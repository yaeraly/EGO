# EGOMOT

Business management system. NestJS + Prisma + PostgreSQL API, React + Vite PWA client.

## Status

**Modules 0–3 complete.** Foundation; capital and currency; purchasing and
counterparty payments; receipt, landed cost, LOT/FIFO and warehouses.
476 API tests and 11 client tests passing.

| Task | State |
|---|---|
| 0.1 Project skeleton + Prisma model from `db/egomot_schema.sql` | done |
| 0.2 Auth, users, PIN | done |
| 0.3 Documents core, numbering, status machine | done |
| 0.4 Payment accounts, transfers (TRN) | done |
| 0.5 Settings, audit log | done |
| 0.6 Business days skeleton (Period Lock) | done |
| 1.1 Capital in (CAP), investors | done |
| 1.2 Withdrawals (WDW) | done |
| 1.3 Currency exchange (CEX) | done |
| 1.4 Currency FIFO service | done |
| 2.1 Product master (minimal), suppliers, cargo companies | done |
| 2.2 Purchase (PUR) — order, lines, CNY totals | done |
| 2.3 Logistics status machine (§6, 16 stages) | done |
| 2.4 Supplier ledger, payable recognition, payment status | done |
| 2.5 Supplier payment (SPY) — currency FIFO, FX result | done |
| 2.6 Cargo payment (CPY) — USD till or som at a stated rate | done |
| 2.7 Alerts (§39, the part Module 2 can observe) | done |
| 2.8 Mobile-first UI: purchase list and card, SPY/CPY, ledgers | done |
| 3.1 Warehouses (§12-А), MAIN and DEFECT seeded | done |
| 3.2 Stock core: FIFO layers, layer stock, movements | done |
| 3.3 Warehouse transfer (TRF), Day Close blocker | done |
| 3.4 Receipt (RCV): lines, expenses, rates | done |
| 3.5 Confirmation blocks (§7, §9.8) | done |
| 3.6 Allocation engine — pure, four bases, §9.9 rounding | done |
| 3.7 Confirm → LOT, FIFO layers, prepayment apply | done |
| 3.8 Discrepancy (DIF) and its §8.2–8.3 consequence | done |
| 3.9 Claim (CLM), compensation, write-off | done |
| 3.10 Mobile-first UI: receipt wizard, stock, DIF, CLM | done |

Module 0 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | Concurrent numbering, zero duplicates | `test/document-numbering.spec.ts` — 100 concurrent creations yield a contiguous 1..100 |
| 2 | CONFIRMED document refuses updates, visible in the audit log | `test/document-status.spec.ts` |
| 3 | TRN moves balance, blocks on insufficient funds, both movements in one transaction | `test/accounts-transfers.spec.ts` |
| 4 | No plaintext PIN in the database or logs | `test/credential-leak.spec.ts` — scans every text/jsonb column plus captured stdout/stderr |
| 5 | No document on a DAY_CLOSED date | `test/business-days.spec.ts` |

Module 1 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | The §10-А.3 example: 10 000×13.00 + 5 000×13.40, pay 12 000 CNY → 156 800.00 KGS | `test/currency-fifo.spec.ts` |
| 2 | A currency till can never go negative | `test/currency-exchange.spec.ts`, including concurrent sales |
| 3 | A withdrawal leaves no trace in P&L expenses | `test/capital-withdrawals.spec.ts` |
| 4 | Reverse CEX computes FX gain and loss | `test/currency-exchange.spec.ts` — gain, loss and break-even |
| 5 | Every amount is Decimal; no float anywhere | `test/decimal-money.spec.ts` — source scan, API boundary, arithmetic |

Module 2 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | A confirmed order books the payable in CNY at the reference rate | `test/supplier-payments.spec.ts` |
| 2 | A payment consumes currency FIFO and records the FX result (§10.2) | `test/supplier-payments.spec.ts` — debt at 13.00 paid from 13.00 + 14.00 layers → −5 000 KGS |
| 3 | Paying more than the debt leaves an advance, not a negative debt (§4.3) | `test/supplier-payments.spec.ts` |
| 4 | Logistics moves one step for staff, any step for the OWNER, audited (§6) | `test/purchases.spec.ts` |
| 5 | A short currency till refuses the payment and says to buy currency first | `test/supplier-payments.spec.ts`, and the UI links straight to CEX |
| 6 | Cargo payment in som records the rate; in USD it uses the FIFO cost (§5.2) | `test/cargo-payments.spec.ts` |

