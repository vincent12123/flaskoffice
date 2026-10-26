from datetime import UTC, datetime

from app.blueprints.pos.services import hitung_pajak_dan_total
from app.models.metode_bayar import MetodeBayar
from app.models.order import Order, OrderItem
from app.models.pelanggan import Pelanggan
from app.models.pengaturan import Pengaturan
from app.models.produk import Produk
from app.models.user import User


def setup_pos_data(db):
    """Helper untuk mengisi data master awal untuk pengujian POS."""
    # Pengaturan (PPN 10%, ambang stok 5)
    pengaturan = Pengaturan(
        nama_toko="SMK Mart Lab",
        alamat_toko="Jl. Pendidikan No. 1",
        tarif_pajak=10,
        ambang_stok_menipis=5,
    )
    db.session.add(pengaturan)

    # User Admin & Kasir
    admin = User(username="admin", nama="Administrator", peran="admin", aktif=True)
    admin.set_password("AdminPass123!")

    kasir1 = User(username="kasir1", nama="Ahmad Kasir", peran="kasir", aktif=True)
    kasir1.set_password("KasirPass123!")

    kasir2 = User(username="kasir2", nama="Siti Kasir", peran="kasir", aktif=True)
    kasir2.set_password("KasirPass123!")

    db.session.add_all([admin, kasir1, kasir2])

    # Pelanggan
    plg_umum = Pelanggan(nama="Umum", telepon=None, bawaan=True)
    plg_budi = Pelanggan(nama="Budi Santoso", telepon="08123456789", bawaan=False)
    db.session.add_all([plg_umum, plg_budi])

    # Metode Bayar
    metode_tunai = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)
    metode_transfer = MetodeBayar(nama="Transfer Bank", jenis="non_tunai", aktif=True)
    metode_qris = MetodeBayar(nama="QRIS", jenis="non_tunai", aktif=True)
    db.session.add_all([metode_tunai, metode_transfer, metode_qris])

    # Produk
    p1 = Produk(
        kode="PRD01",
        nama="Kopi Susu Gula Aren",
        harga=12000,
        stok=20,
        kategori="Minuman",
        aktif=True,
    )
    p2 = Produk(
        kode="PRD02",
        nama="Roti Bakar Cokelat",
        harga=15000,
        stok=5,
        kategori="Makanan",
        aktif=True,
    )
    p3 = Produk(
        kode="PRD03",
        nama="Sandwich Smoked Beef",
        harga=18000,
        stok=0,
        kategori="Makanan",
        aktif=True,
    )
    p4 = Produk(
        kode="PRD04",
        nama="Produk Nonaktif",
        harga=10000,
        stok=10,
        kategori="Snack",
        aktif=False,
    )
    p5 = Produk(
        kode="PRD05",
        nama="Permen Mint",
        harga=12345,
        stok=50,
        kategori="Snack",
        aktif=True,
    )

    db.session.add_all([p1, p2, p3, p4, p5])
    db.session.commit()

    return {
        "admin": admin,
        "kasir1": kasir1,
        "kasir2": kasir2,
        "plg_umum": plg_umum,
        "plg_budi": plg_budi,
        "tunai": metode_tunai,
        "transfer": metode_transfer,
        "qris": metode_qris,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "p4": p4,
        "p5": p5,
    }


def test_hitung_pajak_dan_total_pembulatan(db):
    """AC-60 & AC-61: Perhitungan pajak dan pembulatan 0,5 ke atas (ROUND_HALF_UP)."""
    # AC-60: subtotal 40.000 dan tarif 10% -> pajak 4.000, total 44.000
    pajak1, total1 = hitung_pajak_dan_total(40000, 10)
    assert pajak1 == 4000
    assert total1 == 44000

    # AC-61: subtotal 12.345 dan tarif 10% -> 1234.5 dibulatkan ke 1.235, total 13.580
    pajak2, total2 = hitung_pajak_dan_total(12345, 10)
    assert pajak2 == 1235
    assert total2 == 13580


