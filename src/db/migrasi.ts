import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AKAR_PROYEK, bacaKonfigurasi, muatEnv } from '../konfigurasi.js';
import { bukaDatabase, type DB } from './koneksi.js';

// File .sql selalu dibaca dari src/ (ikut ter-deploy lewat git), baik dijalankan dari src maupun dist
export const FOLDER_MIGRASI = path.join(AKAR_PROYEK, 'src', 'db', 'migrasi');

const POLA_NAMA = /^\d{3}_[a-z0-9_]+\.sql$/;

// Migrasi yang membuat ulang tabel (mis. untuk mengubah CHECK) diawali baris ini: foreign key
// dimatikan selama migrasi itu, karena DROP TABLE dengan foreign key menyala ikut menghapus baris
// anak (ON DELETE CASCADE). PRAGMA foreign_keys tidak berlaku di dalam transaksi, jadi diatur di luarnya.
const PENANDA_TANPA_FK = '-- tanpa-foreign-keys';

/**
 * Jalankan file migrasi `NNN_nama.sql` yang belum tercatat, urut nama.
 * Tiap file dijalankan dalam satu transaksi; gagal → dibatalkan dan berhenti.
 * Mengembalikan nama file yang baru dijalankan.
 */
export function jalankanMigrasi(db: DB, folder: string = FOLDER_MIGRASI): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS migrasi (
    nama TEXT PRIMARY KEY,
    dijalankan_pada TEXT NOT NULL
  )`);

  const sudah = new Set(
    db
      .prepare('SELECT nama FROM migrasi')
      .all()
      .map((baris) => (baris as { nama: string }).nama),
  );
  const berkas = readdirSync(folder)
    .filter((nama) => nama.endsWith('.sql'))
    .sort();

  const tidakValid = berkas.filter((nama) => !POLA_NAMA.test(nama));
  if (tidakValid.length > 0) {
    throw new Error(`Nama file migrasi tidak valid (harus NNN_nama.sql): ${tidakValid.join(', ')}`);
  }

  const catat = db.prepare('INSERT INTO migrasi (nama, dijalankan_pada) VALUES (?, ?)');
  const baru: string[] = [];
  for (const nama of berkas) {
    if (sudah.has(nama)) continue;
    const sql = readFileSync(path.join(folder, nama), 'utf8');
    const tanpaFk = sql.trimStart().startsWith(PENANDA_TANPA_FK);
    const fkSemula = db.pragma('foreign_keys', { simple: true });
    if (tanpaFk) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (tanpaFk) {
          const rusak = db.pragma('foreign_key_check') as unknown[];
          if (rusak.length > 0) throw new Error(`Migrasi ${nama} merusak ${rusak.length} relasi foreign key`);
        }
        catat.run(nama, new Date().toISOString());
      })();
    } finally {
      if (tanpaFk) db.pragma(`foreign_keys = ${fkSemula ? 'ON' : 'OFF'}`);
    }
    baru.push(nama);
  }
  return baru;
}

// Dijalankan langsung: npm run db:migrate
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  muatEnv();
  const { dbPath } = bacaKonfigurasi();
  const db = bukaDatabase(dbPath);
  const baru = jalankanMigrasi(db);
  console.log(
    baru.length > 0 ? `Migrasi dijalankan: ${baru.join(', ')}` : 'Tidak ada migrasi baru.',
  );
  db.close();
}
