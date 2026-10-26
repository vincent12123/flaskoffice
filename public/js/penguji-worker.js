// =====================================================================
// WEB WORKER PENGUJI
//   Kode siswa dijalankan di sini (Pyodide), terpisah dari halaman guru.
//   Worker tidak punya akses ke sessionStorage/DOM halaman guru, sehingga tidak
//   bisa mengambil token CSRF untuk memanggil API guru. Halaman guru menghentikan
//   worker ini bila pemeriksaan melewati batas waktu (perulangan tanpa henti).
// =====================================================================
/* global importScripts, loadPyodide */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');

const PENGUJI = `
import sys, os, re, html, shutil, importlib, json, traceback
DIR = '/home/pyodide/proyek'

# ---------------------------------------------------------------------
# Pencocokan longgar: spasi/baris baru diabaikan, huruf besar/kecil sama.
# Teks dicari di HTML mentah (untuk "<form") dan di teks tanpa tag.
# ---------------------------------------------------------------------
def rapat(s):
    return ' '.join(str(s).split()).casefold()

def teks_saja(s):
    return html.unescape(re.sub('<[^>]+>', ' ', s))

def memuat(halaman, cari):
    c = rapat(cari)
    return c in rapat(halaman) or c in rapat(teks_saja(halaman))

# ---------------------------------------------------------------------
# Pemeriksaan variabel template (Tiket #3), tanpa peduli nama variabel:
#   1. Rekam template + konteks yang dirender lewat sinyal template_rendered.
#   2. Pastikan nilai yang diminta (mis. 'SMK Karya Bangsa') ada di konteks.
#   3. Render ulang template dengan nilai diganti penanda. Bila penanda muncul,
#      berarti template memakai variabel; bila tidak, teksnya ditulis langsung.
# ---------------------------------------------------------------------
KUNCI_BAWAAN = {'config', 'request', 'session', 'g', 'get_flashed_messages', 'url_for'}

def semua_teks(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from semua_teks(x)
    elif isinstance(v, (list, tuple, set)):
        for x in v:
            yield from semua_teks(x)
    elif objek_biasa(v):
        for x in vars(v).values():
            yield from semua_teks(x)

def objek_biasa(v):
    # objek dari class buatan siswa (atau SimpleNamespace), bukan fungsi/modul/objek Flask
    if callable(v) or not hasattr(v, '__dict__'):
        return False
    modul = type(v).__module__
    if modul == 'types':
        return True
    berkas = getattr(sys.modules.get(modul), '__file__', None) or ''
    return berkas.startswith(DIR)

def ganti_dalam(v, peta):
    if isinstance(v, str):
        for asli, penanda in peta.items():
            v = re.sub(re.escape(asli), penanda, v, flags=re.IGNORECASE)
        return v
    if type(v) is dict:
        return {k: ganti_dalam(x, peta) for k, x in v.items()}
    if isinstance(v, tuple) and hasattr(v, '_fields'):
        return type(v)(*(ganti_dalam(x, peta) for x in v))
    if isinstance(v, (list, tuple)):
        return type(v)(ganti_dalam(x, peta) for x in v)
    if objek_biasa(v):
        import copy
        salinan = copy.copy(v)
        for nama, x in vars(v).items():
            setattr(salinan, nama, ganti_dalam(x, peta))
        return salinan
    return v

def periksa_variabel(app, url, rekaman, daftar):
    hasil = []
    if not rekaman:
        return [{'label': f'Template untuk {url}', 'lulus': False,
                 'pesan': 'Halaman ini belum memakai render_template(...). Pindahkan tampilannya ke folder templates/.'}]
    template, konteks = rekaman[-1]
    milik_siswa = {k: v for k, v in konteks.items() if k not in KUNCI_BAWAAN}
    isi_konteks = [rapat(t) for t in semua_teks(milik_siswa)]
    peta = {}
    for i, v in enumerate(daftar):
        nilai = v['nilai'] if isinstance(v['nilai'], list) else [v['nilai']]
        kurang = [n for n in nilai if not any(rapat(n) in t for t in isi_konteks)]
        if kurang:
            hasil.append({'label': f"Variabel {v['nama']}", 'lulus': False,
                          'pesan': f"{v['nama'].capitalize()} belum dikirim ke template. Kirim lewat render_template('{template.name}', nama_variabel=...)."})
            continue
        for j, n in enumerate(nilai):
            peta[n] = f'QQ{i}X{j}QQ'
    if not peta:
        return hasil
    konteks_baru = dict(konteks)
    konteks_baru.update({k: ganti_dalam(v, peta) for k, v in milik_siswa.items()})
    try:
        with app.test_request_context(url):
            keluaran = template.render(konteks_baru)
    except Exception as e:
        return hasil + [{'label': f'Template {template.name}', 'lulus': False, 'pesan': 'Template gagal dirender ulang: ' + pesan_error(e)}]
    for i, v in enumerate(daftar):
        nilai = v['nilai'] if isinstance(v['nilai'], list) else [v['nilai']]
        penanda = [f'QQ{i}X{j}QQ' for j in range(len(nilai))]
        if not all(p in peta.values() for p in penanda):
            continue
        if all(p in keluaran for p in penanda):
            hasil.append({'label': f"Variabel {v['nama']}", 'lulus': True, 'pesan': f"Template menampilkan {v['nama']} dari variabel."})
        else:
            hasil.append({'label': f"Variabel {v['nama']}", 'lulus': False,
                          'pesan': f"Template {template.name} belum menampilkan {v['nama']} dari variabel. Pakai {v['cara']}, jangan tulis teksnya langsung."})
    return hasil

def baris_siswa(e):
    tb = [b for b in traceback.extract_tb(e.__traceback__) if b.filename.startswith(DIR)]
    if not tb:
        return ''
    return f' ({os.path.relpath(tb[-1].filename, DIR).replace("aplikasi_siswa.py", "app.py")} baris {tb[-1].lineno})'

def pesan_error(e):
    nama = type(e).__name__
    if nama == 'TemplateNotFound':
        return f'Template "{e}" tidak ditemukan di folder templates/. Periksa ejaan nama berkasnya.'
    if nama == 'TemplateSyntaxError':
        return f'Ada salah tulis di template {e.name} baris {e.lineno}: {e.message}'
    if nama == 'UndefinedError':
        return f'Template memakai variabel yang tidak dikirim: {e}'
    if nama == 'NameError':
        return f'Ada nama yang belum dikenal{baris_siswa(e)}: {e}. Sudah di-import / sudah dibuat?'
    if nama == 'BuildError':
        return f'url_for tidak menemukan endpoint itu{baris_siswa(e)}. Argumennya harus nama fungsi route, misalnya url_for(\\'tugas\\').'
    if nama == 'ModuleNotFoundError':
        return f'Modul tidak ditemukan{baris_siswa(e)}: {e}. Pemeriksa hanya menyediakan Flask dan pustaka standar Python.'
    return f'{nama}{baris_siswa(e)}: {e}'

def bersihkan_modul():
    for nama, mod in list(sys.modules.items()):
        if (getattr(mod, '__file__', None) or '').startswith(DIR):
            del sys.modules[nama]

def uji(berkas_json, kasus_json):
    berkas = json.loads(berkas_json)
    kasus = json.loads(kasus_json)
    shutil.rmtree(DIR, ignore_errors=True)
    for nama, isi in berkas.items():
        tujuan = os.path.join(DIR, 'aplikasi_siswa.py' if nama == 'app.py' else nama)
        os.makedirs(os.path.dirname(tujuan), exist_ok=True)
        with open(tujuan, 'w') as f:
            f.write(isi)
    bersihkan_modul()
    if DIR not in sys.path:
        sys.path.insert(0, DIR)
    importlib.invalidate_caches()

    # Kode siswa tidak boleh menyentuh lingkungan JavaScript worker
    simpan = {k: sys.modules.get(k) for k in ('js', 'pyodide_js')}
    sys.modules['js'] = None
    sys.modules['pyodide_js'] = None
    try:
        return jalankan_kasus(kasus)
    finally:
        for k, v in simpan.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

def jalankan_kasus(kasus):
    from flask import template_rendered
    try:
        mod = importlib.import_module('aplikasi_siswa')
    except SyntaxError as e:
        nama = os.path.relpath(e.filename or 'app.py', DIR).replace('aplikasi_siswa.py', 'app.py')
        return json.dumps({'error': f'Salah ketik di {nama} baris {e.lineno}: {e.msg}'})
    except Exception as e:
        return json.dumps({'error': pesan_error(e)})

    app = getattr(mod, 'app', None)
    if app is None or not hasattr(app, 'test_client'):
        return json.dumps({'error': 'Tidak ditemukan objek Flask bernama app di app.py.'})
    app.testing = True
    klien = app.test_client()
    hasil = []
    for k in kasus:
        metode = k.get('metode', 'GET')
        url = k['url']
        label = k.get('label') or f'{metode} {url}'
        harap = k.get('status', 200)
        def gagal(pesan):
            hasil.append({'label': label, 'lulus': False, 'pesan': pesan})
        rekaman = []
        def catat(sender, template, context, **extra):
            rekaman.append((template, dict(context)))
        template_rendered.connect(catat, app, weak=False)
        try:
            r = klien.open(url, method=metode, data=k.get('data'))
        except Exception as e:
            p = pesan_error(e)
            if harap == 404:
                p += '. Nomor yang tidak ada seharusnya dijawab abort(404), bukan error.'
            gagal('Halaman error. ' + p)
            continue
        finally:
            template_rendered.disconnect(catat, app)
        teks = r.get_data(as_text=True)
        if r.status_code != harap:
            if r.status_code == 404:
                gagal(f'Halaman belum ada (404). Sudah membuat route untuk {url}?')
            elif r.status_code == 405:
                gagal(f'Route belum menerima metode {metode} (405). Tambahkan methods=[...] pada @app.route.')
            elif r.status_code == 400:
                gagal('Server menjawab 400 (Bad Request). Biasanya karena nama di request.form[...] tidak sama dengan atribut name pada input form.')
            elif harap == 404:
                gagal(f'Seharusnya 404 (tidak ditemukan), tapi server menjawab {r.status_code}.')
            elif harap == 302:
                gagal(f'Belum ada redirect: server menjawab {r.status_code}. Setelah menyimpan, return redirect(url_for(...)).')
            else:
                gagal(f'Server menjawab kode {r.status_code}, seharusnya {harap}.')
            continue
        if 'lokasi' in k and not r.headers.get('Location', '').endswith(k['lokasi']):
            gagal(f"Redirect mengarah ke {r.headers.get('Location')}, seharusnya ke {k['lokasi']}.")
            continue
        kurang = [s for s in k.get('berisi', []) if not memuat(teks, s)]
        if kurang:
            ringkas = ' '.join(teks_saja(teks).split())[:70]
            gagal(f'Halaman ada, tapi belum menampilkan "{kurang[0]}". Sekarang isinya: "{ringkas}"')
        else:
            hasil.append({'label': label, 'lulus': True, 'pesan': 'Sesuai harapan.'})
        if k.get('variabel'):
            hasil.extend(periksa_variabel(app, url, rekaman, k['variabel']))
    return json.dumps({'hasil': hasil})
`;

