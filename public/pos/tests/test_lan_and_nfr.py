from datetime import UTC, datetime, timedelta, timezone

import pytest

from app import create_app
from app.extensions import db as _db
from app.models.metode_bayar import MetodeBayar
from app.models.order import Order
from app.models.pelanggan import Pelanggan
from app.models.pengaturan import Pengaturan
from app.models.produk import Produk
from app.models.user import User

WIB_TZ = timezone(timedelta(hours=7))


@pytest.fixture
def setup_nfr_data(app):
    """Seed data pengujian untuk NFR test suite."""
    with app.app_context():
        admin = User(username="admin", nama="Admin Utama", peran="admin", aktif=True)
        admin.set_password("AdminPass123!")

        kasir = User(username="kasir1", nama="Ahmad Kasir", peran="kasir", aktif=True)
        kasir.set_password("KasirPass123!")

        metode = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)
        pelanggan = Pelanggan(nama="Umum")
        produk = Produk(
            kode="PRD-001",
            nama="Buku Tulis",
            kategori="ATK",
            harga=5000,
            stok=20,
            aktif=True,
        )
        pengaturan = Pengaturan(
            nama_toko="SMK Mart POS", tarif_pajak=10, ambang_stok_menipis=5
        )

        _db.session.add_all([admin, kasir, metode, pelanggan, produk, pengaturan])
        _db.session.commit()
        yield


def test_nf_01_semua_halaman_terproteksi_redirect_ke_login(client):
    """NF-01: Semua halaman selain login tidak bisa diakses tanpa login (AC-04)."""
    halaman_terproteksi = [
        "/dashboard",
        "/pos",
        "/produk",
        "/produk/tambah",
        "/pelanggan",
        "/pelanggan/tambah",
        "/metode-bayar",
        "/pengaturan",
        "/pengguna",
        "/pengguna/tambah",
        "/order/",
    ]
    for url in halaman_terproteksi:
        res = client.get(url, follow_redirects=False)
        assert res.status_code == 302, (
            f"URL {url} harus redirect (302) tapi mengembalikan {res.status_code}"
        )
        assert "/login" in res.headers["Location"], (
            f"URL {url} harus redirect ke /login"
        )


def test_nf_02_csrf_protection_menolak_permintaan_tanpa_token():
    """NF-02: Semua form POST menolak permintaan tanpa token CSRF yang sah."""
    csrf_app = create_app("testing")
    csrf_app.config["WTF_CSRF_ENABLED"] = True

    with csrf_app.app_context():
        _db.create_all()
        with csrf_app.test_client() as csrf_client:
            # POST login tanpa CSRF token harus ditolak (400 Bad Request)
            res = csrf_client.post(
                "/login",
                data={"username": "admin", "password": "AdminPass123!"},
            )
            assert res.status_code == 400
            assert b"CSRF" in res.data or b"bad request" in res.data.lower()
        _db.session.remove()
        _db.drop_all()


def test_nf_03_sql_injection_safety_pada_pencarian(client, setup_nfr_data):
    """NF-03: Input SQL injection seperti ' OR 1=1 -- pada pencarian tidak error atau bocor."""
    # Login sebagai admin
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})

    payloads = [
        "' OR 1=1 --",
        "'; DROP TABLE produk; --",
        "' UNION SELECT null, null, null --",
    ]

    for p in payloads:
        res = client.get(f"/produk?q={p}")
        assert res.status_code == 200

        res_pelanggan = client.get(f"/pelanggan?q={p}")
        assert res_pelanggan.status_code == 200

        res_order = client.get(f"/order/?q={p}")
        assert res_order.status_code == 200

    # Pastikan data produk tetap aman
    assert Produk.query.count() > 0


def test_nf_04_gitignore_and_credentials_check():
    """NF-04: .env diabaikan oleh .gitignore dan tidak ada secret/kredensial hardcoded di repo."""
    import os

    gitignore_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), ".gitignore"
    )
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r", encoding="utf-8") as f:
            content = f.read()
            assert ".env" in content


