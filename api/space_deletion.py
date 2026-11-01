"""One transaction, one Space. Unknown or cross-scope dependencies fail closed.

The caller must hold require_owner's transaction-scoped owner claim and Space
row lock. This module never commits, restores an account, or clears an owner.
"""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import delete, inspect, select, tuple_, update
from sqlalchemy.exc import IntegrityError

from .database import Base
from .data_safety import save_recovery


def guard_context_writes(db):
    """Non-FK AI context creation must serialize with financial deletion too.

    These are late flush claims: NOWAIT prevents lock inversions with AI's own
    chat locks. After deletion, a stale new context gets 409 instead of saving
    a dangling wallet/note ID. Existing history edits need no financial claim.
    """
    references = []
    for row in set(db.new) | set(db.dirty):
        table = getattr(row, '__table__', None)
        if table is None:
            continue
        mapping = {'ai_chats': ('wallet_id', 'wallets'), 'ai_turns': ('note_id', 'notes')}
        if table.name not in mapping:
            continue
        column, parent = mapping[table.name]
        ident = getattr(row, column)
        if ident is None or (row not in db.new and not inspect(row).attrs[column].history.has_changes()):
            continue
        # AI's existing save-note claim uses -1 as a transaction-local marker.
        if ident == -1 and table.name == 'ai_turns':
            continue
        references.append((Base.metadata.tables[parent], ident))
    if not references:
        return
    connection = db.connection()
    owners = set()
    for parent, ident in references:
        owner = connection.execute(select(parent.c.user_id).where(parent.c.id == ident)).scalar_one_or_none()
        if owner is None:
            conflict()
        owners.add(owner)
    from .coordination import lock_owners
    lock_owners(db, *owners, nowait=True)
    for parent, ident in references:
        if connection.execute(select(parent.c.id).where(parent.c.id == ident)).scalar_one_or_none() is None:
            conflict()


ROOTS = {'wallets', 'categories', 'budgets', 'goals', 'debts', 'notes',
         'note_folders', 'space_members', 'bank_transaction_candidates'}
# Only these parent relationships establish ownership of an otherwise unscoped
# child. A category, posted transaction, or recurring parent never does.
CHILDREN = {
    'transactions': ('wallet_id', 'wallets'),
    'planned_transactions': ('wallet_id', 'wallets'),
    'transaction_receipts': ('transaction_id', 'transactions'),
    'wallet_balance_checks': ('wallet_id', 'wallets'),
    'wallet_shares': ('wallet_id', 'wallets'),
    'bank_source_mappings': ('wallet_id', 'wallets'),
    'note_shares': ('note_id', 'notes'),
    'note_revisions': ('note_id', 'notes'),
    'scheduled_push_outbox': ('plan_id', 'planned_transactions'),
}


def conflict():
    raise HTTPException(409, 'This space has cross-scope or unsupported references. Review its linked records before deleting it.')


def key(table, row):
    return tuple(row[c.name] for c in table.primary_key)


def predicate(table, rows):
    return tuple_(*table.primary_key.columns).in_(list(rows))


def batches(values, size=400):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def deletion_rows(db, space):
    tables = Base.metadata.tables
    selected = {name: {} for name in tables}

    def collect(name, condition):
        table = tables[name]
        for row in db.execute(select(table).where(condition)).mappings():
            selected[name][key(table, row)] = row

    collect('spaces', tables['spaces'].c.id == space.id)
    for name, table in tables.items():
        if 'space_id' not in table.c:
            continue
        if name not in ROOTS:
            if db.execute(select(table).where(table.c.space_id == space.id).limit(1)).first():
                conflict()
            continue
        collect(name, table.c.space_id == space.id)
    for name, (column, parent) in CHILDREN.items():
        if name in tables:
            for batch in batches(r['id'] for r in selected[parent].values()):
                collect(name, tables[name].c[column].in_(batch))
    if 'upcoming_push_receipts' in tables:
        occurrences = [hashlib.sha256(f"{r['id']}:{r['due_at'].isoformat()}".encode()).hexdigest()
                       for r in selected['planned_transactions'].values()]
        for batch in batches(occurrences):
            collect('upcoming_push_receipts', tables['upcoming_push_receipts'].c.occurrence.in_(batch))

    selected_ids = {name: {r['id'] for r in rows.values() if 'id' in r}
                    for name, rows in selected.items()}
    categories = tables['categories']
    # Home Expense's original ledger legitimately uses personal categories.
    # They are referenced by deleted children, never included in deletion.
    personal_categories = set(db.execute(select(categories.c.id).where(
        categories.c.user_id == space.owner_id, categories.c.space_id.is_(None))).scalars())

    # An explicit space/wallet boundary overrides all secondary references.
    for name, rows in selected.items():
        for row in rows.values():
            owner_column = 'owner_id' if name in {'spaces', 'planned_transactions', 'wallet_shares'} else 'user_id'
            if owner_column in row and name != 'bank_transaction_candidates' and name != 'bank_source_mappings':
                if row[owner_column] != space.owner_id:
                    conflict()
            table = tables[name]
            for fk in table.foreign_keys:
                parent = fk.column.table.name
                if parent not in ROOTS | {'spaces', 'transactions', 'planned_transactions'}:
                    continue
                value = row[fk.parent.name]
                if (parent == 'categories' and name in {'transactions', 'planned_transactions'}
                        and value in personal_categories):
                    continue
                if value is not None and value not in selected_ids[parent]:
                    conflict()

    # Inspect *all* registered FKs, including CASCADE and SET NULL, before any
    # deletion. Neither database cascade may silently mutate outside records.
    for table in tables.values():
        for fk in table.foreign_keys:
            parents = selected[fk.column.table.name]
            if not parents:
                continue
            values = {r[fk.column.name] for r in parents.values()}
            for batch in batches(values):
                for row in db.execute(select(table).where(fk.parent.in_(batch))).mappings():
                    if key(table, row) not in selected[table.name]:
                        conflict()
    return selected


