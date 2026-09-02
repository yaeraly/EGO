# EGOMOT

Business management system. NestJS + Prisma + PostgreSQL API, React + Vite PWA client.

## Status

**Modules 0–21 complete.** Foundation; capital and currency; purchasing and
counterparty payments; receipt, landed cost, LOT/FIFO and warehouses;
customers, pricing, sales, payment and debt; the product catalogue;
reservations and customer advances; inventory and warehouse handover;
returns; defect acts, write-offs and scrap income; operating expenses;
salaries; the seller's bonus; correction and reversal; the daily cash
handover, Day Close and the Period Lock; the three financial statements;
ABC, XYZ, margin and what needs ordering; plans, KPI and the reports by
salesperson and by customer; the OWNER's dashboard; the purchasing
assistant; the business health board; structured compatibility. The system
issues the SKU and the barcode, and a product card carries its photos.
882 API tests and 11 client tests passing.

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
| 8.1 Return (RET) against its sale, partial and full (§35.1, §35.7) | done |
| 8.2 §18.0 restock: original cost, today's date, a new layer | done |
| 8.3 Debt offset, split refund and its source (§35.4, §35.5) | done |
| 8.4 §36-А.2 warranty check on a defect return | done |
| 8.5 UI: pick the sale, the lines and the condition; settle | done |
| 9.1 Defect act (DEF): origin, finding, decision (§36-А.3, §37) | done |
| 9.2 Write-off (WOF) out of DEFECT at each LOT's own cost (§38) | done |
| 9.3 Open supplier claim settles first (§38.2) | done |
| 9.4 Scrap income (OIN) and the net defect loss (§38.7) | done |
| 9.5 UI: the act, the write-off and the metal money | done |
| 10.1 Expense categories with a monthly ceiling (§26) | done |
| 10.2 Expense (EXP): category, account, amount, comment | done |
| 10.3 This month's spend against the ceiling | done |
| 10.4 UI: record an expense, see the month against budget | done |
| 11.1 Salary payment (SLR): the parts and the total (§25) | done |
| 11.2 Paying it: only the net leaves the account | done |
| 11.3 What each employee has been paid for a period | done |
| 11.4 UI: the month, the parts and the payment | done |
| 12.1 Bonus from the margin a confirmed sale earned (§23.1) | done |
| 12.2 Payable once that sale's own money arrives (§23.2) | done |
| 12.3 Paying it (BON); a return reverses or adjusts it (§23.3–23.4) | done |
| 12.4 UI: what each seller has earned, and the payment | done |
| 13.1 Correction/Reversal (COR): the record §27.1 asks for | done |
| 13.2 Reversing a document's money movements, guarded | done |
| 13.3 The one document a closed period accepts (Period Lock) | done |
| 13.4 UI: pick the document, state the reason, the OWNER's PIN | done |
| 14.1 The salesperson's day, and handing the till over (§20) | done |
| 14.2 Day Close Pre-check: unresolved documents and unhanded tills | done |
| 14.3 Day Close, Month Close and Period Reopen (Period Lock) | done |
| 14.4 UI: my day, what is blocking, and closing it | done |
| 15.1 ОПУ / Profit and Loss (§28, §3.1.5, §42.8) | done |
| 15.2 ДДС / Cash Flow, split by kind of flow (§28) | done |
| 15.3 Баланс, with the check that it holds together (§28, §17-А.5) | done |
| 15.4 UI: the three statements on one screen | done |
| 16.1 ABC, XYZ and margin per product (§29) | done |
| 16.2 Sales by day, week and month (§29) | done |
| 16.3 What needs ordering (§29, §12-Б.4) | done |
| 16.4 UI: the three analyses on one screen | done |
| 17.1 Monthly plans per person and for the business (§24) | done |
| 17.2 By salesperson: result, plan, bonus and till (§31) | done |
| 17.3 By customer, and who has stopped coming (§30) | done |
| 17.4 UI: sellers, customers and the plan on one screen | done |
| 18.1 The OWNER's one screen, assembled from the reports (§32) | done |
| 18.2 UI: the dashboard, and the OWNER lands on it | done |
| 19.1 What to order and how much, from measured figures (§33) | done |
| 19.2 Priority, estimated cost and what the yuan till holds (§33) | done |
| 19.3 UI: change the suggestion and turn it into an order (§33) | done |
| 20.1 The daily list of what needs doing (§34) | done |
| 20.2 UI: the board, ordered by how pressing each item is | done |
| 21.1 Vehicle models, and a part linked to many of them (§12-Б.8) | done |
| 21.2 VERIFIED / UNVERIFIED, with who checked and when | done |
| 21.3 Finding the parts for a model, checked ones only if wanted | done |
| 21.4 UI: the model list, the filter, and the panel on the product card | done |
| — The system issues the SKU and the barcode (§12-Б.9.1) | done |
| — Product photos in the database, with the card and the form to manage them (§12-Б.1) | done |

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

