"""Vercel/local ASGI entrypoint with the extended Budgetly feature set."""

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
from . import ai
from . import ai_settings
from . import tutorial
from . import statements
from . import planned
from . import financial_ledger
from . import attention
from . import google_auth
from . import google_drive
from . import app_updates
from . import guest_import
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
app.include_router(ai.router)
app.include_router(ai_settings.router)
app.include_router(tutorial.router)
app.include_router(statements.router)
app.include_router(planned.router)
app.include_router(financial_ledger.router)
app.include_router(attention.router)
app.include_router(google_auth.router)
app.include_router(google_drive.router)
app.include_router(app_updates.router)
app.include_router(guest_import.router)


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
