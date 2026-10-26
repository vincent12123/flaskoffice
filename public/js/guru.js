import { LEVEL } from '/js/level.js';
import { BAB_POS, cekPos, judulPos, ujiPos } from '/js/pos.js';
import { buatKantor } from '/js/kantor.js';
import { Penguji } from '/js/penguji.js';
import { gambarLaporan } from '/js/laporan.js';

const $ = (id) => document.getElementById(id);
const KUNCI_CSRF = 'fo-csrf';

// Token CSRF hanya disimpan di sessionStorage halaman ini; Web Worker penguji tidak bisa membacanya.
let csrf = sessionStorage.getItem(KUNCI_CSRF) || '';

async function api(url, opsi = {}) {
  const r = await fetch(url, { ...opsi, headers: { 'X-CSRF': csrf, ...(opsi.body ? { 'Content-Type': 'application/json' } : {}), ...opsi.headers } });
  if (r.status === 401 && !url.endsWith('/login')) { tampilLayar('login'); throw new Error('Silakan login lagi.'); }
  const isi = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(isi.pesan || `Gagal (${r.status})`);
  return isi;
}

function tampilLayar(nama) {
  for (const id of ['login', 'daftar', 'sesi']) $(`layar-${id}`).classList.toggle('tampil', id === nama);
  if (nama !== 'sesi') clearInterval(timerSesi);
  if (nama === 'login') $('username').focus();
}

const waktu = (iso) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const td = (teks) => Object.assign(document.createElement('td'), { textContent: teks });

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('galat-login').textContent = '';
  try {
    const r = await api('/api/guru/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
    csrf = r.csrf;
    sessionStorage.setItem(KUNCI_CSRF, csrf);
    $('password').value = '';
    bukaDaftar();
  } catch (err) {
    $('galat-login').textContent = err.message;
  }
});

$('keluar').onclick = async () => {
  await api('/api/guru/logout', { method: 'POST', body: '{}' }).catch(() => {});
  sessionStorage.removeItem(KUNCI_CSRF);
  csrf = '';
  tampilLayar('login');
};

// ---------------------------------------------------------------------
// Daftar sesi
// ---------------------------------------------------------------------
// Pilihan tiket mengikuti jenis pemeriksaan: tiket latihan (LEVEL) atau bab proyek POS (BAB_POS)
$('pilih-mode').onchange = () => {
  const mode = $('pilih-mode').value;
  $('wadah-level').hidden = mode === 'bebas';
  $('label-level').textContent = mode === 'pos' ? 'Bab yang diperiksa (test bab sebelumnya ikut dijalankan)' : 'Tiket yang diperiksa';
  const judul = mode === 'pos' ? BAB_POS.map((_, i) => judulPos(i)) : LEVEL.map((L) => L.judul);
  $('pilih-level').replaceChildren(...judul.map((j, i) => Object.assign(document.createElement('option'), { value: i, textContent: j })));
};
$('pilih-mode').onchange();
const namaPemeriksaan = (s) => (s.mode === 'bebas' ? 'Proyek bebas' : s.mode === 'pos' ? judulPos(s.level) : LEVEL[s.level]?.judul ?? '?');

let saringan = 'aktif';

/**
 * Konfirmasi dua klik di dalam halaman (tanpa confirm(), yang diblokir di sebagian browser):
 * klik pertama mengubah tombol menjadi peringatan merah, klik kedua dalam 5 detik menjalankan aksi.
 */
function duaKlik(tombol, teksYakin, aksi) {
  const asli = tombol.textContent;
  let timer = null;
  tombol.onclick = async () => {
    if (!timer) {
      tombol.textContent = teksYakin;
      tombol.classList.add('bahaya');
      timer = setTimeout(() => { timer = null; tombol.textContent = asli; tombol.classList.remove('bahaya'); }, 5000);
      return;
    }
    clearTimeout(timer);
    timer = null;
    tombol.disabled = true;
    try {
      await aksi();
    } catch (err) {
      $('galat-daftar').textContent = err.message;
      tombol.disabled = false;
      tombol.textContent = asli;
      tombol.classList.remove('bahaya');
    }
  };
}

const tombolKecil = (teks, onclick) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: teks });
  if (onclick) b.onclick = onclick;
  return b;
};