Module 2 also added the payment-status read model (`test/purchase-view.spec.ts`)
and the §39 alerts (`test/notifications.spec.ts`).

Module 3 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §9.9 rounding: 1 000.00 over three equal weights → 333.34 + 333.33 + 333.33; and Σ = Source over 10 000 random weightings | `test/allocation.spec.ts` |
| 2 | §8.1: 100 ordered, 90 arrive → Inventory 90 000, the missing 10 000 stays out of landed cost, DIF raised | `test/receipts.spec.ts`, `test/discrepancies.spec.ts` |
| 3 | §8.2/§8.3: paid → Supplier Receivable; unpaid → the payable shrinks and no receivable is invented | `test/discrepancies.spec.ts` |
| 4 | §9.3, §9.7: two products, 1 400 KGS by weight → 1 000 : 400, and the unit landed cost that follows | `test/receipts.spec.ts` |
| 5 | §9.4: VOLUME with no volume data blocks the receipt, naming the product | `test/receipts.spec.ts` |
| 6 | §8.4: 10 received, 2 damaged → 8 MAIN, 2 DEFECT, one unit cost, DEFECT outside Available | `test/receipts.spec.ts` |
| 7 | §12-А.5: a transfer does not change the layer cost, and a sent transfer blocks the day close | `test/warehouse-transfers.spec.ts` |
| 8 | §4.3: a 2 000 CNY advance against a 5 000 CNY payable leaves 3 000, with the §10.2 result | `test/prepayment-apply.spec.ts` |
| 9 | §42.5: stock never goes negative, and the transaction rolls back whole | `test/stock.spec.ts` |
| 10 | §27.1, §18.1.6.3: a confirmed receipt refuses changes; no endpoint writes a layer cost | `test/receipts.spec.ts`, `test/stock.spec.ts` |

### Open questions

- **A receipt values goods at one blended CNY rate.** §10.1 sets the rate per
  *portion* — paid yuan at what they actually cost, unpaid yuan at the
  reference rate — while the LOT records a single rate and source (§18.1.1).
  The stored rate is the exact weighted average of the two, so the KGS value
  is precisely what §10.1 asks for; the *source* is labelled FACTUAL only when
  every yuan has been paid, REFERENCE otherwise, and the exact split is in the
  Audit Log. If a part-paid order should record both rates separately, that
  needs a schema change.
- **A shortage splits between §8.2 and §8.3 by the order's paid share.**
  §8.3 states the rule in halves — what was paid becomes a receivable, what
  was not reduces the payable — without saying how to divide a part-paid
  order. The paid proportion of that purchase is used, so a half-paid order
  splits a shortage in half. Payments made to the supplier's general debt
  rather than to this order do not count towards it. Worth confirming.
- **Excess is received but not valued** (§8.8): the DIF stays OPEN and the
  extra units do not enter stock, because §8.8 gives no cost rule and says the
  goods enter "per a documented decision". The decision workflow is not built.
- **The payable is recognised in CNY at the reference rate of the day the
  order is confirmed** (§4.2, §10.1), and a later payment's FX result is
  measured against that. The knowledge base states the debt is a yuan debt and
  §10.2 requires an FX result, but does not say which rate anchors it. The
  supplier ledger therefore carries a weighted-average KGS value over the open
  debt, so a fully paid supplier nets to zero on both columns. Worth
  confirming before Module 3 reduces a payable for a short delivery (§8.3).
- **Cargo cost is not recognised in Module 2.** §5.2 recognises it at Receipt,
  which is Module 3, so a CPY made now leaves a positive balance — a deposit
  held with the carrier. The cargo-debt alert therefore stays silent until
  Module 3 lands.