Module 8 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §35.1: a return names its sale, and a line not on that sale is refused | `test/returns.spec.ts` |
| 2 | §35.7: never more than was sold, counting what already came back | `test/returns.spec.ts` |
| 3 | §18.0: the goods return at the cost they left at, as a new layer dated today; the old LOT is not refilled and a later, dearer batch changes nothing | `test/returns.spec.ts` |
| 4 | §42.12: a defective item goes to DEFECT, never back to MAIN | `test/returns.spec.ts` |
| 5 | §35.4: the open debt is settled first and only the remainder is paid out — 1 500 returned against a 1 000 debt leaves 350 in cash | `test/returns.spec.ts` |
| 6 | §35.5: the account that was paid needs no reason; another account does, and the line records it | `test/returns.spec.ts` |
| 7 | §35.6, §42.5: a till that cannot cover the refund refuses, and the document stays a draft | `test/returns.spec.ts` |
| 8 | A return always takes a PIN | `test/returns.spec.ts` |
| 9 | §36-А.2: inside the warranty a defect return is ordinary; past it a salesperson cannot confirm at all and the OWNER only with a reason, which is stored | `test/returns.spec.ts` |
| 10 | §35.8, §35.1.2: revenue and COGS reversed are recorded and the sale line marks what came back, while the sale itself is untouched | `test/returns.spec.ts` |

Module 9 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §37: an act records its origin — a return or a receiving discrepancy — and one with neither is refused | `test/defects-writeoffs.spec.ts` |
| 2 | §37: an act with no decision does not confirm; the four decisions are the ones the schema names | `test/defects-writeoffs.spec.ts` |
| 3 | §38.4: goods leave DEFECT, and a write-off pointed at MAIN is refused | `test/defects-writeoffs.spec.ts` |
| 4 | §38: each line is written off at its own LOT's landed cost | `test/defects-writeoffs.spec.ts` |
| 5 | A write-off always takes a PIN | `test/defects-writeoffs.spec.ts` |
| 6 | §42.5: more than the defect warehouse holds is refused | `test/defects-writeoffs.spec.ts` |
| 7 | §38.2: an open supplier claim over the same product blocks the write-off, and settling it unblocks it | `test/defects-writeoffs.spec.ts` |
| 8 | §38.7: the scrap money is a document of its own, in the till, against the write-off it came from | `test/defects-writeoffs.spec.ts` |
| 9 | §38: net defect loss = written-off cost − scrap income (7 000 − 1 200 = 5 800) | `test/defects-writeoffs.spec.ts` |
| 10 | §38: neither the loss nor the scrap income enters a bonus base | `test/defects-writeoffs.spec.ts` |

Module 10 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §2, §26: only the OWNER maintains the categories; everyone reads them | `test/expenses.spec.ts` |
| 2 | A duplicate category name and a negative budget are refused | `test/expenses.spec.ts` |
| 3 | §26: a confirmed expense takes the money out of the account it names, with its comment on the audit entry | `test/expenses.spec.ts` |
| 4 | §42.5: an expense larger than the till holds is refused and the document stays a draft | `test/expenses.spec.ts` |
| 5 | Category, comment and a positive amount are all required | `test/expenses.spec.ts` |
| 6 | §3.1.5–6: an expense is an operating flow; an owner withdrawal never is | `test/expenses.spec.ts` |
| 7 | §26: the monthly ceiling reports and never blocks — an expense over it is recorded, flagged and paid | `test/expenses.spec.ts` |
| 8 | The month counts confirmed documents only; a draft is a plan, not a cost | `test/expenses.spec.ts` |
| 9 | A category with no ceiling reports no remainder and is never over budget | `test/expenses.spec.ts` |

Module 11 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §25: total = base + bonus − advance − deduction, computed and never typed in | `test/salaries.spec.ts` |
| 2 | §25: the employee's own base salary applies when the month states none | `test/salaries.spec.ts` |
| 3 | Only the net leaves the account, so an advance is not handed over twice | `test/salaries.spec.ts` |
| 4 | A month with nothing left to pay is refused, and so is a negative part | `test/salaries.spec.ts` |
| 5 | §42.5: a salary larger than the till holds is refused and the document stays a draft | `test/salaries.spec.ts` |
| 6 | Salaries are paid in som; another currency is refused | `test/salaries.spec.ts` |
| 7 | §2: the whole module is the OWNER's — reading it and making one both | `test/salaries.spec.ts` |
| 8 | §3.1.6: a salary is an operating expense; an owner withdrawal never is | `test/salaries.spec.ts` |
| 9 | §25: the period summary adds up confirmed payments and counts them | `test/salaries.spec.ts` |
| 10 | A draft salary counts for nothing | `test/salaries.spec.ts` |

Module 12 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §23: base = revenue − FIFO COGS, bonus = base × rate (100 000 − 70 000 at 10% → 3 000) | `test/bonuses.spec.ts` |
| 2 | §23.1: the sale's own revenue, cost and rate are recorded at confirmation and never recomputed later | `test/bonuses.spec.ts` |
| 3 | §13.6: a loss sale earns no bonus base at all | `test/bonuses.spec.ts` |
| 4 | §23.2: CALCULATED while that sale is owed, PAYABLE once it is settled — another sale's debt holds nothing back | `test/bonuses.spec.ts` |
| 5 | §23.2: a sale paid at the counter is payable straight away | `test/bonuses.spec.ts` |
| 6 | §23.4: a return reduces an unpaid bonus, and reverses it when everything comes back | `test/bonuses.spec.ts` |
| 7 | §23.4: a bonus already paid is kept, and the difference is carried as an adjustment | `test/bonuses.spec.ts` |
| 8 | §23.3: BON takes the money out of the account it names and marks the bonuses paid, oldest first | `test/bonuses.spec.ts` |
| 9 | More than is payable is refused, and so is a payment when nothing is | `test/bonuses.spec.ts` |
| 10 | §2: the whole module is the OWNER's — reading it and paying it both | `test/bonuses.spec.ts` |
| 11 | §3.1.5: BON is an operating flow, like the salary it accompanies | `test/bonuses.spec.ts` |
| 12 | §23.5: a later exchange-rate move leaves a recorded bonus alone | `test/bonuses.spec.ts` |

