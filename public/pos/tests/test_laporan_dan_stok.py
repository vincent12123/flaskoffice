import csv
import io

from app.models.metode_bayar import MetodeBayar
from app.models.mutasi_stok import MutasiStok
from app.models.pelanggan import Pelanggan
from app.models.pengaturan import Pengaturan
from app.models.produk import Produk
from app.models.user import User


def setup_test_data(db_session):
    admin = User(username="admin", nama="Admin Akuntansi", peran="admin", aktif=True)
    admin.set_password("AdminPass123!")

    kasir = User(username="kasir1", nama="Ahmad Kasir", peran="kasir", aktif=True)
    kasir.set_password("KasirPass123!")

    metode = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)
    pelanggan = Pelanggan(nama="Umum")
    p1 = Produk(
        kode="PRD-001",
        nama="Buku Tulis",
        kategori="ATK",
        harga=5000,
        stok=20,
        aktif=True,
    )
    p2 = Produk(
        kode="PRD-002",
        nama="Pensil 2B",
        kategori="ATK",
        harga=2500,
        stok=10,
        aktif=True,
    )
    pengaturan = Pengaturan(
        nama_toko="SMK Mart POS", tarif_pajak=10, ambang_stok_menipis=5
    )

    db_session.add_all([admin, kasir, metode, pelanggan, p1, p2, pengaturan])
    db_session.commit()
    return {
        "admin": admin,
        "kasir": kasir,
        "metode": metode,
        "pelanggan": pelanggan,
        "p1": p1,
        "p2": p2,
    }


def test_restock_cepat_sukses(client, db):
    """Admin berhasil menambah stok cepat dan tercatat ke MutasiStok."""
    data = setup_test_data(db.session)
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    p1 = data["p1"]
    stok_awal = p1.stok

    # Lakukan restock cepat via JSON API
    res = client.post(
        f"/produk/{p1.id}/tambah-stok",
        json={"jumlah": 15, "keterangan": "Kulakan Toko Grosir Jaya"},
    )
    assert res.status_code == 200
    res_data = res.get_json()
    assert res_data["success"] is True
    assert res_data["stok_baru"] == stok_awal + 15

    # Cek database stok produk
    p1_refreshed = db.session.get(Produk, p1.id)
    assert p1_refreshed.stok == stok_awal + 15

    # Cek record MutasiStok
    mutasi = MutasiStok.query.filter_by(produk_id=p1.id, tipe="masuk").first()
    assert mutasi is not None
    assert mutasi.jumlah == 15
    assert mutasi.stok_sebelum == stok_awal
    assert mutasi.stok_sesudah == stok_awal + 15
    assert "Kulakan Toko Grosir Jaya" in mutasi.keterangan


def test_restock_cepat_validasi_negatif(client, db):
    """Validasi penambahan stok: jumlah 0, negatif, atau string ditolak."""
    data = setup_test_data(db.session)
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    p1 = data["p1"]

    # Jumlah 0
    res0 = client.post(f"/produk/{p1.id}/tambah-stok", json={"jumlah": 0})
    assert res0.status_code == 400
    assert res0.get_json()["success"] is False

    # Jumlah negatif
    res_neg = client.post(f"/produk/{p1.id}/tambah-stok", json={"jumlah": -5})
    assert res_neg.status_code == 400

    # Bukan angka
    res_str = client.post(f"/produk/{p1.id}/tambah-stok", json={"jumlah": "sepuluh"})
    assert res_str.status_code == 400


def test_kasir_dilarang_restock_cepat(client, db):
    """Kasir dilarang mengakses rute restock cepat (403 Forbidden)."""
    data = setup_test_data(db.session)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]
    res = client.post(f"/produk/{p1.id}/tambah-stok", json={"jumlah": 10})
    assert res.status_code == 403


def test_penjualan_pos_mencatat_mutasi_keluar(client, db):
    """Transaksi checkout di POS otomatis mencatat mutasi stok tipe 'keluar'."""
    data = setup_test_data(db.session)
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    p1 = data["p1"]
    stok_awal = p1.stok

    res = client.post(
        "/pos/checkout",
        json={
            "pelanggan_id": data["pelanggan"].id,
            "metode_bayar_id": data["metode"].id,
            "uang_diterima": 20000,
            "items": [{"produk_id": p1.id, "jumlah": 3}],
        },
    )
    assert res.status_code == 201

    mutasi = MutasiStok.query.filter_by(produk_id=p1.id, tipe="keluar").first()
    assert mutasi is not None
    assert mutasi.jumlah == 3
    assert mutasi.stok_sebelum == stok_awal
    assert mutasi.stok_sesudah == stok_awal - 3


