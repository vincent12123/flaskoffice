// =====================================================================
// Membaca folder proyek / zip di browser siswa sebelum diunggah.
// Penyaringan di sini sama dengan src/layanan/berkas.ts (server memvalidasi ulang);
// tujuannya agar folder venv yang besar tidak ikut dibaca dan dikirim.
// =====================================================================
import { unzipSync } from '/vendor/fflate.js';

const FOLDER_DIABAIKAN = new Set([
  'venv', '.venv', 'env', '__pycache__', '.git', 'node_modules', '.idea', '.vscode', 'instance',
  '.pytest_cache', '.mypy_cache', 'site-packages', 'migrations',
]);
export const NAMA_ENTRY = ['app.py', 'main.py', 'run.py', 'wsgi.py', 'server.py', 'application.py'];
const TEKS_STATIC = /\.(css|js|json|svg|txt|map)$/i;
const ASET_STATIC = /\.(png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|mp3|mp4|webm|pdf)$/i;
const BATAS_BERKAS = 200 * 1024;

// Berkas bertitik yang boleh ikut (tanpa rahasia). .env sendiri TIDAK pernah ikut.
const BERTITIK_DIIZINKAN = new Set(['.flaskenv', '.gitignore', '.env.example']);
const diabaikan = (path) => path.split('/').some((b) => FOLDER_DIABAIKAN.has(b) || (b.startsWith('.') && !BERTITIK_DIIZINKAN.has(b)));

/** 'teks' = isinya dikirim, 'aset' = hanya namanya (gambar/font), null = tidak dikirim. */
function jenis(path) {
  if (diabaikan(path)) return null;
  const bagian = path.split('/');
  const nama = bagian[bagian.length - 1];
  if (/\.py$/.test(nama)) return 'teks';
  if (bagian.includes('templates') && /\.(html?|jinja2?|j2|txt)$/i.test(nama)) return 'teks';
  if (bagian.includes('static')) return TEKS_STATIC.test(nama) ? 'teks' : ASET_STATIC.test(nama) ? 'aset' : null;
  // berkas data/konfigurasi; posisi akar proyek belum diketahui di sini, server menyaring ulang
  if (/^(requirements.*\.txt|\.flaskenv|\.gitignore|\.env\.example|pytest\.ini|ruff\.toml|.*\.(sql|json|csv))$/i.test(nama)) return 'teks';
  return null;
}

/** Apakah daftar berkas memuat aplikasi Flask (entry umum atau paket factory). */
export function adaAplikasi(berkas) {
  return berkas.some((b) => NAMA_ENTRY.includes(b.path.split('/').pop())
    || (b.path.endsWith('__init__.py') && /\bFlask\s*\(|\bcreate_app\b/.test(b.isi)));
}

/** Dari <input type="file" webkitdirectory> atau beberapa berkas biasa. */
export async function bacaDaftarBerkas(fileList) {
  const hasil = [];
  for (const f of fileList) {
    const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const j = jenis(path);
    if (!j) continue;
    if (j === 'aset') { hasil.push({ path, isi: '' }); continue; }
    if (f.size > BATAS_BERKAS) throw new Error(`${path} terlalu besar (maks 200 KB).`);
    hasil.push({ path, isi: await f.text() });
  }
  return hasil;
}

/** Dari berkas .zip. */
export async function bacaZip(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('Zip terlalu besar. Jangan ikutkan folder venv.');
  const aset = [];
  const isiZip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      const path = f.name.replace(/\\/g, '/');
      const j = jenis(path);
      if (j === 'aset') aset.push({ path, isi: '' });
      return j === 'teks' && f.originalSize <= BATAS_BERKAS;
    },
  });
  const dekoder = new TextDecoder();
  return [
    ...Object.entries(isiZip)
      .filter(([nama]) => !nama.endsWith('/'))
      .map(([path, data]) => ({ path: path.replace(/\\/g, '/'), isi: dekoder.decode(data) })),
    ...aset,
  ];
}

/** Dari drag-and-drop folder (DataTransferItem.webkitGetAsEntry). */
export async function bacaSeret(items) {
  const hasil = [];
  const bacaEntri = (entri, awalan) => new Promise((selesai, gagal) => {
    if (entri.isFile) {
      const path = awalan + entri.name;
      const j = jenis(path);
      if (!j) return selesai();
      if (j === 'aset') { hasil.push({ path, isi: '' }); return selesai(); }
      entri.file(async (f) => {
        if (f.size > BATAS_BERKAS) return gagal(new Error(`${path} terlalu besar (maks 200 KB).`));
        hasil.push({ path, isi: await f.text() });
        selesai();
      }, gagal);
    } else if (entri.isDirectory) {
      if (FOLDER_DIABAIKAN.has(entri.name) || entri.name.startsWith('.')) return selesai();
      const pembaca = entri.createReader();
      const semua = [];
      const lanjut = () => pembaca.readEntries(async (bagian) => {
        if (!bagian.length) {
          try { for (const e of semua) await bacaEntri(e, awalan + entri.name + '/'); selesai(); } catch (e) { gagal(e); }
          return;
        }
        semua.push(...bagian);
        lanjut();
      }, gagal);
      lanjut();
    } else selesai();
  });
  const entri = [...items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  for (const e of entri) {
    if (e.isFile && /\.zip$/i.test(e.name)) {
      const f = await new Promise((s, g) => e.file(s, g));
      hasil.push(...await bacaZip(f));
    } else await bacaEntri(e, '');
  }
  return hasil;
}