let python = null;

async function siapkan() {
  python = await loadPyodide();
  // hashlib versi OpenSSL (pbkdf2/scrypt untuk generate_password_hash) dan sqlite3 dimuat terpisah di Pyodide
  await python.loadPackage(['micropip', 'sqlite3', 'hashlib']).catch(() => python.loadPackage(['micropip', 'sqlite3']));
  await python.runPythonAsync("import micropip\nawait micropip.install(['flask', 'pyflakes'])");
  python.runPython(PENGUJI);
  // Pemeriksa proyek bebas & proyek POS ada di berkas Python terpisah (POS memakai fungsi dari bebas)
  const bebas = await (await fetch('/js/pemeriksa_bebas.py')).text();
  python.runPython(bebas);
  python.runPython(await (await fetch('/js/pemeriksa_pos.py')).text());
  return python.runPython("import importlib.metadata as m; m.version('flask')");
}

const siap = siapkan();

// Test resmi proyek POS (sama dengan Paket Starter) + test tambahan Flask Office
const BERKAS_TES_POS = [
  'conftest.py', 'test_auth.py', 'test_dashboard.py', 'test_errors.py', 'test_lan_and_nfr.py', 'test_laporan_dan_stok.py',
  'test_master_data.py', 'test_models.py', 'test_order_batal.py', 'test_pengguna.py', 'test_pos.py', 'test_seed.py',
  'test_pemeriksa_pos.py',
];
let tesPos = null;
async function muatTesPos() {
  const isi = await Promise.all(BERKAS_TES_POS.map(async (n) => {
    const r = await fetch(`/pos/tests/${n}`);
    if (!r.ok) throw new Error(`Test resmi ${n} tidak bisa dimuat (${r.status}).`);
    return [n, await r.text()];
  }));
  return Object.fromEntries(isi);
}

