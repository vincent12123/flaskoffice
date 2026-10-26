/**
 * Merapikan berkas proyek yang diunggah siswa.
 *
 * Siswa memilih folder proyek VS Code (atau .zip). Isinya bisa bersarang
 * (`tugas-flask/app.py`), memakai blueprint (`routes/`), pola factory (`app/__init__.py`),
 * dan sering membawa `venv/`, `__pycache__/`, `.git/`. Fungsi ini menentukan akar proyek,
 * lalu hanya menyimpan berkas yang dibutuhkan pemeriksa. Logika penyaringan yang sama ada di
 * public/js/berkas.js (di browser, sebelum mengunggah); server tetap memvalidasi ulang.
 */

export const BATAS = {
  jumlahBerkas: 200,
  perBerkas: 200 * 1024,
  total: 1536 * 1024,
};

export const FOLDER_DIABAIKAN = new Set([
  'venv', '.venv', 'env', '__pycache__', '.git', 'node_modules', '.idea', '.vscode', 'instance',
  '.pytest_cache', '.mypy_cache', 'site-packages', 'migrations',
]);

// Berkas entry yang umum dipakai siswa, urut prioritas
export const NAMA_ENTRY = ['app.py', 'main.py', 'run.py', 'wsgi.py', 'server.py', 'application.py'];

const TEKS_STATIC = /\.(css|js|json|svg|txt|map)$/i;
const ASET_STATIC = /\.(png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|mp3|mp4|webm|pdf)$/i;

export interface BerkasMasuk {
  path: string;
  isi: string;
}

export type HasilRapikan =
  | { ok: true; berkas: Record<string, string>; ukuran: number; entry: string }
  | { ok: false; pesan: string };

function normalisasi(p: string): string | null {
  const bersih = p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
  if (bersih.startsWith('/') || /^[a-zA-Z]:/.test(bersih)) return null;
  const bagian = bersih.split('/');
  if (bagian.some((b) => b === '..' || b === '.' || b === '')) return null;
  return bagian.join('/');
}

// Berkas bertitik yang boleh ikut (tanpa rahasia). .env sendiri TIDAK pernah ikut.
const BERTITIK_DIIZINKAN = new Set(['.flaskenv', '.gitignore', '.env.example']);
const diabaikan = (path: string) => path.split('/').some((b) => FOLDER_DIABAIKAN.has(b) || (b.startsWith('.') && !BERTITIK_DIIZINKAN.has(b)));

/**
 * Jenis berkas (relatif terhadap akar proyek): 'teks' disimpan isinya, 'aset' disimpan namanya saja
 * (gambar/font; isinya tidak dikirim), null = tidak disimpan.
 */
export function jenisBerkas(relatif: string): 'teks' | 'aset' | null {
  if (diabaikan(relatif)) return null;
  const bagian = relatif.split('/');
  const nama = bagian[bagian.length - 1]!;
  if (/\.py$/.test(nama)) return 'teks';
  if (bagian.includes('templates') && /\.(html?|jinja2?|j2|txt)$/i.test(nama)) return 'teks';
  if (bagian.includes('static')) {
    if (TEKS_STATIC.test(nama)) return 'teks';
    if (ASET_STATIC.test(nama)) return 'aset';
    return null;
  }
  // berkas konfigurasi di akar proyek (.gitignore & pytest.ini dipakai pemeriksa proyek POS)
  if (bagian.length === 1 && /^(requirements.*\.txt|\.flaskenv|\.gitignore|\.env\.example|pytest\.ini|ruff\.toml|.*\.(sql|json|csv))$/i.test(nama)) return 'teks';
  return null;
}

