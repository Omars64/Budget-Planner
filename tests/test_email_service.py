import smtplib

import pytest

from api import email_service


class FakeSMTP:
    attempts = []
    fail_first_connection = False

    def __init__(self, host, port, *args, **kwargs):
        self.host = host
        self.port = port
        FakeSMTP.attempts.append(port)
        if FakeSMTP.fail_first_connection and len(FakeSMTP.attempts) == 1:
            raise OSError("simulated connection failure")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def ehlo(self):
        return 250, b"ok"

    def starttls(self, context=None):
        return 220, b"ready"

    def login(self, username, password):
        assert username == "omarsolanki35@gmail.com"
        assert password == "abcdefghijklmnop"
        return 235, b"ok"

    def send_message(self, message):
        assert message["To"] == "recipient@example.com"
        assert "FlowBudget" in message["From"]
        return {}

    def noop(self):
        return 250, b"ok"


@pytest.fixture(autouse=True)
def smtp_env(monkeypatch):
    for key in [
        "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM",
        "GMAIL_USER", "GMAIL_APP_PASSWORD", "GOOGLE_APP_PASSWORD",
        "EMAIL_USER", "EMAIL_PASSWORD", "EMAIL_FROM",
    ]:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop")
    FakeSMTP.attempts = []
    FakeSMTP.fail_first_connection = False
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)


def test_gmail_sender_defaults_and_app_password_alias():
    config = email_service.get_smtp_config()
    assert config.username == "omarsolanki35@gmail.com"
    assert config.from_email == "omarsolanki35@gmail.com"
    assert config.password == "abcdefghijklmnop"
    email_service.send_verification_code("recipient@example.com", "Omar", "123456")
    assert FakeSMTP.attempts == [587]


def test_gmail_retries_alternate_tls_port_on_connection_failure():
    FakeSMTP.fail_first_connection = True
    email_service.send_verification_code("recipient@example.com", "Omar", "123456")
    assert FakeSMTP.attempts == [587, 465]


def test_status_reports_missing_secret_without_exposing_one(monkeypatch):
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    status = email_service.smtp_status()
    assert status["configured"] is False
    assert status["password_present"] is False
    assert status["code"] == "EMAIL_NOT_CONFIGURED"
    assert "password" not in {key for key in status if key not in {"password_present"}}
