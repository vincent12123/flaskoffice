import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DB } from '../db/koneksi.js';

export const JUMLAH_LEVEL = 6;
export const JUMLAH_BAB_POS = 16;   // tiket proyek POS: Bab 2–17 (public/js/pos.js)
export const MASA_SESI_KELAS_MS = 12 * 60 * 60 * 1000;   // sesi kelas otomatis tertutup setelah 12 jam
export const SIMPAN_KIRIMAN_HARI = 30;
export const SIMPAN_SESI_DITUTUP_HARI = 90;   // sesi yang sudah ditutup selama ini dihapus otomatis

// Tanpa huruf/angka yang mirip (O/0, I/1/L) supaya mudah dibaca dari proyektor
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type ModeSesi = 'tiket' | 'bebas' | 'pos';
export const MODE_SESI: readonly ModeSesi[] = ['tiket', 'bebas', 'pos'];

export interface SesiKelas {
  id: number;
  kode: string;
  guru_id: number;
  mode: ModeSesi;
  level: number;
  label: string;
  dibuka_pada: string;
  ditutup_pada: string | null;
}

export function normalisasiKode(kode: string): string {
  return kode.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sesiMasihBuka(s: SesiKelas, sekarang: Date): boolean {
  if (s.ditutup_pada) return false;
  return new Date(s.dibuka_pada).getTime() + MASA_SESI_KELAS_MS > sekarang.getTime();
}

export function bukaSesiKelas(
  db: DB, guruId: number, mode: ModeSesi, level: number, label: string, sekarang: Date,
): SesiKelas {
  if (!MODE_SESI.includes(mode)) throw new Error('Mode sesi tidak dikenal');
  if (mode === 'bebas') level = 0;   // tidak dipakai pada proyek bebas
  const batas = mode === 'pos' ? JUMLAH_BAB_POS : JUMLAH_LEVEL;   // pos: level = indeks bab (0 = Bab 2)
  if (!Number.isInteger(level) || level < 0 || level >= batas) throw new Error('Tiket tidak dikenal');
  const labelBersih = label.trim().slice(0, 40);
  for (let coba = 0; coba < 20; coba++) {
    const kode = Array.from({ length: 6 }, () => ALFABET[randomInt(ALFABET.length)]).join('');
    try {
      const hasil = db
        .prepare('INSERT INTO sesi_kelas (kode, guru_id, mode, level, label, dibuka_pada) VALUES (?, ?, ?, ?, ?, ?)')
        .run(kode, guruId, mode, level, labelBersih, sekarang.toISOString());
      return ambilSesiKelas(db, Number(hasil.lastInsertRowid))!;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  throw new Error('Gagal membuat kode sesi');
}

export function ambilSesiKelas(db: DB, id: number): SesiKelas | undefined {
  return db.prepare('SELECT * FROM sesi_kelas WHERE id = ?').get(id) as SesiKelas | undefined;
}

export function cariSesiKelas(db: DB, kode: string): SesiKelas | undefined {
  return db.prepare('SELECT * FROM sesi_kelas WHERE kode = ?').get(normalisasiKode(kode)) as SesiKelas | undefined;
}

export type SaringanSesi = 'aktif' | 'ditutup';

/** Batas waktu: sesi yang dibuka sebelum ini dianggap sudah tertutup otomatis. */
const batasBuka = (sekarang: Date) => new Date(sekarang.getTime() - MASA_SESI_KELAS_MS).toISOString();
const SQL_AKTIF = 'ditutup_pada IS NULL AND dibuka_pada > ?';

export function daftarSesiGuru(db: DB, guruId: number, saringan: SaringanSesi, sekarang: Date) {
  const syarat = saringan === 'aktif' ? SQL_AKTIF : `NOT (${SQL_AKTIF})`;
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM kiriman k WHERE k.sesi_id = s.id) AS jumlah_kiriman
       FROM sesi_kelas s WHERE guru_id = ? AND ${syarat} ORDER BY dibuka_pada DESC LIMIT 500`,
    )
    .all(guruId, batasBuka(sekarang)) as (SesiKelas & { jumlah_kiriman: number })[];
}

export function hitungSesiGuru(db: DB, guruId: number, sekarang: Date): Record<SaringanSesi, number> {
  const b = db
    .prepare(`SELECT SUM(${SQL_AKTIF}) AS aktif, SUM(NOT (${SQL_AKTIF})) AS ditutup FROM sesi_kelas WHERE guru_id = ?`)
    .get(batasBuka(sekarang), batasBuka(sekarang), guruId) as { aktif: number | null; ditutup: number | null };
  return { aktif: b.aktif ?? 0, ditutup: b.ditutup ?? 0 };
}

/** Hapus satu sesi beserta semua kirimannya (permanen). */
export function hapusSesiKelas(db: DB, id: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM kiriman WHERE sesi_id = ?').run(id);
    db.prepare('DELETE FROM sesi_kelas WHERE id = ?').run(id);
  })();
}

/** Hapus semua sesi yang sudah ditutup milik seorang guru. Sesi aktif tidak disentuh. */
export function hapusSesiDitutup(db: DB, guruId: number, sekarang: Date): number {
  return db.transaction(() => {
    const id = db
      .prepare(`SELECT id FROM sesi_kelas WHERE guru_id = ? AND NOT (${SQL_AKTIF})`)
      .all(guruId, batasBuka(sekarang)) as { id: number }[];
    for (const s of id) hapusSesiKelas(db, s.id);
    return id.length;
  })();
}

export function tutupSesiKelas(db: DB, id: number, sekarang: Date): void {
  db.prepare('UPDATE sesi_kelas SET ditutup_pada = ? WHERE id = ? AND ditutup_pada IS NULL').run(sekarang.toISOString(), id);
}

// ---------------------------------------------------------------------------
// Kiriman
// ---------------------------------------------------------------------------

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function bersihkanTeks(s: unknown, maks: number): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maks) : '';
}

export function simpanKiriman(
  db: DB,
  sesiId: number,
  nama: string,
  kelas: string,
  berkas: Record<string, string>,
  ukuran: number,
  sekarang: Date,
): { id: number; token: string } {
  const token = randomBytes(24).toString('base64url');
  const hasil = db
    .prepare(
      `INSERT INTO kiriman (sesi_id, nama, kelas, berkas_json, ukuran, token_hash, dikirim_pada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sesiId, nama, kelas, JSON.stringify(berkas), ukuran, hashToken(token), sekarang.toISOString());
  return { id: Number(hasil.lastInsertRowid), token };
}

export interface RingkasKiriman {
  id: number;
  nama: string;
  kelas: string;
  status: 'menunggu' | 'lulus' | 'gagal';
  dikirim_pada: string;
  diperiksa_pada: string | null;
  ke: number;   // kiriman ke-berapa dari siswa ini di sesi ini
}

export function daftarKiriman(db: DB, sesiId: number): RingkasKiriman[] {
  return db
    .prepare(
      `SELECT id, nama, kelas, status, dikirim_pada, diperiksa_pada,
         ROW_NUMBER() OVER (PARTITION BY lower(nama), lower(kelas) ORDER BY dikirim_pada, id) AS ke
       FROM kiriman WHERE sesi_id = ? ORDER BY dikirim_pada, id`,
    )
    .all(sesiId) as RingkasKiriman[];
}

export function ambilKiriman(db: DB, id: number) {
  return db.prepare('SELECT * FROM kiriman WHERE id = ?').get(id) as
    | { id: number; sesi_id: number; nama: string; kelas: string; berkas_json: string; token_hash: string;
        status: string; hasil_json: string | null; dikirim_pada: string; diperiksa_pada: string | null }
    | undefined;
}

export function kirimanUntukSiswa(db: DB, id: number, token: string) {
  const k = ambilKiriman(db, id);
  if (!k || k.token_hash !== hashToken(token)) return undefined;
  return k;
}

export const TINGKAT = ['bug', 'peringatan', 'saran', 'ok'] as const;
export type Tingkat = (typeof TINGKAT)[number];

export interface ButirHasil {
  label: string;
  lulus: boolean;
  pesan: string;
  saran?: true;
  // khusus proyek bebas
  tingkat?: Tingkat;
  kategori?: string;
  lokasi?: string;
}
export interface Hasil {
  lulus: boolean;
  error?: string;
  butir: ButirHasil[];
  skor?: number;
  ringkasan?: Record<string, number>;
}

const teksOpsional = (v: unknown, maks: number) => (typeof v === 'string' && v ? v.slice(0, maks) : undefined);

/** Validasi hasil pemeriksaan yang dikirim halaman guru. */
export function validasiHasil(masuk: unknown): Hasil | null {
  if (!masuk || typeof masuk !== 'object') return null;
  const { lulus, error, butir, skor, ringkasan } = masuk as Record<string, unknown>;
  if (typeof lulus !== 'boolean' || !Array.isArray(butir) || butir.length > 300) return null;
  const rapi: ButirHasil[] = [];
  for (const b of butir) {
    if (!b || typeof b !== 'object') return null;
    const { label, lulus: l, pesan, saran, tingkat, kategori, lokasi } = b as Record<string, unknown>;
    if (typeof label !== 'string' || typeof l !== 'boolean' || typeof pesan !== 'string') return null;
    if (tingkat !== undefined && !TINGKAT.includes(tingkat as Tingkat)) return null;
    const k = teksOpsional(kategori, 40);
    const lok = teksOpsional(lokasi, 200);
    rapi.push({
      label: label.slice(0, 200), lulus: l, pesan: pesan.slice(0, 600),
      ...(saran === true ? { saran: true as const } : {}),
      ...(tingkat ? { tingkat: tingkat as Tingkat } : {}),
      ...(k ? { kategori: k } : {}),
      ...(lok ? { lokasi: lok } : {}),
    });
  }
  const hasil: Hasil = { lulus, butir: rapi };
  if (typeof error === 'string') hasil.error = error.slice(0, 600);
  if (typeof skor === 'number' && Number.isFinite(skor)) hasil.skor = Math.max(0, Math.min(100, Math.round(skor)));
  if (ringkasan && typeof ringkasan === 'object' && !Array.isArray(ringkasan)) {
    const r: Record<string, number> = {};
    for (const [kunci, nilai] of Object.entries(ringkasan).slice(0, 10)) {
      if (/^[a-z_]{1,20}$/.test(kunci) && typeof nilai === 'number' && Number.isFinite(nilai)) r[kunci] = Math.round(nilai);
    }
    hasil.ringkasan = r;
  }
  return hasil;
}

export function simpanHasil(db: DB, id: number, hasil: Hasil, sekarang: Date): void {
  db.prepare('UPDATE kiriman SET status = ?, hasil_json = ?, diperiksa_pada = ? WHERE id = ?').run(
    hasil.lulus ? 'lulus' : 'gagal',
    JSON.stringify(hasil),
    sekarang.toISOString(),
    id,
  );
}

/** Rekap per siswa (nama + kelas) dalam satu sesi, sebagai baris CSV. */
export function rekapCSV(db: DB, sesiId: number): string {
  const baris = db
    .prepare(
      `SELECT nama, kelas, COUNT(*) AS jumlah,
         SUM(status = 'lulus') AS jumlah_lulus,
         MIN(CASE WHEN status = 'lulus' THEN diperiksa_pada END) AS lulus_pada,
         (SELECT k2.status FROM kiriman k2 WHERE k2.sesi_id = k.sesi_id AND lower(k2.nama) = lower(k.nama)
            AND lower(k2.kelas) = lower(k.kelas) ORDER BY k2.dikirim_pada DESC, k2.id DESC LIMIT 1) AS status_terakhir,
         (SELECT json_extract(k2.hasil_json, '$.skor') FROM kiriman k2 WHERE k2.sesi_id = k.sesi_id AND lower(k2.nama) = lower(k.nama)
            AND lower(k2.kelas) = lower(k.kelas) AND k2.hasil_json IS NOT NULL ORDER BY k2.dikirim_pada DESC, k2.id DESC LIMIT 1) AS skor_terakhir
       FROM kiriman k WHERE sesi_id = ? GROUP BY lower(nama), lower(kelas) ORDER BY kelas, nama`,
    )
    .all(sesiId) as { nama: string; kelas: string; jumlah: number; jumlah_lulus: number; lulus_pada: string | null; status_terakhir: string; skor_terakhir: number | null }[];
  // Nilai diawali = + - @ dinetralkan supaya tidak dieksekusi sebagai rumus oleh Excel
  const sel = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const wib = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16) : '';
  const STATUS: Record<string, string> = { menunggu: 'Belum diperiksa', lulus: 'Lulus', gagal: 'Belum lulus' };
  const kepala = ['Nama', 'Kelas', 'Jumlah kiriman', 'Pernah lulus', 'Lulus pertama (WIB)', 'Status terakhir', 'Skor terakhir'];
  const isi = baris.map((b) =>
    [b.nama, b.kelas, b.jumlah, b.jumlah_lulus > 0 ? 'Ya' : 'Belum', wib(b.lulus_pada),
     STATUS[b.status_terakhir] ?? b.status_terakhir, b.skor_terakhir ?? '']
      .map(sel).join(','),
  );
  return '﻿' + [kepala.map(sel).join(','), ...isi].join('\r\n') + '\r\n';
}

export function hapusKirimanLama(db: DB, sekarang: Date): number {
  const batas = new Date(sekarang.getTime() - SIMPAN_KIRIMAN_HARI * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM kiriman WHERE dikirim_pada < ?').run(batas).changes;
}

/** Hapus sesi yang sudah tertutup (manual atau kedaluwarsa) lebih dari SIMPAN_SESI_DITUTUP_HARI. */
export function hapusSesiLama(db: DB, sekarang: Date): number {
  const batas = new Date(sekarang.getTime() - SIMPAN_SESI_DITUTUP_HARI * 24 * 60 * 60 * 1000).toISOString();
  // waktu tutup = ditutup_pada, atau (untuk sesi kedaluwarsa) dibuka_pada + 12 jam
  const lama = db
    .prepare(`SELECT id FROM sesi_kelas WHERE COALESCE(ditutup_pada, strftime('%Y-%m-%dT%H:%M:%fZ', dibuka_pada, '+12 hours')) < ?`)
    .all(batas) as { id: number }[];
  for (const s of lama) hapusSesiKelas(db, s.id);
  return lama.length;
}