/** Cari akar proyek: folder berkas entry yang paling dangkal, atau induk paket factory. */
function cariAkar(daftar: BerkasMasuk[]): { akar: string; entry: string } | null {
  const bersih = daftar.filter((b) => !diabaikan(b.path));
  const kedalaman = (p: string) => p.split('/').length;
  const entry = bersih
    .filter((b) => NAMA_ENTRY.includes(b.path.split('/').pop()!))
    .sort((a, b) => kedalaman(a.path) - kedalaman(b.path)
      || NAMA_ENTRY.indexOf(a.path.split('/').pop()!) - NAMA_ENTRY.indexOf(b.path.split('/').pop()!))[0];
  const paket = bersih
    .filter((b) => b.path.endsWith('__init__.py') && /\bFlask\s*\(|\bcreate_app\b/.test(b.isi))
    .sort((a, b) => kedalaman(a.path) - kedalaman(b.path))[0];
  // Paket factory (app/__init__.py) yang lebih dangkal dari entry → akarnya induk paket itu
  if (paket && (!entry || kedalaman(paket.path) - 1 < kedalaman(entry.path))) {
    const folderPaket = paket.path.split('/').slice(0, -1);
    return { akar: folderPaket.slice(0, -1).join('/'), entry: folderPaket.slice(-1)[0] + '/__init__.py' };
  }
  if (!entry) return null;
  const bagian = entry.path.split('/');
  return { akar: bagian.slice(0, -1).join('/'), entry: bagian[bagian.length - 1]! };
}

export function rapikanBerkas(masuk: unknown): HasilRapikan {
  if (!Array.isArray(masuk) || masuk.length === 0) return { ok: false, pesan: 'Tidak ada berkas yang dikirim.' };
  if (masuk.length > 3000) return { ok: false, pesan: 'Terlalu banyak berkas. Pilih folder proyek saja, bukan seluruh disk.' };

  const daftar: BerkasMasuk[] = [];
  for (const b of masuk) {
    if (!b || typeof b !== 'object') return { ok: false, pesan: 'Format kiriman tidak dikenal.' };
    const { path, isi } = b as Record<string, unknown>;
    if (typeof path !== 'string' || typeof isi !== 'string') return { ok: false, pesan: 'Format kiriman tidak dikenal.' };
    const p = normalisasi(path);
    if (p === null) return { ok: false, pesan: `Nama berkas tidak valid: ${path.slice(0, 80)}` };
    daftar.push({ path: p, isi });
  }

  const ditemukan = cariAkar(daftar);
  if (!ditemukan) {
    return { ok: false, pesan: `Tidak ditemukan berkas aplikasi Flask (${NAMA_ENTRY.slice(0, 3).join(', ')}, …). Pastikan yang dipilih adalah folder proyek Flask kamu.` };
  }
  const awalan = ditemukan.akar ? ditemukan.akar + '/' : '';

  const hasil: Record<string, string> = {};
  let total = 0;
  for (const b of daftar) {
    if (!b.path.startsWith(awalan)) continue;
    const relatif = b.path.slice(awalan.length);
    const jenis = jenisBerkas(relatif);
    if (!jenis) continue;
    // aset (gambar/font) hanya dicatat namanya
    const isi = jenis === 'aset' ? '' : b.isi;
    const ukuran = Buffer.byteLength(isi, 'utf8');
    if (ukuran > BATAS.perBerkas) return { ok: false, pesan: `Berkas ${relatif} terlalu besar (maks ${BATAS.perBerkas / 1024} KB).` };
    if (isi.includes('\u0000')) return { ok: false, pesan: `Berkas ${relatif} bukan berkas teks.` };
    hasil[relatif] = isi;
    total += ukuran;
  }
  const jumlah = Object.keys(hasil).length;
  if (jumlah > BATAS.jumlahBerkas) return { ok: false, pesan: `Terlalu banyak berkas (${jumlah}, maks ${BATAS.jumlahBerkas}).` };
  if (total > BATAS.total) return { ok: false, pesan: `Proyek terlalu besar (maks ${Math.round(BATAS.total / 1024)} KB teks).` };
  return { ok: true, berkas: hasil, ukuran: total, entry: ditemukan.entry };
}