def json_references(value, ids):
    """Known typed references in planner archives and assistant action payloads."""
    if isinstance(value, list):
        return any(json_references(item, ids) for item in value)
    if not isinstance(value, dict):
        return False
    for name, item in value.items():
        parent = {'wallet_id': 'wallets', 'transfer_wallet_id': 'wallets',
                  'category_id': 'categories', 'transaction_id': 'transactions',
                  'planned_id': 'planned_transactions', 'folder_id': 'note_folders'}.get(name)
        if parent and isinstance(item, int) and item in ids[parent]:
            return True
        if json_references(item, ids):
            return True
    return False


def cleanup_context(db, space, selected):
    tables = Base.metadata.tables
    ids = {name: {r['id'] for r in rows.values() if 'id' in r} for name, rows in selected.items()}
    settings = tables['settings']
    planner_key = f'cash_flow_space_{space.id}_v1'
    # Other planners must not lose payments, bills, or allocations implicitly.
    for row in db.execute(select(settings).where(settings.c.key.like('cash_flow%'))).mappings():
        if row['user_id'] == space.owner_id and row['key'] == planner_key:
            continue
        try:
            value = json.loads(row['value'])
        except (ValueError, TypeError):
            # Opaque unrelated settings have no provable typed reference. Leave
            # them intact; the owner's backup still validates its own planners.
            continue
        if json_references(value, ids):
            conflict()

    # Conversation history belongs to its author, including shared-wallet users.
    # Detach financial context without widening it to their personal wallets.
    chats = tables.get('ai_chats')
    if chats is not None:
        for batch in batches(ids['wallets']):
            db.execute(update(chats).where(chats.c.wallet_id.in_(batch))
                       .values(wallet_id=None, scope='general'))
    turns = tables.get('ai_turns')
    if turns is not None:
        for batch in batches(ids['notes']):
            db.execute(update(turns).where(turns.c.note_id.in_(batch)).values(note_id=None))
    actions = tables.get('ai_actions')
    if actions is not None:
        kinds = {'transaction': 'transactions', 'budget': 'budgets', 'goal': 'goals', 'debt': 'debts', 'note': 'notes'}
        for row in db.execute(select(actions)).mappings():
            target_ids = ids.get(kinds.get(row['kind']), set())
            referenced = False
            for column in ('payload', 'before'):
                try:
                    referenced |= json_references(json.loads(row[column]), ids)
                except (ValueError, TypeError):
                    # Do not couple deletion to malformed, unrelated history.
                    # Direct target/result IDs below still expire linked rows.
                    continue
            if row['target_id'] in target_ids or row['result_id'] in target_ids or referenced:
                # Keep the audit/history row but make the old action unusable.
                db.execute(update(actions).where(actions.c.id == row['id']).values(
                    target_id=None, result_id=None, payload='{}', before='{}', status='expired'))
    db.execute(delete(settings).where(settings.c.user_id == space.owner_id, settings.c.key == planner_key))


def delete_owned_space(db, space, actor):
    selected = deletion_rows(db, space)
    # The existing full-owner backup includes Spaces, memberships, plans,
    # receipts and planner archives; keep it in this same atomic transaction.
    save_recovery(db, actor, actor, f'Delete space: {space.name}')
    cleanup_context(db, space, selected)
    tables = Base.metadata.tables
    tx = tables['transactions']
    # Self-references are validated above; break only links inside the deletion.
    if selected['transactions']:
        for batch in batches(selected['transactions']):
            db.execute(update(tx).where(predicate(tx, batch)).values(recurring_parent_id=None))
    # Reverse metadata order respects every registered dependency, including
    # restrictive FKs, without relying on database-specific cascade behavior.
    try:
        for table in reversed(Base.metadata.sorted_tables):
            if selected[table.name]:
                for batch in batches(selected[table.name], size=max(1, 800 // len(table.primary_key.columns))):
                    db.execute(delete(table).where(predicate(table, batch)))
    except IntegrityError:
        # Also fail closed for migrated constraints absent from model metadata.
        conflict()
