# EGOMOT

Business management system. NestJS + Prisma + PostgreSQL API, React + Vite PWA client.

## Status

**Modules 0–7 complete.** Foundation; capital and currency; purchasing and
counterparty payments; receipt, landed cost, LOT/FIFO and warehouses;
customers, pricing, sales, payment and debt; the product catalogue;
reservations and customer advances; inventory and warehouse handover.
646 API tests and 11 client tests passing.

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
| 4.1 Customers, Walk-in, search (§11) | done |
| 4.2 Monthly category recalculation (§12.1) | done |
| 4.3 Pricing engine: base markup × type/category (§13) | done |
| 4.4 Sale flow: customer, goods, payment, confirm (§14) | done |
| 4.5 FIFO simulator and COGS — one code path (§13.3, §18.1.4) | done |
| 4.6 Discount rules and the absolute below-cost block (§13.1–13.6) | done |
| 4.7 Confirm and the conditional PIN (Security) | done |
| 4.8 Mixed payment and change (§15) | done |
| 4.9 Credit control, overdue, OWNER override (§16.1–16.7) | done |
| 4.10 Customer payment and allocation, overpayment → ADV (§16-А) | done |
| 4.11 Mobile-first UI: sale screen, customer card, my sales | done |
| 5.1 Product categories (§12-Б.1) with the warranty default (§36-А.1) | done |
| 5.2 Product card: the rest of §12-Б.1–.8 on the product itself | done |
| 5.3 Alternative names and search across them (§12-Б.2, §12-Б.9.6) | done |
| 5.4 Card view: stock, inbound, FIFO layers, cost, purchase history | done |
| 5.5 Catalogue UI: list, search, card, create/edit, categories | done |
| 6.1 Reservation policy settings (§17.3) | done |
| 6.2 Reservation (RSV): fixed price, expiry, advance requirement | done |
| 6.3 Reserved stock, and the sale that may not touch it (§42.2) | done |
| 6.4 Expiry, cancellation, fulfilment by sale | done |
| 6.5 Advance (ADV): taken, applied to a sale, refunded (§17-А) | done |
| 6.6 Reservation UI: list, create, card with advance and cancel | done |
| 7.1 Inventory (INV): count sheet, LOT-level adjustment (§22) | done |
| 7.2 Shortage by named LOT or FIFO; surplus as its own layer | done |
| 7.3 Full-count schedule and its overdue alert (§22, §39) | done |
| 7.4 Handover act (HND): system-chosen sample, two signatures (§21) | done |
| 7.5 UI: the count sheet and the handover act | done |

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

Module 4 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §13.3: 5×7 000 + 5×7 500, sell 10 → COGS 72 500, two allocation rows, right remainders | `test/fifo-simulation.spec.ts`, `test/sales.spec.ts` |
| 2 | §13.4: below cost is 422 for the salesperson **and** the OWNER; only LSS goes through, with the loss computed | `test/sales.spec.ts` |
| 3 | §16.2/§16.3: limit 100 000, debt 70 000, goods 50 000 → blocked with "pay 20 000 now"; paying it lets the sale through | `test/credit-and-payments.spec.ts` |
| 4 | §16.4: overdue blocks new credit but not a paid sale; the OWNER override is recorded in full | `test/credit-and-payments.spec.ts` |
| 5 | §16-А.1: debts 30 000 + 20 000, payment 40 000 → 30 000 + 10 000, second sale left owing 10 000 | `test/credit-and-payments.spec.ts` |
| 6 | §16-А.5: debt 18 000, payment 20 000 → a 2 000 ACTIVE advance; Walk-in refused | `test/credit-and-payments.spec.ts` |
| 7 | §15.2: total 8 000, cash given 10 000 → change 2 000 and 8 000 into the till | `test/sales.spec.ts` |
| 8 | Two concurrent sales of the last unit → one confirms, no oversell, no negative stock | `test/sales.spec.ts`, `test/fifo-simulation.spec.ts` |
| 9 | §11.1: Walk-in refuses any debt; only Outstanding = 0 confirms | `test/sales.spec.ts` |
| 10 | Conditional PIN: none on an ordinary paid sale; required for a discount, a debt or the threshold; the attempt reaches the Security Log | `test/sales.spec.ts` |
| 11 | §12.1: turnover over the threshold promotes; a manual override is left alone | `test/customers.spec.ts` |

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

