import importlib.util
from pathlib import Path
from unittest.mock import Mock
from urllib.error import URLError
from urllib.error import HTTPError
from io import BytesIO
import pytest

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


def test_probe_retries_transport_disconnects(monkeypatch):
    from http.client import IncompleteRead, RemoteDisconnected
    request = Mock(side_effect=[RemoteDisconnected(), IncompleteRead(b'partial'), OSError('private')])
    monkeypatch.setattr(monitor, 'urlopen', request)
    monkeypatch.setattr(monitor.time, 'sleep', Mock())
    assert not monitor.healthy('https://example.invalid/api/health/ready')
    assert request.call_count == 3
    assert monitor.time.sleep.call_count == 2


def test_probe_recovers_and_requests_no_intermediary_cache(monkeypatch):
    response = Mock(status=200)
    response.read.return_value = b'{"ok":true}'
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    request = Mock(side_effect=[URLError('private'), response])
    monkeypatch.setattr(monitor, 'urlopen', request)
    monkeypatch.setattr(monitor.time, 'sleep', Mock())
    assert monitor.healthy('https://example.invalid/api/health/ready')
    assert request.call_count == 2
    assert request.call_args.args[0].get_header('Cache-control') == 'no-cache'


def test_http_failure_diagnostics_are_allowlisted_and_retries_unchanged(monkeypatch, capsys):
    errors = [HTTPError('https://user:secret@example.invalid/private', 503,
                        'private reason', {'X-Budgetly-Readiness-Source': 'probe',
                                           'Authorization': 'secret-header'},
                        BytesIO(b'{"code":"STORAGE_UNAVAILABLE","detail":"secret-body"}'))
              for _ in range(3)]
    request = Mock(side_effect=errors)
    sleep = Mock()
    monkeypatch.setattr(monitor, 'urlopen', request)
    monkeypatch.setattr(monitor.time, 'sleep', sleep)
    assert not monitor.healthy('https://user:secret@example.invalid/private')
    assert request.call_count == 3
    assert [call.args for call in sleep.call_args_list] == [(5,), (5,)]
    assert capsys.readouterr().out == ''.join(
        f'Probe {attempt}: status=503 source=probe code=STORAGE_UNAVAILABLE\n'
        for attempt in range(1, 4))
    assert all(error.closed for error in errors)


@pytest.mark.parametrize('body', [b'{"code":["private"]}', b'{"code":"secret-code"}',
                                      b'private-invalid-json', b'[]'])
def test_untrusted_error_fields_never_print(monkeypatch, capsys, body):
    errors = [HTTPError('https://secret.invalid', 503, 'secret reason',
                        {'X-Budgetly-Readiness-Source': 'private\nheader'}, BytesIO(body))
              for _ in range(3)]
    monkeypatch.setattr(monitor, 'urlopen', Mock(side_effect=errors))
    monkeypatch.setattr(monitor.time, 'sleep', Mock())
    assert not monitor.healthy('https://secret.invalid')
    assert capsys.readouterr().out == ''.join(
        f'Probe {attempt}: status=503 source=unknown code=unknown\n'
        for attempt in range(1, 4))


def test_cached_success_diagnostic(monkeypatch, capsys):
    response = Mock(status=200, headers={'X-Budgetly-Readiness-Source': 'cached'})
    response.read.return_value = b'{"ok":true,"detail":"private"}'
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    request = Mock(return_value=response)
    monkeypatch.setattr(monitor, 'urlopen', request)
    assert monitor.healthy('https://example.invalid')
    assert request.call_count == 1
    assert capsys.readouterr().out == 'Probe 1: status=200 source=cached code=unknown\n'


def test_transport_diagnostics_do_not_expose_exception(monkeypatch, capsys):
    monkeypatch.setattr(monitor, 'urlopen', Mock(side_effect=URLError('secret-url-and-token')))
    monkeypatch.setattr(monitor.time, 'sleep', Mock())
    assert not monitor.healthy('https://secret.invalid')
    assert capsys.readouterr().out == ''.join(
        f'Probe {attempt}: status=unknown source=unknown code=unknown\n'
        for attempt in range(1, 4))
