"""Production ASGI entrypoint must not require local development servers."""
import os
from pathlib import Path
import site
import subprocess
import sys


def test_asgi_entrypoint_imports_without_uvicorn_or_provider_credentials(tmp_path):
    root = Path(__file__).resolve().parents[1]
    environment = {key: value for key, value in os.environ.items() if key.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
    }}
    environment.update(PYTHONPATH=site.getusersitepackages(),
                       FLOWBUDGET_DATABASE_URL='sqlite:///' + (tmp_path / 'synthetic.db').as_posix(),
                       APP_SECRET='synthetic-import-check-only-not-production')
    result = subprocess.run([sys.executable, '-c', '''
import sys, socket
sys.modules['uvicorn'] = None
socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('External IO forbidden'))
from api.app import app
assert app.title == 'Budgetly API'
assert '/api/health/ready' in app.openapi()['paths']
print('ASGI import ready without development server')
'''], cwd=root, env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == 'ASGI import ready without development server'