Module 5 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §12-Б.7: a product without its own term inherits the category's; its own 0 is a real "no warranty" and does not fall through | `test/product-catalog.spec.ts` |
| 2 | §12-Б.9.6: a search for a word that appears only in an alias finds the product | `test/product-catalog.spec.ts` |
| 3 | §12-Б.1: SKU stays unique; a duplicate category name is refused | `test/product-catalog.spec.ts` |
| 4 | A category with products in it will not be deleted — §36-А.2 judges returns by its term | `test/product-catalog.spec.ts` |
| 5 | §12-Б.4/§12-А.6: DEFECT stock counts as held but never as available, and does not silence a below-minimum warning | `test/product-catalog.spec.ts` |
| 6 | §12-Б.5: the last purchase price is read from the confirmed orders; a draft is not a price | `test/product-catalog.spec.ts` |
| 7 | §12-Б.4: inbound is what is ordered on confirmed orders and not yet received | `test/product-catalog.spec.ts` |
| 8 | §13.3: the card's cost is the oldest layer's — the same figure the sale screen prices from, from one code path | `test/product-catalog.spec.ts`, `test/sales.spec.ts` |
| 9 | §2: only the OWNER writes categories, products and aliases | `test/product-catalog.spec.ts` |
| 10 | §27: every category change reaches the audit log with old and new values | `test/product-catalog.spec.ts` |

Module 6 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §42.2: a confirmed reservation comes off available stock, and another customer's sale of it is refused | `test/reservations.spec.ts` |
| 2 | §17.3: the hold ends the moment it expires — stock is free before the job runs, which then only records EXPIRED | `test/reservations.spec.ts` |
| 3 | §17.3's own example: 20 000 threshold at 20% on a 50 000 reservation → 10 000 required | `test/reservations.spec.ts` |
| 4 | A required advance with no configured percentage is refused, not priced at a guess | `test/reservations.spec.ts` |
| 5 | §17.3: a product that always demands an advance wins over the amount threshold, with its own percentage | `test/reservations.spec.ts` |
| 6 | §17.3: Walk-in cannot reserve or hold an advance; the active-reservation limit holds, and the OWNER passes it only with a reason that reaches the audit log | `test/reservations.spec.ts` |
| 7 | §17.1: the sale charges the price fixed at reservation time, and §13.4 still refuses it if cost has risen above it | `test/reservations.spec.ts` |
| 8 | Two reservations for the last unit: one confirms, one is refused | `test/reservations.spec.ts` |
| 9 | §17-А.1–.3: an advance is cash in and a liability, and it settles the sale before credit is weighed | `test/reservations.spec.ts` |
| 10 | §17-А.4, §35.4: a refund pays the open debt first and only then hands back cash; §35.5 needs a reason for another account; a PIN is always required | `test/reservations.spec.ts` |

Module 7 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §22: a shortage traced to a LOT comes off that LOT at its own landed cost; an untraced one comes off the oldest, FIFO | `test/inventories.spec.ts` |
| 2 | §22: a surplus becomes its own ADJUSTMENT layer at the value the OWNER states, and the confirm refuses until they state it | `test/inventories.spec.ts` |
| 3 | §22: only the OWNER confirms an adjustment, and always with a PIN | `test/inventories.spec.ts` |
| 4 | A count that agrees with the system moves nothing | `test/inventories.spec.ts` |
| 5 | §42.5: an adjustment the warehouse cannot cover is refused and the document stays a draft | `test/inventories.spec.ts` |
| 6 | §22, §39: a warehouse past its schedule raises one alert; an unconfigured schedule raises none | `test/inventories.spec.ts` |
| 7 | §21.1: every A-class product is counted, plus the positions the system picks — never the same product twice | `test/inventories.spec.ts` |
| 8 | §21.1: responsibility moves only when both people have signed | `test/inventories.spec.ts` |
| 9 | §21.1: a handover records its difference and corrects no stock — §22 does that | `test/inventories.spec.ts` |
| 10 | §27.1: neither a confirmed count nor a signed act can be re-typed | `test/inventories.spec.ts` |

