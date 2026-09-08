"""Vercel/local ASGI entrypoint with the extended FlowBudget feature set."""

from fastapi import Query, Depends
from .index import admin_user

from .index import app
from . import extensions
from . import workspace
from . import bank_messages
from . import passkeys
from . import account_security
from . import recovery
from . import productivity
from . import operations
from .email_service import send_verification_code, smtp_status

# Route signup verification through the hardened email transport. Keeping this
# assignment here avoids duplicating the signup/database logic in extensions.py.
extensions.send_code = send_verification_code
app.include_router(extensions.router)
app.include_router(workspace.router)
app.include_router(bank_messages.router)
app.include_router(passkeys.router)
app.include_router(account_security.router)
app.include_router(recovery.router)
app.include_router(productivity.router)
app.include_router(operations.router)


@app.get("/api/health/email")
def email_health(probe: bool = Query(False), user=Depends(admin_user)):
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
