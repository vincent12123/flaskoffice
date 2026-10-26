import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bukaDatabase } from '../src/db/koneksi.js';
import { FOLDER_MIGRASI, jalankanMigrasi } from '../src/db/migrasi.js';

const sementara: string[] = [];
afterEach(() => { for (const d of sementara.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Folder migrasi berisi sebagian file saja (untuk mensimulasikan database lama). */
function folderSebagian(...nama: string[]): string {
  const d = mkdtempSync(path.join(tmpdir(), 'fo-migrasi-'));
  sementara.push(d);
  for (const n of nama) copyFileSync(path.join(FOLDER_MIGRASI, n), path.join(d, n));
  return d;
}

describe('migrasi 003_mode_pos', () => {
  it('membuat ulang sesi_kelas tanpa menghapus kiriman, lalu menerima mode pos', () => {
    const db = bukaDatabase(':memory:');
    jalankanMigrasi(db, folderSebagian('001_skema_awal.sql', '002_mode_sesi.sql'));
    db.prepare("INSERT INTO guru (id, username, nama, password_hash, dibuat_pada) VALUES (1, 'g', 'G', 'x', '2026-01-01')").run();
    db.prepare("INSERT INTO sesi_kelas (id, kode, guru_id, level, label, dibuka_pada, mode) VALUES (7, 'ABC234', 1, 2, 'XI', '2026-01-01', 'bebas')").run();
    db.prepare("INSERT INTO kiriman (sesi_id, nama, kelas, berkas_json, ukuran, token_hash, dikirim_pada) VALUES (7, 'Ani', 'XI', '{}', 2, 'h', '2026-01-01')").run();
    expect(() => db.prepare("UPDATE sesi_kelas SET mode = 'pos' WHERE id = 7").run()).toThrow(/CHECK/);

    expect(jalankanMigrasi(db)).toEqual(['003_mode_pos.sql']);

    expect(db.prepare('SELECT COUNT(*) AS n FROM kiriman WHERE sesi_id = 7').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT kode, mode, level FROM sesi_kelas WHERE id = 7').get()).toEqual({ kode: 'ABC234', mode: 'bebas', level: 2 });
    db.prepare("UPDATE sesi_kelas SET mode = 'pos' WHERE id = 7").run();
    expect(() => db.prepare("UPDATE sesi_kelas SET mode = 'lain' WHERE id = 7").run()).toThrow(/CHECK/);
    // foreign key menyala lagi dan relasi tetap bekerja: hapus sesi → kiriman ikut terhapus
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('DELETE FROM sesi_kelas WHERE id = 7').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM kiriman').get()).toEqual({ n: 0 });
  });
});