### Open questions

- **The A-class list is expressed as categories** (§21.1). §21.1 leaves the
  list to the OWNER and names motors, batteries and controllers — which are
  categories, and Module 5 gave the system categories. So
  `handover.a_class_category_ids` holds category ids. Unset, only the random
  sample is counted; say the word if you would rather flag individual
  products.
- **A handover corrects nothing.** §21.1 has it record a difference; §22 is
  what adjusts stock, and only the OWNER may confirm that. So an act that
  finds two motors missing says so and leaves the books alone until an
  Inventory Adjustment is made.
- **The shortage loss is recorded but not yet reported.** §22 puts it in its
  own line and out of the bonus base; the adjustment writes both figures to
  the audit log with `in_bonus_base: false`, ready for the P&L and bonus
  modules that do not exist yet.
- **An unset reservation policy means "no limit", not a guessed one** (§17.3).
  §17.3 names five parameters and states no numbers — its 20 000 / 20% is
  introduced as an example. So an unset threshold imposes no requirement, an
  unset active-reservation limit imposes none, and an unset percentage refuses
  a reservation that needs an advance rather than inventing a rate. The one
  that deserves the OWNER's attention is
  `reservation.max_no_advance_hours`: §17.3 requires a zero-advance
  reservation to be time-boxed, and while that setting is empty nothing caps
  it.
- **A cancelled reservation refunds the advance in full** (§17.2). The
  cancellation fee is stored as a setting and left unset, which §17.2
  describes as the MVP state: "баштапкы версияда бул параметр өчүк турат,
  бирок архитектура даяр болот".
- **The advance refund posts against the ADV document.** `advance_refund_lines`
  carries no document of its own, so the outgoing movement belongs to the
  advance it reverses — every movement still has a document (§42.3).
- **The card computes the purchase history rather than storing it** (§12-Б.5).
  `db/egomot_schema.sql` has no column for a last purchase price, and adding
  one would be a second copy of what the orders already say. The card reads
  the most recent CONFIRMED order instead. Say so if you want the figure
  frozen on the card at receipt time rather than following the documents.
- **Categories are not seeded.** Naming them is business data, not a rule the
  knowledge base states, so the OWNER enters them. Send a list and it becomes
  a seed step.
- **Product images (§12-Б.1) are not implemented.** The `images` column is
  there, but nothing in the knowledge base says where the files live, and an
  upload endpoint with no storage decision behind it would be a guess.
- **A category is deletable only while empty.** §12-Б says nothing about
  deletion; refusing it while products still inherit the category's warranty
  term (§12-Б.7) is the reading that cannot silently change how a return is
  judged (§36-А.2).
- **A sale's money must land in the salesperson's own account** (§19). A
  company-wide till and another person's till are both refused. §19 describes
  per-seller accounts and per-seller day closes, so this follows; confirm it
  before a shop that shares one till starts using the system.
- **The OWNER's own discount needs no second signature.** §13.5 makes the
  OWNER the approver, so a sale the OWNER prices is treated as approved by
  the person who would approve it. §13.4's below-cost block still refuses
  everyone, OWNER included.
- **A part-paid order's shortage splits by the paid share** — unchanged from
  Module 3, restated here because Module 4's credit checks read the same
  debts.
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
- **A customer's category has no configured GOLD or VIP threshold.** §12
  marks both "кийин такталат", so the monthly job promotes only as far as
  SILVER; a customer who should be GOLD has to be set by hand (§12.1), which
  the system supports and audits.
