"""Vercel/local ASGI entrypoint with the extended FlowBudget feature set."""

from .index import app
from .extensions import router as extensions_router

app.include_router(extensions_router)
