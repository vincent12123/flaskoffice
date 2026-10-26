# =====================================================================
# PEMERIKSA PROYEK BEBAS — memeriksa kesehatan aplikasi Flask apa pun.
#
# Dijalankan di Web Worker (Pyodide) halaman guru. Tidak tahu apa yang "seharusnya"
# dibuat siswa; yang dicari adalah masalah umum:
#   bug        aplikasi gagal jalan, halaman/form error 500, field form tidak cocok,
#              link rusak, route berparameter yang tidak menangani data tidak ada
#   peringatan template rusak, HTML tidak tertutup, static hilang, keamanan (SQL, |safe, password)
#   saran      kelengkapan HTML (title, viewport, lang), aksesibilitas, kebiasaan kode (pyflakes)
#
# Urutan kerja: tulis berkas -> jalankan app (blok __main__ ikut jalan, app.run dimatikan)
#   -> jelajahi semua route GET -> isi & kirim semua form -> jelajahi ulang (data sudah ada,
#   mungkin sudah login) -> periksa template & kode Python -> skor.
# =====================================================================
import sys, os, re, ast, html, json, shutil, importlib, traceback, types, builtins
from collections import deque
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin

DIR = '/home/pyodide/proyek'
NAMA_ENTRY = ['app.py', 'main.py', 'run.py', 'wsgi.py', 'server.py', 'application.py']
MAKS_HALAMAN = 40
MAKS_FORM = 15
# link logout dilewati agar sesi login pemeriksa tidak hilang di tengah penjelajahan
# (hanya segmen URL / nama endpoint utuh: /keluar cocok, /pengeluaran tidak)
POLA_LOGOUT = re.compile(r'(?:^|[/._-])(?:logout|log-out|keluar|signout|sign-out)(?:$|[/?._-])', re.I)
POLA_LOGIN = re.compile(r'(?:^|[/._-])(?:login|log-in|masuk|signin|sign-in)(?:$|[/?._-])', re.I)

# import siswa -> nama paket pip yang boleh dipasang di pemeriksa
PAKET = {
    'flask_sqlalchemy': 'flask-sqlalchemy', 'sqlalchemy': 'sqlalchemy', 'flask_login': 'flask-login',
    'flask_wtf': 'flask-wtf', 'wtforms': 'wtforms', 'email_validator': 'email-validator',
    'dotenv': 'python-dotenv', 'flask_bcrypt': 'flask-bcrypt', 'bcrypt': 'bcrypt',
    'flask_migrate': 'flask-migrate', 'flask_cors': 'flask-cors', 'markdown': 'markdown',
    'flask_mail': 'flask-mail', 'flask_session': 'flask-session', 'dateutil': 'python-dateutil',
}
TIDAK_TERSEDIA = {'pymysql': 'MySQL', 'MySQLdb': 'MySQL', 'mysql': 'MySQL', 'psycopg2': 'PostgreSQL',
                  'pymongo': 'MongoDB', 'flask_mysqldb': 'MySQL'}

# ---------------------------------------------------------------------
# Catatan temuan
# ---------------------------------------------------------------------
temuan = []
_kunci_temuan = {}

def kabar(data):
    f = globals().get('kabar_js')
    if f:
        try:
            f(json.dumps(data))
        except Exception:
            pass

def catat(tingkat, kategori, label, pesan, lokasi=None):
    """Simpan satu temuan; temuan kembar (kategori+label+pesan sama) digabung jadi hitungan."""
    kunci = (tingkat, kategori, label, pesan)
    if kunci in _kunci_temuan:
        _kunci_temuan[kunci]['jumlah'] += 1
        return
    t = {'tingkat': tingkat, 'kategori': kategori, 'label': label, 'pesan': pesan,
         'lulus': tingkat != 'bug', 'jumlah': 1}
    if lokasi:
        t['lokasi'] = lokasi
    _kunci_temuan[kunci] = t
    temuan.append(t)
    kabar({'temuan': t})

def relatif(p):
    return os.path.relpath(p, DIR) if p and p.startswith(DIR) else p

def lokasi_error(e):
    tb = [b for b in traceback.extract_tb(e.__traceback__) if b.filename.startswith(DIR)]
    if tb:
        return f'{relatif(tb[-1].filename)} baris {tb[-1].lineno}'
    if getattr(e, 'filename', None) and getattr(e, 'lineno', None):
        return f'{relatif(e.filename)} baris {e.lineno}'
    return None

def jelaskan_error(e):
    nama = type(e).__name__
    pesan = str(e)
    if nama == 'TemplateNotFound':
        return f'Template "{pesan}" tidak ditemukan di folder templates/.'
    if nama == 'TemplateSyntaxError':
        return f'Salah tulis di template {e.name} baris {e.lineno}: {e.message}'
    if nama == 'UndefinedError':
        return f'Template memakai sesuatu yang tidak ada: {pesan}'
    if nama == 'BuildError':
        return f'url_for gagal: {pesan.splitlines()[0]}. Argumennya harus nama fungsi route.'
    if nama == 'OperationalError' and 'no such table' in pesan:
        return f'{pesan}. Tabel database belum dibuat; pastikan kode pembuat tabel (create_all / CREATE TABLE) ikut berjalan saat aplikasi dinyalakan.'
    if nama == 'RuntimeError' and 'secret key' in pesan.lower():
        return 'session/flash dipakai tetapi app.secret_key belum diatur.'
    if nama == 'BadRequestKeyError':
        kunci = e.args[0] if e.args else '?'
        return f"Server meminta field '{kunci}' yang tidak dikirim form. Samakan request.form['{kunci}'] dengan atribut name pada input."
    return f'{nama}: {pesan}'[:400]