- **A minimal product master** (SKU, name, weight) stands in for §12-Б, which
  is deferred. A purchase line refuses an unknown or retired product.
- **§39 lists thirteen alerts; three are implemented** — supplier debt, cargo
  debt and a currency till below its threshold. The other ten depend on
  modules that do not exist yet and are deliberately not stubbed: an alert
  that never fires reads as covered.
- **GOLD and VIP category thresholds, and the default bonus rate**, are seeded
  as null. §12 marks the first two "кийин такталат" and §23 leaves the rate to
  OWNER configuration, so reading one fails loudly rather than defaulting to
  zero. SILVER is 50 000 per §12.
- **Capital contributed straight into a foreign-currency till builds a FIFO
  layer** at the supplied rate, and the rate is therefore mandatory. §3 allows
  capital in any currency and §10-А.3 requires every unit in a till to have a
  cost basis, but the knowledge base does not join the two explicitly. Worth
  confirming.
- **CEX commission is recorded, not moved.** `given_amount` and
  `received_amount` are what actually left and arrived, so a fee taken off the
  top is already inside them. If a dealer charges the fee separately, this
  needs a third movement.
- **A CEX must have a KGS side.** §10-А.2 defines the document as buying
  currency with KGS or the reverse; a foreign-to-foreign swap has no rate to
  book a layer at and is refused.
- `MBank` and `O!Bank` seed accounts are typed `BANK` rather than `EWALLET`.
- PIN length is assumed to be 4–8 digits (`src/auth/dto/pin.dto.ts`).
- No lockout policy after repeated PIN failures. Failures are logged; nothing
  throttles them.

Working rules live in `CLAUDE.md`; the business rules they defer to are in
`docs/EGOMOT_Knowledge_Base_v2.1.md` (§44: Source of Truth).

## Layout

```
apps/api/                 NestJS + Prisma API
  prisma/
    schema.prisma           generated by `prisma db pull` — never hand-edited
    migrations/0_init/      verbatim copy of db/egomot_schema.sql
    migrations/1_append_only_logs/
    migrations/2_idempotency_keys/
    migrations/3_purchases_and_notifications/
    migrations/4_receipt_items_and_claims/
                            each carries a down.sql alongside migration.sql
    seed.ts                 bootstrap OWNER, accounts, setting keys
  src/
    accounts/               payment accounts, balances, movement posting
    allocation/             the §9.3-9.9 allocation engine (pure)
    audit/                  append-only Audit Log (§27)
    auth/                   login, JWT, PIN
    business-days/          Period Lock
    capital/                CAP, investors (§3)
    cargo-payments/         CPY and the cargo ledger (§5.2)
    common/                 guards, decorators, Decimal and hashing helpers
    counterparties/         suppliers and cargo companies
    idempotency/            duplicate-request protection (Connectivity)
    currency/               CEX, the currency FIFO service and the
                            reference rate (§10-А, §10.1)
    claims/                 CLM, compensation, write-off (§8.5, §8.7)
    discrepancies/          DIF and its §8.2-8.3 consequence
    documents/              numbering, status machine, posting registry
    ledgers/                supplier and cargo ledgers (§4.3, §5.2)
    notifications/          in-app alerts and the daily digest (§39)
    products/               minimal product master
    purchase-view/          purchase list and card read model (§4.2)
    purchases/              PUR and the §6 logistics stages
    receipts/               RCV, landed cost, LOT and FIFO layers (§7, §9, §18.1)
    reports/                Cash Flow classification (§3.1.5)
    security/               Security Log
    settings/               global parameters
    stock/                  the only door into layer_stock (§12-А, §42.4-5)
    supplier-payments/      SPY, FIFO consumption, FX result (§4.3, §10.2)
    transfers/              TRN
    transfers-warehouse/    TRF between warehouses (§12-А.4-5)
    warehouses/             warehouse master data (§12-А.1)
    withdrawals/            WDW (§3.1)
  test/                     integration tests against a real database
apps/web/                 React 19 + Vite 6 PWA, mobile-first (§1)
  src/
    api/                    fetch client and response types
    auth/                   token storage and the current user
    components/             shell, badges, money rendering, till picker
    hooks/                  GET helper, unread-alert poll
    pages/                  login, purchases, counterparties, payments,
                            tills, CEX, alerts, receipt wizard, stock,
                            transfers, discrepancies, claims
  test/                     decimal-string helpers (the only client-side
                            code that looks at money)
db/egomot_schema.sql      the authoritative data model
deploy/                   systemd units and an nginx config
docker-compose.yml        postgres + api + web
scripts/install-ubuntu.sh one-command Ubuntu install
```

