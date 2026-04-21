---
name: postgres-scaffold
description: Use when implementing or updating database schema. Generates goose migration files and optionally GORM model structs for PostgreSQL tables.
metadata:
  version: "1.0.0"
allowed-tools: Bash(find:*) Bash(ls:*) Bash(date:*) Bash(echo:*) Bash(grep:*) Bash(head:*) Glob Read Write Edit
---

# PostgreSQL Scaffold Rules

Follow these rules when implementing or updating database schema.

## Discover existing layout

Before generating anything, locate migration files and (if GORM) model files:

```!
find . -type d \( -name "migrations" -o -name "migration" \) | grep -v vendor | head -5
```

```!
find . -type d \( -name "models" -o -name "model" -o -name "entity" -o -name "entities" \) | grep -v vendor | head -5
```

Use the paths discovered above throughout this session. If neither is found, ask the user where migrations and models live.

---

## 1. Table naming

- snake_case, always plural: `users`, `order_items`, `refresh_tokens`
- Junction/pivot tables: `<table_a>_<table_b>` alphabetically: `roles_users`

---

## 2. Standard columns

Every table **must** include:

```sql
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at  TIMESTAMPTZ          -- NULL = active; soft-delete sentinel
```

Include `created_by` / `updated_by` whenever the table tracks ownership or user actions:

```sql
created_by  UUID REFERENCES users(id) ON DELETE SET NULL
updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
```

If in doubt, include them — they are cheap to add now and painful to add later.

### Foreign key actions

- Default to `ON DELETE RESTRICT` (PostgreSQL's `NO ACTION` behaves similarly but defers; prefer `RESTRICT` for clarity).
- Use `ON DELETE SET NULL` for optional audit/reference columns (e.g. `created_by`, `updated_by`).
- Never cascade into soft-delete parents — a cascading hard delete bypasses the soft-delete contract.
- Only use `ON DELETE CASCADE` for true parent/child ownership (e.g. `order_items` → `orders`) and flag it to the user before writing.

---

## 3. Primary keys

Default: **UUIDv7**, generated at the database level on PostgreSQL 17+.

```sql
id UUID PRIMARY KEY DEFAULT uuidv7()
```

**Fallbacks (in order):**

1. **PostgreSQL ≤ 16 with `pg_uuidv7` extension** — same syntax, different provider:
   ```sql
   id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
   ```
   The extension must be created before any migration that references it. Add it to a dedicated early migration (e.g. `0001_extensions.sql`):
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
   ```
2. **No extension / Go-side generation** — omit the `DEFAULT`, generate in a `BeforeCreate` hook using `github.com/google/uuid` v1.6+ (`uuid.NewV7()`). See §9 for the hook implementation.
3. **Last resort** — `DEFAULT gen_random_uuid()` (UUIDv4) if none of the above are available.

When the PostgreSQL version is unknown, ask the user before choosing a strategy.

---

## 4. Column conventions

| Pattern | Convention |
|---|---|
| Case | snake_case |
| Booleans | `is_<state>`, `has_<thing>` — e.g. `is_active`, `has_verified_email` |
| Foreign keys | `<referenced_table_singular>_id` — e.g. `user_id`, `order_id` |
| Timestamps | `<event>_at` — e.g. `published_at`, `expires_at` |
| Nullable fields | omit `NOT NULL`; nullable by default in SQL |

---

## 5. Enums

Use PostgreSQL **native enums** via `CREATE TYPE`. Define the type before the table in the same migration.

```sql
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');
```

(Postgres has no `CREATE TYPE ... IF NOT EXISTS` syntax. If re-running a partially-failed migration is a concern, wrap the `CREATE TYPE` in a `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block.)

Reference in the table:

```sql
status order_status NOT NULL DEFAULT 'pending'
```

In Go, map to a typed string:

```go
type OrderStatus string

const (
    OrderStatusPending   OrderStatus = "pending"
    OrderStatusConfirmed OrderStatus = "confirmed"
    OrderStatusShipped   OrderStatus = "shipped"
    OrderStatusDelivered OrderStatus = "delivered"
    OrderStatusCancelled OrderStatus = "cancelled"
)
```

Drop order in `Down`: drop the table first, then the type.

---

## 6. JSONB columns

Use `gorm.io/datatypes`:

- **Known shape** — prefer `datatypes.JSONType[T]` for compile-time safety:
  ```go
  import "gorm.io/datatypes"

  Metadata datatypes.JSONType[ProductMetadata] `gorm:"type:jsonb"`
  ```
- **Schemaless** — use `datatypes.JSON` when the payload shape isn't known ahead of time:
  ```go
  Metadata datatypes.JSON `gorm:"type:jsonb"`
  ```

Raw SQL:

```sql
metadata JSONB
```

Always add a **GIN index** on JSONB columns that will be queried:

```sql
CREATE INDEX idx_products_metadata ON products USING gin(metadata);
```

