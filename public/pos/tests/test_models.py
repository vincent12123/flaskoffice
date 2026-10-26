from datetime import UTC, datetime

from app.models import (
    MetodeBayar,
    Order,
    OrderItem,
    Pelanggan,
    Pengaturan,
    Produk,
    User,
)


def test_user_password_hashing(db):
    user = User(nama="Budi Santoso", username="budi", peran="kasir")
    user.set_password("rahasia123")

    assert user.password_hash != "rahasia123"
    assert user.check_password("rahasia123") is True
    assert user.check_password("salah") is False
    assert user.is_kasir is True
    assert user.is_admin is False
    assert user.is_active is True


def test_produk_model(db):
    prod = Produk(
        kode="MK99",
        nama="Roti Keju",
        kategori="Makanan",
        harga=10000,
        stok=20,
        aktif=True,
    )
    db.session.add(prod)
    db.session.commit()

    saved = Produk.query.filter_by(kode="MK99").first()
    assert saved is not None
    assert saved.nama == "Roti Keju"
    assert saved.harga == 10000
    assert saved.stok == 20


def test_pelanggan_bawaan(db):
    p_umum = Pelanggan(nama="Umum", bawaan=True)
    p_khusus = Pelanggan(nama="Ahmad", telepon="08123456789", bawaan=False)
    db.session.add_all([p_umum, p_khusus])
    db.session.commit()

    assert p_umum.bawaan is True
    assert p_khusus.bawaan is False


def test_metode_bayar_model(db):
    m_tunai = MetodeBayar(nama="Tunai", jenis="tunai", aktif=True)
    m_qris = MetodeBayar(nama="QRIS", jenis="non_tunai", aktif=True)
    db.session.add_all([m_tunai, m_qris])
    db.session.commit()

    assert m_tunai.jenis == "tunai"
    assert m_qris.jenis == "non_tunai"


def test_order_and_items_snapshot(db):
    # Setup dependencies
    kasir = User(nama="Kasir 1", username="kasir1", peran="kasir")
    kasir.set_password("kasirpass")
    pelanggan = Pelanggan(nama="Umum", bawaan=True)
    metode = MetodeBayar(nama="Tunai", jenis="tunai")
    produk = Produk(kode="PR01", nama="Teh Botol", harga=5000, stok=50)
    db.session.add_all([kasir, pelanggan, metode, produk])
    db.session.commit()

    # Create Order with OrderItem
    order = Order(
        nomor="POS-20261020-0001",
        waktu=datetime.now(UTC),
        kasir_id=kasir.id,
        pelanggan_id=pelanggan.id,
        metode_bayar_id=metode.id,
        subtotal=10000,
        tarif_pajak=10,
        pajak=1000,
        total=11000,
        uang_diterima=20000,
        kembalian=9000,
        status="selesai",
    )
    db.session.add(order)
    db.session.flush()

    item = OrderItem(
        order_id=order.id,
        produk_id=produk.id,
        nama_produk="Teh Botol (Snapshot)",
        harga_satuan=5000,
        jumlah=2,
        subtotal=10000,
    )
    db.session.add(item)
    db.session.commit()

    saved_order = Order.query.filter_by(nomor="POS-20261020-0001").first()
    assert saved_order is not None
    assert len(saved_order.items) == 1
    assert saved_order.items[0].nama_produk == "Teh Botol (Snapshot)"
    assert saved_order.kasir.username == "kasir1"
    assert saved_order.pelanggan.nama == "Umum"


def test_pengaturan_model(db):
    cfg = Pengaturan(
        nama_toko="Toko SMK Barokah",
        alamat_toko="Jl. Pendidikan No. 1",
        tarif_pajak=10,
        ambang_stok_menipis=5,
    )
    db.session.add(cfg)
    db.session.commit()

    saved = Pengaturan.query.first()
    assert saved is not None
    assert saved.nama_toko == "Toko SMK Barokah"
    assert saved.tarif_pajak == 10
    assert saved.ambang_stok_menipis == 5
