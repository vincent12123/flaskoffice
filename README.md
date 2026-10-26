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

Belum dideploy. Rencana mengikuti pola goldenbee di VPS karyabangsa: `flaskoffice.service` di
`127.0.0.1:3040`, subdomain lewat Cloudflare Tunnel, `.env` dengan `COOKIE_SECURE=true` dan
`TRUST_PROXY=true`. **Backup `data/` sebelum update.**