async function bukaDaftar() {
  const saya = await api('/api/guru/saya');
  $('nama-guru').textContent = saya.nama;
  $('galat-daftar').textContent = '';
  const { jumlah, sesi: daftar } = await api(`/api/guru/sesi?status=${saringan}`);
  $('jml-aktif').textContent = `(${jumlah.aktif})`;
  $('jml-ditutup').textContent = `(${jumlah.ditutup})`;
  document.querySelectorAll('[data-saring]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.saring === saringan)));
  $('info-ditutup').hidden = saringan !== 'ditutup';
  const tombolSemua = $('hapus-ditutup');
  tombolSemua.hidden = saringan !== 'ditutup' || jumlah.ditutup === 0;
  tombolSemua.disabled = false;
  tombolSemua.classList.remove('bahaya');
  tombolSemua.textContent = `Hapus semua yang ditutup (${jumlah.ditutup})`;
  duaKlik(tombolSemua, `Yakin hapus ${jumlah.ditutup} sesi? Klik lagi`, async () => {
    await api('/api/guru/sesi-ditutup/hapus', { method: 'POST', body: '{}' });
    await bukaDaftar();
  });

  $('tabel-sesi').replaceChildren(...daftar.map((s) => {
    const tr = document.createElement('tr');
    const tdKode = document.createElement('td');
    tdKode.append(tombolKecil(s.kode, () => bukaSesi(s.kode)));
    tdKode.firstChild.className = 'mono';
    const tdAksi = document.createElement('td');
    const aksi = Object.assign(document.createElement('div'), { className: 'aksi' });
    if (s.buka) {
      aksi.append(tombolKecil('Buka', () => bukaSesi(s.kode)));
    } else {
      aksi.append(tombolKecil('Lihat', () => bukaSesi(s.kode)), tombolKecil('Rekap', () => unduhRekap(s.kode)));
      const hapus = tombolKecil('Hapus');
      duaKlik(hapus, 'Yakin? Klik lagi', async () => {
        await api(`/api/guru/sesi/${s.kode}`, { method: 'DELETE' });
        await bukaDaftar();
      });
      aksi.append(hapus);
    }
    tdAksi.append(aksi);
    tr.append(tdKode, td(namaPemeriksaan(s)), td(s.label), td(waktu(s.dibuka_pada)), td(String(s.jumlah_kiriman)), tdAksi);
    return tr;
  }));
  if (!daftar.length) {
    const tr = document.createElement('tr');
    const sel = td(saringan === 'aktif' ? 'Belum ada sesi aktif. Buka sesi baru di atas.' : 'Tidak ada sesi yang ditutup.');
    sel.colSpan = 6;
    tr.append(sel);
    $('tabel-sesi').replaceChildren(tr);
  }
  tampilLayar('daftar');
}

document.querySelectorAll('[data-saring]').forEach((b) => {
  b.onclick = () => { saringan = b.dataset.saring; bukaDaftar(); };
});

$('form-sesi').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('galat-sesi').textContent = '';
  try {
    const s = await api('/api/guru/sesi', { method: 'POST', body: JSON.stringify({ mode: $('pilih-mode').value, level: Number($('pilih-level').value), label: $('label-sesi').value }) });
    bukaSesi(s.kode);
  } catch (err) {
    $('galat-sesi').textContent = err.message;
  }
});

// ---------------------------------------------------------------------
// Tampilan proyektor
// ---------------------------------------------------------------------
// Kantor 3D voxel (three.js) dipakai bila WebGL2 tersedia; kantor SVG tetap menjadi cadangan
// dan bisa dipilih manual. Pilihan guru diingat per browser.
const KUNCI_KANTOR = 'fo-kantor';
const kantorDibuat = {};      // '2d' | '3d' → objek kantor, dibuat saat pertama dipakai
let kantor = null;
let modeKantor = null;
let namaLulus = [];
let sesi = null;          // data sesi terakhir dari server

function pilihanKantor() {
  try { return localStorage.getItem(KUNCI_KANTOR) === '2d' ? '2d' : '3d'; } catch { return '3d'; }
}

async function pakaiKantor(mode) {
  let k = kantorDibuat[mode];
  if (!k && mode === '3d') {
    try {
      const { buatKantor3D, dukungWebGL } = await import('/js/kantor3d.js');
      if (!dukungWebGL()) throw new Error('WebGL2 tidak tersedia');
      k = buatKantor3D($('wadah-kantor'));
    } catch (err) {
      console.warn('Kantor 3D tidak bisa dipakai, memakai kantor 2D:', err);
      mode = '2d';
      k = kantorDibuat['2d'];
      $('ganti-kantor').hidden = true;
    }
  }
  k ??= buatKantor($('kantor'));
  kantorDibuat[mode] = k;
  kantorDibuat['3d']?.jeda(mode !== '3d');
  kantorDibuat['3d']?.tampil(mode === '3d');
  $('kantor').style.display = mode === '2d' ? '' : 'none';
  kantor = k;
  modeKantor = mode;
  kantor.reset();
  kantor.papan(namaLulus);
  kantor.antrean(antreanKantor());
  $('ganti-kantor').textContent = mode === '3d' ? 'Kantor 2D' : 'Kantor 3D';
}

