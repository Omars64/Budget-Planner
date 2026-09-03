from __future__ import annotations

import html
import logging
import os
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid

logger = logging.getLogger("flowbudget.email")
DEFAULT_SENDER = "omarsolanki35@gmail.com"


class EmailServiceError(RuntimeError):
    code = "EMAIL_DELIVERY_FAILED"


class EmailConfigurationError(EmailServiceError):
    code = "EMAIL_NOT_CONFIGURED"


class EmailAuthenticationError(EmailServiceError):
    code = "EMAIL_AUTH_FAILED"


class EmailConnectionError(EmailServiceError):
    code = "EMAIL_CONNECTION_FAILED"


@dataclass(frozen=True)
class SMTPConfig:
    host: str
    port: int
    username: str
    password: str
    from_email: str
    timeout: float


def _first_env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def get_smtp_config(require_password: bool = True) -> SMTPConfig:
    host = _first_env("SMTP_HOST", default="smtp.gmail.com")
    try:
        port = int(_first_env("SMTP_PORT", default="587"))
    except ValueError as exc:
        raise EmailConfigurationError("SMTP_PORT must be a valid integer") from exc

    username = _first_env("SMTP_USER", "GMAIL_USER", "EMAIL_USER", default=DEFAULT_SENDER)
    password = _first_env("SMTP_PASSWORD", "GMAIL_APP_PASSWORD", "GOOGLE_APP_PASSWORD", "EMAIL_PASSWORD")
    password = "".join(password.split())
    from_email = _first_env("SMTP_FROM", "EMAIL_FROM", default=username or DEFAULT_SENDER)
    try:
        timeout = float(_first_env("SMTP_TIMEOUT", default="8"))
    except ValueError as exc:
        raise EmailConfigurationError("SMTP_TIMEOUT must be numeric") from exc

    if not host or not username or not from_email:
        raise EmailConfigurationError("SMTP sender configuration is incomplete")
    if require_password and not password:
        raise EmailConfigurationError("SMTP password is not configured")
    if "@" not in username or "@" not in from_email:
        raise EmailConfigurationError("SMTP sender address is invalid")

    return SMTPConfig(
        host=host,
        port=port,
        username=username,
        password=password,
        from_email=from_email,
        timeout=max(3.0, min(timeout, 20.0)),
    )


def _build_verification_message(config: SMTPConfig, to_email: str, username: str, code: str) -> EmailMessage:
    safe_name = html.escape(username)
    msg = EmailMessage()
    msg["Subject"] = f"{code} is your FlowBudget verification code"
    msg["From"] = f"FlowBudget <{config.from_email}>"
    msg["To"] = to_email
    msg["Reply-To"] = config.from_email
    msg["Date"] = format_datetime(datetime.now(timezone.utc))
    domain = config.from_email.split("@", 1)[1] if "@" in config.from_email else None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"

    msg.set_content(
        f"Hi {username},\n\n"
        f"Your FlowBudget verification code is {code}.\n"
        "It expires in 10 minutes.\n\n"
        "If you did not request this code, you can safely ignore this email.\n\n"
        "FlowBudget"
    )
    msg.add_alternative(
        f'''<!doctype html><html><body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#153246"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #dce8f0;border-radius:20px"><tr><td style="padding:28px"><div style="font-size:22px;font-weight:700;color:#0a4173">FlowBudget</div><p>Hi {safe_name},</p><p>Use this code to finish creating your account:</p><div style="font-size:34px;letter-spacing:10px;font-weight:800;color:#0a4173;padding:18px 0">{code}</div><p style="font-size:13px;color:#647987">The code expires in 10 minutes. If you did not request it, ignore this message.</p></td></tr></table></td></tr></table></body></html>''',
        subtype="html",
    )
    return msg


def _smtp_session(config: SMTPConfig, port: int):
    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(config.host, port, context=context, timeout=config.timeout)
        server.ehlo()
        return server
    server = smtplib.SMTP(config.host, port, timeout=config.timeout)
    server.ehlo()
    server.starttls(context=context)
    server.ehlo()
    return server


def _ports_to_try(config: SMTPConfig) -> list[int]:
    ports = [config.port]
    if config.host.lower() in {"smtp.gmail.com", "smtp.googlemail.com"}:
        alternate = 465 if config.port != 465 else 587
        if alternate not in ports:
            ports.append(alternate)
    return ports


def _classify_error(exc: Exception) -> EmailServiceError:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return EmailAuthenticationError("The sender account rejected the SMTP credentials")
    if isinstance(exc, (TimeoutError, OSError, smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        return EmailConnectionError("Could not connect to the email provider")
    if isinstance(exc, smtplib.SMTPException):
        return EmailServiceError("The email provider rejected the message")
    return EmailServiceError("Unexpected email delivery failure")


def send_verification_code(to_email: str, username: str, code: str) -> None:
    config = get_smtp_config(require_password=True)
    msg = _build_verification_message(config, to_email, username, code)
    last_error: EmailServiceError | None = None

    for port in _ports_to_try(config):
        try:
            with _smtp_session(config, port) as server:
                server.login(config.username, config.password)
                server.send_message(msg)
            logger.info("Verification email sent through %s:%s", config.host, port)
            return
        except Exception as exc:
            classified = _classify_error(exc)
            last_error = classified
            logger.error(
                "Verification email failed through %s:%s (%s)",
                config.host,
                port,
                classified.code,
            )
            if isinstance(classified, EmailAuthenticationError):
                break

    raise last_error or EmailServiceError("Verification email could not be delivered")


def smtp_status(probe: bool = False) -> dict:
    try:
        config = get_smtp_config(require_password=False)
    except EmailConfigurationError as exc:
        return {"configured": False, "ready": False, "code": exc.code, "message": str(exc)}

    has_password = bool(
        _first_env("SMTP_PASSWORD", "GMAIL_APP_PASSWORD", "GOOGLE_APP_PASSWORD", "EMAIL_PASSWORD")
    )
    result = {
        "configured": has_password,
        "ready": False,
        "host": config.host,
        "port": config.port,
        "sender": config.from_email,
        "username": config.username,
        "password_present": has_password,
    }
    if not has_password:
        result.update({"code": "EMAIL_NOT_CONFIGURED", "message": "SMTP password is not configured"})
        return result
    if not probe:
        result.update({"ready": True, "code": "CONFIG_PRESENT", "message": "SMTP credentials are present"})
        return result

    try:
        checked = get_smtp_config(require_password=True)
        last_error: EmailServiceError | None = None
        for port in _ports_to_try(checked):
            try:
                with _smtp_session(checked, port) as server:
                    server.login(checked.username, checked.password)
                    server.noop()
                result.update({"ready": True, "port": port, "code": "SMTP_OK", "message": "SMTP login succeeded"})
                return result
            except Exception as exc:
                last_error = _classify_error(exc)
                if isinstance(last_error, EmailAuthenticationError):
                    break
        assert last_error is not None
        result.update({"ready": False, "code": last_error.code, "message": str(last_error)})
        return result
    except EmailServiceError as exc:
        result.update({"ready": False, "code": exc.code, "message": str(exc)})
        return result
