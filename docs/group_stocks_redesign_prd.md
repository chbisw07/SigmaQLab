# Group stocks redesign – baskets & composition modes

## 1. Context

SigmaQLab already has a **StockGroup** / **StockGroupMember** model that
represents a named basket of stocks drawn from the research universe. Today
these groups are used in two main places:

- **Group (portfolio) backtests** – a backtest can target a stock group and
  treat it as the universe of symbols to trade.
- **Portfolios** – a Portfolio can reference a stock group as its universe
  scope (e.g. "group:PF_GRP").

In the current implementation, a stock group is effectively just a **set of
symbols**. Group members do not carry any portfolio-style weights or target
allocations, and backtests/portfolios only need the list of member symbols.

The "re-design of group stocks" extends this into a more expressive **basket**
concept while keeping all existing behaviours working:

- Groups remain the single source of truth for backtest and portfolio universe
  definitions.
- We introduce a simple **composition mode** on the group and optional **target
  fields** on each member.
- Backtests and portfolios continue to treat groups primarily as lists of
  symbols in this sprint; the new fields are plumbed for future use.


## 2. Schema changes

The schema changes are intentionally minimal and backwards-compatible. They
extend the existing `stock_groups` and `stock_group_members` tables.

### 2.1 StockGroup

New fields on the `StockGroup` SQLAlchemy model (`backend/app/models.py`):

```python
class StockGroup(Base):
    __tablename__ = "stock_groups"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)

    # NEW: basket composition metadata
    composition_mode = Column(String, nullable=False, default="weights")
    total_investable_amount = Column(Numeric(20, 4), nullable=True)
```

Notes:

- `composition_mode` is stored as a `String` with values drawn from the set
  `{"weights", "qty", "amount"}`. A small helper enum can be defined in Python:

  ```python
  from enum import Enum

  class GroupCompositionMode(str, Enum):
      WEIGHTS = "weights"
      QTY = "qty"
      AMOUNT = "amount"
  ```

  but the DB column itself is a plain string for simplicity.
- The default is `"weights"` and the column is **NOT NULL**. The migration
  sets this default for all existing rows so legacy groups behave as before.
- `total_investable_amount` is only meaningful when `composition_mode == "amount"`.
  It is nullable and left `NULL` for existing groups and for groups in other
  modes.


### 2.2 StockGroupMember

New fields on the `StockGroupMember` model:

```python
class StockGroupMember(Base):
    __tablename__ = "stock_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("stock_groups.id"), nullable=False)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)

    # NEW: per-member targets
    target_weight_pct = Column(Numeric(10, 4), nullable=True)
    target_qty = Column(Numeric(20, 4), nullable=True)
    target_amount = Column(Numeric(20, 4), nullable=True)
```

Notes:

- All three target fields are **nullable** and are initially `NULL` for all
  existing memberships.
- Precision is chosen so that:
  - weights can be expressed accurately in percentage points with 4 decimals,
  - quantities and amounts can represent reasonably large real-world values.


### 2.3 Migrations

The project already uses a lightweight in-place migration helper
`ensure_meta_schema_migrations()` in `backend/app/database.py`. We extend it
with:

- `ALTER TABLE stocks ADD COLUMN market_cap_crore FLOAT;` (already implemented
  for TradingView imports).
- `ALTER TABLE stock_groups ADD COLUMN composition_mode VARCHAR NOT NULL DEFAULT 'weights';`
- `ALTER TABLE stock_groups ADD COLUMN total_investable_amount NUMERIC(20,4);`
- `ALTER TABLE stock_group_members ADD COLUMN target_weight_pct NUMERIC(10,4);`
- `ALTER TABLE stock_group_members ADD COLUMN target_qty NUMERIC(20,4);`
- `ALTER TABLE stock_group_members ADD COLUMN target_amount NUMERIC(20,4);`

For SQLite, adding a `NOT NULL` column with a `DEFAULT` fills existing rows
with that default, so all legacy groups end up with
`composition_mode = 'weights'`.

No existing columns are dropped or modified; this is a purely additive change.


## 3. Behaviour notes

### 3.1 Composition modes

Each group has exactly one `composition_mode`:

- **weights**
  - Primary field on members: `target_weight_pct` (0–100).
  - Semantics: member-level weight as a percentage of the basket.
  - Other fields (`target_qty`, `target_amount`) are either `NULL` or treated as
    derived/ignored.

- **qty**
  - Primary field: `target_qty`.
  - Semantics: desired quantity per stock when constructing a portfolio.
  - `target_weight_pct`/`target_amount` are secondary.

- **amount**
  - Primary fields:
    - `StockGroup.total_investable_amount`
    - `StockGroupMember.target_amount`
  - Semantics: each member has an absolute target amount in base currency.
  - `target_weight_pct`/`target_qty` may be derived or unused.

In all modes, only the primary target is considered authoritative in this
iteration; the others are optional and will be used by future helpers.


### 3.2 Backwards compatibility

To keep the system stable for existing users:

- All existing groups are migrated with `composition_mode = "weights"` and all
  target fields left `NULL`. This corresponds to the current "simple group"
  behaviour: a basket is just a set of symbols with no explicit weights.
- Group backtests (`backtest_engine` / `backtest_service`) and portfolios
  continue, in this sprint, to treat groups primarily as **lists of symbols**.
  They may read the new fields but must not change their behaviour or test
  expectations yet.
- API schemas are extended in later tasks (S14_G02) to surface the new fields;
  S14_G01 focuses on the persistence layer (models + DB).


### 3.3 Validation and business rules

Validation of the new fields is intentionally **light** in S14_G01:

- The DB layer does not enforce cross-field constraints (e.g. sum of weights
  equals 100). Instead, higher-level services (to be added in S14_G02) will
  provide:
  - helpers to distribute equal weights/qty/amount,
  - normalisation routines for weight and amount,
  - composition-mode-aware validation when updating members.
- Service- and API-level code should:
  - only accept/modify the primary field that matches `composition_mode`,
  - leave other fields untouched or keep them `NULL`.


### 3.4 Future “deployment” concept

The design deliberately keeps room for a future **deployment** layer in which:

- A basket (StockGroup + members) becomes a concrete, time-stamped portfolio
  deployment with:
  - buy date / buy price,
  - invested amount and charges,
  - link to a Portfolio record and/or live account.

This future feature can be modelled as a separate table that references
`stock_groups.id` and captures realised portfolio metadata. The current schema
does not attempt to model deployments and remains lightweight enough for both
research-only baskets and future real portfolios.


## 4. Seed data

To make the new fields easy to exercise in tests and manual UI checks, the
seeding logic (`backend/app/seed.py`) creates three example groups:

- `GRP_WEIGHTS` – Example Weights Basket
  - `composition_mode = "weights"`
  - 3 members with `target_weight_pct` 40, 30, 30.
- `GRP_QTY` – Example Qty Basket
  - `composition_mode = "qty"`
  - 3 members with `target_qty` 10, 20, 30.
- `GRP_AMOUNT` – Example Amount Basket
  - `composition_mode = "amount"`
  - `total_investable_amount = 100000`
  - 3 members with `target_amount` 40000, 30000, 30000.

These groups use synthetic NSE symbols (`GRPWT1`, `GRPQT1`, etc.) so they do
not collide with user data, and they are seeded idempotently alongside the
existing strategy presets.
