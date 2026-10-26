from datetime import UTC, datetime, time, timedelta, timezone

from app.models.metode_bayar import MetodeBayar
from app.models.order import Order, OrderItem
from app.models.pelanggan import Pelanggan
from app.models.pengaturan import Pengaturan
from app.models.produk import Produk
from app.models.user import User

WIB_TZ = timezone(timedelta(hours=7))


def setup_dashboard_data(db):
    """Menyiapkan data awal untuk pengujian Dashboard."""
    pengaturan = Pengaturan(
        nama_toko="SMK Mart Lab",
        alamat_toko="Jl. Ritel No. 1",
        tarif_pajak=10,
        ambang_stok_menipis=5,
    )
    db.session.add(pengaturan)

    admin = User(username="admin", nama="Retno Pembimbing", peran="admin", aktif=True)
    admin.set_password("AdminPass123!")

    kasir = User(username="kasir1", nama="Ahmad Kasir", peran="kasir", aktif=True)
    kasir.set_password("KasirPass123!")

    pelanggan = Pelanggan(nama="Umum", bawaan=True)
    metode = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)

    db.session.add_all([admin, kasir, pelanggan, metode])

    # Produk
    p1 = Produk(
        kode="P01",
        nama="Kopi Susu",
        harga=15000,
        stok=3,
        kategori="Minuman",
        aktif=True,
    )  # stok menipis (3 <= 5)
    p2 = Produk(
        kode="P02",
        nama="Roti Bakar",
        harga=10000,
        stok=20,
        kategori="Makanan",
        aktif=True,
    )  # stok aman
    p3 = Produk(
        kode="P03",
        nama="Air Mineral",
        harga=5000,
        stok=0,
        kategori="Minuman",
        aktif=True,
    )  # stok habis (0 <= 5)
    p4 = Produk(
        kode="P04",
        nama="Permen Karet",
        harga=1000,
        stok=2,
        kategori="Snack",
        aktif=False,
    )  # nonaktif

    db.session.add_all([p1, p2, p3, p4])
    db.session.commit()

    return {
        "admin": admin,
        "kasir": kasir,
        "pelanggan": pelanggan,
        "metode": metode,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "p4": p4,
        "pengaturan": pengaturan,
    }


