import os
from unittest.mock import patch

from app.models import (
    MetodeBayar,
    Pelanggan,
    Pengaturan,
    Produk,
    User,
)


def test_seed_populates_initial_data(app, runner):
    """AC-110: flask seed mengisi seluruh data awal sesuai spesifikasi."""
    with patch.dict(
        os.environ,
        {
            "ADMIN_PASSWORD": "AdminSecretPassword123!",
            "KASIR_PASSWORD": "KasirSecretPassword123!",
            "ADMIN_USERNAME": "admin",
            "KASIR_USERNAME": "kasir1",
        },
    ):
        result = runner.invoke(args=["seed"])
        assert result.exit_code == 0
        assert "Data awal (seed) berhasil disimpan" in result.output

    with app.app_context():
        # Verifikasi Admin & Kasir
        admins = User.query.filter_by(peran="admin").all()
        kasirs = User.query.filter_by(peran="kasir").all()
        assert len(admins) == 1
        assert len(kasirs) == 1
        assert admins[0].username == "admin"
        assert admins[0].check_password("AdminSecretPassword123!") is True
        assert kasirs[0].username == "kasir1"
        assert kasirs[0].check_password("KasirSecretPassword123!") is True

        # Verifikasi 3 Metode Bayar
        metode = MetodeBayar.query.all()
        assert len(metode) == 3
        metode_names = {m.nama for m in metode}
        assert metode_names == {"Tunai", "Transfer", "QRIS"}

        # Verifikasi Pelanggan Bawaan "Umum"
        pelanggan_umum = Pelanggan.query.filter_by(bawaan=True).all()
        assert len(pelanggan_umum) == 1
        assert pelanggan_umum[0].nama == "Umum"

        # Verifikasi Pengaturan
        pengaturan = Pengaturan.query.all()
        assert len(pengaturan) == 1
        assert pengaturan[0].tarif_pajak == 10
        assert pengaturan[0].ambang_stok_menipis == 5

        # Verifikasi ±15 Produk Contoh
        produks = Produk.query.all()
        assert len(produks) == 15
        assert all(p.harga >= 0 and p.stok >= 0 for p in produks)


def test_seed_is_idempotent(app, runner):
    """AC-111: Ketika seed dijalankan dua kali, tidak ada data ganda."""
    env_vars = {
        "ADMIN_PASSWORD": "AdminSecretPassword123!",
        "KASIR_PASSWORD": "KasirSecretPassword123!",
    }
    with patch.dict(os.environ, env_vars):
        res1 = runner.invoke(args=["seed"])
        assert res1.exit_code == 0

        res2 = runner.invoke(args=["seed"])
        assert res2.exit_code == 0

    with app.app_context():
        assert User.query.count() == 2
        assert MetodeBayar.query.count() == 3
        assert Pelanggan.query.count() == 1
        assert Pengaturan.query.count() == 1
        assert Produk.query.count() == 15


def test_seed_aborts_without_passwords(app, runner):
    """AC-112: Tanpa password seed di .env, seed berhenti dengan pesan jelas dan exit code != 0."""
    with patch.dict(os.environ, {}, clear=True):
        result = runner.invoke(args=["seed"])
        assert result.exit_code != 0
        assert "ADMIN_PASSWORD dan KASIR_PASSWORD wajib diatur" in (
            result.output + str(result.exception)
        )
