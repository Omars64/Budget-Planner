import importlib.util
from pathlib import Path
from unittest.mock import Mock
from urllib.error import URLError

spec = importlib.util.spec_from_file_location('monitor_production', Path(__file__).resolve().parents[1] / 'scripts' / 'monitor-production.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


def test_probe_retries_failures_without_printing_response(monkeypatch):
    request = Mock(side_effect=URLError('secret-test-error'))
    monkeypatch.setattr(monitor, 'urlopen', request)
    monkeypatch.setattr(monitor.time, 'sleep', lambda _: None)
    assert not monitor.healthy('https://example.invalid/api/health/ready')
    assert request.call_count == 3


def test_probe_handles_unexpected_json(monkeypatch):
    response = Mock(status=200)
    response.read.return_value = b'[]'
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(monitor, 'urlopen', lambda *args, **kwargs: response)
    monkeypatch.setattr(monitor.time, 'sleep', lambda _: None)
    assert not monitor.healthy('https://example.invalid/api/health/ready')
    response.read.return_value = b'{"ok":true}'
    assert monitor.healthy('https://example.invalid/api/health/ready')