Module 13 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §27.1: a confirmed document is reversed by a COR, never edited — the original keeps its status, its movements and its place in history | `test/corrections.spec.ts` |
| 2 | §42.3: the reversal is the correction's own movements, the exact inverse of the original's | `test/corrections.spec.ts` |
| 3 | Both sides of a two-account document come back (§19) | `test/corrections.spec.ts` |
| 4 | §42.5: a reversal the till can no longer afford is refused and the correction stays a draft | `test/corrections.spec.ts` |
| 5 | §27.1, §35: a sale is sent to the return process by name, not half-reversed | `test/corrections.spec.ts` |
| 6 | A document that moved stock, or built a currency rate layer, is refused with the reason | `test/corrections.spec.ts` |
| 7 | A draft needs no correction, and no document is corrected twice | `test/corrections.spec.ts` |
| 8 | §2, §27.1: raising one and confirming one are both the OWNER's, and always take a PIN — the generic confirm endpoint is not a way around it | `test/corrections.spec.ts` |
| 9 | §27.1: the reason is mandatory and cannot be a shrug | `test/corrections.spec.ts` |
| 10 | Period Lock: the record carries the original, the reason, the old and the new value, and the balances either side | `test/corrections.spec.ts` |
| 11 | §27: an append-only audit entry accompanies every posted correction | `test/corrections.spec.ts` |
| 12 | Period Lock: a closed day and a closed month both refuse every document except this one | `test/corrections.spec.ts` |
| 13 | Period Lock: the period it belongs to and the moment it was entered are kept apart (31 Aug closed, error found 2 Sep) | `test/corrections.spec.ts` |
| 14 | §28: a correction takes the Cash Flow category of the document it reverses, never one of its own | `test/corrections.spec.ts` |

Module 14 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §20: the day shows what the system says was taken — sales, credit, returns, advances, and every account of that person | `test/day-close.spec.ts` |
| 2 | §2: each person sees their own day; the OWNER may look at anyone's | `test/day-close.spec.ts` |
| 3 | §19, §20: the till is handed over by TRN, and the comparison is recorded with it in one transaction | `test/day-close.spec.ts` |
| 4 | §20: a difference without a reason is refused; with one it is recorded, and the money stays visible in the till | `test/day-close.spec.ts` |
| 5 | §20: the day becomes CASH_HANDED once nobody who worked it is still holding money | `test/day-close.spec.ts` |
| 6 | Once a day, from your own cash account, to a central account (§19) | `test/day-close.spec.ts` |
| 7 | Period Lock: the pre-check names the unfinished documents rather than counting them, and the salesperson can read it | `test/day-close.spec.ts` |
| 8 | Period Lock: an unresolved document blocks the close — "OWNER да bypass кыла албайт" | `test/day-close.spec.ts` |
| 9 | Period Lock: an unhanded till blocks the close, and says whose | `test/day-close.spec.ts` |
| 10 | §20: closing is the OWNER's and always takes a PIN; the close is audited | `test/day-close.spec.ts` |
| 11 | Period Lock: a closed day refuses every ordinary document, a second close, and a handover (§20 — no TRN into a closed day) | `test/day-close.spec.ts` |
| 12 | Period Lock: a month waits for every one of its days, then locks the whole month | `test/day-close.spec.ts` |
| 13 | Period Reopen: OWNER, PIN and a real reason, kept in the audit log; a month never closed cannot be reopened | `test/day-close.spec.ts` |

Module 15 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §13.3, §35: profit is revenue less what came back, less the FIFO cost of what stayed sold | `test/reports.spec.ts` |
| 2 | §17-А.5: a customer advance is a liability and is never netted against what customers owe | `test/reports.spec.ts` |
| 3 | §27, §42.3: a balance that does not hold reports its difference rather than absorbing it | `test/reports.spec.ts` |
| 4 | §3.1.1, §3.1.6: an owner withdrawal changes no profit figure, and is stated as excluded rather than dropped | `test/reports.spec.ts` |
| 5 | §35, §18.0: a return comes off the revenue and the cost together | `test/reports.spec.ts` |
| 6 | §27.1: an expense a correction reversed is no longer an expense — while both its movements still stand in the Cash Flow | `test/reports.spec.ts` |
| 7 | §22: a stock shortage is a line of its own, not part of the cost of goods sold | `test/reports.spec.ts` |
| 8 | §28, §19: the Cash Flow separates operating from capital, and an internal transfer changes no total | `test/reports.spec.ts` |
| 9 | §3.1.5: a withdrawal is cash out in the Cash Flow and never an operating outflow | `test/reports.spec.ts` |
| 10 | §10: a foreign account is valued at the rate that applied when the money moved, not today's | `test/reports.spec.ts` |
| 11 | A period opens where the one before it closed | `test/reports.spec.ts` |
| 12 | §28, §12-А: the sellable shelf and the defect shelf are separate lines and a total | `test/reports.spec.ts` |
| 13 | The balance holds through a real purchase, receipt, sale and withdrawal — difference 0.00 | `test/reports.spec.ts` |
| 14 | Retained earnings are the profit since the first document, computed, not stored | `test/reports.spec.ts` |
| 15 | §2: the financial picture is the OWNER's | `test/reports.spec.ts` |