# ---------------------------------------------------------------------
# Persiapan berkas & paket
# ---------------------------------------------------------------------
def tulis_berkas(berkas):
    shutil.rmtree(DIR, ignore_errors=True)
    for nama, isi in berkas.items():
        tujuan = os.path.join(DIR, nama)
        os.makedirs(os.path.dirname(tujuan), exist_ok=True)
        with open(tujuan, 'w') as f:
            f.write(isi)
    for nama, mod in list(sys.modules.items()):
        if (getattr(mod, '__file__', None) or '').startswith(DIR):
            del sys.modules[nama]
    if DIR not in sys.path:
        sys.path.insert(0, DIR)
    importlib.invalidate_caches()
    os.chdir(DIR)

def modul_diimpor(berkas):
    nama = set()
    for p, isi in berkas.items():
        if not p.endswith('.py'):
            continue
        try:
            pohon = ast.parse(isi)
        except SyntaxError:
            continue
        for n in ast.walk(pohon):
            if isinstance(n, ast.Import):
                nama.update(a.name.split('.')[0] for a in n.names)
            elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
                nama.add(n.module.split('.')[0])
    return nama

async def siapkan_paket(berkas_json):
    """Pasang paket yang diimpor siswa (hanya dari daftar PAKET)."""
    import micropip
    berkas = json.loads(berkas_json)
    perlu = [PAKET[m] for m in sorted(modul_diimpor(berkas)) if m in PAKET]
    gagal = []
    for p in perlu:
        try:
            await micropip.install(p)
        except Exception as e:
            gagal.append(p)
    return json.dumps(gagal)

# ---------------------------------------------------------------------
# Menjalankan aplikasi
# ---------------------------------------------------------------------
def cari_entry(berkas):
    for n in NAMA_ENTRY:
        if n in berkas:
            return n
    paket = sorted((p for p in berkas if p.endswith('__init__.py') and re.search(r'\bFlask\s*\(|\bcreate_app\b', berkas[p])),
                   key=lambda p: p.count('/'))
    return paket[0] if paket else None

info_run = {}

def tambal_hash():
    """
    Python di browser (Pyodide) tidak punya hashlib.scrypt, padahal itu metode bawaan
    generate_password_hash() di Werkzeug 3. Di komputer siswa fungsi itu berjalan normal,
    jadi di pemeriksa metode scrypt diganti pbkdf2 (iterasi kecil agar cepat). Kode siswa
    tidak diubah; hanya fungsi pustakanya yang dibungkus sebelum kode siswa di-import.
    """
    import hashlib, hmac
    import werkzeug.security as ws
    if not hasattr(hashlib, 'pbkdf2_hmac'):
        # cadangan murni-Python (lambat, tetapi iterasi di pemeriksa kecil)
        def pbkdf2_hmac(nama, sandi, garam, iterasi, panjang=None):
            panjang = panjang or hashlib.new(nama).digest_size
            hasil, blok = b'', 1
            while len(hasil) < panjang:
                u = hmac.new(sandi, garam + blok.to_bytes(4, 'big'), nama).digest()
                t = int.from_bytes(u, 'big')
                for _ in range(iterasi - 1):
                    u = hmac.new(sandi, u, nama).digest()
                    t ^= int.from_bytes(u, 'big')
                hasil += t.to_bytes(len(u), 'big')
                blok += 1
            return hasil[:panjang]
        hashlib.pbkdf2_hmac = pbkdf2_hmac
    if hasattr(hashlib, 'scrypt') or getattr(ws, '_ditambal', False):
        return
    asli = ws.generate_password_hash
    def generate_password_hash(password, method='scrypt', salt_length=16):
        if method.startswith('scrypt') or method.startswith('pbkdf2'):
            method = 'pbkdf2:sha256:1000'
        return asli(password, method, salt_length)
    ws.generate_password_hash = generate_password_hash
    ws._ditambal = True

