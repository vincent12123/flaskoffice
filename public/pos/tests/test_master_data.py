from datetime import UTC, datetime

from app.models import MetodeBayar, Order, Pelanggan, Pengaturan, Produk, User


def setup_admin_and_kasir(client, db):
    admin = User(nama="Pak Guru", username="admin1", peran="admin", aktif=True)
    admin.set_password("AdminPassword123!")

    kasir = User(nama="Siti Kasir", username="kasir1", peran="kasir", aktif=True)
    kasir.set_password("KasirPassword123!")

    db.session.add_all([admin, kasir])
    db.session.commit()
    return admin, kasir


def login(client, username, password):
    return client.post(
        "/login",
        data={"username": username, "password": password},
        follow_redirects=True,
    )


# ==========================================
# TEST PRODUK (REQ-04, AC-20 s/d AC-26)
# ==========================================


def test_tambah_produk_valid(client, db):
    """AC-20: Admin tambah produk valid muncul di daftar Produk."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    resp = client.post(
        "/produk/tambah",
        data={
            "kode": "MK10",
            "nama": "Donat Stroberi",
            "kategori": "Makanan",
            "harga": 8000,
            "stok": 15,
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Produk Donat Stroberi tersimpan." in resp.data

    p = Produk.query.filter_by(kode="MK10").first()
    assert p is not None
    assert p.harga == 8000
    assert p.stok == 15


def test_tambah_produk_duplicate_code(client, db):
    """AC-21: Kode produk duplikat ditolak."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    p1 = Produk(kode="MN10", nama="Kopi Susu", harga=10000, stok=20, aktif=True)
    db.session.add(p1)
    db.session.commit()

    resp = client.post(
        "/produk/tambah",
        data={
            "kode": "MN10",
            "nama": "Kopi Hitam",
            "kategori": "Minuman",
            "harga": 8000,
            "stok": 10,
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Kode MN10 sudah dipakai produk lain." in resp.data


def test_produk_negative_price_or_stock(client, db):
    """AC-22: Harga atau stok negatif ditolak."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    resp = client.post(
        "/produk/tambah",
        data={
            "kode": "MK11",
            "nama": "Roti Murah",
            "harga": -5000,
            "stok": -10,
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Harga harus berupa angka dan minimal 0." in resp.data
    assert b"Stok harus berupa angka dan minimal 0." in resp.data


def test_deactivate_produk(client, db):
    """AC-23: Produk dinonaktifkan."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    p = Produk(kode="MN12", nama="Jus Sirsak", harga=12000, stok=10, aktif=True)
    db.session.add(p)
    db.session.commit()

    resp = client.post(
        f"/produk/{p.id}/ubah",
        data={
            "kode": "MN12",
            "nama": "Jus Sirsak",
            "harga": 12000,
            "stok": 10,
            # aktif tidak dicentang -> nonaktif
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    p_reloaded = db.session.get(Produk, p.id)
    assert p_reloaded.aktif is False


def test_produk_delete_route_not_allowed(client, db):
    """AC-24: Alamat hapus produk tidak tersedia (404/405)."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    resp = client.post("/produk/1/hapus")
    assert resp.status_code in [404, 405]


def test_produk_stok_menipis_label(client, db):
    """AC-25: Stok <= ambang berlabel Menipis."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    pengaturan = Pengaturan(nama_toko="Toko", tarif_pajak=10, ambang_stok_menipis=5)
    p_menipis = Produk(
        kode="MK20", nama="Donat Menipis", harga=5000, stok=3, aktif=True
    )
    p_aman = Produk(kode="MK21", nama="Donat Aman", harga=5000, stok=20, aktif=True)
    db.session.add_all([pengaturan, p_menipis, p_aman])
    db.session.commit()

    resp = client.get("/produk")
    assert resp.status_code == 200
    assert b"Menipis: 3" in resp.data


def test_produk_search_and_filter(client, db):
    """AC-26: Filter kategori dan search kode/nama."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    p1 = Produk(
        kode="MK30", nama="Bakso Bakar", kategori="Makanan", harga=10000, stok=10
    )
    p2 = Produk(kode="MN30", nama="Es Cincau", kategori="Minuman", harga=6000, stok=10)
    db.session.add_all([p1, p2])
    db.session.commit()

    # Search Bakso
    resp_search = client.get("/produk?q=Bakso")
    assert b"Bakso Bakar" in resp_search.data
    assert b"Es Cincau" not in resp_search.data

    # Filter Kategori Minuman
    resp_kat = client.get("/produk?kategori=Minuman")
    assert b"Es Cincau" in resp_kat.data
    assert b"Bakso Bakar" not in resp_kat.data


# ==========================================
# TEST PELANGGAN (REQ-05, AC-30 s/d AC-35)
# ==========================================


def test_tambah_dan_ubah_pelanggan_valid(client, db):
    """AC-30: Kasir atau Admin bisa tambah dan ubah pelanggan valid."""
    setup_admin_and_kasir(client, db)
    login(client, "kasir1", "KasirPassword123!")

    # Kasir tambah pelanggan
    resp = client.post(
        "/pelanggan/tambah",
        data={
            "nama": "Pak Hendra",
            "telepon": "081234567890",
            "alamat": "Jl. Melati No. 10",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Pelanggan Pak Hendra tersimpan." in resp.data

    hendra = Pelanggan.query.filter_by(nama="Pak Hendra").first()
    assert hendra is not None
    assert hendra.telepon == "081234567890"

    # Kasir ubah pelanggan
    resp_edit = client.post(
        f"/pelanggan/{hendra.id}/ubah",
        data={
            "nama": "Pak Hendra Spd",
            "telepon": "+6281234567890",
            "alamat": "Jl. Mawar",
        },
        follow_redirects=True,
    )
    assert resp_edit.status_code == 200
    assert b"Pelanggan Pak Hendra Spd tersimpan." in resp_edit.data
    assert db.session.get(Pelanggan, hendra.id).nama == "Pak Hendra Spd"


def test_pelanggan_invalid_telepon(client, db):
    """AC-31: Nama kosong atau telepon berisi huruf ditolak."""
    setup_admin_and_kasir(client, db)
    login(client, "kasir1", "KasirPassword123!")

    resp = client.post(
        "/pelanggan/tambah",
        data={
            "nama": "Budi",
            "telepon": "0812abcd",  # huruf di telepon
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Nomor telepon hanya boleh angka dan tanda +." in resp.data


def test_pelanggan_umum_immutable(client, db):
    """AC-32: Pelanggan Umum tidak bisa diubah atau dihapus."""
    setup_admin_and_kasir(client, db)
    p_umum = Pelanggan(nama="Umum", bawaan=True)
    db.session.add(p_umum)
    db.session.commit()

    login(client, "admin1", "AdminPassword123!")

    # Coba ubah
    resp_ubah = client.post(
        f"/pelanggan/{p_umum.id}/ubah",
        data={"nama": "Umum Baru"},
        follow_redirects=True,
    )
    assert resp_ubah.status_code == 200
    assert b"Pelanggan Umum tidak bisa diubah atau dihapus." in resp_ubah.data
    assert db.session.get(Pelanggan, p_umum.id).nama == "Umum"

    # Coba hapus
    resp_hapus = client.post(f"/pelanggan/{p_umum.id}/hapus", follow_redirects=True)
    assert resp_hapus.status_code == 200
    assert b"Pelanggan Umum tidak bisa diubah atau dihapus." in resp_hapus.data
    assert db.session.get(Pelanggan, p_umum.id) is not None


def test_pelanggan_with_orders_cannot_be_deleted(client, db):
    """AC-33: Pelanggan yang punya order tidak bisa dihapus."""
    _admin, kasir = setup_admin_and_kasir(client, db)
    metode = MetodeBayar(nama="Tunai", jenis="tunai")
    pelanggan = Pelanggan(nama="Pelanggan Berbelanja", bawaan=False)
    db.session.add_all([metode, pelanggan])
    db.session.commit()

    order = Order(
        nomor="POS-20261020-0010",
        waktu=datetime.now(UTC),
        kasir_id=kasir.id,
        pelanggan_id=pelanggan.id,
        metode_bayar_id=metode.id,
        subtotal=10000,
        tarif_pajak=10,
        pajak=1000,
        total=11000,
        status="selesai",
    )
    db.session.add(order)
    db.session.commit()

    login(client, "admin1", "AdminPassword123!")

    resp = client.post(f"/pelanggan/{pelanggan.id}/hapus", follow_redirects=True)
    assert resp.status_code == 200
    assert (
        b"Pelanggan Pelanggan Berbelanja tidak bisa dihapus karena sudah punya order."
        in resp.data
    )
    assert db.session.get(Pelanggan, pelanggan.id) is not None


def test_kasir_cannot_delete_pelanggan(client, db):
    """AC-34: Kasir kirim hapus pelanggan ditolak 403."""
    setup_admin_and_kasir(client, db)
    pelanggan = Pelanggan(nama="Pelanggan Kasir", bawaan=False)
    db.session.add(pelanggan)
    db.session.commit()

    login(client, "kasir1", "KasirPassword123!")

    resp = client.post(f"/pelanggan/{pelanggan.id}/hapus")
    assert resp.status_code == 403
    assert db.session.get(Pelanggan, pelanggan.id) is not None


def test_admin_delete_pelanggan_without_order(client, db):
    """AC-35: Admin hapus pelanggan tanpa order berhasil terhapus."""
    setup_admin_and_kasir(client, db)
    pelanggan = Pelanggan(nama="Pelanggan Bebas", bawaan=False)
    db.session.add(pelanggan)
    db.session.commit()

    login(client, "admin1", "AdminPassword123!")

    resp = client.post(f"/pelanggan/{pelanggan.id}/hapus", follow_redirects=True)
    assert resp.status_code == 200
    assert b"Pelanggan Pelanggan Bebas dihapus." in resp.data
    assert db.session.get(Pelanggan, pelanggan.id) is None


# ==========================================
# TEST METODE BAYAR (REQ-06, AC-40 s/d AC-43)
# ==========================================


def test_crud_metode_bayar(client, db):
    """AC-40: Admin tambah, ubah, nonaktifkan metode bayar."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    # Tambah
    resp = client.post(
        "/metode-bayar/tambah",
        data={"nama": "Debit BCA", "jenis": "non_tunai", "aktif": "y"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Metode bayar Debit BCA tersimpan." in resp.data

    m = MetodeBayar.query.filter_by(nama="Debit BCA").first()
    assert m is not None

    # Ubah
    resp_ubah = client.post(
        f"/metode-bayar/{m.id}/ubah",
        data={"nama": "Debit BCA Baru", "jenis": "non_tunai", "aktif": "y"},
        follow_redirects=True,
    )
    assert resp_ubah.status_code == 200
    assert b"Metode bayar Debit BCA Baru tersimpan." in resp_ubah.data
    assert db.session.get(MetodeBayar, m.id).nama == "Debit BCA Baru"


def test_metode_bayar_duplicate_name(client, db):
    """AC-41: Nama metode bayar sudah dipakai ditolak."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    m1 = MetodeBayar(nama="Tunai", jenis="tunai")
    db.session.add(m1)
    db.session.commit()

    resp = client.post(
        "/metode-bayar/tambah",
        data={"nama": "Tunai", "jenis": "tunai", "aktif": "y"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Nama Tunai sudah dipakai." in resp.data


def test_cannot_deactivate_last_active_metode(client, db):
    """AC-42: Metode aktif terakhir tidak bisa dinonaktifkan."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    m_only = MetodeBayar(nama="Tunai Satu Satunya", jenis="tunai", aktif=True)
    db.session.add(m_only)
    db.session.commit()

    resp = client.post(
        f"/metode-bayar/{m_only.id}/ubah",
        data={
            "nama": "Tunai Satu Satunya",
            "jenis": "tunai",
            # aktif tidak dicentang -> nonaktif
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert (
        b"Metode bayar aktif terakhir tidak bisa dinonaktifkan. Aktifkan metode lain dulu."
        in resp.data
    )
    assert db.session.get(MetodeBayar, m_only.id).aktif is True


def test_metode_bayar_delete_not_available(client, db):
    """AC-43: Alamat hapus metode bayar tidak tersedia (404/405)."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    resp = client.post("/metode-bayar/1/hapus")
    assert resp.status_code in [404, 405]


# ==========================================
# TEST PENGATURAN (REQ-16, AC-50 s/d AC-53)
# ==========================================


def test_admin_update_pengaturan_nama_dan_alamat(client, db):
    """AC-50 & AC-51: Admin ubah nama, alamat, dan tarif pajak."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    p = Pengaturan(
        nama_toko="SMK Mart Lama",
        alamat_toko="Jl. Lama",
        tarif_pajak=10,
        ambang_stok_menipis=5,
    )
    db.session.add(p)
    db.session.commit()

    resp = client.post(
        "/pengaturan",
        data={
            "nama_toko": "SMK Mart Terpadu",
            "alamat_toko": "Jl. Pendidikan Baru No. 99",
            "tarif_pajak": 11,
            "ambang_stok_menipis": 7,
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Pengaturan tersimpan." in resp.data

    updated = Pengaturan.query.first()
    assert updated.nama_toko == "SMK Mart Terpadu"
    assert updated.alamat_toko == "Jl. Pendidikan Baru No. 99"
    assert updated.tarif_pajak == 11
    assert updated.ambang_stok_menipis == 7


def test_pengaturan_validation_errors(client, db):
    """AC-52: Validasi tarif di luar 0-100, ambang negatif, nama toko kosong."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    resp = client.post(
        "/pengaturan",
        data={
            "nama_toko": "",  # kosong
            "tarif_pajak": 150,  # > 100
            "ambang_stok_menipis": -3,  # negatif
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Nama toko wajib diisi." in resp.data
    assert b"Tarif pajak harus antara 0 sampai 100%." in resp.data
    assert b"Ambang stok menipis minimal 0." in resp.data


def test_pengaturan_ambang_stok_updates_produk_list(client, db):
    """AC-53: Perubahan ambang stok mempengaruhi label Menipis pada produk."""
    setup_admin_and_kasir(client, db)
    login(client, "admin1", "AdminPassword123!")

    cfg = Pengaturan(nama_toko="Toko", tarif_pajak=10, ambang_stok_menipis=5)
    prod = Produk(kode="MK99", nama="Kue Lapis", harga=5000, stok=8, aktif=True)
    db.session.add_all([cfg, prod])
    db.session.commit()

    # Stok 8 dengan ambang 5 -> tidak menipis
    resp1 = client.get("/produk")
    assert b"Menipis: 8" not in resp1.data

    # Naikkan ambang ke 10
    client.post(
        "/pengaturan",
        data={
            "nama_toko": "Toko",
            "tarif_pajak": 10,
            "ambang_stok_menipis": 10,
        },
        follow_redirects=True,
    )

    # Sekarang stok 8 <= 10 -> harus tampil label Menipis
    resp2 = client.get("/produk")
    assert b"Menipis: 8" in resp2.data