Module 16 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §29: products rank by what they brought in, and each takes the class its running share falls into | `test/analytics.spec.ts` |
| 2 | The ranking is by value, whatever order the rows arrive in; a product that earned nothing is C | `test/analytics.spec.ts` |
| 3 | §29: XYZ measures how far demand moves from its own average, in percent | `test/analytics.spec.ts` |
| 4 | One period is not evidence of steadiness — XYZ is left unset rather than guessed | `test/analytics.spec.ts` |
| 5 | Margin is a share of what was charged, not of cost; zero revenue has no margin percentage | `test/analytics.spec.ts` |
| 6 | §35.7: a returned unit is counted as never sold, in the quantity, the revenue and the cost | `test/analytics.spec.ts` |
| 7 | The cut-offs used are reported with the figures, and the OWNER's settings override them | `test/analytics.spec.ts` |
| 8 | §29: sales add up by day, by week and by month; an unknown bucket falls back to days | `test/analytics.spec.ts` |
| 9 | §12-Б.4: a product below its minimum or at its reorder point is listed, a well-stocked one is not | `test/analytics.spec.ts` |
| 10 | §17: reserved goods count as gone — the list works on available stock | `test/analytics.spec.ts` |
| 11 | §12-Б.4: what is already on its way is shown, not subtracted | `test/analytics.spec.ts` |
| 12 | §2: the analyses are the OWNER's | `test/analytics.spec.ts` |

Module 17 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §24: achievement is a percentage of a target, and there is none without a target | `test/performance.spec.ts` |
| 2 | §31: the average sale exists only when something was sold | `test/performance.spec.ts` |
| 3 | §30: purchase frequency is the span between the first and last purchase over the gaps; one purchase has none | `test/performance.spec.ts` |
| 4 | §24: the plan is the OWNER's, for one person or for the business as a whole | `test/performance.spec.ts` |
| 5 | A month's plan is replaced, not duplicated, and both the setting and the change are audited | `test/performance.spec.ts` |
| 6 | A plan with no target in it is refused; a plan can be withdrawn | `test/performance.spec.ts` |
| 7 | §31: sales, margin, margin share and average sale per salesperson | `test/performance.spec.ts` |
| 8 | §16, §31: credit sales are counted and what is owed on them is stated | `test/performance.spec.ts` |
| 9 | §24: a new customer counts for whoever first sold to them, once; Walk-in is never new (§11.1) | `test/performance.spec.ts` |
| 10 | §24: the plan sits beside the result, per person and for the business; an unset target shows no percentage | `test/performance.spec.ts` |
| 11 | §19, §23, §31: each salesperson's own tills and their bonus by status | `test/performance.spec.ts` |
| 12 | §30: what a customer bought, earned and still owes; the Walk-in row is not a customer | `test/performance.spec.ts` |
| 13 | §30: who brought the most money and who brought the most margin, ranked apart | `test/performance.spec.ts` |
| 14 | §17, §30: how each customer's reservations ended | `test/performance.spec.ts` |
| 15 | §30: customers who used to buy and have stopped — a one-time buyer is not one of them | `test/performance.spec.ts` |
| 16 | §2: both reports are the OWNER's | `test/performance.spec.ts` |

Module 18 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | An empty business reads as empty — no invented figures, and no percentage without a plan | `test/dashboard.spec.ts` |
| 2 | §32: today's and this month's sales and profit | `test/dashboard.spec.ts` |
| 3 | §28: the dashboard agrees with the Profit and Loss it summarises, to the kopeck | `test/dashboard.spec.ts` |
| 4 | §32, §19: cash by currency, and what is still in the salespeople's tills | `test/dashboard.spec.ts` |
| 5 | §16.4: what customers owe, and how much of it is already late | `test/dashboard.spec.ts` |
| 6 | §17-А.5: a customer advance is held apart from what customers owe | `test/dashboard.spec.ts` |
| 7 | §4, §5.2: the China debt in yuan and in som, the carrier's in dollars | `test/dashboard.spec.ts` |
| 8 | §12-А: the sellable shelf and the defect shelf, apart and together | `test/dashboard.spec.ts` |
| 9 | §29: what has run low, with what is already on its way | `test/dashboard.spec.ts` |
| 10 | §32: what sold most and what earned most, ranked apart | `test/dashboard.spec.ts` |
| 11 | §24, §31: the salespeople against their plan, and the business against its own | `test/dashboard.spec.ts` |
| 12 | §2, §32: the dashboard is the OWNER's | `test/dashboard.spec.ts` |

Module 19 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §33's own example: 12 on the shelf, 18 a month, 30 days out → the shortfall over the horizon | `test/purchase-advice.spec.ts` |
| 2 | §12-Б.4: what is already on its way is not ordered twice | `test/purchase-advice.spec.ts` |
| 3 | §17: a reservation is demand already asked for, not stock on hand | `test/purchase-advice.spec.ts` |
| 4 | Never a negative order; whole units, rounded up | `test/purchase-advice.spec.ts` |
| 5 | §12-Б.4: a slow month never argues away the OWNER's minimum | `test/purchase-advice.spec.ts` |
| 6 | Stock that never sells has no cover period — it has a different problem | `test/purchase-advice.spec.ts` |
| 7 | §33: urgent means it runs out before an order could arrive; what earns most breaks ties | `test/purchase-advice.spec.ts` |
| 8 | The lead time is unknown until something has arrived — it is never guessed | `test/purchase-advice.spec.ts` |
| 9 | The OWNER's figure stands in until a first batch has been timed | `test/purchase-advice.spec.ts` |
| 10 | §6, §7: the lead time is measured from the order to its receipt | `test/purchase-advice.spec.ts` |
| 11 | §33: the suggestion covers the wait plus the cover period, and says so in words | `test/purchase-advice.spec.ts` |
| 12 | What is already covered is held back, with the reason written out | `test/purchase-advice.spec.ts` |
| 13 | §33: the order is priced in yuan and weighed against the yuan till | `test/purchase-advice.spec.ts` |
| 14 | §29: the ABC and XYZ classes travel onto the line | `test/purchase-advice.spec.ts` |
| 15 | §2: the assistant is the OWNER's | `test/purchase-advice.spec.ts` |

