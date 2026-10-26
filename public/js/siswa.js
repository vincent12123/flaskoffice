import { LEVEL, daftarPemeriksaan } from '/js/level.js';
import { BAB_POS, judulPos, urlBab } from '/js/pos.js';
import { gambarLaporan } from '/js/laporan.js';
import { adaAplikasi, bacaDaftarBerkas, bacaSeret, bacaZip } from '/js/berkas.js';

const $ = (id) => document.getElementById(id);
const KUNCI = 'flaskoffice-siswa';

let data = {};
try { data = JSON.parse(localStorage.getItem(KUNCI)) || {}; } catch {}
const simpan = () => { try { localStorage.setItem(KUNCI, JSON.stringify(data)); } catch {} };

let siapKirim = null;   // berkas hasil baca, menunggu tombol Kirim
let timerPantau = null;

async function api(url, opsi = {}) {
  const r = await fetch(url, opsi);
  const isi = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(isi.pesan || `Gagal (${r.status})`);
  return isi;
}

// ---------------------------------------------------------------------
// Langkah 1: masuk
// ---------------------------------------------------------------------
const dariUrl = new URLSearchParams(location.search).get('sesi');
$('kode').value = dariUrl || data.kode || '';
$('nama').value = data.nama || '';
$('kelas').value = data.kelas || '';

$('form-masuk').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('galat-masuk').textContent = '';
  const kode = $('kode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nama = $('nama').value.trim();
  const kelas = $('kelas').value.trim();
  if (!kode) return tampilGalat('galat-masuk', 'Isi kode sesi dari layar proyektor.', 'kode');
  if (nama.length < 2) return tampilGalat('galat-masuk', 'Isi nama lengkap.', 'nama');
  if (!kelas) return tampilGalat('galat-masuk', 'Isi kelas, misalnya XI RPL 1.', 'kelas');
  try {
    const sesi = await api(`/api/sesi/${encodeURIComponent(kode)}`);
    if (data.kode !== sesi.kode) delete data.kiriman;
    Object.assign(data, { kode: sesi.kode, nama, kelas });
    simpan();
    tampilkanSesi(sesi);
  } catch (err) {
    tampilGalat('galat-masuk', err.message, 'kode');
  }
});

/** Penunjuk langkah di atas halaman: 1 = masuk, 2 = kirim proyek, 3 = lihat hasil. */
function setLangkah(n) {
  [1, 2, 3].forEach((i) => {
    const el = $(`penanda-${i}`);
    el.classList.toggle('aktif', i === n);
    el.classList.toggle('selesai', i < n);
    if (i === n) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
  });
}

function tampilGalat(idGalat, pesan, idFokus) {
  $(idGalat).textContent = pesan;
  if (idFokus) $(idFokus).focus();
}

$('ganti').addEventListener('click', (e) => {
  e.preventDefault();
  clearInterval(timerPantau);
  $('langkah-kirim').classList.remove('tampil');
  $('langkah-masuk').classList.add('tampil');
  setLangkah(1);
  $('kode').focus();
});

// ---------------------------------------------------------------------
// Langkah 2: tiket + unggah
// ---------------------------------------------------------------------
function tampilkanSesi(sesi) {
  const L = sesi.mode === 'bebas' ? PROYEK_BEBAS : sesi.mode === 'pos' ? tiketPos(sesi.level) : LEVEL[sesi.level];
  data.mode = sesi.mode;
  $('langkah-masuk').classList.remove('tampil');
  $('langkah-kirim').classList.add('tampil');
  setLangkah(2);
  $('info-sesi').textContent = `Sesi ${sesi.kode}${sesi.label ? ' · ' + sesi.label : ''}${sesi.buka ? '' : ' · SUDAH DITUTUP'}`;
  $('judul-tiket').textContent = L.judul;
  $('isi-tiket').innerHTML = L.tugas;           // teks tiket berasal dari level.js (bukan input pengguna)
  $('konsep-tiket').textContent = L.konsep ? `Konsep: ${L.konsep}` : '';
  $('kotak-petunjuk').hidden = !L.petunjuk;
  $('petunjuk-tiket').innerHTML = L.petunjuk || '';
  const daftar = sesi.mode === 'bebas' || sesi.mode === 'pos' ? L.periksa : daftarPemeriksaan(L);
  $('daftar-periksa').replaceChildren(...daftar.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  $('saya').textContent = `${data.nama} (${data.kelas})`;
  ['pilih-folder', 'pilih-zip'].forEach((id) => { $(id).disabled = !sesi.buka; });
  if (!sesi.buka) $('galat-kirim').textContent = 'Sesi ini sudah ditutup guru. Minta kode sesi yang baru.';
  if (data.kiriman) pantau();
}

// Teks untuk sesi proyek bebas (tidak ada tiket; aplikasi Flask apa pun diperiksa)
const PROYEK_BEBAS = {
  judul: 'Proyek bebas — pemeriksaan aplikasi Flask',
  tugas: 'Kirim proyek Flask kamu, apa pun isinya. Pastikan aplikasinya sudah kamu jalankan dan coba sendiri di komputermu. Pemeriksa akan menjalankan aplikasimu, membuka semua halaman, mengisi semua form, lalu memberi laporan.',
  periksa: [
    'Aplikasi bisa dijalankan (tidak ada salah ketik / import yang gagal)',
    'Semua halaman terbuka tanpa error, termasuk halaman berparameter seperti /data/<id>',
    'Semua form bisa dikirim, juga saat dikirim kosong',
    'Link dan berkas static (CSS, JS, gambar) tidak ada yang rusak',
    'Template HTML: penulisan Jinja, tag yang tertutup, title, viewport, label, alt gambar',
    'Keamanan: query SQL, |safe, password tanpa hash',
    'Kode Python: nama yang belum didefinisikan, import yang tidak dipakai',
  ],
};

// Teks untuk sesi proyek POS (SMK Mart): satu bab tutorial, diperiksa dengan test resmi
function tiketPos(i) {
  const B = BAB_POS[i];
  return {
    judul: judulPos(i),
    tugas: `Kerjakan <a href="${urlBab(i)}" target="_blank" rel="noopener">Bab ${B.bab} di tutorial SMK Mart POS</a> sampai semua titik periksanya beres, lalu kirim <b>seluruh folder proyek</b> (folder yang berisi <code>app/</code>, <code>config.py</code>, dan <code>tests/</code>).
      <ul>
        <li>Folder <code>.venv</code>, <code>instance</code>, dan berkas <code>.env</code> otomatis tidak ikut terkirim.</li>
        <li>Pemeriksa memakai <b>test resmi</b> dari Paket Starter, bukan isi folder <code>tests/</code> milikmu.</li>
        <li>Test dari bab-bab sebelumnya ikut dijalankan: fitur lama tidak boleh rusak.</li>
      </ul>`,
    periksa: [...B.titik, ...(i > 0 ? [`Semua test Bab 2–${B.bab - 1} tetap hijau`] : [])],
  };
}

$('pilih-folder').onclick = () => $('input-folder').click();
$('pilih-zip').onclick = () => $('input-zip').click();
$('input-folder').onchange = (e) => baca(() => bacaDaftarBerkas(e.target.files));
$('input-zip').onchange = (e) => e.target.files[0] && baca(() => bacaZip(e.target.files[0]));

const zona = $('zona');
zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('aktif'); });
zona.addEventListener('dragleave', () => zona.classList.remove('aktif'));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  zona.classList.remove('aktif');
  baca(() => bacaSeret(e.dataTransfer.items));
});