---

## 7. Indexes

| Scenario | Type |
|---|---|
| Standard equality / range | B-tree (default) |
| JSONB queries | GIN |
| Full-text search | GIN with `to_tsvector` |
| Multi-column frequent queries | Composite B-tree |
| Active rows on soft-delete tables | Partial `WHERE deleted_at IS NULL` on queried columns |

On soft-delete tables, apply the partial predicate to indexes on **columns the application actually queries** (foreign keys, lookup columns). Do not create a partial index on `id` alone — the primary key already covers it.

```sql
CREATE INDEX idx_orders_user_id_active ON orders(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status_active  ON orders(status)  WHERE deleted_at IS NULL;
```

---

## 8. Goose migration files

### Timestamp

Get the current UTC timestamp for the filename:

```!
date -u +%Y%m%d%H%M%S
```

### Filename format

```
<YYYYMMDDHHmmss>_<description>.sql
```

Example: `20240315143022_create_orders.sql`

### File structure

Every file must have both `Up` and `Down` sections. Wrap multi-statement blocks in `StatementBegin` / `StatementEnd`:

```sql
-- +goose Up
-- +goose StatementBegin

CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');

CREATE TABLE orders (
    id          UUID         PRIMARY KEY DEFAULT uuidv7(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status      order_status NOT NULL DEFAULT 'pending',
    metadata    JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_orders_user_id_active ON orders(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status_active  ON orders(status)  WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_metadata       ON orders USING gin(metadata);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS orders;
DROP TYPE  IF EXISTS order_status;

-- +goose StatementEnd
```

Rules:
- `Down` must cleanly reverse `Up`
- Never use `DROP ... CASCADE` without flagging it to the user first
- Drop dependent types **after** tables in `Down`
- For `ALTER TABLE` migrations, reverse each change explicitly in `Down`

---

## 9. GORM model (optional)

Generate a GORM model only when:
- The user explicitly requests it, **or**
- The project already uses GORM (detectable by imports in existing model files)

### Custom base struct

`gorm.Model` uses a `uint` ID — not suitable for UUIDs. Use this custom base instead:

```go
import (
    "time"

    "github.com/google/uuid"
    "gorm.io/gorm"
)

type Base struct {
    ID        uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuidv7()"`
    CreatedAt time.Time      `gorm:"not null;default:now()"`
    UpdatedAt time.Time      `gorm:"not null;default:now()"`
    DeletedAt gorm.DeletedAt `gorm:"index"`
}
```

The `default:uuidv7()` tag delegates generation to PostgreSQL 17+. No `BeforeCreate` hook is needed in this case.

**Fallbacks** — match the strategy chosen in §3:

- **PostgreSQL ≤ 16 with `pg_uuidv7`** — use `default:uuid_generate_v7()` instead:
  ```go
  ID uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v7()"`
  ```
- **Go-side generation** — remove the `default` tag and add a `BeforeCreate` hook:

```go
func (b *Base) BeforeCreate(tx *gorm.DB) error {
    if b.ID == uuid.Nil {
        id, err := uuid.NewV7()
        if err != nil {
            return err
        }
        b.ID = id
    }
    return nil
}
```

When `created_by` / `updated_by` are needed, embed an audit extension:

```go
type AuditBase struct {
    Base
    CreatedBy *uuid.UUID `gorm:"type:uuid"`
    UpdatedBy *uuid.UUID `gorm:"type:uuid"`
}
```

### Struct conventions

- Struct name: PascalCase singular — `Order`, `OrderItem`
- Embed `Base` or `AuditBase`; never repeat the standard fields
- Nullable fields: pointer types — `*string`, `*uuid.UUID`, `*time.Time`
- JSONB: `datatypes.JSON` with `gorm:"type:jsonb"`
- Enums: typed string with `gorm:"type:<pg_type_name>"`
- Foreign key associations: declare both the FK field and the association field. Use `uuid.UUID` when the FK is `NOT NULL`, `*uuid.UUID` when nullable

### Example

```go
type Order struct {
    AuditBase
    UserID   uuid.UUID      `gorm:"type:uuid;not null"`
    User     User           `gorm:"foreignKey:UserID"`
    Status   OrderStatus    `gorm:"type:order_status;not null;default:pending"`
    Metadata datatypes.JSON `gorm:"type:jsonb"`
}
```

---

## 10. Confirm before writing

After designing the schema, pause and show the user:

```
Table:      <table_name>
Operation:  create / alter

Columns:
  <column  type  constraints>
  ...

Indexes:
  <index definitions>
  ...

Migration file:  <path/to/filename.sql>
GORM model:      yes (<path/to/model.go>) / no

Proceed? (yes / edit / cancel)
```

- **yes** — write the file(s)
- **edit** — ask what to change, revise, and show the summary again
- **cancel** — stop without writing anything

Do not write any files until the user explicitly confirms.
