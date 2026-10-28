"""CI-only synthetic app: no inherited configuration, bootstrap, or external sockets."""
import os
import sys
from pathlib import Path
import socket
import tempfile
import secrets

ROOT = Path(__file__).resolve().parents[1]


def isolate(directory):
    # An allowlist also removes provider variables introduced after this helper.
    keep = {key: value for key, value in os.environ.items() if key.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG',
        'LC_ALL', 'HOME', 'USERPROFILE', 'COMSPEC', 'PATHEXT',
    }}
    os.environ.clear()
    os.environ.update(keep)
    os.environ.update(
        FLOWBUDGET_DATABASE_URL='sqlite:///' + str(Path(directory) / 'synthetic.sqlite'),
        APP_SECRET=secrets.token_urlsafe(48), BUDGETLY_SEED_DEMO='false',
        BUDGETLY_ENV='test', AWS_EC2_METADATA_DISABLED='true',
    )
    original = socket.socket.connect
    original_ex = socket.socket.connect_ex
    original_resolve = socket.getaddrinfo

    def require_loopback(address):
        if not isinstance(address, tuple) or address[0] not in ('127.0.0.1', '::1'):
            raise RuntimeError('Synthetic backend forbids external connections')

    def loopback_only(sock, address):
        require_loopback(address)
        return original(sock, address)

    def loopback_ex(sock, address):
        require_loopback(address)
        return original_ex(sock, address)

    def loopback_resolve(host, port, *args, **kwargs):
        if host not in ('127.0.0.1', '::1', 'localhost', b'127.0.0.1', b'::1', b'localhost'):
            raise RuntimeError('Synthetic backend forbids external DNS')
        return original_resolve(host, port, *args, **kwargs)

    socket.socket.connect = loopback_only
    socket.socket.connect_ex = loopback_ex
    socket.getaddrinfo = loopback_resolve


def create_app(directory):
    if any(name == 'api' or name.startswith('api.') for name in sys.modules):
        raise RuntimeError('Isolation must precede every API import')
    isolate(directory)
    sys.path.insert(0, str(ROOT))
    from api.app import app
    from api import index
    from api.database import Base, engine, SessionLocal
    from api.models import User, Wallet, Category
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    assert engine.url.get_backend_name() == 'sqlite'
    assert Path(engine.url.database).resolve().parent == Path(directory).resolve()
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for suffix in ('a', 'b'):
            user = User(username='Synthetic ' + suffix.upper(),
                        email=f'browser-{suffix}@example.test',
                        password_hash=index.hash_password('Synthetic-CI-only-928!'))
            db.add(user)
            db.flush()
            db.add(Wallet(user_id=user.id, name=f'Synthetic wallet {suffix.upper()}'))
            db.add(Category(user_id=user.id, name='Synthetic expense', kind='expense'))
            index.set_setting(db, user.id, 'tutorial_v1', 'skipped')
        db.commit()

    def forbid_bootstrap(*_args, **_kwargs):
        raise RuntimeError('Production bootstrap is forbidden in browser reliability CI')

    index.initialize_storage = forbid_bootstrap
    index._initialize_storage = forbid_bootstrap
    app.state.storage_ready = True

    @app.get('/__browser_reliability__/ready', include_in_schema=False)
    def synthetic_ready():
        return {'synthetic': True, 'pid': os.getpid()}

    @app.get('/{path:path}', include_in_schema=False)
    def shell(path: str):
        if path.startswith('api/'):
            raise HTTPException(404)
        dist = (ROOT / 'dist').resolve()
        target = (dist / path).resolve()
        if not target.is_relative_to(dist):
            raise HTTPException(404)
        return FileResponse(target if target.is_file() else dist / 'index.html')

    return app, engine


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        os.environ.update(DATABASE_URL='postgresql://forbidden.invalid/never',
                          OPENAI_API_KEY='synthetic-must-be-cleared',
                          FLOWBUDGET_POSTGRES_URL='postgresql://forbidden.invalid/never')
    scratch = ROOT / '.verification'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='budgetly-browser-', dir=scratch) as directory:
        app, engine = create_app(directory)
        try:
            if args.self_test:
                from fastapi.testclient import TestClient
                # No context manager: deliberately never run production lifespan.
                client = TestClient(app)
                for suffix in ('a', 'b'):
                    response = client.post('/api/auth/login', json={
                        'email': f'browser-{suffix}@example.test',
                        'password': 'Synthetic-CI-only-928!',
                    })
                    assert response.status_code == 200
                    headers = {'Authorization': 'Bearer ' + response.json()['token']}
                    assert client.get('/api/wallets', headers=headers).status_code == 200
                client.close()
                assert 'DATABASE_URL' not in os.environ
                assert 'OPENAI_API_KEY' not in os.environ
                assert 'FLOWBUDGET_POSTGRES_URL' not in os.environ
                with socket.socket() as probe:
                    try:
                        probe.connect(('192.0.2.1', 443))
                    except RuntimeError:
                        pass
                    else:
                        raise AssertionError('External socket guard failed')
                try:
                    socket.getaddrinfo('forbidden.invalid', 443)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError('External DNS guard failed')
                print('Synthetic isolation and real password sign-in passed')
            else:
                import uvicorn
                uvicorn.run(app, host='127.0.0.1', port=8765, lifespan='off',
                            access_log=False, log_level='warning')
        finally:
            engine.dispose()


if __name__ == '__main__':
    main()
