// =====================================================================
// PENGUJI — menjalankan kode siswa di Web Worker, dengan batas waktu.
// =====================================================================
const BATAS_TIKET_MS = 15000;
const BATAS_BEBAS_MS = 60000;
const BATAS_POS_MS = 180000;   // seluruh 96 test resmi ±45 dtk di laptop guru; beri ruang untuk PC lambat

/**
 * Pemeriksaan teks kode: `ada` = berkas wajib ada; `pola` wajib cocok, atau dilarang bila `tidak`.
 * `berkas: 'templates/*'` = gabungan semua berkas di folder itu.
 */
export function cekGagal(c, berkas) {
  const isi = c.berkas.endsWith('/*')
    ? Object.entries(berkas).filter(([n]) => n.startsWith(c.berkas.slice(0, -1))).map(([, t]) => t).join('\n') || undefined
    : berkas[c.berkas];
  if (c.ada) return isi === undefined;
  if (isi === undefined) return !c.tidak;
  return c.pola.test(isi) === !!c.tidak;
}

// Kode siswa berjalan di interpreter yang sama dengan pemeriksa. Cara-cara mengutak-atik
// pemeriksa (mengubah modul lain, builtins, membaca frame) ditandai dan membuat kiriman tidak lulus.
const POLA_CURANG = [
  /\bimport\s+__main__\b|\bfrom\s+__main__\s+import\b/,
  /\bsys\.modules\b/,
  /\bimport\s+builtins\b|\b__builtins__\b/,
  /\bsys\._getframe\b|\binspect\.(stack|currentframe|getouterframes)\b/,
  /\bgc\.get_(objects|referrers)\b/,
  /\bimport\s+(ctypes|pyodide|js|micropip)\b|\bfrom\s+(pyodide|js|micropip)\b/,
];

export function cariKecurangan(berkas) {
  const hasil = [];
  for (const [nama, isi] of Object.entries(berkas)) {
    if (!nama.endsWith('.py')) continue;
    isi.split('\n').forEach((baris, i) => {
      if (POLA_CURANG.some((p) => p.test(baris))) hasil.push(`${nama} baris ${i + 1}`);
    });
  }
  return hasil;
}

const butirCurang = (lokasi) => ({
  label: 'Kode tidak diizinkan', lulus: false, tingkat: 'bug', kategori: 'Pemeriksaan', lokasi: lokasi.slice(0, 3).join(', '),
  pesan: 'Kode memakai fitur yang bisa mengubah jalannya pemeriksa (sys.modules, __main__, builtins, frame, ctypes/pyodide). Hapus bagian itu.',
});

