CREATE TABLE guru (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL
);

-- id = sha256(token cookie); csrf = token yang wajib dikirim di header X-CSRF
CREATE TABLE sesi_login (
  id TEXT PRIMARY KEY,
  guru_id INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  kedaluwarsa_pada TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL
);

-- Satu sesi kelas = satu tiket yang diperiksa dalam satu pertemuan
CREATE TABLE sesi_kelas (
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  guru_id INTEGER NOT NULL REFERENCES guru(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  dibuka_pada TEXT NOT NULL,
  ditutup_pada TEXT
);

CREATE TABLE kiriman (
  id INTEGER PRIMARY KEY,
  sesi_id INTEGER NOT NULL REFERENCES sesi_kelas(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  kelas TEXT NOT NULL,
  berkas_json TEXT NOT NULL,
  ukuran INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'lulus', 'gagal')),
  hasil_json TEXT,
  dikirim_pada TEXT NOT NULL,
  diperiksa_pada TEXT
);

CREATE INDEX idx_kiriman_sesi ON kiriman (sesi_id, dikirim_pada);