/** Murid yang menunggu, urut antrean (sama dengan urutan "Periksa berikutnya"), untuk ruang tunggu kantor. */
function antreanKantor() {
  return (sesi?.kiriman ?? []).filter((k) => k.status === 'menunggu').map(({ id, nama }) => ({ id, nama }));
}

let siapKantor = pakaiKantor(pilihanKantor());

$('ganti-kantor').onclick = async () => {
  if (sibuk) return;
  const mode = modeKantor === '3d' ? '2d' : '3d';
  try { localStorage.setItem(KUNCI_KANTOR, mode); } catch { /* mode privat: pilihan tidak diingat */ }
  siapKantor = pakaiKantor(mode);
  await siapKantor;
};

let penguji = null;      // dibuat saat pertama kali membuka sesi (memuat Python ±15 MB)
let timerSesi = null;
let dipilih = null;       // id kiriman yang sedang ditampilkan
let sibuk = false;

async function bukaSesi(kode) {
  penguji ??= new Penguji((t) => { $('status-py').textContent = t; });
  batalYakin();
  dipilih = null;
  $('sedang').textContent = 'Pilih kiriman dari antrean untuk diperiksa.';
  $('hasil').replaceChildren();
  $('kartu-kode').hidden = true;
  await siapKantor;
  kantor.reset();
  await muatSesi(kode);
  const qr = await fetch(`/api/guru/sesi/${kode}/qr.svg`, { headers: { 'X-CSRF': csrf } });
  $('qr').src = URL.createObjectURL(await qr.blob());
  $('alamat').textContent = location.host;
  tampilLayar('sesi');
  clearInterval(timerSesi);
  timerSesi = setInterval(() => muatSesi(kode).catch(() => {}), 3000);
}

async function muatSesi(kode) {
  sesi = await api(`/api/guru/sesi/${kode}`);
  $('info-tiket').textContent = `${namaPemeriksaan(sesi)}${sesi.label ? ' · ' + sesi.label : ''}`;
  $('kode-besar').textContent = sesi.kode;
  $('status-sesi').textContent = sesi.buka ? 'Sesi terbuka' : 'Sesi sudah ditutup — kiriman baru ditolak';
  $('tutup-sesi').disabled = !sesi.buka;
  const menunggu = sesi.kiriman.filter((k) => k.status === 'menunggu').length;
  $('hitung').textContent = `(${menunggu} menunggu · ${sesi.kiriman.length} total)`;
  kantor?.antrean(antreanKantor());
  $('berikutnya').disabled = sibuk || menunggu === 0;

  $('antrean').replaceChildren(...[...sesi.kiriman].reverse().map((k) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.setAttribute('aria-current', String(k.id === dipilih));
    const kiri = document.createElement('span');
    kiri.style.minWidth = '0';
    const nama = Object.assign(document.createElement('div'), { className: 'nama', textContent: k.nama });
    const ket = Object.assign(document.createElement('div'), { className: 'kecil redup', textContent: `${k.kelas} · kiriman ke-${k.ke} · ${new Date(k.dikirim_pada).toLocaleTimeString('id-ID', { timeStyle: 'short' })}` });
    kiri.append(nama, ket);
    const label = sesi.mode === 'bebas'
      ? { menunggu: 'Menunggu', lulus: 'Tanpa bug', gagal: 'Ada bug' }[k.status]
      : { menunggu: 'Menunggu', lulus: 'Lulus', gagal: 'Belum lulus' }[k.status];
    b.append(kiri, Object.assign(document.createElement('span'), { className: `lencana ${k.status}`, textContent: label }));
    b.onclick = () => periksa(k.id);
    b.disabled = sibuk;
    li.append(b);
    return li;
  }));

  // Papan "sudah lulus": nama unik, urut waktu lulus
  const lulus = [];
  for (const k of sesi.kiriman) if (k.status === 'lulus' && !lulus.includes(k.nama)) lulus.push(k.nama);
  namaLulus = lulus;
  kantor?.papan(lulus);
}

$('berikutnya').onclick = () => {
  const k = sesi?.kiriman.find((x) => x.status === 'menunggu');
  if (k) periksa(k.id);
};