## Installing

On Ubuntu, one command from a fresh clone:

```bash
git clone https://github.com/yaeraly/EGO.git egomot
cd egomot
./scripts/install-ubuntu.sh
```

It installs Node 22 and PostgreSQL, creates the two database roles, applies the
migrations, writes a `.env` with generated passwords, seeds the first OWNER, and
builds both apps — then verifies that the application's role is not a superuser
and that `audit_log` is still append-only.

With Docker instead:

```bash
cp .env.example .env      # then set BOOTSTRAP_OWNER_* and JWT_SECRET
docker compose up
docker compose exec api npx prisma db seed
```

**`docs/INSTALL.md`** covers the manual steps, systemd and nginx for
production, backups, upgrades and troubleshooting.

## Running

```bash
npm run dev:api    # API → http://localhost:3000/api
npm run dev:web    # web → http://localhost:5173
```

### Tests

They run against a real database (`egomot_test` by default; override with
`TEST_DATABASE_URL`), created from the same migrations as production.

```bash
createdb egomot_test
npm test          # API integration tests, then the client's unit tests
```

The client's tests need no database — `npm run test -w @egomot/web` on its own
runs them.

`npm run db:verify` builds one database from `db/egomot_schema.sql` and another
from the migrations, then diffs them — the reference SQL and the migrations
must never drift apart.

## Deployment note: the application database user

`audit_log` and `security_log` are append-only, enforced by privileges rather
than by application discipline. Migration `1_append_only_logs` creates the
`egomot_app` role with `SELECT`/`INSERT` on both logs and no `UPDATE`/`DELETE`.

So a deployment uses two roles: an owner that runs migrations and seeds, and a
non-superuser application role that is a member of `egomot_app`:

```sql
GRANT egomot_app TO <application_user>;
```

**The application user must not be a superuser** — superusers bypass every
privilege check, which would make the guarantee decorative. The install script
sets both roles up and refuses to finish if the application role turns out to
be a superuser.

## Conventions

- **Money is never a float.** Amounts and percentages cross the API as decimal
  *strings* and are parsed straight into `Prisma.Decimal`; a JSON number is
  rejected. An ESLint rule blocks `parseFloat`.
- **The SQL leads.** `db/egomot_schema.sql` is the source of truth;
  `schema.prisma` is generated from it. See `db/README.md`.
- **Documents post on confirm.** `DRAFT → CONFIRMED → CANCELLED`, cancel from
  `DRAFT` only. A document type registers a poster with
  `DocumentPostingRegistry`; it runs inside the confirming transaction, so the
  status change and its effects commit together.
- **Balances are sums, never stored totals.** An account row is locked
  `FOR UPDATE` before any movement, so a balance check cannot race the
  movement it authorises.
- **A currency till's KGS value lives in FIFO layers** (§10-А.3), never an
  average. Every unit entering a foreign-currency account creates a layer at
  its rate; every unit leaving consumes the oldest layers and carries their
  rate as its cost basis.
- **Staff are deactivated, never deleted**, so their documents stay
  attributable.
- **Business logic works in Asia/Bishkek; the database stores UTC.** An
  omitted `business_date` defaults to today in Bishkek, and document numbers
  count by the Bishkek creation year.
- **SQL and Prisma live in repositories**, business rules in services,
  controllers thin. Every repository method takes the caller's transaction, so
  the service decides the transaction boundary.
- **Every mutating endpoint accepts an `Idempotency-Key` header.** A repeated
  key replays the first response instead of running again; a failed request
  releases its key so a genuine retry works.
