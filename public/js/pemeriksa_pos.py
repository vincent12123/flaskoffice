# =====================================================================
# PEMERIKSA PROYEK POS — menjalankan test resmi SMK Mart POS terhadap kode siswa.
#
# Dijalankan di Web Worker (Pyodide) halaman guru, sama seperti pemeriksa tiket/bebas.
# Folder tests/ milik siswa DIABAIKAN: yang dipakai selalu test resmi dari Flask Office
# (public/pos/tests/), supaya test tidak bisa diubah agar "lulus".
#
# Urutan: tulis kode siswa + test resmi -> pasang paket -> pytest dengan daftar test bab itu
#   -> hasil per test (label = docstring test, pesan = baris "E ..." yang paling berguna).
# =====================================================================
import sys, os, io, re, json, shutil, importlib, contextlib

DIR_POS = '/home/pyodide/pos'
PAKET_POS = ['flask', 'flask-sqlalchemy', 'flask-login', 'flask-wtf', 'python-dotenv', 'pytest']
_paket_pos_siap = False


async def siapkan_paket_pos():
    global _paket_pos_siap
    if _paket_pos_siap:
        return '[]'
    import micropip
    gagal = []
    for p in PAKET_POS:
        try:
            await micropip.install(p)
        except Exception:
            gagal.append(p)
    _paket_pos_siap = not gagal
    return json.dumps(gagal)


def _tulis(berkas, tes):
    shutil.rmtree(DIR_POS, ignore_errors=True)
    for nama, isi in berkas.items():
        if nama.split('/')[0] in ('tests', 'test'):
            continue                      # test milik siswa tidak dipakai
        tujuan = os.path.join(DIR_POS, nama)
        os.makedirs(os.path.dirname(tujuan), exist_ok=True)
        with open(tujuan, 'w') as f:
            f.write(isi)
    for nama, isi in tes.items():
        tujuan = os.path.join(DIR_POS, 'tests', nama)
        os.makedirs(os.path.dirname(tujuan), exist_ok=True)
        with open(tujuan, 'w') as f:
            f.write(isi)
    # modul dari pemeriksaan sebelumnya (app, config, conftest, test_*) harus dimuat ulang
    for nama, mod in list(sys.modules.items()):
        berkas_mod = getattr(mod, '__file__', None) or ''
        if berkas_mod.startswith(DIR_POS) or nama in ('conftest', 'config') or nama == 'app' or nama.startswith('app.'):
            del sys.modules[nama]
    if DIR_POS not in sys.path:
        sys.path.insert(0, DIR_POS)
    importlib.invalidate_caches()
    os.chdir(DIR_POS)


def _ringkas_gagal(teks):
    """Ambil pesan yang berguna dari laporan pytest: baris 'E ...' dan lokasi di kode siswa."""
    baris = teks.splitlines()
    e = [b[1:].strip() for b in baris if b.startswith('E ')]
    lokasi = [m.group(1) for b in baris if (m := re.match(r'^(app/[^:]+:\d+|config\.py:\d+)', b))]
    # assert dengan pesan sendiri ("AssertionError: Masih mengalihkan…"): cukup pesannya saja
    if e and re.match(r'AssertionError: \S', e[0]):
        e = e[:1]
    inti = ' '.join(e[:3]) if e else (baris[-1].strip() if baris else 'Gagal')
    inti = inti.replace(DIR_POS + '/', '')
    if lokasi:
        inti += f' (di {lokasi[-1].replace(":", " baris ")})'
    return inti[:400]


def periksa_pos(berkas_json, tes_json, uji_json):
    berkas = json.loads(berkas_json)
    tes = json.loads(tes_json)
    uji = json.loads(uji_json)
    _tulis(berkas, tes)
    # werkzeug: scrypt -> pbkdf2 (fungsi dari pemeriksa_bebas.py)
    tambal_hash()
    # .env siswa tidak ikut diunggah; nilai ini hanya dipakai bila kode membaca environment
    os.environ.setdefault('SECRET_KEY', 'kunci-pemeriksa-flask-office')

    # Muat aplikasi lebih dulu: bila conftest gagal meng-import app, pytest berhenti tanpa laporan per test
    try:
        importlib.import_module('app')
        importlib.import_module('config')
    except SyntaxError as e:
        nama = os.path.relpath(e.filename or 'app', DIR_POS)
        return json.dumps({'error': f'Salah ketik di {nama} baris {e.lineno}: {e.msg}. Aplikasi tidak bisa dimuat, jadi test belum bisa dijalankan.'})
    except Exception as e:
        import traceback
        tb = [b for b in traceback.extract_tb(e.__traceback__) if b.filename.startswith(DIR_POS)]
        lokasi = f'{os.path.relpath(tb[-1].filename, DIR_POS)} baris {tb[-1].lineno}' if tb else ''
        pesan = jelaskan_error(e).replace(DIR_POS + '/', '')
        return json.dumps({'error': f'Aplikasi gagal dimuat{" (" + lokasi + ")" if lokasi else ""}: {pesan}'})

    import pytest

    hasil = {}
    galat_koleksi = []

    class Kumpul:
        def pytest_collectreport(self, report):
            if report.failed:
                galat_koleksi.append(_ringkas_gagal(report.longreprtext))

        def pytest_runtest_logreport(self, report):
            n = report.nodeid
            if report.when == 'call' or report.failed or report.skipped:
                lama = hasil.get(n)
                if lama and not lama['lulus']:
                    return
                if report.failed:
                    tahap = '' if report.when == 'call' else ' (saat persiapan test)'
                    hasil[n] = {'lulus': False, 'pesan': _ringkas_gagal(report.longreprtext) + tahap}
                elif report.skipped:
                    hasil[n] = {'lulus': False, 'pesan': 'Test dilewati.'}
                else:
                    hasil[n] = {'lulus': True, 'pesan': 'Lulus.'}
                kabar({'test': len(hasil), 'total': len(uji)})

        def pytest_collection_modifyitems(self, items):
            for it in items:
                fungsi = getattr(it, 'function', None)
                doc = ((fungsi.__doc__ if fungsi else None) or '').strip().splitlines()
                label_test[it.nodeid] = doc[0] if doc else it.name

    label_test = {}
    keluaran = io.StringIO()
    with contextlib.redirect_stdout(keluaran), contextlib.redirect_stderr(keluaran):
        kode = pytest.main(['-q', '-p', 'no:cacheprovider', '-p', 'no:warnings', '--tb=short', '--rootdir', DIR_POS, *uji],
                           plugins=[Kumpul()])

    if not hasil:
        if galat_koleksi:
            return json.dumps({'error': 'Aplikasi tidak bisa dimuat oleh test: ' + galat_koleksi[0]})
        sisa = [b for b in keluaran.getvalue().replace(DIR_POS + '/', '').splitlines() if b.strip()]
        return json.dumps({'error': 'Test tidak bisa dijalankan: ' + (' '.join(sisa[-3:])[:400] or f'pytest berhenti (kode {int(kode)}).')})
    butir = []
    for n in uji:
        h = hasil.get(n)
        berkas_test, _, nama = n.partition('::')
        label = label_test.get(n, nama)
        if h is None:
            pesan = galat_koleksi[0] if galat_koleksi else 'Test tidak berjalan.'
            butir.append({'label': label, 'lulus': False, 'pesan': pesan, 'lokasi': berkas_test})
        else:
            butir.append({'label': label, 'lulus': h['lulus'], 'pesan': h['pesan'], 'lokasi': berkas_test})
    return json.dumps({'hasil': butir, 'kode': int(kode)})
