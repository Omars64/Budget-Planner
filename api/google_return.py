"""Token-free OAuth completion pages for browser and verified Android links."""
import json
import secrets
from html import escape
from urllib.parse import quote
from fastapi.responses import HTMLResponse
from .android_identity import ANDROID_RP_ID, ANDROID_PACKAGE

RETURN_PATH = '/api/auth/google/return'
RETURN_URL = f'https://{ANDROID_RP_ID}{RETURN_PATH}'
ANDROID_INTENT = (f'intent://{ANDROID_RP_ID}{RETURN_PATH}#Intent;scheme=https;'
                  f'package={ANDROID_PACKAGE};S.browser_fallback_url={quote(RETURN_URL, safe="")};end')


def completion_page(native=False, automatic=True, successful=True):
    nonce = secrets.token_urlsafe(24)
    title = 'Opening Budgetly…' if native else 'Return to Budgetly'
    message = ('Your Google confirmation is ready. Continue in Budgetly to finish.' if successful
               else 'Google sign-in could not be completed. Return to Budgetly to try again.')
    action = f'<a href="{escape(ANDROID_INTENT, quote=True)}">Open Budgetly</a>' if native else '<button id="close" type="button">Close this window</button>'
    script = ('window.location.replace(' + json.dumps(ANDROID_INTENT) + ');' if native and automatic
              else '' if native else "document.getElementById('close').onclick=()=>window.close();window.close();")
    return HTMLResponse(f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style nonce="{nonce}">body{{font:16px system-ui;max-width:440px;margin:12vh auto;padding:24px;line-height:1.6;background:#f6f8fb;color:#172b3a}}h1{{font-size:28px}}a,button{{display:inline-block;border:0;border-radius:14px;padding:14px 22px;background:#203b73;color:white;text-decoration:none;font:inherit}}small{{display:block;margin-top:24px;color:#526b80}}</style></head><body><h1>{title}</h1><p>{message}</p>{action}<small>If Budgetly does not open automatically, use the button above or switch back to the app. If your sign-in expired, start again there.</small><script nonce="{nonce}">{script}</script></body></html>''',
        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                 'Content-Security-Policy': f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"})
