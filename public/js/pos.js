// =====================================================================
// TIKET PROYEK POS (SMK Mart POS) — satu tiket per bab tutorial
// https://projekrpl.karyabangsa.sch.id/  (Bab 2–17; Bab 0–1 belum berisi aplikasi)
//
//   Pemeriksaan memakai test resmi proyek (public/pos/tests/, sama dengan Paket Starter)
//   ditambah test_pemeriksa_pos.py untuk titik periksa yang di tutorial dicek manual.
//   Tiap bab MENAMBAH test; test bab sebelumnya ikut dijalankan supaya fitur lama tidak rusak.
//   Pilihan test mengikuti tutorial, termasuk test yang sengaja "ditunda" ke bab berikutnya
//   (mis. dua test login sukses baru hijau di Bab 10 dan Bab 14).
//
//   cek = pemeriksaan teks berkas (format sama dengan LEVEL di level.js)
// =====================================================================
const t = (berkas, ...nama) => nama.map((n) => `tests/${berkas}.py::${n}`);

// Semua test resmi per berkas (untuk "seluruh berkas hijau")
const SEMUA = {
  test_models: ['test_user_password_hashing', 'test_produk_model', 'test_pelanggan_bawaan', 'test_metode_bayar_model', 'test_order_and_items_snapshot', 'test_pengaturan_model'],
  test_seed: ['test_seed_populates_initial_data', 'test_seed_is_idempotent', 'test_seed_aborts_without_passwords'],
  test_auth: ['test_login_success_admin_to_dashboard', 'test_login_success_kasir_to_pos', 'test_login_invalid_credentials', 'test_login_inactive_user_rejected', 'test_unauthenticated_redirect_to_login', 'test_logout_redirect_and_session_cleared', 'test_kasir_cannot_access_admin_pages', 'test_kasir_cannot_post_to_admin_routes'],
  test_errors: ['test_404_error_page', 'test_403_error_page_unauthenticated', 'test_500_error_page'],
  test_pengguna: ['test_tambah_pengguna_valid', 'test_tambah_pengguna_duplicate_username', 'test_tambah_pengguna_short_password', 'test_kasir_deactivated_cannot_login', 'test_admin_cannot_deactivate_self_or_last_admin', 'test_admin_reset_password', 'test_edit_user_immutable_username'],
  test_master_data: ['test_tambah_produk_valid', 'test_tambah_produk_duplicate_code', 'test_produk_negative_price_or_stock', 'test_deactivate_produk', 'test_produk_delete_route_not_allowed', 'test_produk_stok_menipis_label', 'test_produk_search_and_filter', 'test_tambah_dan_ubah_pelanggan_valid', 'test_pelanggan_invalid_telepon', 'test_pelanggan_umum_immutable', 'test_pelanggan_with_orders_cannot_be_deleted', 'test_kasir_cannot_delete_pelanggan', 'test_admin_delete_pelanggan_without_order', 'test_crud_metode_bayar', 'test_metode_bayar_duplicate_name', 'test_cannot_deactivate_last_active_metode', 'test_metode_bayar_delete_not_available', 'test_admin_update_pengaturan_nama_dan_alamat', 'test_pengaturan_validation_errors', 'test_pengaturan_ambang_stok_updates_produk_list'],
  test_pos: ['test_hitung_pajak_dan_total_pembulatan', 'test_transaksi_tunai_sukses', 'test_transaksi_tunai_kurang_ditolak', 'test_keranjang_kosong_ditolak', 'test_jumlah_melebihi_stok_ditolak', 'test_produk_stok_nol_atau_nonaktif_ditolak', 'test_harga_diambil_dari_database_snapshot', 'test_transaksi_atomik_gagal_stok_tidak_berubah', 'test_stok_tidak_pernah_negatif_pada_pembelian_berurutan', 'test_transaksi_non_tunai_transfer_dan_qris', 'test_pelanggan_default_umum_dan_terdaftar', 'test_tambah_pelanggan_cepat_pos', 'test_struk_order', 'test_larangan_hapus_order_dan_item', 'test_perubahan_harga_produk_tidak_mengubah_order_lama'],
  test_order_batal: ['test_riwayat_order_filter_default_hari_ini_wib', 'test_riwayat_order_hak_akses_admin_vs_kasir', 'test_filter_status_kasir_dan_nomor', 'test_kasir_ajukan_pembatalan_sukses', 'test_kasir_ajukan_pembatalan_alasan_kurang_ditolak', 'test_kasir_ajukan_pembatalan_order_bukan_miliknya_atau_bukan_selesai_ditolak', 'test_admin_konfirmasi_pembatalan_dengan_cek_fisik', 'test_admin_konfirmasi_tanpa_cek_fisik_ditolak', 'test_konfirmasi_order_sudah_dibatalkan_ditolak', 'test_admin_tolak_pengajuan_pembatalan', 'test_admin_batalkan_langsung', 'test_kasir_dilarang_konfirmasi_tolak_atau_batal_langsung'],
  test_dashboard: ['test_dashboard_metrik_hari_ini_wib', 'test_dashboard_state_kosong_tanpa_order', 'test_dashboard_top_5_produk_terlaris_30_hari', 'test_dashboard_stok_menipis', 'test_dashboard_counter_pengajuan_batal', 'test_dashboard_hak_akses_admin_saja'],
  test_laporan_dan_stok: ['test_restock_cepat_sukses', 'test_restock_cepat_validasi_negatif', 'test_kasir_dilarang_restock_cepat', 'test_penjualan_pos_mencatat_mutasi_keluar', 'test_pembatalan_order_mencatat_mutasi_batal', 'test_halaman_dan_ekspor_laporan_penjualan', 'test_halaman_dan_ekspor_kartu_stok'],
  test_lan_and_nfr: ['test_nf_01_semua_halaman_terproteksi_redirect_ke_login', 'test_nf_02_csrf_protection_menolak_permintaan_tanpa_token', 'test_nf_03_sql_injection_safety_pada_pencarian', 'test_nf_04_gitignore_and_credentials_check', 'test_nf_06_format_rupiah_dan_bahasa_indonesia', 'test_nf_07_waktu_ui_wib_dan_db_utc', 'test_nf_09_order_snapshot_immutability', 'test_nf_10_and_ac_114_error_500_tanpa_traceback', 'test_a11y_05_status_order_berupa_teks_eksplisit'],
};
const semua = (berkas) => t(berkas, ...SEMUA[berkas]);
const tambahan = (...nama) => t('test_pemeriksa_pos', ...nama);

