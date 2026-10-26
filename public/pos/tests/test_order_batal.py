from datetime import UTC, datetime, timedelta

from app.models.metode_bayar import MetodeBayar
from app.models.order import Order, OrderItem
from app.models.pelanggan import Pelanggan
from app.models.pengaturan import Pengaturan
from app.models.produk import Produk
from app.models.user import User


def setup_order_test_data(db):
    """Menyiapkan data pengguna, produk, dan order untuk pengujian riwayat & alur pembatalan."""
    # 1. Pengaturan
    pengaturan = Pengaturan(
        nama_toko="SMK Mart Lab",
        alamat_toko="Jl. Ritel No. 1",
        tarif_pajak=10,
        ambang_stok_menipis=5,
    )
    db.session.add(pengaturan)

    # 2. Pengguna: Admin, Kasir 1, Kasir 2
    admin = User(username="admin", nama="Administrator", peran="admin", aktif=True)
    admin.set_password("AdminPass123!")

    kasir1 = User(username="kasir1", nama="Ahmad Kasir", peran="kasir", aktif=True)
    kasir1.set_password("KasirPass123!")

    kasir2 = User(username="kasir2", nama="Siti Kasir", peran="kasir", aktif=True)
    kasir2.set_password("KasirPass123!")

    db.session.add_all([admin, kasir1, kasir2])

    # 3. Pelanggan & Metode
    pelanggan = Pelanggan(nama="Umum", bawaan=True)
    metode = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)
    db.session.add_all([pelanggan, metode])

    # 4. Produk
    p1 = Produk(
        kode="PRD01",
        nama="Buku Catatan",
        harga=10000,
        stok=20,
        kategori="ATK",
        aktif=True,
    )
    p2 = Produk(
        kode="PRD02",
        nama="Pulpen Gel",
        harga=5000,
        stok=30,
        kategori="ATK",
        aktif=True,
    )
    db.session.add_all([p1, p2])
    db.session.commit()

    # 5. Order Hari Ini milik Kasir 1
    order1 = Order(
        nomor="POS-20261020-0001",
        waktu=datetime.now(UTC),
        kasir_id=kasir1.id,
        pelanggan_id=pelanggan.id,
        metode_bayar_id=metode.id,
        subtotal=20000,
        tarif_pajak=10,
        pajak=2000,
        total=22000,
        uang_diterima=25000,
        kembalian=3000,
        status="selesai",
    )
    db.session.add(order1)
    db.session.flush()

    item1 = OrderItem(
        order_id=order1.id,
        produk_id=p1.id,
        nama_produk=p1.nama,
        harga_satuan=p1.harga,
        jumlah=2,
        subtotal=20000,
    )
    db.session.add(item1)

    # 6. Order Hari Ini milik Kasir 2
    order2 = Order(
        nomor="POS-20261020-0002",
        waktu=datetime.now(UTC),
        kasir_id=kasir2.id,
        pelanggan_id=pelanggan.id,
        metode_bayar_id=metode.id,
        subtotal=15000,
        tarif_pajak=10,
        pajak=1500,
        total=16500,
        uang_diterima=20000,
        kembalian=3500,
        status="selesai",
    )
    db.session.add(order2)
    db.session.flush()

    item2 = OrderItem(
        order_id=order2.id,
        produk_id=p2.id,
        nama_produk=p2.nama,
        harga_satuan=p2.harga,
        jumlah=3,
        subtotal=15000,
    )
    db.session.add(item2)

    # 7. Order Hari Kemarin milik Kasir 1
    order_kemarin = Order(
        nomor="POS-20261019-0001",
        waktu=datetime.now(UTC) - timedelta(days=2),
        kasir_id=kasir1.id,
        pelanggan_id=pelanggan.id,
        metode_bayar_id=metode.id,
        subtotal=10000,
        tarif_pajak=10,
        pajak=1000,
        total=11000,
        uang_diterima=15000,
        kembalian=4000,
        status="selesai",
    )
    db.session.add(order_kemarin)
    db.session.commit()

    return {
        "admin": admin,
        "kasir1": kasir1,
        "kasir2": kasir2,
        "p1": p1,
        "p2": p2,
        "order1": order1,
        "order2": order2,
        "order_kemarin": order_kemarin,
    }


def test_riwayat_order_filter_default_hari_ini_wib(client, db):
    """AC-85: Filter default adalah hari ini; order hari kemarin tidak tampil secara default."""
    setup_order_test_data(db)

    # Admin login
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    res = client.get("/order/")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    # Order hari ini harus ada di halaman
    assert "POS-20261020-0001" in html
    assert "POS-20261020-0002" in html
    # Order kemarin tidak boleh ada
    assert "POS-20261019-0001" not in html


