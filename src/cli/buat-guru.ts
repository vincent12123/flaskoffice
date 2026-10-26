/**
 * Membuat akun guru (atau mengganti password bila username sudah ada).
 *   npm run guru:buat -- <username> "<Nama Lengkap>"
 * Password diminta lewat prompt agar tidak tersimpan di riwayat shell.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { bacaKonfigurasi, muatEnv } from '../konfigurasi.js';
import { bukaDatabase } from '../db/koneksi.js';
import { jalankanMigrasi } from '../db/migrasi.js';
import { buatGuru, gantiPasswordGuru } from '../layanan/auth.js';

const [username, nama] = process.argv.slice(2);
if (!username) {
  console.error('Pakai: npm run guru:buat -- <username> "<Nama Lengkap>"');
  process.exit(1);
}

muatEnv();
const db = bukaDatabase(bacaKonfigurasi().dbPath);
jalankanMigrasi(db);

const rl = createInterface({ input: stdin, output: stdout });
const password = process.env.GURU_PASSWORD ?? (await rl.question('Password (min. 10 karakter): '));
rl.close();

try {
  const ada = db.prepare('SELECT 1 FROM guru WHERE username = ?').get(username.trim().toLowerCase());
  if (ada) {
    await gantiPasswordGuru(db, username, password);
    console.log(`Password guru "${username}" diganti. Semua sesi login lamanya dicabut.`);
  } else {
    await buatGuru(db, username, nama ?? username, password);
    console.log(`Akun guru "${username}" dibuat.`);
  }
} catch (e) {
  console.error('Gagal:', (e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
