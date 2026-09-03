"""Vercel/local ASGI entrypoint with the extended FlowBudget feature set."""

from fastapi import Query

from .index import app
from . import extensions
from .email_service import send_verification_code, smtp_status

# Route signup verification through the hardened email transport. Keeping this
# assignment here avoids duplicating the signup/database logic in extensions.py.
extensions.send_code = send_verification_code
app.include_router(extensions.router)


@app.get("/api/health/email")
def email_health(probe: bool = Query(False)):
    """Return non-secret SMTP readiness information for deployment diagnostics."""
    status = smtp_status(probe=probe)
    return {
        "configured": status.get("configured", False),
        "ready": status.get("ready", False),
        "code": status.get("code", "UNKNOWN"),
        "message": status.get("message", ""),
        "host": status.get("host"),
        "port": status.get("port"),
        "sender": status.get("sender"),
        "password_present": status.get("password_present", False),
    }