- **`pricing.markup_matrix_pct` and `credit.category_default_limit_kgs` are
  seeded null.** With no matrix a sale prices at the product's base markup
  alone; with no default limit a customer without an individual limit gets no
  credit at all, rather than unlimited credit. Both need the OWNER's numbers
  before real trading.
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
    migrations/5_sale_payments_and_approval/
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
    categories/             product categories and the warranty
                            default (§12-Б.1, §36-А.1)
    advances/               ADV: taken, applied, refunded (§17-А)
    counterparties/         suppliers and cargo companies
    idempotency/            duplicate-request protection (Connectivity)
    currency/               CEX, the currency FIFO service and the
                            reference rate (§10-А, §10.1)
    claims/                 CLM, compensation, write-off (§8.5, §8.7)
    credit/                 credit limits, overdue, override (§16.1-16.7)
    customer-payments/      PAY and payment allocation (§16-А)
    customers/              customers, Walk-in, categories (§11, §12)
    discrepancies/          DIF and its §8.2-8.3 consequence
    documents/              numbering, status machine, posting registry
    handovers/              HND: the act and its sample (§21)
    inventories/            INV: count and LOT-level adjustment (§22)
    ledgers/                supplier and cargo ledgers (§4.3, §5.2)
    notifications/          in-app alerts and the daily digest (§39)
    products/               Product Master: card, aliases, search (§12-Б)
    purchase-view/          purchase list and card read model (§4.2)
    pricing/                suggested price: base markup × type/category (§13)
    purchases/              PUR and the §6 logistics stages
    receipts/               RCV, landed cost, LOT and FIFO layers (§7, §9, §18.1)
    reservations/           RSV: the hold, its policy and expiry (§17)
    reports/                Cash Flow classification (§3.1.5)
    security/               Security Log
    settings/               global parameters
    sales/                  SAL and LSS: discount rules, FIFO COGS, payment
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
                            transfers, discrepancies, claims, the sale
                            screen, checkout, customers, my sales, the
                            product catalogue and categories, reservations,
                            the count sheet and the handover act
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

## After `git pull`

```bash
npm install        # only when package.json changed
npm run setup      # migrate → generate → seed → build
```

`npm run doctor` says what is wrong when that fails. It reports causes rather
than consequences: an unresolved merge conflict, a missing `.env`, an
ungenerated Prisma client, a database that is not running or not migrated.

`apps/api/prisma/schema.prisma` is generated (`db/README.md`), so a merge
conflict in it is discarded, not resolved by hand:

```bash
git checkout -- apps/api/prisma/schema.prisma
npm run db:pull    # regenerate it from the migrated database
```

Left unresolved, its conflict markers stop `prisma generate`, `@prisma/client`
is never written, and `npm run build` then prints hundreds of type errors that
all have that one cause.

## Running

```bash
npm run dev:api    # API → http://localhost:3000/api
npm run dev:web    # web → http://localhost:5173
```

Every `db:*` script reads the repository-root `.env` and works from any
directory. Where a machine has the two database roles of `docs/INSTALL.md` §3,
they use `MIGRATION_DATABASE_URL` — the owner role — for migrations, and leave
`DATABASE_URL` to the restricted role the application runs as.

| | |
|---|---|
| `npm run doctor` | what is wrong with this working copy |
| `npm run dev:api` | regenerates the client, then starts the API in watch mode |
| `npm run setup` | migrate, generate, seed, build |
| `npm run db:deploy` | apply migrations |
| `npm run db:generate` | regenerate the Prisma client |
| `npm run db:pull` | regenerate `schema.prisma` from the database |
| `npm run db:seed` | bootstrap OWNER, accounts, warehouses, walk-in, settings |
| `npm run db:verify` | reference SQL and migrations still agree |

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
