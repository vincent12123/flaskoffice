"""Pemeriksaan tambahan Flask Office untuk titik periksa yang tidak dicakup test resmi.

Test resmi proyek SMK Mart POS (tests/test_*.py) dipakai apa adanya; berkas ini hanya
menambah hal yang di tutorial diperiksa secara manual.
"""

import pytest

from app import create_app


def test_bab02_beranda_berjalan():
    """Bab 2: halaman depan menampilkan "Halo! Aplikasi POS berjalan." (bab berikutnya boleh mengalihkan ke login)."""
    app = create_app("testing")
    resp = app.test_client().get("/")
    if resp.status_code == 200:
        assert "Halo! Aplikasi POS berjalan." in resp.get_data(as_text=True)
    else:
        assert resp.status_code in (301, 302, 303, 307, 308), f"Halaman depan menjawab {resp.status_code}"


def test_bab02_secret_key_wajib(monkeypatch):
    """Bab 2: aplikasi menolak berjalan bila SECRET_KEY belum diatur."""
    import config

    monkeypatch.delenv("SECRET_KEY", raising=False)
    for kelas in vars(config).values():
        if isinstance(kelas, type) and kelas.__name__ != "TestingConfig" and "SECRET_KEY" in dir(kelas):
            monkeypatch.setattr(kelas, "SECRET_KEY", None)
    with pytest.raises(Exception, match="SECRET_KEY"):
        create_app("development")


def test_bab05_celah_open_redirect_tertutup(client, db):
    """Bab 5: login dengan ?next= ke situs luar tidak boleh mengalihkan ke situs itu."""
    from app.models.user import User

    user = User(nama="Uji Redirect", username="uji_redirect", peran="admin", aktif=True)
    user.set_password("UjiPassword123!")
    db.session.add(user)
    db.session.commit()

    resp = client.post(
        "/login?next=https://situs-jahat.example/curi",
        data={"username": "uji_redirect", "password": "UjiPassword123!"},
    )
    assert resp.status_code in (301, 302, 303, 307, 308), f"Login menjawab {resp.status_code}"
    assert "situs-jahat.example" not in resp.headers.get("Location", ""), "Masih mengalihkan ke situs luar"


def test_bab17_produksi_tanpa_debug(monkeypatch):
    """Bab 17: konfigurasi production berjalan tanpa debug, dan /console menjawab 404."""
    import config

    monkeypatch.setenv("SECRET_KEY", "kunci-uji-produksi")
    for kelas in vars(config).values():
        if isinstance(kelas, type) and "SECRET_KEY" in dir(kelas) and not getattr(kelas, "SECRET_KEY", None):
            monkeypatch.setattr(kelas, "SECRET_KEY", "kunci-uji-produksi")
    app = create_app("production")
    assert not app.debug, "Mode debug masih menyala di konfigurasi production"
    assert app.test_client().get("/console").status_code == 404