def test_riwayat_order_hak_akses_admin_vs_kasir(client, db):
    """AC-86: Admin melihat semua order; Kasir hanya melihat order miliknya sendiri."""
    setup_order_test_data(db)

    # Kasir 1 login
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    res_kasir = client.get("/order/")
    assert res_kasir.status_code == 200
    html_kasir = res_kasir.get_data(as_text=True)

    # Kasir 1 melihat order miliknya
    assert "POS-20261020-0001" in html_kasir
    # Kasir 1 TIDAK melihat order milik Kasir 2
    assert "POS-20261020-0002" not in html_kasir

    # Admin login
    client.post("/logout")
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res_admin = client.get("/order/")
    assert res_admin.status_code == 200
    html_admin = res_admin.get_data(as_text=True)

    # Admin melihat kedua order
    assert "POS-20261020-0001" in html_admin
    assert "POS-20261020-0002" in html_admin


def test_filter_status_kasir_dan_nomor(client, db):
    """AC-85: Filter status, kasir (oleh Admin), dan nomor menghasilkan data yang cocok."""
    data = setup_order_test_data(db)

    # Set status order2 jadi pengajuan_batal
    data["order2"].status = "pengajuan_batal"
    data["order2"].alasan_batal = "Salah jumlah produk"
    db.session.commit()

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    # 1. Filter status pengajuan_batal
    res_status = client.get("/order/?status=pengajuan_batal")
    html_status = res_status.get_data(as_text=True)
    assert "POS-20261020-0002" in html_status
    assert "POS-20261020-0001" not in html_status

    # 2. Filter kasir 1
    res_kasir1 = client.get(f"/order/?kasir_id={data['kasir1'].id}")
    html_kasir1 = res_kasir1.get_data(as_text=True)
    assert "POS-20261020-0001" in html_kasir1
    assert "POS-20261020-0002" not in html_kasir1

    # 3. Filter nomor query
    res_q = client.get("/order/?q=0002")
    html_q = res_q.get_data(as_text=True)
    assert "POS-20261020-0002" in html_q
    assert "POS-20261020-0001" not in html_q


def test_kasir_ajukan_pembatalan_sukses(client, db):
    """AC-87: Kasir mengajukan pembatalan (alasan >= 5 karakter) -> status pengajuan_batal, stok TIDAK berubah."""
    data = setup_order_test_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    order1 = data["order1"]
    p1 = data["p1"]
    stok_awal = p1.stok  # 20

    res = client.post(
        f"/order/{order1.id}/ajukan-batal",
        json={"alasan": "Pembeli salah memilih varian barang"},
    )
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    # Periksa database
    db.session.refresh(order1)
    assert order1.status == "pengajuan_batal"
    assert order1.alasan_batal == "Pembeli salah memilih varian barang"
    assert order1.diajukan_oleh_id == data["kasir1"].id

    # AC-87: Stok TIDAK boleh berubah
    db.session.refresh(p1)
    assert p1.stok == stok_awal


def test_kasir_ajukan_pembatalan_alasan_kurang_ditolak(client, db):
    """AC-88: Alasan kosong atau < 5 karakter -> ditolak dengan pesan validasi."""
    data = setup_order_test_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    order1 = data["order1"]

    # Alasan terlalu pendek (< 5 karakter)
    res = client.post(f"/order/{order1.id}/ajukan-batal", json={"alasan": "oops"})
    assert res.status_code == 400
    assert "Alasan wajib diisi, minimal 5 karakter." in res.get_json()["message"]

    # Status tetap selesai
    db.session.refresh(order1)
    assert order1.status == "selesai"


def test_kasir_ajukan_pembatalan_order_bukan_miliknya_atau_bukan_selesai_ditolak(
    client, db
):
    """AC-89: Kasir lain dilarang ajukan batal (403); order selain selesai dilarang."""
    data = setup_order_test_data(db)

    # Kasir 2 coba ajukan order milik Kasir 1 -> 403 Forbidden
    client.post("/login", data={"username": "kasir2", "password": "KasirPass123!"})
    res_403 = client.post(
        f"/order/{data['order1'].id}/ajukan-batal",
        json={"alasan": "Mencoba membajak order kasir lain"},
    )
    assert res_403.status_code == 403

    # Order yang sudah dibatalkan tidak bisa diajukan pembatalan lagi
    client.post("/logout")
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    data["order1"].status = "dibatalkan"
    db.session.commit()

    res_batal = client.post(
        f"/order/{data['order1'].id}/ajukan-batal",
        json={"alasan": "Ajukan lagi yang sudah batal"},
    )
    assert res_batal.status_code == 400