def muat_app(berkas):
    import flask
    entry = cari_entry(berkas)
    if not entry:
        catat('bug', 'Menjalankan', 'Aplikasi', 'Tidak ditemukan berkas aplikasi (app.py, main.py, run.py, …).')
        return None

    # app.run() tidak boleh benar-benar menyalakan server; catat argumennya
    def run_palsu(self, *a, **k):
        info_run.update(k)
    flask.Flask.run = run_palsu
    builtins.input = lambda *a, **k: ''
    tambal_hash()

    try:
        if entry.endswith('__init__.py'):
            nama_paket = entry[:-len('/__init__.py')].replace('/', '.')
            mod = importlib.import_module(nama_paket)
        else:
            nama = entry[:-3]
            path = os.path.join(DIR, entry)
            mod = types.ModuleType(nama)
            mod.__file__ = path
            # Dijalankan seperti `python app.py`: blok if __name__ == '__main__' (create_all, init_db) ikut jalan
            mod.__dict__['__name__'] = '__main__'
            sys.modules[nama] = mod
            with open(path) as f:
                exec(compile(f.read(), path, 'exec'), mod.__dict__)
    except SyntaxError as e:
        catat('bug', 'Menjalankan', 'Aplikasi tidak bisa dijalankan', f'Salah ketik: {e.msg}', f'{relatif(e.filename) or entry} baris {e.lineno}')
        return None
    except Exception as e:
        catat('bug', 'Menjalankan', 'Aplikasi tidak bisa dijalankan', jelaskan_error(e), lokasi_error(e))
        return None

    calon = [v for v in vars(mod).values() if isinstance(v, flask.Flask)]
    app = vars(mod).get('app') if isinstance(vars(mod).get('app'), flask.Flask) else (calon[0] if calon else None)
    if app is None and callable(vars(mod).get('create_app')):
        try:
            app = mod.create_app()
        except Exception as e:
            catat('bug', 'Menjalankan', 'create_app() gagal', jelaskan_error(e), lokasi_error(e))
            return None
    if app is None:
        catat('bug', 'Menjalankan', 'Aplikasi', f'Tidak ditemukan objek Flask di {entry}. Buat dengan app = Flask(__name__).')
        return None

    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, TRAP_BAD_REQUEST_ERRORS=True, PROPAGATE_EXCEPTIONS=True)
    if info_run.get('debug'):
        catat('saran', 'Keamanan', 'app.run(debug=True)', 'Mode debug cocok untuk latihan, tapi wajib dimatikan saat aplikasi dipakai sungguhan.')
    return app

# ---------------------------------------------------------------------
# Membaca HTML: link, form, dan pemeriksaan struktur
# ---------------------------------------------------------------------
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
OPSIONAL_TUTUP = {'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
                  'colgroup', 'rt', 'rp', 'html', 'head', 'body'}
