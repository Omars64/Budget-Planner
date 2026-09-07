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


def clear_budget(db, user_id, preserve_main_wallet=False, preserve_categories=False):
    db.query(WalletShare).filter_by(owner_id=user_id).delete(synchronize_session=False)
    db.query(Transaction).filter_by(user_id=user_id).update({Transaction.recurring_parent_id: None})
    for model in [Transaction, Budget, Goal, Debt]:
        db.query(model).filter_by(user_id=user_id).delete(synchronize_session=False)
    if not preserve_categories:
        db.query(Category).filter_by(user_id=user_id).delete(synchronize_session=False)
    if preserve_main_wallet:
        wallets = db.query(Wallet).filter_by(user_id=user_id).order_by(Wallet.id).all()
        main = next((wallet for wallet in wallets if wallet.name.strip().casefold() == "main wallet"), None)
        if main is None:
            main = Wallet(user_id=user_id, name="Main Wallet", type="cash", initial_balance=0, icon="wallet", color="#0a4173", archived=False)
            db.add(main)
            db.flush()
        else:
            main.initial_balance = 0
            main.archived = False
        for wallet in wallets:
            if wallet.id != main.id:
                db.query(WalletShare).filter_by(wallet_id=wallet.id).delete(synchronize_session=False)
                db.delete(wallet)
    else:
        db.query(Wallet).filter_by(user_id=user_id).delete(synchronize_session=False)


def clear_notes(db, user_id):
    ids = db.query(Note.id).filter_by(user_id=user_id)
    db.query(NoteRevision).filter(NoteRevision.note_id.in_(ids)).delete(synchronize_session=False)
    db.query(NoteShare).filter(NoteShare.note_id.in_(ids)).delete(synchronize_session=False)
    db.query(Note).filter_by(user_id=user_id).delete(synchronize_session=False)
    db.query(NoteFolder).filter_by(user_id=user_id).delete(synchronize_session=False)
