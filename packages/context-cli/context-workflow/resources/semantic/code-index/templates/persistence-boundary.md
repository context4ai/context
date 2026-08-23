---
id: semantic.code-index.template.persistence-boundary
kind: procedure
media-type: text/markdown
---

# Persistence boundary template

Use for `persistence` when durable state, cache behavior, consistency, or
recovery is part of the confirmed reader goal. This template supplements the
service or runtime that owns the operations; it is not a request to catalog
every model or query.

## Evidence pass

Locate:

- repository/data-access interface and concrete callers;
- datastore, table, collection, keyspace, entity, or file identity when
  source-backed;
- transaction, consistency, cache, lock, idempotency, and concurrency bounds;
- read/write/query families and domain mapping;
- schema/migration authority, versioning, and operational recovery;
- generated models, query helpers, fixtures, and migrations that should remain
  supporting evidence.

## Questions the knowledge must answer

1. Which service or domain operation owns each read or write family?
2. What durable or cached state is addressed?
3. Where are transaction, consistency, locking, and idempotency boundaries?
4. Which schema or migration source is authoritative?
5. What failure, migration, or recovery behavior is maintained?

## Chapter blueprint

```markdown
# <Persistence boundary>
## Owned state and authoritative schema
## Repository or data-access entry
## Callers and operation families
## Transaction, consistency, cache, and locking behavior
## Failure, migration, and recovery boundaries
## Source evidence and excluded query helpers
```

## Granularity and stop conditions

Group operations by owned state and consistency policy. Split only when schema
authority, transaction ownership, datastore, or recovery semantics differ.
Every page must identify real state and caller boundaries with source locators;
a directory or class inventory is not a persistence model.

Revise or stop when the datastore identity or owning operation is unknown,
transaction/consistency behavior would be guessed, or generated bindings and
migrations would dominate reader-facing pages.
