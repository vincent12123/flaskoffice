import pytest

from app import create_app
from app.extensions import db as _db


@pytest.fixture
def app():
    """Membuat instance aplikasi dengan konfigurasi pengujian."""
    app = create_app("testing")

    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    """Test client untuk simulasi request HTTP."""
    return app.test_client()


@pytest.fixture
def runner(app):
    """Test runner untuk pengujian perintah CLI Flask."""
    return app.test_cli_runner()


@pytest.fixture
def db(app):
    """Database fixture."""
    return _db
