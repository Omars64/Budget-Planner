import json
from fastapi.encoders import jsonable_encoder
from .models import RecoveryPoint, WalletShare, Transaction, Budget, Goal, Debt, Category, Wallet, NoteShare, Note, NoteFolder
from .models import NoteRevision


def save_recovery(db, owner, actor, reason):
    from .index import export_backup
    point = RecoveryPoint(user_id=owner.id, actor_id=actor.id, reason=reason[:200],
                          payload=json.dumps(jsonable_encoder(export_backup(owner, db))))
    db.add(point)
    db.flush()
    return point


def clear_budget(db, user_id):
    db.query(WalletShare).filter_by(owner_id=user_id).delete(synchronize_session=False)
    db.query(Transaction).filter_by(user_id=user_id).update({Transaction.recurring_parent_id: None})
    for model in [Transaction, Budget, Goal, Debt, Category, Wallet]:
        db.query(model).filter_by(user_id=user_id).delete(synchronize_session=False)


def clear_notes(db, user_id):
    ids = db.query(Note.id).filter_by(user_id=user_id)
    db.query(NoteRevision).filter(NoteRevision.note_id.in_(ids)).delete(synchronize_session=False)
    db.query(NoteShare).filter(NoteShare.note_id.in_(ids)).delete(synchronize_session=False)
    db.query(Note).filter_by(user_id=user_id).delete(synchronize_session=False)
    db.query(NoteFolder).filter_by(user_id=user_id).delete(synchronize_session=False)
