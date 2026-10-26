# Flask Office

Siswa mengerjakan proyek Flask di VS Code lalu mengunggahnya lewat web. Guru menampilkan
kantor pixel-art di proyektor dan memeriksa kiriman satu per satu. Kode siswa dijalankan
**di browser guru** (Pyodide di Web Worker); server hanya menyimpan berkas. Detail keputusan: `SPEC.md`.

## Menjalankan di laptop

```bash
npm install
cp .env.example .env
npm run guru:buat -- nama.guru "Nama Lengkap"   # password diminta lewat prompt
npm run dev                                      # http://127.0.0.1:3040
```

- Halaman siswa: `http://<alamat>/`
- Halaman guru: `http://<alamat>/guru`

Laptop guru butuh internet: Python + Flask (±15 MB) dimuat dari cdn.jsdelivr.net / PyPI saat
pertama kali membuka sesi, lalu tersimpan di cache browser.

## Alur di kelas

1. Guru login di `/guru` → **Buka sesi** → pilih tiket + kelas. Proyektor menampilkan kode sesi + QR.
2. Siswa buka alamat web (atau scan QR) → isi kode sesi, nama, kelas → pilih **folder proyek** atau
   **.zip** → Kirim. Folder `venv`, `__pycache__`, `.git` otomatis tidak ikut.
3. Kiriman masuk antrean di layar guru. Guru klik **Periksa berikutnya**: Developer membawa kode ke
   server, kode diuji, hasil per pemeriksaan tampil besar di proyektor dan di halaman siswa.
4. Siswa yang belum lulus memperbaiki kode lalu mengirim ulang.
5. Akhir pelajaran: **Tutup sesi** dan **Unduh rekap (CSV)**.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server development (auto-restart) |
| `npm test` | Test backend (vitest) |
| `npm run build` / `npm start` | Build TypeScript → `dist/`, jalankan versi build |
| `npm run guru:buat -- <username> "<Nama>"` | Buat akun guru, atau ganti password bila sudah ada |

## Menambah / mengubah tiket

Semua tiket ada di `public/js/level.js`: teks tugas untuk siswa, `kasus` (permintaan yang diuji lewat
`app.test_client()`; opsi `variabel` untuk memeriksa bahwa template memakai variabel), dan `cek`
(pemeriksaan teks kode dengan regex — sebaiknya `saran: true` saja, lihat "Prinsip pemeriksaan" di `SPEC.md`). Server hanya tahu jumlah tiket
(`JUMLAH_LEVEL` di `src/layanan/kelas.ts`); ubah angka itu bila menambah tiket.

## Deploy

Produksi: **https://threejs.sukardi.cloud** di shared hosting Hostinger (`ssh -p 65002 u715621294@88.223.90.200`),
dijalankan LiteSpeed lewat direktif Passenger di `public_html/.htaccess` (tanpa hPanel, tanpa systemd).

| Apa | Di mana |
|---|---|
| Kode (clone repo ini) | `~/domains/threejs.sukardi.cloud/nodejs` |
| `.env` | `nodejs/.env` — `NODE_ENV=production`, `DB_PATH`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` (port diatur LiteSpeed) |
| Database | `~/flaskoffice-data/flaskoffice.db` (di luar folder kode) |
| Log | `nodejs/tmp/console.log` |
| Node | `/opt/alt/alt-nodejs22/root/usr/bin/node` |

Update (**backup `~/flaskoffice-data` dulu**):

```bash
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
cd ~/domains/threejs.sukardi.cloud/nodejs
git pull && npm ci && npm run build && touch tmp/restart.txt
```

Akun guru: `node dist/cli/buat-guru.js <username> "<Nama>"` dari folder yang sama (password diminta lewat prompt).
Migrasi database berjalan otomatis saat aplikasi start.
