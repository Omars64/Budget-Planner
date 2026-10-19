import pytest
from starlette.requests import Request
from api.client_address import client_address


def request(headers=(), host='192.0.2.9'):
    return Request({'type':'http','headers':headers,'client':(host,1234)})


def test_local_forwarded_headers_cannot_change_client(monkeypatch):
    monkeypatch.delenv('VERCEL', raising=False)
    assert client_address(request([(b'x-forwarded-for',b'198.51.100.3')])) == '192.0.2.9'


@pytest.mark.parametrize('value,expected', [
    ('198.51.100.3','198.51.100.3'), ('2001:db8::1','2001:db8::1'),
    ('::ffff:198.51.100.3','198.51.100.3'),
    ('198.51.100.3, 203.0.113.2','192.0.2.9'), ('garbage','192.0.2.9'),
])
def test_platform_address_validation(monkeypatch,value,expected):
    monkeypatch.setenv('VERCEL','1')
    assert client_address(request([(b'x-vercel-forwarded-for',value.encode())])) == expected


def test_reset_limits_aggregate_before_email(monkeypatch):
    from api import account_security as security
    from fastapi import HTTPException
    calls=[]
    def block(db,key,maximum,seconds):
        calls.append((key,maximum,seconds))
        if key.startswith('reset-ip:'): raise HTTPException(429,'Synthetic limit')
    monkeypatch.setattr(security,'limit',block)
    with pytest.raises(HTTPException):
        security.request_reset(security.EmailIn(email='rotating@example.test'),request(),None)
    assert calls == [('reset-global',300,3600),('reset-ip:192.0.2.9',20,3600)]
