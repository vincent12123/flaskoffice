from app.models.user import User


def setup_admin_and_login(client, db):
    admin = User(nama="Pak Guru", username="admin1", peran="admin", aktif=True)
    admin.set_password("AdminPassword123!")
    db.session.add(admin)
    db.session.commit()

    client.post(
        "/login",
        data={"username": "admin1", "password": "AdminPassword123!"},
        follow_redirects=True,
    )
    return admin


def test_tambah_pengguna_valid(client, db):
    """AC-10: Admin tambah pengguna Kasir valid, tersimpan dengan password hash."""
    setup_admin_and_login(client, db)

    resp = client.post(
        "/pengguna/tambah",
        data={
            "nama": "Doni Kasir",
            "username": "doni_kasir",
            "password": "DoniPassword123!",
            "peran": "kasir",
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Pengguna Doni Kasir tersimpan." in resp.data

    doni = User.query.filter_by(username="doni_kasir").first()
    assert doni is not None
    assert doni.nama == "Doni Kasir"
    assert doni.peran == "kasir"
    assert doni.password_hash != "DoniPassword123!"
    assert doni.check_password("DoniPassword123!") is True


def test_tambah_pengguna_duplicate_username(client, db):
    """AC-11: Username duplikat ditolak dengan pesan yang sesuai."""
    setup_admin_and_login(client, db)

    resp = client.post(
        "/pengguna/tambah",
        data={
            "nama": "Guru Baru",
            "username": "admin1",  # sudah dipakai
            "password": "PasswordBaru123!",
            "peran": "admin",
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Username admin1 sudah dipakai." in resp.data


def test_tambah_pengguna_short_password(client, db):
    """AC-12: Password kurang dari 8 karakter ditolak."""
    setup_admin_and_login(client, db)

    resp = client.post(
        "/pengguna/tambah",
        data={
            "nama": "Pendek",
            "username": "pendek",
            "password": "12345",  # < 8 karakter
            "peran": "kasir",
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Password minimal 8 karakter." in resp.data
    assert User.query.filter_by(username="pendek").first() is None


def test_kasir_deactivated_cannot_login(client, db):
    """AC-13: Kasir dinonaktifkan Admin tidak bisa login."""
    setup_admin_and_login(client, db)

    kasir = User(nama="Kasir Cuti", username="kasir_cuti", peran="kasir", aktif=True)
    kasir.set_password("KasirCuti123!")
    db.session.add(kasir)
    db.session.commit()

    # Admin menonaktifkan kasir lewat form ubah
    resp = client.post(
        f"/pengguna/{kasir.id}/ubah",
        data={
            "nama": "Kasir Cuti",
            "username": "kasir_cuti",
            "peran": "kasir",
            # aktif tidak dicentang -> False
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200

    kasir_updated = db.session.get(User, kasir.id)
    assert kasir_updated.aktif is False

    # Logout admin
    client.post("/logout", follow_redirects=True)

    # Coba login kasir nonaktif
    resp_login = client.post(
        "/login",
        data={"username": "kasir_cuti", "password": "KasirCuti123!"},
        follow_redirects=True,
    )
    assert resp_login.status_code == 200
    assert b"Akun Anda tidak aktif. Hubungi Admin." in resp_login.data


def test_admin_cannot_deactivate_self_or_last_admin(client, db):
    """AC-14: Admin tidak bisa menonaktifkan akun sendiri atau menurunkan admin terakhir."""
    admin = setup_admin_and_login(client, db)

    # 1. Admin mencoba menonaktifkan akun sendiri
    resp_self = client.post(
        f"/pengguna/{admin.id}/ubah",
        data={
            "nama": admin.nama,
            "username": admin.username,
            "peran": "admin",
            # aktif False
        },
        follow_redirects=True,
    )
    assert resp_self.status_code == 200
    assert b"Anda tidak bisa menonaktifkan akun Anda sendiri." in resp_self.data
    assert db.session.get(User, admin.id).aktif is True

    # 2. Tambah admin kedua
    admin2 = User(nama="Admin Dua", username="admin2", peran="admin", aktif=True)
    admin2.set_password("Admin2Password123!")
    db.session.add(admin2)
    db.session.commit()

    # Sekarang admin 1 menonaktifkan admin 2 -> berhasil karena masih ada admin 1
    resp_deact2 = client.post(
        f"/pengguna/{admin2.id}/ubah",
        data={
            "nama": admin2.nama,
            "username": admin2.username,
            "peran": "admin",
        },
        follow_redirects=True,
    )
    assert resp_deact2.status_code == 200
    assert db.session.get(User, admin2.id).aktif is False

    # Sekarang admin 2 adalah nonaktif. Mencoba ubah peran admin 1 menjadi kasir -> ditolak karena admin 1 admin aktif terakhir
    resp_demote = client.post(
        f"/pengguna/{admin.id}/ubah",
        data={
            "nama": admin.nama,
            "username": admin.username,
            "peran": "kasir",
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp_demote.status_code == 200
    assert b"Harus ada minimal satu Admin aktif." in resp_demote.data
    assert db.session.get(User, admin.id).is_admin is True


def test_admin_reset_password(client, db):
    """AC-15: Admin mengganti password pengguna; password baru berhasil, lama gagal."""
    setup_admin_and_login(client, db)

    kasir = User(nama="Siswa Test", username="siswa_test", peran="kasir", aktif=True)
    kasir.set_password("PasswordLama123!")
    db.session.add(kasir)
    db.session.commit()

    # Admin reset password
    resp = client.post(
        f"/pengguna/{kasir.id}/reset-password",
        data={"password_baru": "PasswordBaruLolos123!"},
        follow_redirects=True,
    )
    assert resp.status_code == 200
    assert b"Password Siswa Test diganti." in resp.data

    # Logout admin
    client.post("/logout", follow_redirects=True)

    # Login kasir dengan password lama -> gagal
    resp_lama = client.post(
        "/login",
        data={"username": "siswa_test", "password": "PasswordLama123!"},
        follow_redirects=True,
    )
    assert b"Username atau password salah." in resp_lama.data

    # Login kasir dengan password baru -> berhasil
    resp_baru = client.post(
        "/login",
        data={"username": "siswa_test", "password": "PasswordBaruLolos123!"},
        follow_redirects=True,
    )
    assert b"Kasir Utama (POS)" in resp_baru.data


def test_edit_user_immutable_username(client, db):
    """AC-16: Permintaan ubah pengguna membawa username berbeda, username di database tetap."""
    setup_admin_and_login(client, db)

    kasir = User(nama="Asli", username="username_asli", peran="kasir", aktif=True)
    kasir.set_password("Password123!")
    db.session.add(kasir)
    db.session.commit()

    resp = client.post(
        f"/pengguna/{kasir.id}/ubah",
        data={
            "nama": "Asli Diubah",
            "username": "username_palsu",  # coba ubah username
            "peran": "kasir",
            "aktif": "y",
        },
        follow_redirects=True,
    )
    assert resp.status_code == 200

    reloaded = db.session.get(User, kasir.id)
    assert reloaded.nama == "Asli Diubah"
    assert reloaded.username == "username_asli"  # username tidak berubah!
