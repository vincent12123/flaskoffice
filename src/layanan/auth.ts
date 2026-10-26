import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DB } from '../db/koneksi.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opsi: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Parameter scrypt (≈ 32 MB memori, ±100 ms per hash di VPS) — sama dengan goldenbee
const N = 2 ** 15;
const R = 8;
const P = 1;
const PANJANG_KUNCI = 64;
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 10;
export const MASA_SESI_MS = 12 * 60 * 60 * 1000;
export const POLA_USERNAME = /^[a-z0-9._]{3,32}$/;

/** Format: scrypt$N$r$p$salt(base64)$hash(base64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const kunci = await scryptAsync(password, salt, PANJANG_KUNCI, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), kunci.toString('base64')].join('$');
}

export async function cocokPassword(password: string, tersimpan: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = tersimpan.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const harapan = Buffer.from(hash, 'base64');
  const kunci = await scryptAsync(password, Buffer.from(salt, 'base64'), harapan.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(kunci, harapan);
}

// Hash tiruan agar waktu respons login sama saat username tidak ada
let hashTiruan: Promise<string> | undefined;

export interface Guru {
  id: number;
  username: string;
  nama: string;
}

/** Cek username + password. `null` bila salah (tanpa membedakan penyebabnya). */
export async function periksaLogin(db: DB, username: string, password: string): Promise<Guru | null> {
  const baris = db
    .prepare('SELECT id, username, nama, password_hash FROM guru WHERE username = ?')
    .get(username.trim().toLowerCase()) as (Guru & { password_hash: string }) | undefined;
  if (!baris) {
    hashTiruan ??= hashPassword(randomBytes(16).toString('hex'));
    await cocokPassword(password, await hashTiruan);
    return null;
  }
  if (!(await cocokPassword(password, baris.password_hash))) return null;
  return { id: baris.id, username: baris.username, nama: baris.nama };
}

export async function buatGuru(db: DB, username: string, nama: string, password: string): Promise<number> {
  const u = username.trim().toLowerCase();
  if (!POLA_USERNAME.test(u)) throw new Error('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah');
  if (password.length < PASSWORD_MIN) throw new Error(`Password minimal ${PASSWORD_MIN} karakter`);
  if (!nama.trim()) throw new Error('Nama wajib diisi');
  const hasil = db
    .prepare('INSERT INTO guru (username, nama, password_hash, dibuat_pada) VALUES (?, ?, ?, ?)')
    .run(u, nama.trim(), await hashPassword(password), new Date().toISOString());
  return Number(hasil.lastInsertRowid);
}

export async function gantiPasswordGuru(db: DB, username: string, password: string): Promise<boolean> {
  if (password.length < PASSWORD_MIN) throw new Error(`Password minimal ${PASSWORD_MIN} karakter`);
  const hasil = db
    .prepare('UPDATE guru SET password_hash = ? WHERE username = ?')
    .run(await hashPassword(password), username.trim().toLowerCase());
  if (hasil.changes > 0) {
    db.prepare('DELETE FROM sesi_login WHERE guru_id = (SELECT id FROM guru WHERE username = ?)').run(
      username.trim().toLowerCase(),
    );
  }
  return hasil.changes > 0;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Buat sesi login. Token asli masuk cookie; DB hanya menyimpan hash-nya. */
export function buatSesiLogin(db: DB, guruId: number, sekarang: Date): { token: string; csrf: string } {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const waktu = sekarang.toISOString();
  db.prepare('DELETE FROM sesi_login WHERE kedaluwarsa_pada <= ?').run(waktu);
  db.prepare(
    'INSERT INTO sesi_login (id, guru_id, csrf, kedaluwarsa_pada, dibuat_pada) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), guruId, csrf, new Date(sekarang.getTime() + MASA_SESI_MS).toISOString(), waktu);
  return { token, csrf };
}

/**
 * Guru dari cookie + header CSRF. Keduanya wajib cocok: cookie saja tidak cukup, supaya kode
 * siswa yang berjalan di Web Worker halaman guru (bisa `fetch` dengan cookie) tidak bisa
 * memakai API guru.
 */
export function guruDariSesi(
  db: DB,
  token: string | undefined,
  csrf: string | undefined,
  sekarang: Date,
): Guru | null {
  if (!token || !csrf) return null;
  const baris = db
    .prepare(
      `SELECT g.id, g.username, g.nama, s.csrf, s.kedaluwarsa_pada
       FROM sesi_login s JOIN guru g ON g.id = s.guru_id WHERE s.id = ?`,
    )
    .get(hashToken(token)) as (Guru & { csrf: string; kedaluwarsa_pada: string }) | undefined;
  if (!baris) return null;
  if (baris.kedaluwarsa_pada <= sekarang.toISOString()) {
    hapusSesiLogin(db, token);
    return null;
  }
  const a = Buffer.from(baris.csrf);
  const b = Buffer.from(csrf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: baris.id, username: baris.username, nama: baris.nama };
}

export function hapusSesiLogin(db: DB, token: string): void {
  db.prepare('DELETE FROM sesi_login WHERE id = ?').run(hashToken(token));
}
