"""Synthetic decoding and test-harness safety regressions; no provider access."""
import gzip
import json
import sys

import pytest
from cryptography.fernet import Fernet

from scripts.verify_external_backup import decode_backup


@pytest.mark.parametrize('raw', [
    '{"version":1,"version":1}',
    '{"version":true}',
    '{"version":1.0}',
    '{"version":1,"settings":{"secret":1,"secret":2}}',
    '{"version":1,"settings":{"value":NaN}}',
    '{"version":1,"settings":{"value":Infinity}}',
    '{"version":1,"settings":{"value":-Infinity}}',
    '{"version":1,"kind":"future-archive"}',
])
def test_authenticated_but_ambiguous_json_is_rejected(raw):
    secret = Fernet.generate_key()
    token = Fernet(secret).encrypt(gzip.compress(raw.encode()))
    with pytest.raises(ValueError):
        decode_backup(token, secret)


def test_standard_workspace_still_decodes():
    data = {'version': 1, 'settings': {}, **{name: [] for name in
        ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')}}
    secret = Fernet.generate_key()
    token = Fernet(secret).encrypt(gzip.compress(json.dumps(data).encode()))
    assert decode_backup(token, secret) == data


@pytest.mark.parametrize('event,args', [
    ('socket.getaddrinfo', ('provider.invalid', 443, 0, 0, 0)),
    ('socket.connect', (None, ('192.0.2.1', 443))),
    ('socket.connect', (None, ('::ffff:192.0.2.1', 443, 0, 0))),
    ('socket.sendto', (None, b'synthetic', ('192.0.2.1', 53))),
])
def test_external_network_is_blocked_before_io(event, args):
    with pytest.raises(RuntimeError, match='External network access disabled'):
        sys.audit(event, *args)


@pytest.mark.parametrize('host', ['localhost', '127.0.0.1', '::1'])
def test_loopback_synthetic_connections_are_allowed(host):
    # Exercise the exact audit events without requiring OS socket permissions.
    sys.audit('socket.getaddrinfo', host, 5432, 0, 0, 0)
    sys.audit('socket.connect', None, (host, 5432))
