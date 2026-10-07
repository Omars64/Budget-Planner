"""Authentication is independent of the selected financial workspace."""
import hashlib
import hmac
from datetime import timedelta
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired
from sqlalchemy.orm import Session
from .database import get_db
from .models import User, utc_now
from .reliability_models import AccountSession


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    from .index import auth_serializer
    header = request.headers.get('Authorization', '')
    token = header[7:] if header.lower().startswith('bearer ') else request.headers.get('X-App-Token')
    if not token:
        raise HTTPException(401, 'Sign in to continue')
    try:
        data = auth_serializer.loads(token, max_age=86400)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, 'Session expired')
    user = db.get(User, data.get('user_id'))
    if not user or not user.active:
        raise HTTPException(401, 'Account is inactive')
    if not hmac.compare_digest(data.get('credential', ''), hashlib.sha256(user.password_hash.encode()).hexdigest()):
        raise HTTPException(401, 'Please sign in again')
    session = db.get(AccountSession, data.get('sid', ''))
    if not session or session.revoked or session.user_id != user.id:
        raise HTTPException(401, 'Please sign in again. This session has ended.')
    request.state.session_id = session.id
    if session.label == 'Browser session' or session.last_seen < utc_now() - timedelta(minutes=5):
        session.label = request.headers.get('user-agent', 'Browser session')[:200]
        session.last_seen = utc_now(); db.commit()
    return user