export const SITUS_POS = 'https://projekrpl.karyabangsa.sch.id';

/** Bab 2–17. `uji` = test yang DITAMBAHKAN bab ini; ujiPos(i) menggabungkan semua bab ≤ i. */
export const BAB_POS = [
  {
    bab: 2, judul: 'Kerangka Aplikasi Flask (Application Factory)',
    titik: [
      'requirements.txt memuat Flask, Flask-SQLAlchemy, Flask-Login, Flask-WTF, pytest (Bab 1)',
      '.gitignore mencantumkan .env (Bab 1)',
      'create_app() berjalan dan halaman depan menampilkan "Halo! Aplikasi POS berjalan."',
      'Tanpa SECRET_KEY aplikasi menolak berjalan ("SECRET_KEY wajib diatur…")',
    ],
    uji: tambahan('test_bab02_beranda_berjalan', 'test_bab02_secret_key_wajib'),
    cek: [
      { berkas: 'requirements.txt', ada: true, syarat: 'Ada requirements.txt', pesan: 'requirements.txt belum ada di folder proyek (Bab 1).' },
      ...['Flask-SQLAlchemy', 'Flask-Login', 'Flask-WTF', 'pytest'].map((p) => ({
        berkas: 'requirements.txt', pola: new RegExp(`^\\s*${p.replace('-', '[-_]')}\\b`, 'im'),
        syarat: `requirements.txt memuat ${p}`, pesan: `requirements.txt belum memuat ${p} (Bab 1).`,
      })),
      { berkas: '.gitignore', pola: /^\s*\/?\.env\s*$/m, syarat: '.gitignore mencantumkan .env', pesan: '.gitignore belum mencantumkan .env, padahal .env berisi rahasia (Bab 1).' },
      { berkas: 'config.py', ada: true, syarat: 'Ada config.py', pesan: 'config.py belum ada di folder utama proyek.' },
    ],
  },
  {
    bab: 3, judul: 'Model Data dan Database',
    titik: ['pytest tests/test_models.py → 6 passed', 'Password disimpan sebagai hash; item order menyimpan snapshot harga'],
    uji: semua('test_models'),
  },
  {
    bab: 4, judul: 'Data Awal dengan Perintah flask seed',
    titik: ['flask seed berhasil dan bisa diulang tanpa menambah data', 'Tanpa ADMIN_PASSWORD seed dibatalkan', 'pytest tests/test_seed.py tests/test_models.py → 9 passed'],
    uji: semua('test_seed'),
  },
  {
    bab: 5, judul: 'Login dan Logout',
    titik: ['Login gagal, akun nonaktif, belum login, dan logout berperilaku benar (4 test)', 'Celah open redirect sudah ditutup'],
    uji: [
      ...t('test_auth', 'test_login_invalid_credentials', 'test_login_inactive_user_rejected', 'test_unauthenticated_redirect_to_login', 'test_logout_redirect_and_session_cleared'),
      ...tambahan('test_bab05_celah_open_redirect_tertutup'),
    ],
  },
  {
    bab: 6, judul: 'Hak Akses Berdasarkan Peran dan Halaman Error',
    titik: ['Kasir mendapat 403 di halaman admin', 'Halaman 403/404/500 rapi', 'Test auth + errors → 8 passed (login sukses menunggu Bab 10 & 14)'],
    uji: [...t('test_auth', 'test_kasir_cannot_access_admin_pages'), ...semua('test_errors')],
  },
  {
    bab: 7, judul: 'Kelola Pengguna (CRUD Pertama)',
    titik: ['Tambah, ubah, nonaktifkan pengguna berfungsi; kasir mendapat 403 di /pengguna', 'Test auth + pengguna + errors → 15 passed (reset password menunggu Bab 10)'],
    uji: [
      ...t('test_auth', 'test_kasir_cannot_post_to_admin_routes'),
      ...SEMUA.test_pengguna.filter((n) => n !== 'test_admin_reset_password').flatMap((n) => t('test_pengguna', n)),
    ],
  },
  {
    bab: 8, judul: 'Kelola Produk dan Restock Cepat',
    titik: ['Daftar, cari, filter, tambah, ubah, nonaktifkan produk; kode unik huruf besar', 'Tidak ada route hapus produk', 'Restock mencatat mutasi stok', 'Test produk (7) dan restock (3) hijau'],
    uji: [
      ...SEMUA.test_master_data.slice(0, 7).flatMap((n) => t('test_master_data', n)),
      ...t('test_laporan_dan_stok', 'test_restock_cepat_sukses', 'test_restock_cepat_validasi_negatif', 'test_kasir_dilarang_restock_cepat'),
    ],
  },
  {
    bab: 9, judul: 'Pelanggan, Metode Bayar, dan Pengaturan Toko',
    titik: ['Pelanggan "Umum" terlindungi; kasir tidak bisa menghapus pelanggan', 'Metode bayar aktif terakhir tidak bisa dinonaktifkan', 'Tarif pajak di luar 0–100 ditolak', 'tests/test_master_data.py → 20 passed'],
    uji: semua('test_master_data'),
  },
  {
    bab: 10, judul: 'Layar Kasir (POS) dan Keranjang Belanja',
    titik: ['Layar kasir tampil setelah kasir login', 'Dua test yang ditunda sejak Bab 5 dan 7 kini hijau'],
    uji: [...t('test_auth', 'test_login_success_kasir_to_pos'), ...t('test_pengguna', 'test_admin_reset_password')],
  },
  {
    bab: 11, judul: 'Checkout: Jantung Aplikasi',
    titik: ['Tunai, transfer, QRIS berhasil; uang/stok kurang dan keranjang kosong ditolak', 'Transaksi atomik: gagal = stok tidak berubah', 'pytest tests/test_pos.py → 15 passed'],
    uji: semua('test_pos'),
  },
  {
    bab: 12, judul: 'Struk Belanja dan Cetak 58/80 mm',
    titik: ['Struk lengkap dan tidak berubah saat harga produk diubah', 'Format Rupiah Indonesia dan waktu WIB (nf_06, nf_07)'],
    uji: t('test_lan_and_nfr', 'test_nf_06_format_rupiah_dan_bahasa_indonesia', 'test_nf_07_waktu_ui_wib_dan_db_utc'),
  },
  {
    bab: 13, judul: 'Riwayat Order dan Alur Pembatalan',
    titik: ['Riwayat default hari ini (WIB) dengan filter; kasir hanya melihat ordernya', 'Stok kembali hanya saat admin mengonfirmasi, dan tidak dua kali', 'pytest tests/test_order_batal.py → 12 passed'],
    uji: semua('test_order_batal'),
  },
  {
    bab: 14, judul: 'Dashboard Admin',
    titik: ['Kartu, grafik, terlaris, dan stok menipis benar; tidak error tanpa transaksi', 'tests/test_auth.py, test_dashboard.py, test_errors.py seluruhnya hijau (17 passed)'],
    uji: [...t('test_auth', 'test_login_success_admin_to_dashboard'), ...semua('test_dashboard')],
  },
  {
    bab: 15, judul: 'Laporan Penjualan, Kartu Stok, dan Ekspor CSV',
    titik: ['Laporan & kartu stok benar, filter tidak membuat error, CSV terunduh', 'Kasir mendapat 403 di semua halaman laporan', 'tests/test_laporan_dan_stok.py → 7 passed'],
    uji: semua('test_laporan_dan_stok'),
  },
  {
    bab: 16, judul: 'Pengujian Menyeluruh dan Merapikan Proyek',
    titik: ['app/sementara.py dihapus dan tidak ada sisa pemakaiannya', 'pytest → 96 passed'],
    uji: semua('test_lan_and_nfr'),
    cek: [
      { berkas: 'app/sementara.py', pola: /[\s\S]/, tidak: true, syarat: 'app/sementara.py sudah dihapus', pesan: 'app/sementara.py (halaman sementara Bab 5) masih ada. Hapus berkasnya.' },
      { berkas: 'app/*', pola: /\bsementara\b/, tidak: true, syarat: 'Tidak ada sisa pemakaian modul sementara', pesan: 'Masih ada kode yang memakai modul sementara. Hapus import/pemakaiannya.' },
    ],
  },
  {
    bab: 17, judul: 'Menjalankan di Jaringan LAN Laboratorium',
    titik: ['Konfigurasi production tanpa debug (/console → 404)', '.env tidak ikut ke Git', 'Semua test tetap hijau'],
    uji: tambahan('test_bab17_produksi_tanpa_debug'),
  },
];

/** Semua test untuk tiket bab ke-i (indeks BAB_POS): gabungan bab ≤ i, tanpa duplikat. */
export function ujiPos(i) {
  return [...new Set(BAB_POS.slice(0, i + 1).flatMap((b) => b.uji))];
}

/** Semua cek teks untuk tiket bab ke-i (cek bab sebelumnya tetap berlaku). */
export function cekPos(i) {
  return BAB_POS.slice(0, i + 1).flatMap((b) => b.cek || []);
}

export const judulPos = (i) => (BAB_POS[i] ? `POS Bab ${BAB_POS[i].bab} — ${BAB_POS[i].judul}` : '?');
export const urlBab = (i) => `${SITUS_POS}/bab-${String(BAB_POS[i].bab).padStart(2, '0')}.html`;