def test_dashboard_metrik_hari_ini_wib(client, db):
    """AC-100 & AC-101: Omzet, jumlah order, rata-rata order hari ini WIB; dibatalkan tidak dihitung; batas WIB 23:30."""
    data = setup_dashboard_data(db)

    # Tanggal hari ini di WIB
    today_wib = datetime.now(WIB_TZ).date()

    # 1. Order Siang Selesai (Total 33.000)
    waktu1 = (
        datetime.combine(today_wib, time(12, 0), tzinfo=WIB_TZ)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    order1 = Order(
        nomor="POS-20261020-0001",
        waktu=waktu1,
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=30000,
        tarif_pajak=10,
        pajak=3000,
        total=33000,
        status="selesai",
    )

    # 2. Order Malam 23:30 WIB (AC-101: walau UTC hari berikutnya, harus dihitung hari ini WIB) (Total 22.000)
    waktu2 = (
        datetime.combine(today_wib, time(23, 30), tzinfo=WIB_TZ)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    order2 = Order(
        nomor="POS-20261020-0002",
        waktu=waktu2,
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=20000,
        tarif_pajak=10,
        pajak=2000,
        total=22000,
        status="pengajuan_batal",  # AC-100: Pengajuan batal DIHITUNG
    )

    # 3. Order Dibatalkan Hari Ini (Total 50.000) -> AC-100: TIDAK DIHITUNG
    waktu3 = (
        datetime.combine(today_wib, time(15, 0), tzinfo=WIB_TZ)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    order3 = Order(
        nomor="POS-20261020-0003",
        waktu=waktu3,
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=45000,
        tarif_pajak=10,
        pajak=5000,
        total=50000,
        status="dibatalkan",
    )

    db.session.add_all([order1, order2, order3])
    db.session.commit()

    # Total Omzet yang valid = 33.000 + 22.000 = 55.000
    # Jumlah Order = 2
    # Rata-rata = 55.000 / 2 = 27.500

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/dashboard")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    assert "55.000" in html
    assert "2 transaksi" in html
    assert "27.500" in html


def test_dashboard_state_kosong_tanpa_order(client, db):
    """AC-104 & UX-02: State kosong jika belum ada order."""
    setup_dashboard_data(db)

    # Pastikan stok aman semua untuk menguji state kosong stok menipis
    p_all = Produk.query.all()
    for p in p_all:
        p.stok = 50
    db.session.commit()

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/dashboard")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    # Kartu Rp 0 dan 0
    assert "Rp 0" in html
    assert "0 transaksi" in html
    assert (
        "Belum ada penjualan hari ini. Omzet muncul setelah ada order di POS." in html
    )
    assert "Belum ada penjualan." in html
    assert "Belum ada produk terjual." in html
    assert "Semua stok aman." in html


def test_dashboard_top_5_produk_terlaris_30_hari(client, db):
    """AC-102: 5 produk terlaris 30 hari berdasarkan terjual (tanpa order dibatalkan)."""
    data = setup_dashboard_data(db)

    # Buat order 1: 5x Kopi Susu
    order1 = Order(
        nomor="POS-20261020-0001",
        waktu=datetime.now(UTC),
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=75000,
        tarif_pajak=10,
        pajak=7500,
        total=82500,
        status="selesai",
    )
    db.session.add(order1)
    db.session.flush()

    item1 = OrderItem(
        order_id=order1.id,
        produk_id=data["p1"].id,
        nama_produk="Kopi Susu",
        harga_satuan=15000,
        jumlah=5,
        subtotal=75000,
    )

    # Buat order 2: 10x Roti Bakar (Order Dibatalkan -> TIDAK DIHITUNG!)
    order2 = Order(
        nomor="POS-20261020-0002",
        waktu=datetime.now(UTC),
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=100000,
        tarif_pajak=10,
        pajak=10000,
        total=110000,
        status="dibatalkan",
    )
    db.session.add(order2)
    db.session.flush()

    item2 = OrderItem(
        order_id=order2.id,
        produk_id=data["p2"].id,
        nama_produk="Roti Bakar",
        harga_satuan=10000,
        jumlah=10,
        subtotal=100000,
    )

    db.session.add_all([item1, item2])
    db.session.commit()

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/dashboard")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    # Kopi Susu harus tampil dengan 5 terjual
    assert "Kopi Susu" in html
    assert "5 terjual" in html
    # Roti bakar (dari order dibatalkan) tidak boleh dihitung terjual
    assert "10 terjual" not in html


def test_dashboard_stok_menipis(client, db):
    """AC-103: Produk aktif dengan stok <= ambang tampil di daftar stok menipis."""
    data = setup_dashboard_data(db)
    # p1 stok 3 (<= 5) -> tampil
    # p2 stok 20 (> 5) -> tidak tampil
    # p3 stok 0 (<= 5) -> tampil
    # p4 stok 2 tapi nonaktif -> tidak tampil

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/dashboard")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    assert data["p1"].nama in html
    assert data["p3"].nama in html
    assert data["p4"].nama not in html


def test_dashboard_counter_pengajuan_batal(client, db):
    """AC-105: Pengajuan pembatalan menunggu tampil dengan counter & tombol Lihat pengajuan."""
    data = setup_dashboard_data(db)

    order1 = Order(
        nomor="POS-20261020-0001",
        waktu=datetime.now(UTC),
        kasir_id=data["kasir"].id,
        pelanggan_id=data["pelanggan"].id,
        metode_bayar_id=data["metode"].id,
        subtotal=15000,
        tarif_pajak=10,
        pajak=1500,
        total=16500,
        status="pengajuan_batal",
        alasan_batal="Salah barang",
    )
    db.session.add(order1)
    db.session.commit()

    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/dashboard")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    assert "1 pengajuan pembatalan menunggu persetujuan" in html
    assert "Lihat pengajuan" in html


def test_dashboard_hak_akses_admin_saja(client, db):
    """Kasir dilarang membuka Dashboard (403 Forbidden)."""
    setup_dashboard_data(db)

    # Kasir login
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    res_kasir = client.get("/dashboard")
    assert res_kasir.status_code == 403

    # Unauthenticated
    client.post("/logout")
    res_unauth = client.get("/dashboard")
    assert res_unauth.status_code == 302
