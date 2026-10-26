// =====================================================================
// TIKET (LEVEL) — satu sumber untuk halaman siswa & guru.
//   tugas  = apa yang harus dibuat siswa di proyek VS Code-nya
//   cek    = pemeriksaan teks kode (regex) sebelum dijalankan
//   kasus  = permintaan ke aplikasi siswa lewat app.test_client(), berurutan
//            dengan klien yang sama (data di list ikut tersimpan antar-kasus)
//   catatan / layar = tampilan di kantor saat tiket lulus
// =====================================================================
export const LEVEL = [
  {
    judul: 'Tiket #1 — Nyalakan servernya',
    konsep: 'Flask(__name__), @app.route',
    tugas: `Buat folder proyek baru berisi <code>app.py</code>. Halaman depan <code>/</code> harus menampilkan teks <code>Halo, Dunia!</code>.`,
    petunjuk: `<pre>from flask import Flask

app = Flask(__name__)

@app.route('/')
def beranda():
    return 'Halo, Dunia!'</pre>`,
    kasus: [{ url: '/', berisi: ['Halo, Dunia!'] }],
    catatan: '/', layar: 'Halo, Dunia!',
  },
  {
    judul: 'Tiket #2 — Halaman profil sekolah',
    konsep: 'route kedua',
    tugas: `Lanjutkan proyekmu. Tambahkan halaman <code>/profil</code> yang menampilkan teks <code>SMK Karya Bangsa</code>. Halaman depan <code>/</code> jangan sampai rusak.`,
    petunjuk: `Tiru pola route <code>/</code>: <code>@app.route('/profil')</code> lalu fungsi baru dengan nama berbeda, misalnya <code>def profil():</code>.`,
    kasus: [{ url: '/', berisi: ['Halo, Dunia!'] }, { url: '/profil', berisi: ['SMK Karya Bangsa'] }],
    catatan: '/profil', layar: 'Karya Bangsa',
  },
  {
    judul: 'Tiket #3 — Beranda pakai template',
    konsep: 'render_template, {{ variabel }}, {% for %}',
    tugas: `Pindahkan tampilan beranda ke template.
      <ul>
        <li>Buat <code>templates/index.html</code> yang menampilkan nama sekolah dengan <code>{{ }}</code> dan daftar jurusan dengan <code>{% for %}</code>.</li>
        <li>Di <code>app.py</code>, buat list <code>JURUSAN = ['RPL', 'TKJ', 'AKL']</code> lalu kirim <code>SMK Karya Bangsa</code> dan list itu ke template lewat <code>render_template(...)</code>. Nama variabelnya bebas.</li>
        <li>Nama sekolah dan jurusan <b>tidak boleh</b> ditulis langsung di template.</li>
      </ul>`,
    petunjuk: `<code>return render_template('index.html', sekolah='SMK Karya Bangsa', jurusan=JURUSAN)</code>; di template: <code>&lt;h1&gt;{{ sekolah }}&lt;/h1&gt;</code> dan <code>{% for j in jurusan %}&lt;li&gt;{{ j }}&lt;/li&gt;{% endfor %}</code>.`,
    kasus: [
      {
        url: '/', berisi: ['SMK Karya Bangsa', 'RPL', 'TKJ', 'AKL'],
        // diperiksa lewat sinyal template_rendered: nama variabel bebas
        variabel: [
          { nilai: 'SMK Karya Bangsa', nama: 'nama sekolah', cara: '{{ nama_variabel }}' },
          { nilai: ['RPL', 'TKJ', 'AKL'], nama: 'daftar jurusan', cara: '{% for ... %}' },
        ],
      },
      { url: '/profil', berisi: ['SMK Karya Bangsa'] },
    ],
    catatan: 'template', layar: '• RPL • TKJ',
  },
  {
    judul: 'Tiket #4 — Halaman per jurusan',
    konsep: 'route dinamis <int:nomor>, abort(404)',
    tugas: `Buat route <code>/jurusan/&lt;nomor&gt;</code>: <code>/jurusan/0</code> menampilkan <code>RPL</code>, <code>/jurusan/1</code> menampilkan <code>TKJ</code>, <code>/jurusan/2</code> menampilkan <code>AKL</code>. Nomor yang tidak ada (misalnya <code>/jurusan/9</code>) harus menjawab <b>404</b>, bukan error.`,
    petunjuk: `<code>@app.route('/jurusan/&lt;int:nomor&gt;')</code>, lalu <code>if nomor &gt;= len(JURUSAN): abort(404)</code> sebelum <code>return JURUSAN[nomor]</code>. Jangan lupa <code>from flask import abort</code>.`,
    kasus: [
      { url: '/jurusan/0', berisi: ['RPL'] },
      { url: '/jurusan/2', berisi: ['AKL'] },
      { url: '/jurusan/9', status: 404, label: 'GET /jurusan/9 (nomor tidak ada)' },
      { url: '/jurusan/rpl', status: 404, label: 'GET /jurusan/rpl (bukan angka)' },
    ],
    catatan: '/jurusan/0', layar: 'Jurusan RPL',
  },
  {
    judul: 'Tiket #5 — Form tambah tugas',
    konsep: "methods=['GET','POST'], request.form",
    tugas: `Buat halaman <code>/tugas</code> untuk mencatat tugas.
      <ul>
        <li>Template <code>templates/tugas.html</code> berisi <code>&lt;form method="post"&gt;</code> dengan input <code>name="judul"</code>, dan daftar tugas yang sudah tersimpan.</li>
        <li>Simpan tugas di list <code>TUGAS = []</code> di <code>app.py</code>.</li>
        <li>Saat form dikirim (POST), isi field <code>judul</code> ditambahkan ke list lalu halaman menampilkan daftar terbaru.</li>
      </ul>`,
    petunjuk: `<code>@app.route('/tugas', methods=['GET', 'POST'])</code>; di dalam fungsi: <code>if request.method == 'POST': TUGAS.append(request.form['judul'])</code>, lalu <code>return render_template('tugas.html', tugas=TUGAS)</code>.`,
    kasus: [
      { url: '/tugas', berisi: ['<form'] },
      { metode: 'POST', url: '/tugas', data: { judul: 'Belajar Flask' }, berisi: ['Belajar Flask'], label: 'POST /tugas (kirim "Belajar Flask")' },
      { url: '/tugas', berisi: ['Belajar Flask'], label: 'GET /tugas (tugas tetap tersimpan)' },
    ],
    catatan: 'POST', layar: '✉ Belajar Flask',
  },
  {
    judul: 'Tiket #6 — Jangan kirim dua kali',
    konsep: 'redirect, url_for',
    tugas: `Bug dari QA: setelah menyimpan tugas, menekan F5 membuat tugas tersimpan <b>dua kali</b>. Terapkan pola <i>Post/Redirect/Get</i>:
      <ul>
        <li>Setelah POST, <code>return redirect(url_for(...))</code> ke halaman daftar tugas.</li>
        <li>Atribut <code>action</code> form di <code>templates/tugas.html</code> memakai <code>{{ url_for(...) }}</code>, bukan alamat yang ditulis langsung.</li>
      </ul>`,
    petunjuk: `<code>from flask import redirect, url_for</code>; setelah <code>append</code>: <code>return redirect(url_for('tugas'))</code>. Argumen <code>url_for</code> adalah <b>nama fungsi</b>, bukan alamat. Di template: <code>action="{{ url_for('tugas') }}"</code>.`,
    cek: [
      // saran: ditampilkan sebagai catatan kuning, tidak memengaruhi kelulusan
      { saran: true, berkas: 'app.py', pola: /url_for\(/, pesan: "Alamat redirect sebaiknya dibuat dengan url_for('nama_fungsi'), bukan ditulis langsung.", syarat: 'app.py memakai url_for(...)' },
      { saran: true, berkas: 'templates/*', pola: /action\s*=\s*["']?\s*\{\{\s*url_for\(/, pesan: 'Atribut action pada form sebaiknya memakai {{ url_for(...) }}.', syarat: 'action form memakai {{ url_for(...) }}' },
    ],
    kasus: [
      { metode: 'POST', url: '/tugas', data: { judul: 'Ujian Praktik' }, status: 302, lokasi: '/tugas', label: 'POST /tugas → harus redirect ke /tugas' },
      { url: '/tugas', berisi: ['Ujian Praktik'], label: 'GET /tugas (tugas tampil)' },
    ],
    catatan: 'redirect', layar: 'Daftar Tugas ✓',
  },
];

/** Daftar hal yang akan diperiksa, untuk ditampilkan ke siswa sebelum mengunggah. */
export function daftarPemeriksaan(L) {
  return [
    ...L.kasus.map((k) => {
      const dasar = k.label || `${k.metode || 'GET'} ${k.url}`;
      if (k.status === 404) return `${dasar} → menjawab 404`;
      if (k.status === 302) return dasar;
      const tampil = `${dasar} → menampilkan ${k.berisi.map((s) => `"${s}"`).join(', ')}`;
      return k.variabel ? [tampil, `Template menampilkan ${k.variabel.map((v) => v.nama).join(' & ')} dari variabel`] : tampil;
    }).flat(),
    ...(L.cek || []).map((c) => c.saran ? `Saran: ${c.syarat} (tidak memengaruhi kelulusan)` : c.syarat),
  ];
}