def test_transaksi_tunai_sukses(client, db):
    """AC-62, AC-68, AC-69: Transaksi tunai sukses, nomor format POS-YYYYMMDD-NNNN, stok berkurang."""
    data = setup_pos_data(db)

    # Login kasir 1
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]  # 12.000, stok 20
    p2 = data["p2"]  # 15.000, stok 5
    # Beli 2x Kopi Susu (24.000) + 1x Roti (15.000) = Subtotal 39.000
    # Pajak 10% = 3.900, Total = 42.900
    # Uang diterima = 50.000, Kembalian = 7.100

    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 50000,
        "items": [
            {"produk_id": p1.id, "jumlah": 2},
            {"produk_id": p2.id, "jumlah": 1},
        ],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 201
    json_data = res.get_json()
    assert json_data["success"] is True
    assert json_data["kembalian"] == 7100

    order = db.session.get(Order, json_data["order_id"])
    assert order is not None
    assert order.status == "selesai"
    assert order.subtotal == 39000
    assert order.pajak == 3900
    assert order.total == 42900
    assert order.uang_diterima == 50000
    assert order.kembalian == 7100

    # AC-69: Format nomor POS-YYYYMMDD-NNNN
    assert order.nomor.startswith("POS-")
    parts = order.nomor.split("-")
    assert len(parts) == 3
    assert len(parts[1]) == 8  # YYYYMMDD
    assert len(parts[2]) == 4  # NNNN

    # AC-68: Stok berkurang
    db.session.refresh(p1)
    db.session.refresh(p2)
    assert p1.stok == 18  # 20 - 2
    assert p2.stok == 4  # 5 - 1

    # Snapshot OrderItem
    assert len(order.items) == 2
    item1 = next(i for i in order.items if i.produk_id == p1.id)
    assert item1.nama_produk == "Kopi Susu Gula Aren"
    assert item1.harga_satuan == 12000
    assert item1.jumlah == 2
    assert item1.subtotal == 24000


def test_transaksi_tunai_kurang_ditolak(client, db):
    """AC-63: Uang diterima kurang -> ditolak dengan pesan selisih, tidak ada order, stok utuh."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]  # 12.000, stok 20
    # Beli 3 item p1 = subtotal 36.000 + pajak 10% (3.600) = total 39.600
    # Uang diterima 35.000 (kurang 4.600)

    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 35000,
        "items": [{"produk_id": p1.id, "jumlah": 3}],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Uang diterima kurang Rp 4.600." in json_data["message"]

    # Pastikan tidak ada order dan stok tidak berubah
    assert Order.query.count() == 0
    db.session.refresh(p1)
    assert p1.stok == 20


def test_keranjang_kosong_ditolak(client, db):
    """AC-64: Keranjang kosong dibayar -> ditolak dengan pesan 'Keranjang masih kosong.'."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 50000,
        "items": [],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert "Keranjang masih kosong." in json_data["message"]


def test_jumlah_melebihi_stok_ditolak(client, db):
    """AC-65: Jumlah melebihi stok -> ditolak dengan pesan 'Stok {nama} hanya {n}'."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p2 = data["p2"]  # stok = 5
    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 100000,
        "items": [{"produk_id": p2.id, "jumlah": 10}],  # minta 10 padahal stok 5
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 400
    json_data = res.get_json()
    assert json_data["success"] is False
    assert f"Stok {p2.nama} hanya 5." in json_data["message"]
    assert Order.query.count() == 0


def test_produk_stok_nol_atau_nonaktif_ditolak(client, db):
    """AC-66: Produk stok 0 atau nonaktif dikirim ke pembayaran -> ditolak."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p3 = data["p3"]  # stok 0
    p4 = data["p4"]  # nonaktif

    # Uji stok 0
    res1 = client.post(
        "/pos/checkout",
        json={
            "metode_bayar_id": data["tunai"].id,
            "uang_diterima": 50000,
            "items": [{"produk_id": p3.id, "jumlah": 1}],
        },
    )
    assert res1.status_code == 400
    assert Order.query.count() == 0

    # Uji produk nonaktif
    res2 = client.post(
        "/pos/checkout",
        json={
            "metode_bayar_id": data["tunai"].id,
            "uang_diterima": 50000,
            "items": [{"produk_id": p4.id, "jumlah": 1}],
        },
    )
    assert res2.status_code == 400
    assert Order.query.count() == 0


