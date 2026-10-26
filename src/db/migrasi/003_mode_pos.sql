-- tanpa-foreign-keys
-- 'pos' = tiket proyek SMK Mart POS per bab (level = indeks bab, 0 = Bab 2).
-- SQLite tidak bisa mengubah CHECK pada kolom, jadi tabel dibuat ulang. Foreign key dimatikan
-- selama migrasi ini (lihat migrasi.ts) supaya DROP TABLE tidak ikut menghapus kiriman (ON DELETE CASCADE).
CREATE TABLE sesi_kelas_baru (
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  guru_id INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  dibuka_pada TEXT NOT NULL,
  ditutup_pada TEXT,
  mode TEXT NOT NULL DEFAULT 'tiket' CHECK (mode IN ('tiket', 'bebas', 'pos'))
);
INSERT INTO sesi_kelas_baru (id, kode, guru_id, level, label, dibuka_pada, ditutup_pada, mode)
  SELECT id, kode, guru_id, level, label, dibuka_pada, ditutup_pada, mode FROM sesi_kelas;
DROP TABLE sesi_kelas;
ALTER TABLE sesi_kelas_baru RENAME TO sesi_kelas;
