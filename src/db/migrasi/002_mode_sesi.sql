-- 'tiket' = diperiksa sesuai tiket (level); 'bebas' = proyek Flask apa pun, laporan kesehatan app
ALTER TABLE sesi_kelas ADD COLUMN mode TEXT NOT NULL DEFAULT 'tiket' CHECK (mode IN ('tiket', 'bebas'));
