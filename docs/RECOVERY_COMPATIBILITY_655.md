# Legacy Space category recovery

The first live encrypted recovery rehearsal found a real compatibility defect:
some entries created before Spaces still reference an account's personal category
while their wallet now belongs to a Space. Strict archive validation correctly
rejected the mismatched scopes, making those otherwise valid backups unrestorable.

`api/backup_compatibility.py` now normalizes a copy of the archive on export and
before restore validation. For personal categories linked to a declared archived
Space, it reuses an exactly matching category in that Space or copies the same
category metadata with a temporary archive ID. Transactions, planned entries and
Space budgets are remapped to that archive category. Original personal categories
remain present. No live database rows are updated during export.

Transaction amounts, types, dates, descriptions, recurrence and receipt links are
unchanged. Restoration still requires the existing confirmation and replacement
flow. Existing archives are supported; uploading a new backup is not required to
recover an older one. The restore preview explains that category copies can
increase the resulting category count.

This compatibility rule does not accept missing categories, mismatched kinds,
duplicate IDs, a category from another Space, or undeclared destination Spaces.
All strict validation still runs on the normalized archive before replacement.
Budget category workspace checks now also reject cross-Space references.
Post-normalization collection limits remain enforced.
Input sizes are checked before normalization, and equivalent-category matching
uses an index rather than scanning a growing list. The 500-original-category
budget excludes one structurally equivalent personal-category copy per declared
Space; the physical total remains capped at 500 × (50 + 1). This allowance is
derived from category contents, never trusted archive metadata. It supports
reimporting a valid full-budget archive after compatibility copies are added.

The real downloaded archive passed an isolated temporary-SQLite restoration with
matching wallet balances, memberships and note attachment content. The rehearsal
blocked external connections and disposed its temporary database afterward.
Source production financial records were never restored over or rewritten.
Detailed aggregate evidence remains in the local ignored verification directory;
no financial payload, encryption key or identity list is committed here.

Synthetic coverage includes scheduled entries, budget links, category reuse,
non-mutation, idempotent normalization, malformed archives, cross-Space refusal,
and a fresh-account round trip that leaves the source account unchanged.