Module 20 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §34: how far through the month the business is — what "behind" is measured against | `test/health.spec.ts` |
| 2 | §24: a salesperson is behind only once the month has run further than their sales; no plan means no verdict, and neither does the first week | `test/health.spec.ts` |
| 3 | §8.5: an open claim grows louder the longer it stands | `test/health.spec.ts` |
| 4 | §34: idle stock is measured in money, not in pieces | `test/health.spec.ts` |
| 5 | A business with nothing wrong is told so, rather than shown filler | `test/health.spec.ts` |
| 6 | §16.4: the late debts are named, with who owes them | `test/health.spec.ts` |
| 7 | §34: stock that has stopped moving is named with what it is worth; stock still moving is left alone | `test/health.spec.ts` |
| 8 | §8.5: a claim that has stood two months asks to be chased | `test/health.spec.ts` |
| 9 | §24, §34: who is behind their plan, and by how many points | `test/health.spec.ts` |
| 10 | §20: a cash count that did not match is raised, with whose and when | `test/health.spec.ts` |
| 11 | §27, §42.3: a balance that does not hold is the most pressing thing on the board | `test/health.spec.ts` |
| 12 | Most pressing first, each counted, and every item says where to go | `test/health.spec.ts` |
| 13 | §2, §34: the board is the OWNER's | `test/health.spec.ts` |

Module 21 acceptance criteria:

| # | Criterion | Covered by |
|---|---|---|
| 1 | §12-Б.8: the model list is the OWNER's to keep and everyone's to read | `test/compatibility.spec.ts` |
| 2 | A model may have no brand; the same name twice is refused, the same name under a brand is not | `test/compatibility.spec.ts` |
| 3 | A model is archived rather than deleted, and archived ones are hidden by default | `test/compatibility.spec.ts` |
| 4 | §12-Б.8: anyone may record that a part fits, and it starts UNVERIFIED | `test/compatibility.spec.ts` |
| 5 | The same pair is recorded once; an archived or unknown model is refused | `test/compatibility.spec.ts` |
| 6 | Every model a part is recorded against is listed, and a link can be withdrawn — on the record (§27) | `test/compatibility.spec.ts` |
| 7 | §12-Б.8: VERIFIED is the OWNER's alone, and keeps who gave it and when | `test/compatibility.spec.ts` |
| 8 | Taking the mark back forgets who had checked it | `test/compatibility.spec.ts` |
| 9 | Each model counts what is recorded against it and what is checked | `test/compatibility.spec.ts` |
| 10 | §12-Б.8: the catalogue narrows to one model, and again to what is checked | `test/compatibility.spec.ts` |
| 11 | §12-Б.9.6: the free-text search still finds a part by the words people type | `test/compatibility.spec.ts` |
| 12 | §12-Б.8: the MVP's `compatibility_notes` field stays exactly where it was | `test/compatibility.spec.ts` |

Product photo acceptance criteria (§12-Б.1):

| # | Criterion | Covered by |
|---|---|---|
| 1 | A photo is stored, listed and served back, re-encoded rather than copied | `test/product-images.spec.ts` |
| 2 | The bytes are in the database, so a `pg_dump` carries them | `test/product-images.spec.ts` |
| 3 | A picture bigger than the catalogue needs is shrunk on the way in | `test/product-images.spec.ts` |
| 4 | A file that is not an image is refused, and so is an upload with no file | `test/product-images.spec.ts` |
| 5 | A file far too big to be a photo is refused before anything decodes it | `test/product-images.spec.ts` |
| 6 | §2: adding, ordering and removing are the OWNER's; everyone reads | `test/product-images.spec.ts` |
| 7 | Eight pictures is the limit for one product | `test/product-images.spec.ts` |
| 8 | The main photo is chosen by moving one to the front, losing nothing | `test/product-images.spec.ts` |
| 9 | Removing takes the bytes out of the database with the row | `test/product-images.spec.ts` |
| 10 | One product cannot serve another product's photo | `test/product-images.spec.ts` |
| 11 | §26: who added and who removed a picture is in the audit log | `test/product-images.spec.ts` |

A product's photos are the OWNER's to add, and that is settled: §12-Б.1 asks
the card to carry a picture of the part without saying who puts it there, and
the OWNER has decided the photos follow the rest of the product card, which is
reference data the OWNER keeps (§2).

### Open questions

- **A second salary payment in the same month is allowed** (§25). §25 asks for
  the history to be kept and says nothing about one payment a month, and
  settling part early is an ordinary way to pay. So nothing is blocked; the
  screen shows what has already been paid for that month, with the count, so
  a double payment is obvious before it is made. Say the word if you want it
  refused outright.
- **The salary's `bonus_amount` is still typed in, and §23 is now what tells
  you the figure.** The two documents stay apart on purpose: BON pays the
  bonus and is a document of its own (§23.3), so posting the same money again
  inside SLR would pay it twice. The bonus screen shows what is payable per
  employee; the OWNER decides whether to hand it over as BON or to carry it
  into that month's salary.