async function baca(fn) {
  $('galat-kirim').textContent = '';
  try {
    const berkas = await fn();
    if (!adaAplikasi(berkas)) {
      throw new Error('Tidak ditemukan berkas aplikasi Flask (app.py, main.py, run.py, …). Pastikan yang dipilih adalah folder proyek Flask kamu.');
    }
    siapKirim = berkas;
    $('daftar-berkas').replaceChildren(...berkas.map((b) => Object.assign(document.createElement('li'), { textContent: b.path, title: b.path })));
    $('jumlah-berkas').textContent = `${berkas.length} berkas siap dikirim`;
    $('pratinjau').hidden = false;
    $('kirim').focus();
  } catch (err) {
    $('galat-kirim').textContent = err.message;
  } finally {
    $('input-folder').value = '';
    $('input-zip').value = '';
  }
}

$('batal').onclick = () => { siapKirim = null; $('pratinjau').hidden = true; };

$('kirim').onclick = async () => {
  if (!siapKirim) return;
  $('kirim').disabled = true;
  $('galat-kirim').textContent = '';
  try {
    const r = await api(`/api/sesi/${data.kode}/kiriman`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama: data.nama, kelas: data.kelas, berkas: siapKirim }),
    });
    data.kiriman = { id: r.id, token: r.token };
    simpan();
    siapKirim = null;
    $('pratinjau').hidden = true;
    pantau();
  } catch (err) {
    $('galat-kirim').textContent = err.message;
  } finally {
    $('kirim').disabled = false;
  }
};

// ---------------------------------------------------------------------
// Pantau status kiriman sampai diperiksa guru
// ---------------------------------------------------------------------
function pantau() {
  clearInterval(timerPantau);
  $('kartu-status').hidden = false;
  setLangkah(3);
  const cek = async () => {
    try {
      const s = await api(`/api/kiriman/${data.kiriman.id}`, { headers: { 'X-Token': data.kiriman.token } });
      tampilStatus(s);
      if (s.status !== 'menunggu') clearInterval(timerPantau);
    } catch {
      $('status-teks').textContent = 'Tidak bisa memeriksa status. Mencoba lagi…';
    }
  };
  cek();
  timerPantau = setInterval(cek, 3000);
}

function tampilStatus(s) {
  const teks = $('status-teks');
  const daftar = $('hasil');
  // kotak status: jam pasir berputar saat menunggu, centang hijau / silang saat sudah diperiksa
  $('kotak-status').className = `status ${s.status}`;
  $('tanda-status').textContent = { menunggu: '⏳', lulus: '✓', gagal: '!' }[s.status] ?? '•';
  if (s.status === 'menunggu') {
    teks.textContent = s.antre > 0
      ? `Terkirim. Menunggu giliran diperiksa (${s.antre} kiriman di depanmu). Lihat ke layar proyektor.`
      : 'Terkirim. Menunggu guru memeriksa di layar proyektor…';
    daftar.replaceChildren();
    return;
  }
  const bebas = typeof s.hasil?.skor === 'number';
  const bug = s.hasil?.ringkasan?.bug ?? 0;
  teks.textContent = bebas
    ? (s.status === 'lulus' ? `Tidak ada bug. Skor ${s.hasil.skor}. Lihat saran di bawah untuk merapikan.` : `Ditemukan ${bug} bug. Skor ${s.hasil.skor}. Perbaiki lalu kirim ulang.`)
    : (s.status === 'lulus' ? 'Lulus! Semua pemeriksaan berhasil.' : 'Belum lulus. Perbaiki kodenya lalu kirim ulang.');
  if (s.hasil) gambarLaporan(daftar, s.hasil, { tampilSelesai: false });
}

// Langsung masuk bila data sesi tersimpan dan sesuai dengan URL
if (data.kode && data.nama && data.kelas && (!dariUrl || dariUrl.toUpperCase() === data.kode)) {
  api(`/api/sesi/${data.kode}`).then(tampilkanSesi).catch(() => {});
}