async function periksa(id) {
  if (sibuk) return;
  sibuk = true;
  dipilih = id;
  $('berikutnya').disabled = true;
  $('ganti-kantor').disabled = true;
  document.querySelectorAll('#antrean button').forEach((b) => { b.disabled = true; });
  const L = LEVEL[sesi.level];
  try {
    const k = await api(`/api/guru/kiriman/${id}`);
    $('sedang').textContent = `Memeriksa: ${k.nama} (${k.kelas})`;
    pesanHasil('Developer membawa kodenya ke server…');
    tampilKode(k.berkas);
    kantor.layar(k.nama);

    // Pemeriksaan berjalan bersamaan dengan adegan siswa datang; progres baru
    // ditampilkan di gelembung Pemeriksa setelah ia sampai di server.
    let diServer = false;
    const kabar = (langkah) => {
      pesanHasil(`Memeriksa ${langkah} …`);
      if (diServer) kantor.kabar(langkah);
    };
    const mulaiUji = Date.now();
    const janjiHasil = sesi.mode === 'bebas' ? penguji.periksaBebas(k.berkas, kabar)
      : sesi.mode === 'pos' ? penguji.periksaPos(k.berkas, { uji: ujiPos(sesi.level), cek: cekPos(sesi.level) }, kabar)
        : penguji.periksa(k.berkas, L);
    await kantor.datang(k.nama, id);
    await kantor.periksa();
    diServer = true;
    const hasil = await janjiHasil;
    // beri jeda sebentar supaya kelas sempat melihat proses "memeriksa"
    await new Promise((r) => setTimeout(r, Math.max(1200, 2500 - (Date.now() - mulaiUji))));
    gambarLaporan($('hasil'), hasil);
    await api(`/api/guru/kiriman/${id}/hasil`, { method: 'POST', body: JSON.stringify(hasil) });
    await kantor.hasil({
      lulus: hasil.lulus,
      bebas: sesi.mode === 'bebas',
      skor: hasil.skor,
      bug: sesi.mode === 'bebas' ? hasil.ringkasan?.bug : hasil.butir?.filter((b) => !b.lulus).length + (hasil.error ? 1 : 0),
      // lulus tetapi laporannya berisi peringatan/saran → Pemeriksa menjelaskan catatannya
      saran: sesi.mode === 'bebas' ? (hasil.ringkasan?.peringatan ?? 0) + (hasil.ringkasan?.saran ?? 0) > 0 : !!hasil.butir?.some((b) => b.saran),
      terhenti: hasil.terhenti,
    });
  } catch (err) {
    pesanHasil(err.message, 'gagal');
  } finally {
    sibuk = false;
    $('ganti-kantor').disabled = false;
    await muatSesi(sesi.kode).catch(() => {});
  }
}

/** Satu baris pesan di kotak hasil (progres atau galat). */
function pesanHasil(teks, kelas = '') {
  const ul = Object.assign(document.createElement('ul'), { className: 'hasil' });
  ul.append(Object.assign(document.createElement('li'), { className: kelas, textContent: teks }));
  $('hasil').replaceChildren(ul);
}

function tampilKode(berkas) {
  const nama = Object.keys(berkas).sort((a, b) => (a === 'app.py' ? -1 : b === 'app.py' ? 1 : a.localeCompare(b)));
  $('kartu-kode').hidden = false;
  const pilih = (n) => {
    $('isi-berkas').textContent = berkas[n];
    document.querySelectorAll('#tab-berkas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.berkas === n)));
  };
  $('tab-berkas').replaceChildren(...nama.map((n) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: n });
    b.dataset.berkas = n;
    b.onclick = () => pilih(n);
    return b;
  }));
  pilih(nama[0]);
}

$('kembali').onclick = () => bukaDaftar();

// Konfirmasi dua langkah di dalam halaman. Sengaja tidak memakai confirm(): dialog bawaan
// browser diblokir di sebagian browser/panel (langsung dianggap "Batal"), sehingga tombol diam saja.
let timerYakin = null;
const TEKS_TUTUP = 'Tutup sesi';
$('tutup-sesi').textContent = TEKS_TUTUP;
function batalYakin() {
  clearTimeout(timerYakin);
  timerYakin = null;
  $('tutup-sesi').textContent = TEKS_TUTUP;
  $('tutup-sesi').classList.remove('bahaya');
}
$('tutup-sesi').onclick = async () => {
  if (!timerYakin) {
    $('tutup-sesi').textContent = 'Yakin? Klik lagi untuk menutup';
    $('tutup-sesi').classList.add('bahaya');
    timerYakin = setTimeout(batalYakin, 5000);
    return;
  }
  batalYakin();
  $('tutup-sesi').disabled = true;
  try {
    await api(`/api/guru/sesi/${sesi.kode}/tutup`, { method: 'POST', body: '{}' });
    await muatSesi(sesi.kode);
  } catch (err) {
    $('status-sesi').textContent = `Gagal menutup sesi: ${err.message}`;
    $('tutup-sesi').disabled = false;
  }
};

async function unduhRekap(kode) {
  const r = await fetch(`/api/guru/sesi/${kode}/rekap.csv`, { headers: { 'X-CSRF': csrf } });
  if (!r.ok) { ($('layar-sesi').classList.contains('tampil') ? $('status-sesi') : $('galat-daftar')).textContent = 'Gagal mengunduh rekap.'; return; }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `rekap-${kode}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}
$('unduh-rekap').onclick = () => unduhRekap(sesi.kode);

// Mulai: coba sesi login yang ada
bukaDaftar().catch(() => tampilLayar('login'));