self.onmessage = async (e) => {
  const { id, jenis, berkas, kasus } = e.data;
  try {
    const versi = await siap;
    if (jenis === 'siap') return self.postMessage({ id, ok: true, versi });
    if (jenis === 'pos') {
      // test resmi dimuat sekali per worker dari /pos/tests/
      tesPos ??= await muatTesPos();
      const gagalPasang = JSON.parse(await python.runPythonAsync('await siapkan_paket_pos()'));
      if (gagalPasang.length) throw new Error(`Paket ${gagalPasang.join(', ')} gagal dipasang. Periksa internet lalu coba lagi.`);
      python.globals.set('kabar_js', (s) => self.postMessage({ id, progres: JSON.parse(s) }));
      const fn = python.globals.get('periksa_pos');
      const hasil = JSON.parse(fn(JSON.stringify(berkas), JSON.stringify(tesPos), JSON.stringify(e.data.uji)));
      fn.destroy();
      python.globals.delete('kabar_js');
      return self.postMessage({ id, ok: true, hasil });
    }
    if (jenis === 'bebas') {
      const isi = JSON.stringify(berkas);
      python.globals.set('berkas_json', isi);
      const gagalPasang = JSON.parse(await python.runPythonAsync('await siapkan_paket(berkas_json)'));
      // kabar progres (halaman yang sedang dibuka + temuan) supaya laporan tetap ada bila waktu habis
      python.globals.set('kabar_js', (s) => self.postMessage({ id, progres: JSON.parse(s) }));
      const fn = python.globals.get('periksa_bebas');
      const hasil = JSON.parse(fn(isi));
      fn.destroy();
      python.globals.delete('kabar_js');
      return self.postMessage({ id, ok: true, hasil, gagalPasang });
    }
    const fn = python.globals.get('uji');
    const hasil = JSON.parse(fn(JSON.stringify(berkas), JSON.stringify(kasus)));
    fn.destroy();
    self.postMessage({ id, ok: true, hasil });
  } catch (err) {
    self.postMessage({ id, ok: false, pesan: String(err && err.message || err) });
  }
};
