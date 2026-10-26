from app.models.user import User


def setup_users(db):
    admin = User(nama="Pak Guru", username="admin1", peran="admin", aktif=True)
    admin.set_password("AdminPassword123!")

    kasir = User(nama="Siti Kasir", username="kasir1", peran="kasir", aktif=True)
    kasir.set_password("KasirPassword123!")

    kasir_nonaktif = User(
        nama="Budi Nonaktif",
        username="budi_nonaktif",
        peran="kasir",
        aktif=False,
    )
    kasir_nonaktif.set_password("BudiPassword123!")

    db.session.add_all([admin, kasir, kasir_nonaktif])
    db.session.commit()
    return admin, kasir, kasir_nonaktif


def test_login_success_admin_to_dashboard(client, db):
    """AC-01: Admin login berhasil masuk ke Dashboard."""
    setup_users(db)

    resp = client.post(
        "/login",
        data={"username": "admin1", "password": "AdminPassword123!"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Dashboard Admin" in resp.data
    assert b"Selamat datang, Pak Guru." in resp.data


def test_login_success_kasir_to_pos(client, db):
    """AC-01: Kasir login berhasil masuk ke POS."""
    setup_users(db)

    resp = client.post(
        "/login",
        data={"username": "kasir1", "password": "KasirPassword123!"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Kasir Utama (POS)" in resp.data
    assert b"Selamat datang, Siti Kasir." in resp.data


def test_login_invalid_credentials(client, db):
    """AC-02 & UX-01: Password salah atau username tidak ada."""
    setup_users(db)

    # Password salah
    resp = client.post(
        "/login",
        data={"username": "admin1", "password": "PasswordSalah!"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Username atau password salah." in resp.data
    # UX-01: Username tetap terisi, password dikosongkan
    assert b'value="admin1"' in resp.data
    assert b'value="PasswordSalah!"' not in resp.data

    # Username tidak ada
    resp2 = client.post(
        "/login",
        data={"username": "hantu", "password": "PasswordSalah!"},
        follow_redirects=True,
    )
    assert resp2.status_code == 200
    assert b"Username atau password salah." in resp2.data


def test_login_inactive_user_rejected(client, db):
    """AC-03: Akun nonaktif ditolak dengan pesan yang sesuai."""
    setup_users(db)

    resp = client.post(
        "/login",
        data={"username": "budi_nonaktif", "password": "BudiPassword123!"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Akun Anda tidak aktif. Hubungi Admin." in resp.data


def test_unauthenticated_redirect_to_login(client, db):
    """AC-04: Pengunjung belum login dialihkan ke Login."""
    for path in ["/dashboard", "/pos", "/pengguna"]:
        resp = client.get(path)
        assert resp.status_code == 302
        assert "/login" in resp.headers["Location"]


def test_logout_redirect_and_session_cleared(client, db):
    """AC-05: Pengguna logout dialihkan ke Login dan tidak bisa akses halaman privat."""
    setup_users(db)

    # Login dulu
    client.post(
        "/login",
        data={"username": "admin1", "password": "AdminPassword123!"},
        follow_redirects=True,
    )

    # Logout
    logout_resp = client.post("/logout", follow_redirects=True)
    assert logout_resp.status_code == 200
    assert b"Masuk ke kasir" in logout_resp.data

    # Akses kembali dashboard -> harus dialihkan ke login
    resp = client.get("/dashboard")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_kasir_cannot_access_admin_pages(client, db):
    """AC-06: Kasir ditolak 403 saat membuka Dashboard atau Manajemen Pengguna."""
    setup_users(db)

    client.post(
        "/login",
        data={"username": "kasir1", "password": "KasirPassword123!"},
        follow_redirects=True,
    )

    for path in ["/dashboard", "/pengguna"]:
        resp = client.get(path)
        assert resp.status_code == 403
        assert b"Anda tidak punya akses ke halaman ini." in resp.data


def test_kasir_cannot_post_to_admin_routes(client, db):
    """AC-07: Kasir POST ke rute admin ditolak 403 dan data tidak berubah."""
    setup_users(db)

    client.post(
        "/login",
        data={"username": "kasir1", "password": "KasirPassword123!"},
        follow_redirects=True,
    )

    resp = client.post(
        "/pengguna/tambah",
        data={
            "nama": "Hacker",
            "username": "hacker",
            "password": "Password123!",
            "peran": "admin",
            "aktif": "y",
        },
    )
    assert resp.status_code == 403
    assert User.query.filter_by(username="hacker").first() is None