- **Recording a fit is everyone's; confirming it is the OWNER's.** §12-Б.8
  asks for the VERIFIED/UNVERIFIED status and does not say who sets it. The
  person at the counter is who finds out what actually fits, and making them
  wait for the OWNER to write it down would lose the knowledge — so anyone may
  record a link, and it is UNVERIFIED until checked. VERIFIED is the shop's
  word to a customer, so it is the OWNER's to give, and the link keeps who
  gave it and when. Say the word if a senior salesperson should be able to
  verify too.
- **The structured links do not replace the MVP's notes field.** §12-Б.8 keeps
  `compatibility_notes` as free text in the search (§12-Б.9.6), and it is
  untouched: a note somebody typed and a link somebody checked are different
  things, and the search reads both.
- **A vehicle model is a brand and a name, and nothing else.** §12-Б.8 asks
  for the many-to-many link, the status and the filter, and describes no
  further attributes — no year ranges, no engine sizes — so none are invented.
  The brand is optional, because plenty of tricycles arrive without one.
- **The health board reads on demand; §39's alerts push.** §34 asks for a
  daily list of what needs attention and §39 for automatic warnings. They
  overlap in subject and differ in kind, so the board raises no notifications:
  two systems saying the same sentence would teach the OWNER to ignore both.
  The board is the fuller picture — it also carries idle stock, plan pace and
  the balance check, which §39 does not list.
- **"Behind plan" is measured against elapsed time.** §34 asks which
  salesperson has fallen behind and does not say behind what pace. A monthly
  target implies the month's own pace, so a seller at 30% on the fifteenth is
  twenty points behind. Nobody is judged in the first fifth of the month —
  saying so on the second morning would teach the OWNER to skip the board.
- **When stock counts as standing still, and when a claim is stale, are
  yours.** §34 names both and gives no figures. `health.dead_stock_days` is
  seeded at 90, `health.claim_stale_days` at 30 (twice that and it is
  urgent), and `health.dead_stock_urgent_kgs` at 50 000 — the point where
  idle stock is worth raising a voice about rather than noting.
- **The assistant suggests; it does not forecast.** §33 lists seasonality
  among its inputs, and seasonality needs years of history and a stated
  method. With months of trading, a seasonal factor would be noise dressed up
  as knowledge, so there is none. Everything the assistant does use is
  measured from documents, and the reason for every line is printed beside it
  so the arithmetic can be checked on paper. When there are two or three years
  of sales, tell me how you want the season handled and it can be added.
- **The lead time is measured from the order to its receipt, not from the
  logistics stages.** §6 records a date against each of the sixteen stages,
  but a person moves those by hand and one nobody remembered to click would
  silently lengthen every future suggestion. A confirmed receipt is the day
  the goods were really there (§7). The median of past deliveries is used, so
  one batch stuck in customs does not decide today's order. Until a first
  batch has been received the assistant says the lead time is unknown, or
  uses `purchase.fallback_lead_days` if you set one — it never invents a
  number. Note that a measured zero is reported as measured: if your history
  was entered with the order and the receipt on the same day, the figure will
  read 0 and the batch count beside it is how you can tell.
- **How far back to look, and how long an order should last, are yours.**
  §33 names neither. `purchase.velocity_window_days` is seeded at 90 — a
  quarter of trading — and `purchase.cover_days` at 60. Set the cover period
  to how often you want to be placing orders.
- **A product nobody has ordered yet still has somewhere to order from.** The
  supplier of the last order decides it, and failing that the product card's
  main supplier (§12-Б.5). With neither, the line is shown with its quantity
  but no order can be raised from it, and the screen says so.
- **The dashboard recalculates nothing.** Every figure comes from the service
  that owns it — the statements for money earned, the analyses for products,
  the credit module for what is overdue — so a summary can never disagree with
  the report it summarises. A test checks that today's revenue and profit
  match the Profit and Loss to the kopeck, because the day they diverge is the
  day nobody knows which to believe.
- **The money "with the salespeople" excludes the OWNER's own till.** §32 asks
  what is still in the sellers' accounts, which is money waiting to be handed
  in (§19, §20). The OWNER's own till is already theirs. This is the same line
  drawn in the Day Close pre-check.
- **The OWNER lands on the dashboard, everyone else on the counter.** §32 says
  the OWNER should see the state of the business on one screen when they log
  in; §1 asks the selling screen to be the fastest thing in the system for
  everyone else.
- **A plan is monthly, and the report reads the month the period ends in.**
  §24 says "айлык/мезгилдик план" without defining the period, so the plan
  carries a year and a month — the same shape as a salary period (§25). A
  report run across several months therefore shows the last month's target
  beside the whole period's result, which would misread; the screen defaults
  to the current month for that reason. Tell me if you want plans over
  arbitrary ranges instead.
- **A new customer counts for the salesperson who first sold to them.** §24
  lists "жаңы кардарлар" as something a seller is measured on but does not say
  who gets the credit when several people serve the same customer. The first
  confirmed sale in that customer's whole history decides it, and only once —
  a second sale to the same person is not a second new customer. The Walk-in
  row is never new: it stands for everyone unregistered (§11.1).
- **"Previously active" means at least two purchases.** §30 asks for
  "акыркы 90 күндө сатып албаган мурда активдүү кардарлар" and does not define
  active. Someone who bought once and never returned was never a regular, and
  listing them would bury the ones worth a phone call. Two purchases is the
  line; say the word if you want a different one.
- **A plan is edited in place, not corrected.** §27.1 governs posted facts —
  documents that moved money or stock. A plan is a target: changing it moves
  nothing, so it is updated rather than reversed. Every set and every change
  is in the audit log with the old and the new value.
