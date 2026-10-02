# Opportunities

Where this could go next. The goal behind every item is the customer's own:
their accounting team needs visibility into tenant financials so they can
reconcile their books efficiently. Each idea says what it would let an
accountant do, what it takes, and what has to be decided first.

They are ordered by how directly they serve reconciliation, not by size.
One item is not optional: authentication and customer scoping (8) comes
before any real customer sees this, and before anything else here that
writes data.

## 1. Record transactions here

**What it enables.** An accountant applies a courtesy credit, writes off a
small balance, or records a payment that has not reached the PMS yet, and the
ledger and balance reflect it immediately.

**Status.** This was built and tested end to end (API, form in the ledger,
Playwright), then removed before submission. It worked; it was taken out
because of what it implies, not because of the code.

**What it was.** `POST /api/tenants/<id>/transactions/` with date,
description, type and amount, validated the same way as an imported entry.
The row was stored with no PMS id, shown with a "Local" badge, sorted after
PMS entries on the same date, and skipped by the import. Because balances are
derived, nothing else had to change.

**Why it is not in.** It turns a read-only mirror of the PMS into a second
source of truth. The moment an entry exists here and not in the PMS, the
balance on screen no longer reconciles with the PMS, which is the opposite of
what was asked for. Before this ships, someone has to decide:

- Does a local entry get pushed back to the PMS, and what happens when the
  push fails?
- When the PMS later shows the same payment, how are the two matched so it is
  not counted twice?
- Who is allowed to do it, and where is that recorded? There is no
  authentication in this application today.
- Can a local entry be edited or reversed, and is the reversal its own entry?

**Smallest safe version.** Local entries shown in a separate "Adjustments not
yet in the PMS" section with their own subtotal, and two balances side by
side: "per PMS" and "including adjustments".

## 2. Reconciliation status per tenant and per period

**What it enables.** An accountant marks a tenant's ledger as reconciled
through a date, and next month sees only what changed since.

**What it takes.** A `Reconciliation` record (tenant, through date, who,
when, the balance at that moment). The import already knows what it created,
updated, removed and restored; storing those per tenant gives "3 new entries
and 1 changed since you reconciled on March 31".

**Decide first.** Whether an edit to an entry inside a reconciled period
should reopen it automatically.

## 3. Changes since the last import

**What it enables.** After each sync, a list of exactly what moved: new
entries, edited amounts, entries removed from the PMS. This is the fastest
way to explain why a balance is different from yesterday.

**What it takes.** An `ImportRun` record with its counts, and a change row
per affected transaction (before and after values). Removed entries are
already kept and stamped; edits currently overwrite in place, so the before
value is lost.

## 4. Aging buckets

**What it enables.** The standard receivables view: how much of what each
tenant owes is current, 1 to 30, 31 to 60, 61 to 90 and over 90 days old.

**What it takes.** Applying each payment to the oldest unpaid charge first
and bucketing what is left by the charge date. It belongs beside
`build_ledger` and would add an "oldest unpaid" column to the tenant list and
a stacked bar to Insights.

**Decide first.** Whether payments apply oldest-first, or to the charge they
name ("Rent Payment - March"). The PMS does not link a payment to a charge.

## 5. Scheduled sync with alerting

**What it enables.** Ledgers that are never more than a known number of
hours old, and someone told when a sync fails.

**What it takes.** The import is already safe to rerun, exits non-zero on any
problem, and logs structured events, so a cron entry or scheduled job is
enough to start. The screen already shows when each ledger was synced; add a
warning when that is older than the agreed freshness.

## 6. Export for the general ledger

**What it enables.** A month-end file in the layout the customer's accounting
system imports, instead of one CSV per tenant.

**What it takes.** A portfolio-level export for a period: per tenant, opening
balance, charges, payments, closing balance; and a second file of every entry
with a category.

**Decide first.** The chart-of-accounts mapping. The PMS gives only free-text
descriptions ("Rent Charge - March", "Late Fee Charge"). A small
description-to-category table, maintained by the customer, is safer than
guessing.

## 7. A fuller deposit ledger

**What it enables.** The deposit held is now shown apart from the balance
(see `docs/decisions.md`). The next steps are the parts of deposit handling
the PMS data does not show yet: at move-out, how much was refunded, how much
was applied to damages or unpaid rent, and whether interest is owed. This is
the area closest to Rentable's own product, which manages security deposits.

**What it takes.** The category rule recognises anything described as a
security deposit, so refunds and applications will be counted correctly once
the PMS sends them (a refund is a negative deposit payment). What is missing
is a move-out date and a deposit disposition view: held, less deductions,
equals refund due.

**Decide first.** Where the category should come from. Today it is read from
the description, which is free text.

## 8. Authentication, roles and customer scoping

**What it enables.** Shipping this to a real customer at all.

**What it takes.** Login, a customer (or property) boundary on `Tenant`, and
every query filtered by it. Labels would become per-customer. This comes
before anything in this list that writes data.

## 9. Scale

**What it enables.** Portfolios of tens of thousands of tenants.

**What it takes.** Sorting and filtering move from the browser to query
parameters with pagination; the tenant list's balance annotation needs an
index on `(tenant, removed_from_pms_at)`; the import streams and batches
instead of loading one response into memory. None of this is needed at 200
tenants, and the pure functions in `tenantFilters.js` document the rules the
server would have to reproduce.

## 10. Label rules and history

**What it enables.** Labels that keep themselves up to date: "At risk" when a
balance is over a threshold for 30 days, "Defaulting" after two returned
payments. And a record of who labelled a tenant, and when.

**What it takes.** Labels are manual today. A rule would run after each
import and add or clear a label, marked as automatic so a person's choice is
never silently overridden.

## 11. Tracing

**What it enables.** Following one request or one import across services.

**Why not yet.** There is one outbound call and one database. The durations
that matter are already fields on the log events. This becomes worth adding
when a second service, a queue or a scheduled worker exists to correlate
with.