def test_admin_konfirmasi_pembatalan_dengan_cek_fisik(client, db):
    """AC-90: Admin konfirmasi dengan cek fisik dicentang -> status dibatalkan, stok tiap item kembali."""
    data = setup_order_test_data(db)

    order1 = data["order1"]  # berisi 2x p1 (Buku Catatan)
    order1.status = "pengajuan_batal"
    order1.alasan_batal = "Salah input jumlah pesanan"
    order1.diajukan_oleh_id = data["kasir1"].id
    db.session.commit()

    p1 = data["p1"]
    stok_sebelum_batal = p1.stok  # 20

    # Admin login
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.post(f"/order/{order1.id}/konfirmasi-batal", json={"cek_fisik": True})
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    # Periksa database
    db.session.refresh(order1)
    assert order1.status == "dibatalkan"
    assert order1.dikonfirmasi_oleh_id == data["admin"].id
    assert order1.waktu_batal is not None

    # AC-90: Stok produk p1 bertambah 2
    db.session.refresh(p1)
    assert p1.stok == stok_sebelum_batal + 2  # 22


def test_admin_konfirmasi_tanpa_cek_fisik_ditolak(client, db):
    """AC-91: Admin konfirmasi tanpa centang cek fisik -> ditolak, stok tidak berubah."""
    data = setup_order_test_data(db)

    order1 = data["order1"]
    order1.status = "pengajuan_batal"
    db.session.commit()

    p1 = data["p1"]
    stok_awal = p1.stok

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.post(f"/order/{order1.id}/konfirmasi-batal", json={"cek_fisik": False})
    assert res.status_code == 400
    assert (
        "Centang dulu bahwa barang sudah dicek secara fisik."
        in res.get_json()["message"]
    )

    db.session.refresh(order1)
    assert order1.status == "pengajuan_batal"
    db.session.refresh(p1)
    assert p1.stok == stok_awal


def test_konfirmasi_order_sudah_dibatalkan_ditolak(client, db):
    """AC-92: Order sudah dibatalkan, konfirmasi dikirim lagi -> ditolak dan stok tidak bertambah lagi."""
    data = setup_order_test_data(db)

    order1 = data["order1"]
    order1.status = "dibatalkan"
    db.session.commit()

    p1 = data["p1"]
    stok_awal = p1.stok

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.post(f"/order/{order1.id}/konfirmasi-batal", json={"cek_fisik": True})
    assert res.status_code == 400
    assert "sudah dibatalkan" in res.get_json()["message"].lower()

    # Stok tidak bertambah
    db.session.refresh(p1)
    assert p1.stok == stok_awal


def test_admin_tolak_pengajuan_pembatalan(client, db):
    """AC-93: Admin menolak pengajuan -> status kembali selesai, stok tidak berubah."""
    data = setup_order_test_data(db)

    order1 = data["order1"]
    order1.status = "pengajuan_batal"
    order1.alasan_batal = "Barang cacat"
    order1.diajukan_oleh_id = data["kasir1"].id
    db.session.commit()

    p1 = data["p1"]
    stok_awal = p1.stok

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.post(f"/order/{order1.id}/tolak-batal", json={})
    assert res.status_code == 200

    db.session.refresh(order1)
    assert order1.status == "selesai"
    assert order1.alasan_batal is None
    assert order1.diajukan_oleh_id is None

    # Stok tetap
    db.session.refresh(p1)
    assert p1.stok == stok_awal


def test_admin_batalkan_langsung(client, db):
    """AC-94: Admin membatalkan langsung order Selesai (alasan & cek fisik) -> dibatalkan dan stok kembali."""
    data = setup_order_test_data(db)

    order1 = data["order1"]  # selesai
    p1 = data["p1"]
    stok_awal = p1.stok  # 20

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.post(
        f"/order/{order1.id}/batalkan-langsung",
        json={"alasan": "Kesalahan transaksi kasir langsung", "cek_fisik": True},
    )
    assert res.status_code == 200

    db.session.refresh(order1)
    assert order1.status == "dibatalkan"
    assert order1.alasan_batal == "Kesalahan transaksi kasir langsung"
    assert order1.dikonfirmasi_oleh_id == data["admin"].id

    # Stok kembali bertambah 2
    db.session.refresh(p1)
    assert p1.stok == stok_awal + 2


def test_kasir_dilarang_konfirmasi_tolak_atau_batal_langsung(client, db):
    """AC-95: Kasir mengirim permintaan konfirmasi, tolak, atau batalkan langsung -> ditolak 403."""
    data = setup_order_test_data(db)

    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    # Kasir coba konfirmasi batal
    res1 = client.post(
        f"/order/{data['order1'].id}/konfirmasi-batal", json={"cek_fisik": True}
    )
    assert res1.status_code == 403

    # Kasir coba tolak batal
    res2 = client.post(f"/order/{data['order1'].id}/tolak-batal")
    assert res2.status_code == 403

    # Kasir coba batalkan langsung
    res3 = client.post(
        f"/order/{data['order1'].id}/batalkan-langsung",
        json={"alasan": "Mencoba batalkan sendiri", "cek_fisik": True},
    )
    assert res3.status_code == 403
