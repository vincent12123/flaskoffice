import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/konfigurasi.ts dan dist/konfigurasi.js sama-sama satu tingkat di bawah root proyek
export const AKAR_PROYEK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Konfigurasi {
  produksi: boolean;
  port: number;
  host: string;
  dbPath: string;
  cookieSecure: boolean;
  percayaProxy: boolean;
}

function wajibAngka(nama: string, nilai: string): number {
  const angka = Number(nilai);
  if (!Number.isInteger(angka) || angka < 1 || angka > 65535) {
    throw new Error(`${nama} harus berupa nomor port 1–65535, bukan "${nilai}"`);
  }
  return angka;
}

export function bacaKonfigurasi(env: NodeJS.ProcessEnv = process.env): Konfigurasi {
  return {
    produksi: env.NODE_ENV === 'production',
    port: wajibAngka('PORT', env.PORT ?? '3040'),
    host: env.HOST ?? '127.0.0.1',
    dbPath: path.resolve(AKAR_PROYEK, env.DB_PATH ?? 'data/flaskoffice.db'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    percayaProxy: env.TRUST_PROXY === 'true',
  };
}

/** Muat .env dari root proyek bila ada (tanpa dependency dotenv). */
export function muatEnv(): void {
  const berkas = path.join(AKAR_PROYEK, '.env');
  if (existsSync(berkas)) process.loadEnvFile(berkas);
}
