// =====================================================================
// LAPORAN — menggambar hasil pemeriksaan (dipakai halaman guru & siswa).
//   Mode tiket: daftar ✔/✘ per kasus uji.
//   Mode bebas: skor + jumlah per tingkat, lalu temuan berkelompok.
// Semua teks dari hasil disisipkan sebagai textContent (tidak pernah sebagai HTML).
// =====================================================================
const IKON = { bug: '🔴', peringatan: '🟡', saran: '🔵', ok: '✅' };
const JUDUL = { bug: 'Bug', peringatan: 'Peringatan', saran: 'Saran', ok: 'Berjalan baik' };

const el = (tag, props = {}, ...anak) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...anak.filter((a) => a !== null && a !== undefined));
  return e;
};

function butirLi(kelas, ikon, label, pesan, lokasi) {
  const li = el('li', { className: kelas }, `${ikon} `, el('code', { textContent: label }), ' — ', pesan);
  if (lokasi) li.append(el('div', { className: 'kecil redup mono', textContent: lokasi }));
  return li;
}

/** Laporan mode tiket. */
export function gambarTiket(wadah, hasil, { tampilSelesai = true } = {}) {
  const daftar = [];
  if (hasil.error) daftar.push(butirLi('gagal', '✘', 'Aplikasi tidak bisa dijalankan', hasil.error));
  for (const b of hasil.butir.filter((x) => !x.saran)) {
    daftar.push(butirLi(b.lulus ? 'lulus' : 'gagal', b.lulus ? '✔' : '✘', b.label, b.pesan, b.lokasi));
  }
  if (hasil.lulus && tampilSelesai) daftar.push(butirLi('lulus', '✔', 'Tiket selesai', 'Semua pemeriksaan berhasil.'));
  for (const b of hasil.butir.filter((x) => x.saran)) daftar.push(butirLi('saran', '💡', b.label, b.pesan));
  wadah.replaceChildren(el('ul', { className: 'hasil' }, ...daftar));
}

/** Laporan mode proyek bebas. */
export function gambarBebas(wadah, hasil) {
  const r = hasil.ringkasan || {};
  const lencana = (tingkat) => el('span', { className: `chip ${tingkat}` }, `${IKON[tingkat]} ${r[tingkat] ?? 0} ${JUDUL[tingkat]}`);
  const atas = el('div', { className: 'ringkas-laporan' },
    el('div', { className: `skor ${hasil.lulus ? 'lulus' : 'gagal'}` },
      el('span', { className: 'angka', textContent: String(hasil.skor ?? 0) }), el('span', { className: 'kecil', textContent: 'skor' })),
    el('div', {},
      el('div', { className: 'aksi' }, lencana('bug'), lencana('peringatan'), lencana('saran')),
      el('div', { className: 'kecil redup', style: 'margin-top:6px',
        textContent: `${r.halaman ?? 0} kali membuka halaman · ${r.form ?? 0} form dikirim · ${r.route ?? 0} route` })));

  const bagian = [atas];
  if (hasil.error) bagian.push(el('ul', { className: 'hasil' }, butirLi('gagal', '🔴', 'Pemeriksa', hasil.error)));
  for (const tingkat of ['bug', 'peringatan', 'saran', 'ok']) {
    const isi = hasil.butir.filter((b) => b.tingkat === tingkat);
    if (!isi.length) continue;
    const ul = el('ul', { className: 'hasil' }, ...isi.map((b) =>
      butirLi({ bug: 'gagal', peringatan: 'peringatan', saran: 'info', ok: 'lulus' }[tingkat], IKON[tingkat], `${b.kategori} · ${b.label}`, b.pesan, b.lokasi)));
    // bug & peringatan selalu terbuka; saran dan yang berjalan baik bisa dibuka bila perlu
    const kotak = el('details', { className: 'kelompok', open: tingkat === 'bug' || tingkat === 'peringatan' },
      el('summary', { textContent: `${IKON[tingkat]} ${JUDUL[tingkat]} (${isi.length})` }), ul);
    bagian.push(kotak);
  }
  if (!hasil.butir.some((b) => b.tingkat !== 'ok') && !hasil.error) {
    bagian.push(el('p', { textContent: 'Tidak ada masalah yang ditemukan. 🎉' }));
  }
  wadah.replaceChildren(...bagian);
}

export function gambarLaporan(wadah, hasil, opsi) {
  if (typeof hasil.skor === 'number' || hasil.butir.some((b) => b.tingkat)) gambarBebas(wadah, hasil);
  else gambarTiket(wadah, hasil, opsi);
}