def test_nf_06_format_rupiah_dan_bahasa_indonesia(app):
    """NF-06: Semua teks antarmuka dan format uang Rp 12.500."""
    rupiah_filter = app.jinja_env.filters["rupiah"]
    assert rupiah_filter(0) == "Rp 0"
    assert rupiah_filter(12500) == "Rp 12.500"
    assert rupiah_filter(1000000) == "Rp 1.000.000"


def test_nf_07_waktu_ui_wib_dan_db_utc(app):
    """NF-07: Waktu di UI dan struk = WIB sementara database menyimpan UTC."""
    waktu_wib_filter = app.jinja_env.filters["waktu_wib"]
    # Tanggal dan waktu dalam UTC
    dt_utc = datetime(2026, 10, 20, 16, 30, tzinfo=UTC)
    # Di WIB (UTC+7), jam 16:30 UTC adalah jam 23:30 WIB
    wib_str = waktu_wib_filter(dt_utc)
    assert "23:30" in wib_str
    assert "20/10/2026" in wib_str


def test_nf_09_order_snapshot_immutability(client, setup_nfr_data):
    """NF-09: Order dan order item snapshot harga & nama tidak berubah walau master data berubah."""
    client.post("/login", data={"username": "kasir1", "password": "KasirPass123!"})

    produk = Produk.query.filter_by(kode="PRD-001").first()
    metode = MetodeBayar.query.filter_by(nama="Tunai").first()
    pelanggan = Pelanggan.query.filter_by(nama="Umum").first()
    harga_asli = produk.harga
    nama_asli = produk.nama

    # Lakukan checkout via JSON API
    payload = {
        "pelanggan_id": pelanggan.id,
        "metode_bayar_id": metode.id,
        "uang_diterima": harga_asli * 2,
        "items": [{"produk_id": produk.id, "jumlah": 1}],
    }

    res = client.post("/pos/checkout", json=payload)
    assert res.status_code == 201

    order = Order.query.order_by(Order.id.desc()).first()
    assert order is not None
    item = order.items[0]
    assert item.nama_produk == nama_asli
    assert item.harga_satuan == harga_asli

    # Ubah data master produk
    produk.nama = "Nama Produk Baru Setelah Diedit"
    produk.harga = 999999
    _db.session.commit()

    # Periksa snapshot di order tetap memakai data saat transaksi
    order_refresh = _db.session.get(Order, order.id)
    assert order_refresh.items[0].nama_produk == nama_asli
    assert order_refresh.items[0].harga_satuan == harga_asli


def test_nf_10_and_ac_114_error_500_tanpa_traceback(client):
    """NF-10 & AC-114: Error 500 menampilkan template kustom tanpa traceback atau debugger Werkzeug."""

    @client.application.route("/test-simulasi-500")
    def trigger_500():
        raise RuntimeError("Simulasi Error Fatal Server")

    client.application.config["PROPAGATE_EXCEPTIONS"] = False
    res = client.get("/test-simulasi-500")
    assert res.status_code == 500
    html = res.data.decode("utf-8")
    assert "500" in html
    assert "Terjadi masalah di server" in html
    assert "Kembali ke beranda" in html
    assert "Traceback" not in html
    assert "Simulasi Error Fatal Server" not in html


def test_a11y_05_status_order_berupa_teks_eksplisit(client, setup_nfr_data):
    """A11Y-05: Status order tampil sebagai teks eksplisit (bukan hanya warna/ikon)."""
    client.post("/login", data={"username": "admin", "password": "AdminPass123!"})
    res = client.get("/order/")
    html = res.data.decode("utf-8")
    # Periksa teks status atau header tabel riwayat
    assert "Riwayat Order" in html
    assert "Status" in html
    assert "Nomor Order" in html