def test_harga_diambil_dari_database_snapshot(client, db):
    """AC-67: Manipulasi harga dari client diabaikan; server selalu memakai harga database."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]  # harga resmi di DB = 12.000
    # Client mencoba kirim harga = 100
    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 50000,
        "items": [{"produk_id": p1.id, "jumlah": 1, "harga": 100}],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 201
    json_data = res.get_json()
    order = db.session.get(Order, json_data["order_id"])

    # Subtotal harus 12.000 (bukan 100!)
    assert order.subtotal == 12000
    assert order.total == 13200  # 12.000 + 10% (1.200)
    assert order.items[0].harga_satuan == 12000


def test_transaksi_atomik_gagal_stok_tidak_berubah(client, db):
    """AC-70: Keranjang 2 produk, 1 produk stok tidak cukup -> rollback atomik; stok semua produk tidak berubah."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]  # stok 20
    p2 = data["p2"]  # stok 5

    payload = {
        "pelanggan_id": data["plg_umum"].id,
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 100000,
        "items": [
            {"produk_id": p1.id, "jumlah": 2},  # cukup
            {"produk_id": p2.id, "jumlah": 8},  # kurang (stok cuma 5)
        ],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 400
    assert Order.query.count() == 0

    # Stok p1 TIDAK boleh terpotong!
    db.session.refresh(p1)
    db.session.refresh(p2)
    assert p1.stok == 20
    assert p2.stok == 5


def test_stok_tidak_pernah_negatif_pada_pembelian_berurutan(client, db):
    """AC-71: Stok tersisa 1, 2 checkout berturut-turut -> 1 berhasil, 1 gagal, stok akhir 0."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p2 = data["p2"]
    p2.stok = 1
    db.session.commit()

    payload = {
        "metode_bayar_id": data["tunai"].id,
        "uang_diterima": 50000,
        "items": [{"produk_id": p2.id, "jumlah": 1}],
    }

    # Checkout pertama -> Berhasil
    res1 = client.post("/pos/checkout", json=payload)
    assert res1.status_code == 201

    # Checkout kedua -> Ditolak
    res2 = client.post("/pos/checkout", json=payload)
    assert res2.status_code == 400
    assert "habis" in res2.get_json()["message"].lower()

    # Stok akhir tepat 0 (tidak negatif)
    db.session.refresh(p2)
    assert p2.stok == 0


def test_transaksi_non_tunai_transfer_dan_qris(client, db):
    """AC-72: Metode transfer/QRIS tanpa uang diterima -> tersimpan tanpa uang diterima & kembalian."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]
    payload = {
        "metode_bayar_id": data["transfer"].id,
        "uang_diterima": None,
        "items": [{"produk_id": p1.id, "jumlah": 1}],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 201
    order = db.session.get(Order, res.get_json()["order_id"])
    assert order.uang_diterima is None
    assert order.kembalian is None


def test_pelanggan_default_umum_dan_terdaftar(client, db):
    """AC-73: Jika pelanggan kosong -> pakai Umum; jika dipilih -> pakai pelanggan tersebut."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    # 1. Tanpa pelanggan_id -> default Umum
    res1 = client.post(
        "/pos/checkout",
        json={
            "metode_bayar_id": data["transfer"].id,
            "items": [{"produk_id": data["p1"].id, "jumlah": 1}],
        },
    )
    assert res1.status_code == 201
    order1 = db.session.get(Order, res1.get_json()["order_id"])
    assert order1.pelanggan.nama == "Umum"

    # 2. Dengan pelanggan terdaftar
    res2 = client.post(
        "/pos/checkout",
        json={
            "pelanggan_id": data["plg_budi"].id,
            "metode_bayar_id": data["transfer"].id,
            "items": [{"produk_id": data["p1"].id, "jumlah": 1}],
        },
    )
    assert res2.status_code == 201
    order2 = db.session.get(Order, res2.get_json()["order_id"])
    assert order2.pelanggan.nama == "Budi Santoso"


def test_tambah_pelanggan_cepat_pos(client, db):
    """AC-74: Kasir menambah pelanggan baru via modal kasir."""
    setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    res = client.post(
        "/pos/pelanggan-cepat",
        json={"nama": "Dewi Sartika", "telepon": "08987654321"},
    )
    assert res.status_code == 201
    json_data = res.get_json()
    assert json_data["success"] is True
    assert json_data["nama"] == "Dewi Sartika"

    pelanggan = db.session.get(Pelanggan, json_data["id"])
    assert pelanggan is not None
    assert pelanggan.nama == "Dewi Sartika"
    assert pelanggan.telepon == "08987654321"


def test_struk_order(client, db):
    """AC-80, AC-82, AC-83, AC-84: Tampilan struk, hak akses kasir lain (403), order 404, tanda batal."""
    data = setup_pos_data(db)

    # Buat order milik kasir 1
    order1 = Order(
        nomor="POS-20261020-0001",
        waktu=datetime.now(UTC),
        kasir_id=data["kasir1"].id,
        pelanggan_id=data["plg_umum"].id,
        metode_bayar_id=data["tunai"].id,
        subtotal=40000,
        tarif_pajak=10,
        pajak=4000,
        total=44000,
        uang_diterima=50000,
        kembalian=6000,
        status="selesai",
    )
    db.session.add(order1)
    db.session.flush()

    item1 = OrderItem(
        order_id=order1.id,
        produk_id=data["p1"].id,
        nama_produk="Kopi Susu Gula Aren",
        harga_satuan=20000,
        jumlah=2,
        subtotal=40000,
    )
    db.session.add(item1)
    db.session.commit()

    # Kasir 1 login -> boleh buka struk sendiri (AC-80)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    res_kasir1 = client.get(f"/pos/struk/{order1.id}")
    assert res_kasir1.status_code == 200
    html = res_kasir1.get_data(as_text=True)
    assert "POS-20261020-0001" in html
    assert "SMK Mart Lab" in html
    assert "Kopi Susu Gula Aren" in html
    assert "44.000" in html
    assert "Tunai" in html
    assert "6.000" in html

    # AC-82: Order tidak ada -> 404
    res_404 = client.get("/pos/struk/9999")
    assert res_404.status_code == 404

    # AC-83: Kasir 2 login -> coba buka struk order milik kasir 1 -> 403 Forbidden
    client.post("/logout")
    client.post("/login", data={"username": "kasir2", "password": "KasirPass123!"})
    res_kasir2 = client.get(f"/pos/struk/{order1.id}")
    assert res_kasir2.status_code == 403

    # Admin login -> boleh buka struk order kasir mana pun
    client.post("/logout")
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res_admin = client.get(f"/pos/struk/{order1.id}")
    assert res_admin.status_code == 200

    # AC-84: Tanda Pengajuan batal & Dibatalkan
    order1.status = "pengajuan_batal"
    db.session.commit()
    res_batal1 = client.get(f"/pos/struk/{order1.id}")
    assert "PENGAJUAN BATAL" in res_batal1.get_data(as_text=True)

    order1.status = "dibatalkan"
    db.session.commit()
    res_batal2 = client.get(f"/pos/struk/{order1.id}")
    assert "DIBATALKAN" in res_batal2.get_data(as_text=True)


def test_larangan_hapus_order_dan_item(client, db):
    """AC-96: Alamat hapus order atau item order tidak tersedia (404/405)."""
    setup_pos_data(db)
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    res1 = client.get("/order/1/hapus")
    assert res1.status_code in [404, 405]

    res2 = client.post("/order/1/hapus")
    assert res2.status_code in [404, 405]

    res3 = client.get("/pos/order/1/hapus")
    assert res3.status_code in [404, 405]


def test_perubahan_harga_produk_tidak_mengubah_order_lama(client, db):
    """AC-69 & NF-09: Mengubah harga produk setelahnya tidak mengubah snapshot order lama."""
    data = setup_pos_data(db)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]
    res = client.post(
        "/pos/checkout",
        json={
            "metode_bayar_id": data["transfer"].id,
            "items": [{"produk_id": p1.id, "jumlah": 1}],
        },
    )
    order_id = res.get_json()["order_id"]

    # Ubah harga produk p1 di master data dari 12.000 menjadi 50.000
    p1.harga = 50000
    db.session.commit()

    # Periksa order lama: tetap 12.000
    order = db.session.get(Order, order_id)
    assert order.subtotal == 12000
    assert order.items[0].harga_satuan == 12000