USANG = {'center', 'font', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset'}

class PembacaHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.doctype = False
        self.tumpukan = []
        self.tak_tertutup = []
        self.tutup_nyasar = []
        self.link = []
        self.aset = []
        self.form = []
        self._form = None
        self.id = {}
        self.label_for = set()
        self.dalam_label = 0
        self.kontrol = []          # (tag, attrs, di_dalam_label)
        self.img_tanpa_alt = 0
        self.heading = []
        self.lang = None
        self.title = None
        self._di_title = False
        self.charset = False
        self.viewport = False
        self.usang = set()
        self.style_inline = 0
        self._a = None             # [href, teks, punya_img_alt, aria]
        self.link_kosong = 0
        self._select = None

    def handle_decl(self, decl):
        if decl.lower().startswith('doctype'):
            self.doctype = True

    def handle_starttag(self, tag, attrs):
        a = {k: (v or '') for k, v in attrs}
        if 'style' in a:
            self.style_inline += 1
        if tag in USANG:
            self.usang.add(tag)
        if 'id' in a and a['id']:
            self.id[a['id']] = self.id.get(a['id'], 0) + 1
        if tag == 'html':
            self.lang = a.get('lang')
        elif tag == 'title':
            self._di_title = True
            self.title = ''
        elif tag == 'meta':
            if 'charset' in a or a.get('http-equiv', '').lower() == 'content-type':
                self.charset = True
            if a.get('name', '').lower() == 'viewport':
                self.viewport = True
        elif tag == 'a':
            self._a = [a.get('href'), '', False, bool(a.get('aria-label') or a.get('title'))]
            if a.get('href'):
                self.link.append(a['href'])
        elif tag == 'img':
            if 'alt' not in a:
                self.img_tanpa_alt += 1
            elif self._a is not None and a['alt'].strip():
                self._a[2] = True
            if a.get('src'):
                self.aset.append(a['src'])
        elif tag in ('link',) and a.get('href'):
            self.aset.append(a['href'])
        elif tag == 'script' and a.get('src'):
            self.aset.append(a['src'])
        elif tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.heading.append(int(tag[1]))
        elif tag == 'label':
            self.dalam_label += 1
            if a.get('for'):
                self.label_for.add(a['for'])
        elif tag == 'form':
            self._form = {'method': (a.get('method') or 'get').lower(), 'action': a.get('action'),
                          'enctype': a.get('enctype', ''), 'field': []}
            self.form.append(self._form)
        if tag in ('input', 'select', 'textarea', 'button'):
            if tag != 'button':
                self.kontrol.append((tag, a, self.dalam_label > 0))
            if self._form is not None:
                f = {'tag': tag, 'type': (a.get('type') or ('submit' if tag == 'button' else 'text')).lower(),
                     'name': a.get('name'), 'value': a.get('value'), 'checked': 'checked' in a,
                     'required': 'required' in a, 'min': a.get('min'), 'opsi': []}
                self._form['field'].append(f)
                if tag == 'select':
                    self._select = f
        if tag == 'option' and self._select is not None:
            self._select['opsi'].append(a.get('value'))
        if tag not in VOID:
            self.tumpukan.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.tumpukan and self.tumpukan[-1] == tag:
            self.tumpukan.pop()

    def handle_endtag(self, tag):
        if tag == 'title':
            self._di_title = False
        elif tag == 'a' and self._a is not None:
            href, teks, img, aria = self._a
            if not teks.strip() and not img and not aria:
                self.link_kosong += 1
            self._a = None
        elif tag == 'label':
            self.dalam_label = max(0, self.dalam_label - 1)
        elif tag == 'form':
            self._form = None
        elif tag == 'select':
            self._select = None
        if tag in VOID:
            return
        if tag not in self.tumpukan:
            self.tutup_nyasar.append(tag)
            return
        while self.tumpukan:
            atas = self.tumpukan.pop()
            if atas == tag:
                break
            if atas not in OPSIONAL_TUTUP:
                self.tak_tertutup.append(atas)

    def handle_data(self, data):
        if self._di_title:
            self.title += data
        if self._a is not None:
            self._a[1] += data
        if self._select is not None and self._select['opsi'] and self._select['opsi'][-1] is None:
            self._select['opsi'][-1] = data.strip()

    def selesai(self):
        self.close()
        self.tak_tertutup += [t for t in self.tumpukan if t not in OPSIONAL_TUTUP]

def lint_html(halaman, nama_template, sumber):
    """Pemeriksaan struktur & kelengkapan satu halaman hasil render."""
    p = PembacaHTML()
    try:
        p.feed(halaman)
        p.selesai()
    except Exception:
        return p
    kat = 'Template HTML'
    lbl = f'templates/{nama_template}' if nama_template else sumber
    if p.tak_tertutup:
        tag = ', '.join(sorted(set(f'<{t}>' for t in p.tak_tertutup))[:5])
        catat('peringatan', kat, lbl, f'Tag tidak ditutup: {tag}. Tampilan bisa berantakan di browser lain.')
    if p.tutup_nyasar:
        tag = ', '.join(sorted(set(f'</{t}>' for t in p.tutup_nyasar))[:5])
        catat('peringatan', kat, lbl, f'Tag penutup tanpa pembuka: {tag}.')
    if '<html' in halaman.lower() or '<body' in halaman.lower():
        # kelengkapan dokumen digabung jadi satu saran agar laporan tidak penuh hal kecil
        kurang = [teks for ada, teks in (
            (p.doctype, '<!doctype html>'),
            (p.lang, '<html lang="id">'),
            ((p.title or '').strip(), '<title>'),
            (p.charset, '<meta charset="utf-8">'),
            (p.viewport, '<meta name="viewport"> (agar pas di layar HP)'),
        ) if not ada]
        if kurang:
            catat('saran', kat, lbl, 'Kelengkapan HTML yang belum ada: ' + ', '.join(kurang) + '.')
    else:
        catat('saran', kat, lbl, 'Halaman bukan dokumen HTML lengkap (tanpa <html>/<body>). Pakai template dengan struktur HTML utuh.')
    if p.img_tanpa_alt:
        catat('saran', 'Aksesibilitas', lbl, f'{p.img_tanpa_alt} gambar tanpa atribut alt.')
    tanpa_label = [a for tag, a, dalam in p.kontrol
                   if a.get('type', 'text').lower() not in ('hidden', 'submit', 'button', 'reset', 'image')
                   and not dalam and a.get('id') not in p.label_for
                   and not (a.get('aria-label') or a.get('aria-labelledby') or a.get('title'))]
    if tanpa_label:
        catat('saran', 'Aksesibilitas', lbl, f'{len(tanpa_label)} isian form tanpa <label>. Placeholder saja tidak cukup.')
    kembar = [i for i, n in p.id.items() if n > 1]
    if kembar:
        catat('peringatan', kat, lbl, f'id kembar: {", ".join(kembar[:4])}. Setiap id harus unik dalam satu halaman.')
    if p.link_kosong:
        catat('saran', 'Aksesibilitas', lbl, f'{p.link_kosong} link tanpa teks.')
    lompat = [(a, b) for a, b in zip(p.heading, p.heading[1:]) if b > a + 1]
    if lompat:
        catat('saran', kat, lbl, f'Urutan heading melompat (h{lompat[0][0]} langsung ke h{lompat[0][1]}).')
    if p.usang:
        catat('saran', kat, lbl, f'Tag usang: {", ".join(f"<{t}>" for t in sorted(p.usang))}. Ganti dengan CSS.')
    if p.style_inline > 5:
        catat('saran', kat, lbl, f'{p.style_inline} atribut style="..." di HTML. Pindahkan ke berkas CSS.')
    return p

# ---------------------------------------------------------------------
# Mengisi form dengan data contoh
# ---------------------------------------------------------------------
def nilai_contoh(f, semua):
    t, nama = f['type'], (f['name'] or '').lower()
    if f.get('value') and t not in ('checkbox', 'radio', 'submit'):
        return f['value']
    if t == 'email' or 'email' in nama:
        return 'siswa@contoh.sch.id'
    if t == 'password' or 'pass' in nama or 'sandi' in nama:
        return 'Rahasia123!'
    if t in ('number', 'range'):
        return f.get('min') or '5'
    if t == 'date':
        return '2026-10-20'
    if t == 'time':
        return '08:00'
    if t == 'datetime-local':
        return '2026-10-20T08:00'
    if t == 'month':
        return '2026-10'
    if t == 'tel' or 'telp' in nama or 'hp' == nama or 'phone' in nama:
        return '081234567890'
    if t == 'url':
        return 'https://contoh.sch.id'
    if t == 'color':
        return '#336699'
    for kata, isi in (('user', 'budi'), ('nama', 'Budi Santoso'), ('name', 'Budi Santoso'), ('judul', 'Belajar Flask'),
                      ('title', 'Belajar Flask'), ('kelas', 'XI RPL 1'), ('nis', '12345'), ('alamat', 'Jl. Contoh No. 1'),
                      ('harga', '15000'), ('price', '15000'), ('jumlah', '3'), ('qty', '3'), ('stok', '10'),
                      ('umur', '17'), ('age', '17'), ('nilai', '85'), ('tanggal', '2026-10-20')):
        if kata in nama:
            return isi
    return 'Contoh isian'

def data_form(form, kosong=False):
    data = {}
    for f in form['field']:
        if not f['name'] or f['type'] in ('file', 'image', 'reset', 'button'):
            continue
        if f['type'] == 'submit':
            continue
        if f['type'] in ('checkbox', 'radio'):
            if kosong:
                continue
            if f['type'] == 'radio' and f['name'] in data:
                continue
            data[f['name']] = f.get('value') or 'on'
        elif f['tag'] == 'select':
            pilihan = [o for o in f['opsi'] if o]
            data[f['name']] = '' if kosong else (pilihan[0] if pilihan else '')
        elif f['type'] == 'hidden':
            data[f['name']] = f.get('value') or ''
        else:
            data[f['name']] = '' if kosong else nilai_contoh(f, form)
    # tombol submit pertama yang punya name ikut dikirim (sering dipakai untuk membedakan aksi)
    tombol = next((f for f in form['field'] if f['type'] == 'submit' and f['name']), None)
    if tombol:
        data[tombol['name']] = tombol.get('value') or ''
    return data

# ---------------------------------------------------------------------
# Penjelajahan
# ---------------------------------------------------------------------
def periksa_bebas(berkas_json):
    from flask import template_rendered
    berkas = json.loads(berkas_json)
    temuan.clear()
    _kunci_temuan.clear()
    info_run.clear()
    tulis_berkas(berkas)

    for m in sorted(modul_diimpor(berkas)):
        if m in TIDAK_TERSEDIA:
            catat('peringatan', 'Menjalankan', f'import {m}',
                  f'Database {TIDAK_TERSEDIA[m]} tidak tersedia di pemeriksa; bagian yang memakainya tidak bisa diuji. Untuk latihan, pakai SQLite.')

    simpan = {k: sys.modules.get(k) for k in ('js', 'pyodide_js')}
    sys.modules['js'] = None
    sys.modules['pyodide_js'] = None
    try:
        app = muat_app(berkas)
        statistik = {'halaman': 0, 'form': 0, 'route': 0}
        if app is not None:
            jelajahi(app, statistik, template_rendered)
            periksa_template(app, berkas, statistik)
        periksa_kode(berkas, statistik)
    finally:
        for k, v in simpan.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return json.dumps(susun_laporan(statistik))

def jelajahi(app, statistik, template_rendered):
    klien = app.test_client()
    peta = app.url_map.bind('localhost')
    halaman_ok = 0
    template_tampil = set()
    sudah_lint = set()
    perlu_login = set()
    aset_dicek = set()
    form_dikirim = set()
    daftar_form = []

    aturan = [r for r in app.url_map.iter_rules() if not r.endpoint.endswith('static')]
    statistik['route'] = len(aturan)
    rute_param = []
    awal = ['/']
    for r in aturan:
        if 'GET' not in (r.methods or set()) or POLA_LOGOUT.search(r.rule):
            continue
        if not r.arguments:
            awal.append(r.rule)
        else:
            rute_param.append(r)

    def contoh_url(r, besar=False):
        url = r.rule
        for m in re.finditer(r'<(?:(\w+)(?:\([^)]*\))?:)?(\w+)>', r.rule):
            konv = m.group(1) or 'default'
            isi = {'int': '999999' if besar else '1', 'float': '1.5', 'uuid': '00000000-0000-0000-0000-000000000000'}.get(konv, 'contoh')
            url = url.replace(m.group(0), isi, 1)
        return url

    def endpoint_dari(path):
        try:
            return peta.match(path, method='GET')[0]
        except Exception:
            return None

    def buka(url, sumber=None, harap_404=False):
        nonlocal halaman_ok
        kabar({'buka': url})
        rekaman = []
        def rekam(sender, template, context, **extra):
            rekaman.append(template.name)
        template_rendered.connect(rekam, app, weak=False)
        try:
            r = klien.get(url)
        except Exception as e:
            lbl = f'GET {url}'
            if harap_404:
                catat('bug', 'Route', lbl, f'Halaman error saat data tidak ada: {jelaskan_error(e)}. Gunakan abort(404) atau get_or_404().', lokasi_error(e))
            else:
                catat('bug', 'Route', lbl, f'Halaman error: {jelaskan_error(e)}', lokasi_error(e))
            return None
        finally:
            template_rendered.disconnect(rekam, app)
        template_tampil.update(rekaman)
        statistik['halaman'] += 1
        if harap_404 and r.status_code == 200:
            catat('saran', 'Route', f'GET {url}', 'Data yang tidak ada tetap ditampilkan (halaman kosong). Sebaiknya jawab 404, misalnya dengan abort(404) atau get_or_404().')
        if r.status_code == 404:
            if sumber and not harap_404:
                catat('bug', 'Link', f'Link ke {url}', f'Link di halaman {sumber} mengarah ke alamat yang tidak ada (404).')
            return r
        if r.status_code in (401, 403) or (r.status_code in (301, 302, 303, 307, 308) and POLA_LOGIN.search(r.headers.get('Location', ''))):
            perlu_login.add(url)
            return r
        if r.status_code in (301, 302, 303, 307, 308):
            tujuan = urlsplit(urljoin('http://localhost' + url, r.headers.get('Location', '')))
            if tujuan.netloc in ('', 'localhost'):
                antre.append((tujuan.path + (('?' + tujuan.query) if tujuan.query else ''), url))
            return r
        if r.status_code >= 400:
            catat('peringatan', 'Route', f'GET {url}', f'Server menjawab {r.status_code}.')
            return r
        halaman_ok += 1
        jenis = r.headers.get('Content-Type', '')
        if 'html' not in jenis:
            return r
        isi = r.get_data(as_text=True)
        nama_tpl = rekaman[-1] if rekaman else None
        kunci_lint = nama_tpl or url
        if kunci_lint not in sudah_lint:
            sudah_lint.add(kunci_lint)
            if not nama_tpl and len(isi) > 200 and '<' in isi:
                catat('saran', 'Template HTML', f'GET {url}', 'HTML ditulis langsung di kode Python. Pindahkan ke folder templates/ dan pakai render_template().')
            p = lint_html(isi, nama_tpl, f'GET {url}')
        else:
            p = PembacaHTML()
            try:
                p.feed(isi); p.selesai()
            except Exception:
                pass
        for href in p.link:
            tambah_link(href, url)
        for src in p.aset:
            cek_aset(src, url, nama_tpl)
        for f in p.form:
            f['halaman'] = url
            daftar_form.append(f)
        return r

    def tambah_link(href, sumber):
        if not href or href.startswith(('#', 'mailto:', 'tel:', 'javascript:', 'data:')):
            return
        u = urlsplit(urljoin('http://localhost' + sumber, href))
        if u.netloc not in ('', 'localhost') or u.scheme not in ('', 'http', 'https'):
            return
        path = u.path + (('?' + u.query) if u.query else '')
        ep = endpoint_dari(u.path)
        if ep and ep.endswith('static'):
            return
        if POLA_LOGOUT.search(u.path) or (ep and POLA_LOGOUT.search(ep)):
            return
        antre.append((path, sumber))

    def cek_aset(src, sumber, nama_tpl):
        u = urlsplit(urljoin('http://localhost' + sumber, src))
        if u.netloc not in ('', 'localhost') or u.path in aset_dicek:
            return
        aset_dicek.add(u.path)
        try:
            r = klien.get(u.path)
            ada = r.status_code < 400
        except Exception:
            ada = False
        if not ada:
            catat('peringatan', 'Static', u.path, f'Berkas yang dipanggil di {("templates/" + nama_tpl) if nama_tpl else sumber} tidak ditemukan.')

    dikunjungi = set()
    antre = deque((u, None) for u in awal)

    def jalankan_antre():
        while antre and len(dikunjungi) < MAKS_HALAMAN:
            url, sumber = antre.popleft()
            if url in dikunjungi:
                continue
            dikunjungi.add(url)
            buka(url, sumber)

    # 1. Halaman tanpa parameter + link yang ditemukan
    jalankan_antre()
    # 2. Route berparameter: nilai contoh, lalu nilai yang pasti tidak ada (harus 404, bukan error)
    for r in rute_param:
        for besar in (False, True):
            url = contoh_url(r, besar)
            if url not in dikunjungi:
                dikunjungi.add(url)
                buka(url, harap_404=besar)
    jalankan_antre()

    # 3. Form: daftar/registrasi dulu, lalu login, lalu sisanya.
    # 4. Jelajahi ulang: data sudah ada dan mungkin sudah login. Form yang baru terlihat
    #    setelah login ikut dikirim pada putaran berikutnya.
    def urutan(f):
        teks = ((f.get('action') or '') + f['halaman']).lower()
        if re.search(r'daftar|regist|signup', teks):
            return 0
        if POLA_LOGIN.search(f.get('action') or '') or POLA_LOGIN.search(f['halaman']):
            return 1
        return 2
    sisa_login = set()
    for putaran in range(2):
        for f in sorted(daftar_form, key=urutan):
            if statistik['form'] >= MAKS_FORM:
                break
            kirim_form(klien, f, form_dikirim, statistik)
        daftar_form.clear()
        for url in list(perlu_login) + [contoh_url(r) for r in rute_param] + awal:
            dikunjungi.discard(url)
            antre.append((url, None))
        sisa_login = set(perlu_login)
        perlu_login.clear()
        jalankan_antre()
    if perlu_login & sisa_login:
        catat('saran', 'Route', f'{len(perlu_login & sisa_login)} halaman', 'Halaman yang memerlukan login tidak bisa diperiksa (pemeriksa gagal login otomatis).')

    if halaman_ok:
        catat('ok', 'Route', f'{halaman_ok} halaman', 'Terbuka tanpa error.')
    statistik['template_tampil'] = template_tampil

def kirim_form(klien, f, sudah, statistik):
    halaman = f['halaman']
    aksi = urlsplit(urljoin('http://localhost' + halaman, f.get('action') or halaman))
    if aksi.netloc not in ('', 'localhost'):
        return
    path = aksi.path + (('?' + aksi.query) if aksi.query else '')
    kunci = (f['method'], aksi.path, tuple(sorted(x['name'] or '' for x in f['field'])))
    if kunci in sudah:
        return
    sudah.add(kunci)
    statistik['form'] += 1
    metode = 'POST' if f['method'] == 'post' else 'GET'
    lbl = f'Form {metode} {aksi.path}'
    kabar({'form': lbl})
    if any(x['type'] == 'file' for x in f['field']):
        catat('saran', 'Form', lbl, 'Form unggah berkas: isian file tidak diuji otomatis.')

    def kirim(data):
        if metode == 'POST':
            return klien.post(path, data=data)
        return klien.get(path, query_string=data)

    try:
        r = kirim(data_form(f))
    except Exception as e:
        catat('bug', 'Form', lbl, f'Server error saat form dikirim (dari halaman {halaman}): {jelaskan_error(e)}', lokasi_error(e))
        return
    if r.status_code == 405:
        catat('bug', 'Form', lbl, f'Route {aksi.path} tidak menerima metode {metode}. Tambahkan methods=["GET", "POST"] pada @app.route.')
        return
    if r.status_code == 404:
        catat('bug', 'Form', lbl, f'Tujuan form (action) {aksi.path} tidak ditemukan.')
        return
    if r.status_code >= 400:
        catat('peringatan', 'Form', lbl, f'Server menjawab {r.status_code} saat form diisi lengkap.')
        return
    catat('ok', 'Form', lbl, 'Form berhasil dikirim.')

    # Form dikirim kosong: server sebaiknya menolak dengan sopan, bukan error
    if metode == 'POST' and any(x['type'] not in ('hidden', 'submit', 'checkbox', 'radio') and x['name'] for x in f['field']):
        try:
            r = kirim(data_form(f, kosong=True))
            if r.status_code >= 500:
                catat('peringatan', 'Form', lbl, 'Server error kalau form dikirim kosong. Periksa isian dulu sebelum disimpan.')
        except Exception as e:
            catat('peringatan', 'Form', lbl, f'Server error kalau form dikirim kosong ({jelaskan_error(e)}). Periksa isian dulu sebelum disimpan.', lokasi_error(e))

# ---------------------------------------------------------------------
# Template: sintaks, |safe, template yang tidak pernah tampil
# ---------------------------------------------------------------------
def periksa_template(app, berkas, statistik):
    env = app.jinja_env
    try:
        semua = [n for n in env.list_templates() if re.search(r'\.(html?|jinja2?|j2)$', n)]
    except Exception:
        semua = []
    tampil = statistik.pop('template_tampil', set())
    sumber = {}
    for n in semua:
        try:
            sumber[n] = env.loader.get_source(env, n)[0]
        except Exception:
            continue
    dipakai_lain = set()
    for isi in sumber.values():
        for m in re.finditer(r'{%-?\s*(?:extends|include|import|from)\s+["\']([^"\']+)["\']', isi):
            dipakai_lain.add(m.group(1))
    for n, isi in sumber.items():
        try:
            env.parse(isi, n)
        except Exception as e:
            catat('bug', 'Template HTML', f'templates/{n}', f'Salah tulis Jinja baris {getattr(e, "lineno", "?")}: {getattr(e, "message", e)}')
            continue
        for i, baris in enumerate(isi.splitlines(), 1):
            if re.search(r'\|\s*safe\b', baris):
                catat('peringatan', 'Keamanan', f'templates/{n}', f'|safe di baris {i} mematikan perlindungan XSS. Pastikan isinya bukan dari input pengguna.')
                break
        if re.search(r'{%-?\s*autoescape\s+false', isi):
            catat('peringatan', 'Keamanan', f'templates/{n}', 'autoescape false mematikan perlindungan XSS.')
        if n not in tampil and n not in dipakai_lain:
            catat('saran', 'Template HTML', f'templates/{n}', 'Template tidak pernah tampil saat pemeriksaan (perlu login, atau tidak dipakai).')

# ---------------------------------------------------------------------
# Kode Python: pyflakes + pola keamanan
# ---------------------------------------------------------------------
def periksa_kode(berkas, statistik):
    try:
        from pyflakes import api as pf_api, reporter as pf_rep, messages as pf
    except Exception:
        pf_api = None
    py = {p: isi for p, isi in berkas.items() if p.endswith('.py')}
    ada_hash = any(re.search(r'generate_password_hash|check_password_hash|bcrypt|hashpw|argon2|passlib|pbkdf2', isi) for isi in py.values())
    ada_password = any(re.search(r'password|kata_sandi|sandi', isi, re.I) for isi in py.values())
    for p, isi in py.items():
        if pf_api:
            class Penampung(pf_rep.Reporter):
                def __init__(self):
                    self.pesan = []
                def unexpectedError(self, *a): pass
                def syntaxError(self, *a): pass
                def flake(self, m): self.pesan.append(m)
            pen = Penampung()
            pf_api.check(isi, p, pen)
            for m in pen.pesan:
                lok = f'{p} baris {m.lineno}'
                teks = m.message % m.message_args
                if isinstance(m, pf.UndefinedName):
                    catat('bug', 'Kode Python', p, f'Nama {m.message_args[0]!r} belum didefinisikan atau belum di-import.', lok)
                elif isinstance(m, pf.UnusedImport):
                    catat('saran', 'Kode Python', p, f'Import tidak dipakai: {m.message_args[0]}.', lok)
                elif isinstance(m, pf.UnusedVariable):
                    catat('saran', 'Kode Python', p, f'Variabel {m.message_args[0]!r} dibuat tapi tidak dipakai.', lok)
                elif isinstance(m, pf.RedefinedWhileUnused):
                    catat('peringatan', 'Kode Python', p, f'{m.message_args[0]!r} didefinisikan dua kali; yang pertama tertimpa.', lok)
                elif isinstance(m, (pf.ImportStarUsed, pf.ImportStarUsage)):
                    continue
                else:
                    catat('saran', 'Kode Python', p, teks, lok)
        try:
            pohon = ast.parse(isi)
        except SyntaxError:
            continue
        for n in ast.walk(pohon):
            # SQL disusun dengan f-string / % / + / .format
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('execute', 'executemany', 'executescript') and n.args:
                a0 = n.args[0]
                rawan = isinstance(a0, ast.JoinedStr) and any(isinstance(v, ast.FormattedValue) for v in a0.values) \
                    or isinstance(a0, ast.BinOp) and isinstance(a0.op, (ast.Mod, ast.Add)) \
                    or isinstance(a0, ast.Call) and isinstance(a0.func, ast.Attribute) and a0.func.attr == 'format'
                if rawan:
                    catat('peringatan', 'Keamanan', p, 'Query SQL disusun dengan f-string/format/+: rawan SQL injection. Pakai parameter, misalnya execute("... WHERE id = ?", (id,)).', f'{p} baris {n.lineno}')
            # secret_key ditulis langsung
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
                for tg in n.targets:
                    nama = tg.attr if isinstance(tg, ast.Attribute) else (tg.slice.value if isinstance(tg, ast.Subscript) and isinstance(tg.slice, ast.Constant) else None)
                    if nama in ('secret_key', 'SECRET_KEY'):
                        catat('saran', 'Keamanan', p, 'secret_key ditulis langsung di kode. Untuk aplikasi sungguhan, simpan di variabel lingkungan / .env.', f'{p} baris {n.lineno}')
            if isinstance(n, ast.ExceptHandler) and n.type is None:
                catat('saran', 'Kode Python', p, 'except: tanpa jenis error menyembunyikan semua kesalahan. Tulis jenisnya, misalnya except ValueError:.', f'{p} baris {n.lineno}')
    if ada_password and not ada_hash:
        catat('peringatan', 'Keamanan', 'Password', 'Ada password tetapi tidak terlihat proses hash. Simpan dengan generate_password_hash() dan cek dengan check_password_hash().')

# ---------------------------------------------------------------------
# Laporan
# ---------------------------------------------------------------------
BOBOT = {'bug': 12, 'peringatan': 4, 'saran': 1, 'ok': 0}
URUT = {'bug': 0, 'peringatan': 1, 'saran': 2, 'ok': 3}

def susun_laporan(statistik):
    hitung = {k: sum(1 for t in temuan if t['tingkat'] == k) for k in BOBOT}
    # pengurangan dibatasi per tingkat agar banyak saran kecil tidak menenggelamkan skor
    potong = min(60, hitung['bug'] * 12) + min(25, hitung['peringatan'] * 4) + min(15, hitung['saran'])
    skor = max(0, 100 - potong)
    butir = []
    for t in sorted(temuan, key=lambda t: (URUT[t['tingkat']], t['kategori'])):
        b = {k: t[k] for k in ('tingkat', 'kategori', 'label', 'pesan', 'lulus') if k in t}
        if t.get('lokasi'):
            b['lokasi'] = t['lokasi']
        if t['jumlah'] > 1:
            b['pesan'] += f' (×{t["jumlah"]})'
        butir.append(b)
    return {
        'lulus': hitung['bug'] == 0,
        'skor': skor,
        'ringkasan': {'bug': hitung['bug'], 'peringatan': hitung['peringatan'], 'saran': hitung['saran'],
                      'halaman': statistik.get('halaman', 0), 'form': statistik.get('form', 0), 'route': statistik.get('route', 0)},
        'butir': butir[:250],
    }