export class Penguji {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.nomor = 0;
    this.menunggu = new Map();
    this.mulai();
  }

  mulai() {
    this.worker = new Worker('/js/penguji-worker.js');
    this.worker.onmessage = (e) => {
      const tunggu = this.menunggu.get(e.data.id);
      if (!tunggu) return;
      if (e.data.progres) { tunggu.progres?.(e.data.progres); return; }
      this.menunggu.delete(e.data.id);
      clearTimeout(tunggu.timer);
      e.data.ok ? tunggu.selesai(e.data) : tunggu.gagal(new Error(e.data.pesan));
    };
    this.worker.onerror = (e) => {
      for (const t of this.menunggu.values()) { clearTimeout(t.timer); t.gagal(new Error(e.message || 'Worker berhenti')); }
      this.menunggu.clear();
    };
    this.onStatus('Memuat Python (sekali saja, ±20 MB)…');
    this.siap = this.kirim({ jenis: 'siap' }, 240000)
      .then((r) => { this.onStatus(`Python siap · Flask ${r.versi}`); return r.versi; })
      .catch((e) => { this.onStatus('Gagal memuat Python. Periksa internet lalu muat ulang halaman.'); throw e; });
  }

  kirim(pesan, batas, progres) {
    const id = ++this.nomor;
    return new Promise((selesai, gagal) => {
      const timer = setTimeout(() => {
        this.menunggu.delete(id);
        gagal(Object.assign(new Error('waktu habis'), { waktuHabis: true }));
      }, batas);
      this.menunggu.set(id, { selesai, gagal, timer, progres });
      this.worker.postMessage({ id, ...pesan });
    });
  }

  ulangWorker() {
    this.worker.terminate();
    this.mulai();
  }

  /**
   * Periksa kiriman untuk satu tiket.
   * Mengembalikan { lulus, error?, butir: [{label, lulus, pesan, saran?}] }.
   */
  async periksa(berkas, L) {
    await this.siap;
    const curang = cariKecurangan(berkas);
    const butirCek = (L.cek || []).filter((c) => !c.saran && cekGagal(c, berkas))
      .map((c) => ({ label: c.berkas, lulus: false, pesan: c.pesan }));
    if (curang.length) butirCek.unshift(butirCurang(curang));
    // Saran tidak memengaruhi kelulusan; hanya dimunculkan agar bisa dibahas di kelas
    const saran = (L.cek || []).filter((c) => c.saran && cekGagal(c, berkas))
      .map((c) => ({ label: 'Saran', lulus: true, saran: true, pesan: c.pesan }));
    if (!('app.py' in berkas)) {
      return { lulus: false, error: 'Tiket ini memeriksa berkas app.py di folder utama proyek, tetapi berkas itu tidak ada.', butir: butirCek };
    }

    let hasil;
    try {
      hasil = (await this.kirim({ jenis: 'uji', berkas, kasus: L.kasus }, BATAS_TIKET_MS)).hasil;
    } catch (e) {
      if (!e.waktuHabis) return { lulus: false, error: `Pemeriksa gagal: ${e.message}`, butir: butirCek };
      // Perulangan tanpa henti: hentikan worker lalu siapkan yang baru
      this.ulangWorker();
      return {
        lulus: false,
        error: 'Aplikasi berjalan terlalu lama (lebih dari 15 detik) dan dihentikan. Cari perulangan yang tidak pernah berhenti.',
        butir: butirCek,
      };
    }
    if (hasil.error) return { lulus: false, error: hasil.error, butir: butirCek };
    const butir = [...hasil.hasil, ...butirCek];
    return { lulus: butir.every((b) => b.lulus), butir: [...butir, ...saran] };
  }

  /**
   * Periksa proyek POS untuk satu bab: cek teks berkas + test resmi (pytest) bab ≤ bab itu.
   * `onProgres(teks)` dipanggil tiap satu test selesai.
   * Mengembalikan { lulus, error?, butir: [{label, lulus, pesan, lokasi?}] } seperti periksa().
   */
  async periksaPos(berkas, { uji, cek }, onProgres = () => {}) {
    await this.siap;
    const curang = cariKecurangan(Object.fromEntries(Object.entries(berkas).filter(([n]) => !/^tests?\//.test(n))));
    const butirCek = (cek || []).filter((c) => cekGagal(c, berkas))
      .map((c) => ({ label: c.syarat, lulus: false, pesan: c.pesan, lokasi: c.berkas }));
    if (curang.length) butirCek.unshift(butirCurang(curang));
    if (!uji.length) return { lulus: butirCek.length === 0, butir: butirCek };

    let hasil;
    try {
      const progres = (p) => { if (p.test) onProgres(`test ${p.test} dari ${p.total}`); };
      hasil = (await this.kirim({ jenis: 'pos', berkas, uji }, BATAS_POS_MS, progres)).hasil;
    } catch (e) {
      if (!e.waktuHabis) return { lulus: false, error: `Pemeriksa gagal: ${e.message}`, butir: butirCek };
      this.ulangWorker();
      return {
        lulus: false,
        error: `Test tidak selesai dalam ${BATAS_POS_MS / 1000} detik dan dihentikan. Cari perulangan yang tidak pernah berhenti.`,
        butir: butirCek,
      };
    }
    if (hasil.error) return { lulus: false, error: hasil.error, butir: butirCek };
    const butir = [...butirCek, ...hasil.hasil];
    return { lulus: butir.every((b) => b.lulus), butir };
  }

  /**
   * Periksa proyek Flask apa pun (mode bebas). `onProgres(teks)` dipanggil saat
   * pemeriksa membuka halaman / mengirim form.
   * Mengembalikan { lulus, skor, ringkasan, butir: [{tingkat, kategori, label, pesan, lokasi?}] }.
   */
  async periksaBebas(berkas, onProgres = () => {}) {
    await this.siap;
    const sementara = [];
    let terakhir = '';
    const progres = (p) => {
      if (p.temuan) sementara.push(p.temuan);
      if (p.buka || p.form) { terakhir = p.buka ? `GET ${p.buka}` : p.form; onProgres(terakhir); }
    };
    let laporan;
    try {
      const r = await this.kirim({ jenis: 'bebas', berkas }, BATAS_BEBAS_MS, progres);
      laporan = r.hasil;
      for (const p of r.gagalPasang || []) {
        laporan.butir.push({ tingkat: 'peringatan', kategori: 'Menjalankan', label: p, lulus: true, pesan: `Paket ${p} gagal dipasang di pemeriksa; bagian yang memakainya mungkin ikut error.` });
      }
    } catch (e) {
      if (!e.waktuHabis) {
        return { lulus: false, skor: 0, error: `Pemeriksa gagal: ${e.message}`, butir: [], ringkasan: {} };
      }
      this.ulangWorker();
      // Laporan sebagian dari temuan yang sudah terkirim sebelum waktu habis
      sementara.unshift({
        tingkat: 'bug', kategori: 'Route', label: terakhir || 'Aplikasi', lulus: false,
        pesan: 'Pemeriksaan dihentikan karena tidak selesai dalam 60 detik. Kemungkinan ada perulangan tanpa henti di bagian ini.',
      });
      laporan = { lulus: false, butir: sementara, ringkasan: {} };
      laporan.ringkasan = hitungRingkas(sementara);
      laporan.skor = Math.max(0, 100 - Math.min(60, laporan.ringkasan.bug * 12) - Math.min(25, laporan.ringkasan.peringatan * 4) - Math.min(15, laporan.ringkasan.saran));
    }
    const curang = cariKecurangan(berkas);
    if (curang.length) {
      laporan.butir.unshift(butirCurang(curang));
      laporan.lulus = false;
      laporan.ringkasan = { ...laporan.ringkasan, bug: (laporan.ringkasan.bug || 0) + 1 };
    }
    return laporan;
  }
}

function hitungRingkas(butir) {
  const r = { bug: 0, peringatan: 0, saran: 0 };
  for (const b of butir) if (b.tingkat in r) r[b.tingkat]++;
  return r;
}
