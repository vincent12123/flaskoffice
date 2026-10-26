# Flask Office — SPEC

## Tujuan

Guru RPL memeriksa proyek Flask siswa **di depan kelas lewat proyektor**. Siswa menulis kode di
VS Code (proyek Flask sungguhan), lalu mengunggahnya lewat web. Di layar guru, kantor pixel-art
"memeriksa" kiriman itu: Developer membawa kode ke server, kode dijalankan dan diuji, lalu QA datang
bila gagal atau catatan ditempel di papan bila lulus. Aplikasi **hanya memeriksa**; penilaian tetap
di tangan guru (rekap CSV disediakan sebagai bantuan).

## Peran

| Peran | Akses | Yang dilakukan |
|---|---|---|
| Guru | Login username + password (akun dibuat lewat CLI) | Buka sesi kelas untuk satu tiket, tampilkan kode sesi + QR, periksa kiriman satu per satu, tutup sesi, unduh rekap |
| Siswa | Tanpa akun; cukup kode sesi + nama + kelas | Baca tiket, unggah folder/zip proyek, lihat hasil pemeriksaan, unggah ulang |

## Tiket (level)

1. Nyalakan server — `/` menampilkan `Halo, Dunia!`
2. Halaman profil — `/profil` menampilkan `SMK Karya Bangsa`
3. Beranda bertemplate — `render_template('index.html')`, `{{ }}`, `{% for %}`
4. Halaman per jurusan — `/jurusan/<int:nomor>`, `abort(404)`
5. Form tambah tugas — `methods=['GET','POST']`, `request.form`
6. Post/Redirect/Get — `redirect(url_for(...))`, `url_for` di `action` form

Definisi tiket + kasus uji ada di `public/js/level.js` (satu sumber untuk halaman siswa & guru).

## Mode proyek bebas

Guru memilih **Proyek bebas** saat membuka sesi: aplikasi Flask apa pun diperiksa (entry `app.py`,
`main.py`, `run.py`, …, atau paket factory `create_app`). Pemeriksa (`public/js/pemeriksa_bebas.py`):

1. Menjalankan app seperti `python app.py` (blok `__main__` ikut jalan, `app.run` dimatikan);
   paket yang diimpor dipasang dari daftar putih (Flask-SQLAlchemy, Flask-Login, Flask-WTF, dll.).
2. Membuka semua route GET (route berparameter dicoba dengan nilai contoh dan nilai yang pasti tidak
   ada), mengikuti link, memeriksa berkas static.
3. Mengisi & mengirim semua form (daftar → login → sisanya), juga sekali dalam keadaan kosong;
   lalu menjelajah ulang (data sudah ada, sudah login). Link logout dilewati.
4. Memeriksa template (sintaks Jinja, `|safe`, struktur & kelengkapan HTML, aksesibilitas) dan kode
   Python (pyflakes, SQL f-string, password tanpa hash, `secret_key`, `debug=True`).

Laporan: 🔴 bug (menentukan "Ada bug"), 🟡 peringatan, 🔵 saran, ✅ berjalan baik, plus skor 0–100
(pengurangan dibatasi per tingkat). Batas waktu 60 detik; bila habis, temuan yang sudah terkumpul
tetap ditampilkan. Penilaian kerapian tampilan secara subjektif **tidak** dilakukan (tanpa AI).

## Prinsip pemeriksaan

Siswa menulis dengan gaya berbeda-beda; yang dinilai adalah **perilaku**, bukan cara menulis.

- **Kasus uji (penentu lulus):** aplikasi dijalankan dan diberi permintaan HTTP lewat
  `app.test_client()`; dinilai kode status, tujuan redirect, dan isi halaman. Pencocokan isi
  halaman **longgar**: huruf besar/kecil dan spasi/baris baru diabaikan (siswa sudah menguji di
  komputernya sendiri).
- **Variabel template (Tiket #3):** direkam lewat sinyal `template_rendered`, lalu template
  dirender ulang dengan nilai diganti penanda. Nama variabel, bentuk data (string, list, dict,
  class), dan nama berkas template bebas.
- **Saran (tidak menentukan lulus):** hal yang tidak terlihat dari perilaku, mis. memakai
  `url_for` dan bukan alamat langsung. Tampil sebagai catatan kuning untuk dibahas di kelas.
- Pencocokan teks kode (regex) yang menentukan lulus **tidak dipakai lagi**, karena menolak kode
  yang benar tetapi ditulis berbeda.

## Keputusan keamanan (tidak boleh dilanggar)

- **Kode siswa tidak pernah dijalankan di server.** Server hanya menyimpan teks berkas. Kode
  dijalankan di **Web Worker** di browser guru (Pyodide), dengan batas waktu; worker dihentikan
  bila melewatinya.
- API guru butuh **cookie sesi (httpOnly) + header `X-CSRF`**. Token CSRF hanya ada di memori
  halaman guru (sessionStorage), sehingga kode siswa di dalam worker — yang bisa memanggil `fetch`
  dengan cookie — tetap tidak bisa memakai API guru.
- Kiriman dibatasi: hanya `app.py`/`*.py` di akar proyek, `templates/**/*.html`, `static/**/*.css`;
  maks 50 berkas, 200 KB per berkas, 512 KB total; folder `venv`, `__pycache__`, `.git`, dll.
  diabaikan. Path dengan `..` ditolak.
- Nama siswa & isi kode selalu ditampilkan sebagai teks (escape), tidak pernah sebagai HTML.
- Kiriman dihapus otomatis setelah 30 hari.

## Kriteria penerimaan (ringkas)

- Guru dapat login, membuka sesi untuk tiket tertentu, melihat kode sesi + QR.
- Siswa dengan kode sesi valid dapat mengunggah folder atau zip; kiriman muncul di antrean guru ≤ 5 detik.
- Kiriman tanpa `app.py`, terlalu besar, atau ke sesi yang sudah ditutup ditolak dengan pesan jelas.
- Guru memeriksa kiriman; hasil per kasus uji tampil di proyektor dan di halaman siswa ≤ 5 detik.
- Kode dengan perulangan tanpa henti tidak membekukan halaman guru (dihentikan ≤ 15 detik).
- Rekap sesi dapat diunduh sebagai CSV (nama, kelas, jumlah kiriman, status terakhir).

## Deploy (nanti)

Pola sama dengan goldenbee: `flaskoffice.service` di `127.0.0.1:3040`, subdomain lewat Cloudflare
Tunnel, SQLite `data/flaskoffice.db`. **Belum dideploy** — butuh konfirmasi pemilik server.