- **The ABC and XYZ cut-offs are the conventional ones, and want your
  confirmation.** §29 asks for both analyses and states no figures. The
  seeded values are the textbook ones — A up to 80% of cumulative revenue, B
  to 95%, and a coefficient of variation of 10% and 25% for X and Y — and the
  screen prints them under every table so nobody mistakes them for a rule of
  this business. They are ordinary settings: tell me your numbers, or change
  them yourself, and the report follows.
- **ABC ranks by revenue, not by margin.** §29 names "ABC анализ" and
  "маржиналдык анализ" as two analyses, so the classification uses turnover
  and the margin is shown beside it on the same row. A product that sells a
  lot at a thin margin is therefore class A with a low margin percentage —
  which is the thing worth seeing. Say the word if you want ABC by margin
  instead, or both.
- **XYZ is measured month by month.** §29 does not say over what period demand
  variability is measured. A week is too short for a parts business to say
  anything, and a year is one number. A product that sold in only one month of
  the range gets no letter at all rather than a flattering X.
- **Goods already on their way are shown, not subtracted.** Whether 20 units
  in transit cover a shortage depends on the lead time, and §29 and §12-Б.4
  give no rule for it. The list shows the inbound quantity beside the
  shortfall and leaves the judgment to whoever places the order.
- **A supplier payable is raised when the order is confirmed, and the goods
  it bought are not an asset until they arrive.** The balance check found
  this: the ledger records the payable against the PUR document, so between
  ordering and receiving there is a liability with nothing on the asset side,
  and the balance does not hold by exactly that amount. The knowledge base
  never says when the payable arises — §4.2 describes the debt and §4.3 the
  prepayment, neither the moment. Two ways to settle it, and it is your call:
  the payable arises at receipt (§7), which is when the goods and the debt
  both become real; or it stays at the order and the balance gains an
  "ordered, not yet received" asset line, which §28's list does not have. I
  have not changed either module — this needs the rule first.
- **The balance is the position now, not on a chosen date.** What is on the
  shelf, what customers owe, and what is held against advances are current
  figures; an advance's applications are a running total with no per-
  application row, so a back-dated balance cannot be reconstructed exactly.
  Dating some lines and not others would produce a balance that never
  existed, so the report is honest about being "now". Say the word if you need
  a month-end balance and the advance applications can gain their own rows.
- **The Cash Flow's investing section exists and reads zero.** §28 asks the
  statement to separate operating, investing and capital/financing flows.
  Nothing the system does today is investing — goods bought for resale are
  trading, not investment — so the section is there, empty, rather than
  quietly missing.
- **A shortfall in the till is documented, not written off** (§20). §20 says
  the difference is recorded with its reason and documented, and
  `daily_cash_handovers` is where that lives — but it names no document that
  makes the money go away. So a 200-som shortage stays as 200 som in the
  seller's account, visible, and the handover explains it. Tell me what should
  absorb it — an expense, a deduction from that person's salary (§25), a
  correction — and it becomes one more step in the same transaction.
- **"A salesperson who worked" means one who raised a confirmed document that
  day.** §20 asks every seller who worked to compare and hand over; nothing in
  the knowledge base defines "worked". A confirmed document with that business
  date is the closest thing the data has to a day's work. Someone who took no
  cash still hands over: the comparison is zero against zero, no TRN is made,
  and the day has their record.
- **The OWNER's own till is not part of the pre-check.** The condition is
  about salespeople handing money to the centre (§19, §20); asking the OWNER
  to hand their own money to themselves would block every close for no reason.
  Their accounts still show on their own day screen.
- **A month closes when all its days are closed.** Period Lock chains
  OPEN → CASH_HANDED → DAY_CLOSED → MONTH_CLOSED, so a day left open inside a
  closed month would be a hole in the same lock. The full month-end
  reconciliation the specification lists — cash, receivables, payables, stock,
  P&L, balance — needs the Priority 3 reports, which are not built yet; until
  they are, the check is the days.
- **Every draft blocks the day, whatever it is.** Period Lock lists the kinds
  one by one and ends with "башка unresolved/open документтер", so one rule
  covers them: a draft on or before that date is unfinished work. An older
  day's draft blocks today too — otherwise that older day could never be
  closed either. Work unfinished in a way of its own, like a transfer sent and
  not received (§12-А.4), still reports itself.
- **An active reservation does not block the day.** Period Lock mentions an
  unfinished advance or reservation "статусу ошол күндүн жабылышын талап
  кылса" — and a live reservation is meant to span days until it expires
  (§17). Blocking on one would make a day impossible to close for as long as
  the hold lasts. Say the word if a particular reservation state should hold a
  day open.
- **A correction reverses money, and only money — for now.** §27.1 says a
  confirmed document is fixed by a COR, and the Period Lock section lists what
  the record must carry, but neither states what a reversal does to a FIFO
  layer. §18.0 and §42.19 give that rule for a *return* — the goods come back
  as a new layer at the original cost with today's date — and a reversal is
  not a return. So a document that moved stock, or that built or consumed a
  currency rate layer (§10-А), is refused by name with the reason, rather than
  half-reversed. What is reversible today: CAP, WDW, TRN, EXP, SLR, OIN in
  som. Tell me which rule a stock reversal should follow — the exact layers
  back, or a new layer as in §18.0 — and receipts, transfers and write-offs
  can follow.
