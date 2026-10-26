def test_404_error_page(client):
    """UX-11: 404 menampilkan teks sesuai SCR-15 dan tombol Kembali ke beranda."""
    resp = client.get("/halaman-yang-pasti-tidak-ada-12345")
    assert resp.status_code == 404
    assert (
        b"Halaman atau data tidak ditemukan. Periksa alamatnya atau kembali ke beranda."
        in resp.data
    )
    assert b"Kembali ke beranda" in resp.data


def test_403_error_page_unauthenticated(client):
    """UX-11: 403 menampilkan teks sesuai SCR-15 dan tombol Kembali ke beranda."""

    # Rute abort(403)
    @client.application.route("/test-403")
    def trigger_403():
        from flask import abort

        abort(403)

    resp = client.get("/test-403")
    assert resp.status_code == 403
    assert (
        b"Anda tidak punya akses ke halaman ini. Gunakan akun dengan peran yang sesuai."
        in resp.data
    )
    assert b"Kembali ke beranda" in resp.data


def test_500_error_page(client):
    """UX-11: 500 menampilkan teks sesuai SCR-15 dan tombol Kembali ke beranda tanpa traceback."""

    @client.application.route("/test-500")
    def trigger_500():
        raise RuntimeError("Simulated server crash")

    # Default testing client raises exceptions unless handled
    client.application.config["PROPAGATE_EXCEPTIONS"] = False
    resp = client.get("/test-500")
    assert resp.status_code == 500
    assert (
        b"Terjadi masalah di server. Coba lagi sebentar. Bila berulang, beri tahu guru atau Admin."
        in resp.data
    )
    assert b"Kembali ke beranda" in resp.data
    assert b"Traceback" not in resp.data
    assert b"Simulated server crash" not in resp.data