def test_pembatalan_order_mencatat_mutasi_batal(client, db):
    """Konfirmasi pembatalan order oleh admin mencatat mutasi stok tipe 'batal' (retur)."""
    data = setup_test_data(db.session)
    # 1. Kasir checkout
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    p1 = data["p1"]
    res_pos = client.post(
        "/pos/checkout",
        json={
            "pelanggan_id": data["pelanggan"].id,
            "metode_bayar_id": data["metode"].id,
            "uang_diterima": 50000,
            "items": [{"produk_id": p1.id, "jumlah": 2}],
        },
    )
    order_id = res_pos.get_json()["order_id"]

    # 2. Kasir ajukan batal
    client.post(
        f"/order/{order_id}/ajukan-batal",
        json={"alasan": "Barang salah beli oleh siswa"},
    )

    # 3. Admin konfirmasi batal dengan cek fisik
    client.post("/logout")
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    stok_sebelum_batal = db.session.get(Produk, p1.id).stok
    res_batal = client.post(
        f"/order/{order_id}/konfirmasi-batal",
        json={"cek_fisik": True},
    )
    assert res_batal.status_code == 200

    # Cek mutasi bertipe 'batal'
    mutasi_batal = MutasiStok.query.filter_by(produk_id=p1.id, tipe="batal").first()
    assert mutasi_batal is not None
    assert mutasi_batal.jumlah == 2
    assert mutasi_batal.stok_sebelum == stok_sebelum_batal
    assert mutasi_batal.stok_sesudah == stok_sebelum_batal + 2


def test_halaman_dan_ekspor_laporan_penjualan(client, db):
    """Admin dapat membuka halaman rekap akuntansi dan mengunduh file CSV Excel."""
    data = setup_test_data(db.session)

    # Buat satu transaksi penjualan
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})
    client.post(
        "/pos/checkout",
        json={
            "pelanggan_id": data["pelanggan"].id,
            "metode_bayar_id": data["metode"].id,
            "uang_diterima": 20000,
            "items": [{"produk_id": data["p1"].id, "jumlah": 1}],
        },
    )

    # Login sebagai Admin
    client.post("/logout")
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    # 1. Buka Halaman Laporan
    res_page = client.get("/laporan/")
    assert res_page.status_code == 200
    html = res_page.data.decode("utf-8")
    assert "Laporan Keuangan & Penjualan" in html
    assert "Total Omzet Bersih" in html
    assert "Ekspor ke Excel (CSV)" in html

    # 2. Ekspor CSV
    res_csv = client.get("/laporan/penjualan/ekspor")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.content_type
    assert "attachment; filename=" in res_csv.headers["Content-Disposition"]

    content = res_csv.data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(content), delimiter=";")
    rows = list(reader)
    # Header row
    assert rows[0][0] == "No. Order"
    assert rows[0][5] == "Subtotal (Rp)"
    # Minimal ada 1 data order
    assert len(rows) >= 2


def test_halaman_dan_ekspor_kartu_stok(client, db):
    """Admin dapat membuka halaman kartu stok dan mengunduh file CSV mutasi stok."""
    data = setup_test_data(db.session)
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    # Lakukan restock agar ada mutasi
    client.post(
        f"/produk/{data['p1'].id}/tambah-stok",
        json={"jumlah": 20, "keterangan": "Stok Tambahan Toko"},
    )

    # 1. Buka halaman kartu stok
    res_page = client.get("/laporan/kartu-stok")
    assert res_page.status_code == 200
    html = res_page.data.decode("utf-8")
    assert "Kartu Stok & Log Mutasi" in html
    assert "PRD-001" in html

    # 2. Ekspor CSV kartu stok
    res_csv = client.get("/laporan/kartu-stok/ekspor")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.content_type
    content = res_csv.data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(content), delimiter=";")
    rows = list(reader)
    assert rows[0][0] == "ID Mutasi"
    assert len(rows) >= 2