- **A sale is corrected by a return, as §27.1 says.** §27.1 offers two routes
  for a sale — "Return (RET) же ошол эле күнү Correction/Reversal (COR)" — and
  the return is the one whose mechanics the knowledge base states in full
  (§35, §18.0, §42.19). Same-day COR on a sale would additionally have to undo
  the payment allocation, the customer's debt and the bonus; each of those is
  defined for a return and undefined for a reversal. The screen says so and
  points at the return.
- **Only a full reversal, no partial value correction.** The `corrections`
  table carries `correction_type` with old and new value, and a reversal is
  the one correction whose effect the system can derive exactly — from the
  movements the original made. "The amount should have been 11 000, not
  12 000" would need a rule for how the corrected value is re-posted; the
  practice today is to reverse and re-enter, which leaves both documents in
  history. Say the word if you want an in-place value correction and what it
  should do.
- **The effective date defaults to the original's period, not today.** Period
  Lock's own example — 31 August closed, the error found on 2 September —
  keeps Business/Effective Date (which period the operation belongs to) apart
  from Created Date/Time (when it was really entered). The correction is
  therefore booked to August and its `created_at` says September. The OWNER
  can name a different period on the screen.
- **The closed period accepts exactly one document type.** Period Lock says a
  closed day or month is fixed "Correction/Reversal (COR) документи аркылуу
  гана", so the COR itself has to be allowed in. Nothing else is: the same
  business date refuses an ordinary expense with 423. What keeps that honest
  is the OWNER's PIN, the mandatory reason and the audit entry — the three
  things Closed Period Correction asks for. Period Reopen (a closed month
  reopened with a reason) is a separate process and is not built yet.
- **An unconfigured bonus rate is zero, not an error.** §23 states the
  formula and leaves the rate to the OWNER. With neither a personal rate nor
  the `BONUS_DEFAULT_RATE_PCT` setting, the rate is 0 and the bonus is 0 — a
  sale is never blocked by an unconfigured rate, and the screen shows the 0%
  plainly so it is visible rather than silent. Tell me the default you want
  and it becomes a seeded setting.
- **A paid bonus is carried as an adjustment, never reclaimed** (§23.4). When
  goods come back after the bonus was handed over, the money stays with the
  seller and the difference is held against what they earn next. Taking cash
  back off a person is not something §23 asks for, and the schema keeps the
  payment intact. If you want it deducted from the next salary instead, that
  is a rule §25 does not have yet.
- **An advance reduces the payout but moves no money here.** §25 lists the
  advance as a component; whatever document handed it over earlier is what
  took it out of the till, so posting the gross here would pay it twice.
- **Batch freight is not an expense, and the system cannot tell for you**
  (§26). Freight that belongs to a consignment goes into the landed cost
  through §9; only spending attached to no batch is an operating expense.
  Nothing in the data distinguishes the two, so the expense screen says so and
  the person entering it decides. Booking batch freight here would understate
  stock and overstate the month at the same time.
- **The monthly ceiling warns; it does not refuse.** §26 introduces budgets as
  something that "could" warn, and an expense the business has already paid is
  a fact whether or not it fits a budget. Over-budget shows on the screen and
  in `GET /expenses/monthly`; nothing blocks. It does not raise a §39 alert
  either — §39 does not list one, and an alert nobody asked for is noise.
- **An open claim blocks a write-off through the discrepancy it names**
  (§38.2). A claim reaches a product only through its discrepancy, so that is
  the link the check uses. A defect that came back from a customer has no
  claim linked to it at all and nothing blocks it — if you want a claim raised
  from a defect act to hold the goods too, that needs a column joining the
  two, which the schema does not have today.
- **Scrap income counts as operating cash** (§3.1.5). It is money the business
  earned and is neither equity nor a move between its own accounts; §38 asks
  only that it be its own income line, which the OIN document and its category
  provide.
- **A defect act moves no stock.** The goods are already in DEFECT — a return
  put them there (§35.3) or damage on arrival did (§8.4). §37 asks the act for
  the record and the decision, and §38 is what takes the goods off the books.
- **The warranty test is made in dates** (§36-А.2). "Return Date ≤ Sale Date +
  Warranty Days" compares dates, so a same-day defect on a product with a
  zero-day term is inside the warranty rather than a day late. Times of day do
  not enter into it.
- **A return records what came back on the sale line, and leaves the sale
  alone.** §35.1.2 forbids editing the original sale; `sale_items.returned_qty`
  is the column the schema provides for exactly this, and the turnover and
  report queries already net it off.
- **The refund settles debts oldest-first across all of them** (§35.4), not
  only the sale being returned — §35.4 says the offset follows §16-А's
  allocation, and that is the rule §16-А states.
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
    defects/                DEF: the act and its decision (§36-А.3, §37)
    documents/              numbering, status machine, posting registry
    expenses/               EXP and its categories (§26)
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
    returns/                RET: restock, debt offset, refund (§35)
    reports/                Cash Flow classification (§3.1.5)
    security/               Security Log
    settings/               global parameters
    salaries/               SLR: the parts, the total, the payment (§25)
    sales/                  SAL and LSS: discount rules, FIFO COGS, payment
    stock/                  the only door into layer_stock (§12-А, §42.4-5)
    supplier-payments/      SPY, FIFO consumption, FX result (§4.3, §10.2)
    transfers/              TRN
    transfers-warehouse/    TRF between warehouses (§12-А.4-5)
    warehouses/             warehouse master data (§12-А.1)
    write-offs/             WOF and OIN: scrapping and scrap income (§38)
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
                            the count sheet, the handover act, returns,
                            defect acts, write-offs, expenses and salaries
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
