"""Per-account tutorial completion, independent of general preference updates."""
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from .database import get_db
from .index import current_user, setting, set_setting

router = APIRouter(prefix='/api/tutorial', tags=['Tutorial'])
KEY = 'tutorial_v1'


class TutorialProgress(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['completed', 'skipped']


@router.get('')
def get_progress(user=Depends(current_user), db=Depends(get_db)):
    return {'status': setting(db, user.id, KEY, 'not_started')}


@router.put('')
def save_progress(payload: TutorialProgress, user=Depends(current_user), db=Depends(get_db)):
    set_setting(db, user.id, KEY, payload.status)
    db.commit()
    return payload.model_dump()
