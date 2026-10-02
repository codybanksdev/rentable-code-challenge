# Decisions

What was wrong with the original code, what was done about it, and why. Each
decision names the alternative that was not taken.

The request: an accounting team wants to open a tenant's ledger, see the
transactions and the balance, and reconcile against their books. Everything
here is judged against that: a number on screen has to be one an accountant
can trust and trace.

The measurements behind these decisions are in
[data-findings.md](data-findings.md). In short: 200 tenants, 4,424 entries,
every entry a `charge` or a `payment`, and 213 of them negative.

## Contents

- [Defects in the original code](#defects-in-the-original-code)
- [The balance](#the-balance)
  - [Balance = charges minus payments, with the PMS sign kept](#balance--charges-minus-payments-with-the-pms-sign-kept)
  - [The balance is derived, never stored](#the-balance-is-derived-never-stored)
  - [Charges and payments are shown net, and labelled net](#charges-and-payments-are-shown-net-and-labelled-net)
  - [A tenant with nothing on file has no balance](#a-tenant-with-nothing-on-file-has-no-balance)
  - [Security deposits are reported apart from what the tenant owes](#security-deposits-are-reported-apart-from-what-the-tenant-owes)
- [The import](#the-import)
  - [It brings in every PMS tenant, matched on the PMS id only](#it-brings-in-every-pms-tenant-matched-on-the-pms-id-only)
  - [One bad entry holds back that tenant's whole ledger](#one-bad-entry-holds-back-that-tenants-whole-ledger)
  - [Entries the PMS no longer has are marked removed, not deleted](#entries-the-pms-no-longer-has-are-marked-removed-not-deleted)
  - [Migration 0004 deletes pre-existing transactions](#migration-0004-deletes-pre-existing-transactions)
  - [Each ledger records when it was synced](#each-ledger-records-when-it-was-synced)
  - [`--source`, `--dry-run`, and structured logs](#--source---dry-run-and-structured-logs)
- [What the accountant sees](#what-the-accountant-sees)
  - [The ledger](#the-ledger)
  - [The tenant list](#the-tenant-list)
  - [The roll-forward statement](#the-roll-forward-statement)
  - [Insights](#insights)
  - [Labels](#labels)
- [Tests](#tests)
- [Not done, and why](#not-done-and-why)
- [Questions for the customer and the PMS owner](#questions-for-the-customer-and-the-pms-owner)

## Defects in the original code

| # | Defect | Effect | Now |
|---|---|---|---|
| 1 | The import called `/tenants/` without `includeLedgers=true` and read the missing `ledger` key as an empty list. | It wrote nothing and printed "Successfully imported". | The parameter is sent, and a tenant with no `ledger` list is an error, not an empty ledger. |
| 2 | `Tenant.objects.get(id=tenant_id)` compared the PMS tenant id with the local primary key. | PMS tenant 3 (Daisy Ridley) would have landed on local tenant 3 (Charlie Chaplin); 197 tenants were skipped. | `Tenant.pms_tenant_id` holds the PMS id and is the only key the import matches on. |
| 3 | `type` was not stored. | Payments arrive as positive numbers, so charges and payments could not be told apart: summing Alice's amounts gives 11,840 when her balance is 0. | `Transaction.type` is stored and alone decides an entry's direction. |
| 4 | The PMS transaction id was written into the local primary key. | An outside system chose local keys, and it only worked while ids were numeric. | `Transaction.pms_id` is a string, unique per tenant. |
| 5 | Nothing ordered the transactions. | Alice's deposit (PMS ids 3 and 4) is dated before ids 1 and 2, so her ledger opened out of date order. | Ordered by date, then PMS id as a number, which reproduces the PMS's own order for every tenant. |
| 6 | A fetch error was printed and the command returned normally; no timeout; no transaction around the writes. | A failed or partial import looked like success. | 30 second timeout, non-zero exit on any problem, each tenant committed on its own, and a summary of what changed. |
| 7 | `transaction_list` said it filtered by tenant and did not; amounts went from JSON float to decimal; the list showed "No tenants found." while loading; CORS allowed port 3000, not 3009; no tests. | | All fixed. Amounts are parsed with `Decimal(str(value))` and must be whole cents. |

## The balance

### Balance = charges minus payments, with the PMS sign kept

Amounts are stored exactly as the PMS sends them and `type` gives the
direction. A negative charge is a credit and lowers the balance; a negative
payment is a returned payment and raises it.

*Not taken:* storing a signed amount (loses the PMS's own representation,
which is what accountants reconcile against); `abs()` (turns Daisy's $80
credit into an $80 charge); reading the direction from the description.

Worked by hand from the PMS response and asserted in
`backend/api/tests/test_pms_import.py`:

| PMS tenant | Charges | Payments | Balance |
|---|---|---|---|
| 1 Alice Wonderland | 5,920 | 5,920 | 0 |
| 2 Bob The Builder | 4,025 | 1,600 | 2,425 |
| 3 Daisy Ridley | 4,720 | 3,480 | 1,240 |
| 4 Christopher Jackson | 8,270 | 8,270 | 0 |
| 5 Emma Mitchell | 19,485 | 14,369 | 5,116 |

### The balance is derived, never stored

It is computed from the transactions on every read: `build_ledger` gives one
tenant's running balance in a Python loop over at most 51 entries, and
`Tenant.objects.with_balance()` gives every tenant's in one query. Tests
assert the two agree. Balances are `Decimal` on the server and strings in
JSON; the browser never computes one, though it does add up already-computed
balances for the Insights and Labels totals.

*Not taken:* a `balance` column, which can drift from the transactions; a SQL
window function for the running balance, which is harder to read for no gain
at this size.

### Charges and payments are shown net, and labelled net

"Net charges" is charges less credits; "Net payments" is payments less
returned payments. A $1,420 payment that later bounces is net payments of
$0.00, which is right for the balance but would mislead under the word
"total".

### A tenant with nothing on file has no balance

A tenant with no PMS record and no transactions has `balance: null` and is
shown as a dash, in the list and in the ledger. `$0.00` would claim the
account is settled. For the same reason an empty ledger reads "no activity",
not "Paid in full".

### Security deposits are reported apart from what the tenant owes

A deposit is the tenant's money, held by the landlord: a liability, not a
receivable. The PMS puts deposits in the same ledger as rent, so each entry
carries a category and the ledger shows the balance, what it is made of
(rent and fees, and any deposit charged but not yet paid), and separately the
**deposit held**: deposit money received and not refunded. Insights totals
deposits held ($208,250 for the 200 PMS tenants).

The category comes from the description: anything containing "security
deposit" is a deposit. This is the one place a description is read
(`backend/api/services/categories.py`); it matches all 400 deposit entries
and nothing else, and it never decides direction or amount.

*Not taken:* leaving deposits mixed in; a full chart of accounts. *Limit:* a
description is free text, so a real deployment should get the category from
the PMS or a mapping the customer maintains.

## The import

### It brings in every PMS tenant, matched on the PMS id only

The original command skipped 197 of 200 tenants. The request is visibility
into tenant financials, so the import creates them. A local tenant is found
by `pms_tenant_id` and nothing else. The seeded tenants state their PMS id in
`seed_data.py`; Bob's unit becomes B205 because the PMS is the source of
truth. Charlie Chaplin has no PMS id, keeps an empty ledger, and is reported
on every import.

*Not taken:* adopting a local tenant whose name matches. That was the first
implementation; two reviews pointed out that two people can share a name, and
a ledger on the wrong person is worse than two rows for one.

*Assumes* the endpoint returns one customer's tenants.

### One bad entry holds back that tenant's whole ledger

If any entry fails validation (unknown type, bad date, fraction of a cent,
duplicate id, amount too large), none of that tenant's changes are applied,
the tenant is reported, the others still import, and the command exits
non-zero. The same goes for a database error on one tenant.

*Not taken:* skipping only the bad entry (a ledger missing an entry shows a
plausible, wrong balance); aborting everything (one tenant would block 199).

### Entries the PMS no longer has are marked removed, not deleted

If the PMS voids an entry and the copy keeps counting it, the balance can
never reconcile. So a vanished entry stops counting, but the row is kept,
stamped `removed_from_pms_at`, and listed under "Removed from the PMS" in the
ledger. If it comes back the stamp is cleared.

One guard: an empty PMS ledger for a tenant with entries on file is refused
and reported. It is far more likely a bad response than a whole history
voided, and acting on it would zero a balance.

*Not taken:* never removing (the balance drifts); deleting the row, which was
the first implementation and destroys the record of why a balance changed.

### Migration 0004 deletes pre-existing transactions

Rows written before `type` existed cannot be given a correct one. Defaulting
them to `charge` would show a wrong balance, so they are deleted and the next
import restores them. With the original command the table was always empty.

### Each ledger records when it was synced

`Tenant.ledger_synced_at` is set when that tenant's ledger is brought in line
with the PMS. A rejected ledger keeps its old time, so the screen never calls
a stale ledger fresh.

### `--source`, `--dry-run`, and structured logs

`--source file.json` imports a saved PMS response; the tests and the
end-to-end suite use tenants 1 to 5 exactly as the API returned them, so they
assert against real data without the network. `--dry-run` reports what would
change and writes nothing. The import logs named events with fields;
`LOG_FORMAT=json` prints them one JSON object per line, using the standard
library and a 20-line formatter.

*Not taken:* OpenTelemetry. One outbound call and one database do not need
tracing; the durations are already fields on the log events.

## What the accountant sees

### The ledger

A dialog with separate Charge and Payment columns and a running Balance,
oldest first. The rows do not sort: a running balance only means something in
date order.

**Date range.** `?start=&end=` limits the ledger to a period. Entries before
`start` become an opening balance row and the running balance continues from
it, so each row shows the tenant's real balance on that day; the balance
returned is the balance as of `end`. *Not taken:* restarting at zero for the
visible rows, which matches no day's balance.

**CSV export** covers the period on screen. It is fetched, not linked: the
dev server answers a link click with the app's own HTML. Text that begins
with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet
does not run it as a formula.

### The tenant list

The first column is the PMS tenant id, the number an accountant can look up,
not the local id. Sorting and filtering (unit prefix, label, balance range)
happen in the browser; the rules are plain functions in
`frontend/src/tenantFilters.js`. Past a few thousand tenants this moves to
query parameters and pagination. `?as_of=` gives every balance at the close
of a chosen day, and the page says when the balances shown are not today's.

It is "unit prefix", not "building": the PMS says only "unit code".

### The roll-forward statement

`GET /api/reports/roll-forward/?start=&end=`: per tenant, opening balance,
net charges, net payments and closing balance, with control totals. Every row
and the totals obey opening + charges - payments = closing. This is what ties
the tenant sub-ledger to a general ledger control account at period end.

It is one aggregate query. Tests assert its opening and closing agree with
`build_ledger`, and that its closing total equals the month-end receivable
from the monthly report: three code paths, one number.

### Insights

One From/To range drives the tab. The roll-forward and monthly series cover
the period; the tiles and balance lists are standing figures, so they are as
of the end date and say so. The receivable is a level that carries from month
to month, so it is a line and always cumulative from the first transaction;
charges, payments and returned payments belong to their month, so they are
bars. The collection rate is a table column: blank when nothing was charged,
and over 100% when arrears are paid.

"Total outstanding" counts only tenants who owe. It is not reduced by other
tenants' credits, because a credit on one account does not pay down another.

The charts are plain SVG in two components of about 130 lines each, rather
than a chart library. Each chart's numbers are also on the page as a table.

### Labels

"At risk" (red), "Requires follow up" (orange) and "Defaulting" (black) are
created by a migration; more can be added with any colour, and chip text is
black or white by the colour's luminance. Labels live only here: the import
never touches them.

## Tests

- Backend: pytest with pytest-django (`cd backend && pytest`), in the one
  `requirements.txt` the dev container installs. Versions are pinned, because
  unpinned Python 3.12+ would install Django 6 while the dev container
  (Python 3.11) installs 5.2.
- Frontend: React Testing Library, already in the template.
- End to end: Playwright in `e2e/`, against its own database loaded from the
  sample file.
- CI (`.github/workflows/ci.yml`) runs all three and the frontend build.

## Not done, and why

- **Authentication and per-customer scoping.** The template has none. It is
  the first thing a real deployment needs: today anyone who can reach the API
  can read every ledger and edit labels.
- **Pagination.** 200 tenants and at most 51 entries per ledger.
- **Scheduled imports.** The import is safe to schedule; nothing schedules it.
- **Recording transactions here.** Built and tested, then taken out: see
  [opportunities.md](opportunities.md).

## Questions for the customer and the PMS owner

| Question | Assumed for now |
|---|---|
| Is the ledger the complete history, starting from a zero balance? | Yes |
| Can entries be edited or removed in the PMS? | Yes; edits are applied and removals are marked, not deleted |
| Are transaction ids unique across tenants or only within one? | Only within a tenant (the stricter assumption) |
| Should security deposits count toward the balance? | A deposit still owed does; a deposit already paid is reported apart as held |
| When two entries share a date, is the PMS's order meaningful? | Yes; date then id reproduces it |
| Does the endpoint return one customer's tenants or several? | One |
| How fresh do ledgers need to be? | Import is run by hand; it is safe to schedule |
