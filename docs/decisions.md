# Decisions

What was wrong with the original code, what was done about it, and why. Each
entry names the alternative that was not taken.

The request: an accounting team wants to open a tenant's ledger, see the
transactions and the balance, and reconcile against their books. Everything
here is judged against that: a number on screen has to be one an accountant
can trust and trace.

## What the PMS data looks like

Measured from the live API (`GET /tenants/?includeLedgers=true`):

- 200 tenants, 4,424 ledger entries, 6 to 51 per tenant.
- Every entry has `type` of `charge` (2,491) or `payment` (1,933).
- 213 entries have a negative amount: 132 negative charges (credits,
  concessions, waived fees) and 81 negative payments (returned payments).
- Transaction ids are strings (`"3"`), tenant ids are numbers.
- Dates are all `YYYY-MM-DD`; amounts are all whole dollars.
- Without `includeLedgers=true` the same endpoint returns tenants with no
  `ledger` key and HTTP 200.
- The three seeded tenants are Alice Wonderland A101, Bob The Builder B202 and
  Charlie Chaplin C303. PMS tenants 1 to 3 are Alice Wonderland A101, Bob The
  Builder **B205** and **Daisy Ridley** C303. Charlie is not in the PMS.

## Defects in the original code

### 1. The import never requested ledgers

`import_transactions` called `/tenants/` without `includeLedgers=true`, read
the missing `ledger` key as an empty list, wrote nothing, and printed
"Successfully imported transaction data."

**Now:** the request sends `includeLedgers=true`. A tenant whose data has no
`ledger` list is reported as an error instead of being treated as empty, so
the same mistake cannot pass silently again.

### 2. PMS tenant ids were compared to local primary keys

`Tenant.objects.get(id=tenant_id)` treats the PMS `tenant_id` as the local
database id. They only line up by accident. On a fresh database it would have
put Daisy Ridley's ledger (PMS tenant 3) on Charlie Chaplin (local tenant 3),
and skipped the other 197 tenants.

**Now:** `Tenant.pms_tenant_id` (unique, nullable) holds the PMS id, and the
import matches on that only.

### 3. The transaction type was thrown away

`type` was not in the model, the import, or the serializer. Payments arrive
as positive numbers, so without the type there is no way to tell money owed
from money received: summing amounts for Alice gives 11,840 when her real
balance is 0.

**Now:** `Transaction.type` is stored and is the only thing that decides an
entry's direction.

### 4. PMS transaction ids were written into the local primary key

`update_or_create(id=<PMS id>)` let an external system choose local primary
keys, and relied on the PMS string id happening to be numeric.

**Now:** `Transaction.pms_id` is a string column, unique per tenant. Local
ids are the database's own.

### 5. No ordering

Nothing ordered the transactions, so they came back in primary-key order,
which was PMS id order. Alice's security deposit has PMS ids 3 and 4 but is
dated before ids 1 and 2, so her ledger would have opened out of date order.

**Now:** the ledger is ordered by date, then by PMS id compared as a number.
That reproduces the PMS's own order for every tenant.

### 6. Failures looked like success

A network error was printed and the command returned normally. There was no
timeout, and nothing wrapped the writes, so a failure midway left a partial
import.

**Now:** a 30 second timeout; fetch errors raise `CommandError` (non-zero
exit); each tenant is written and committed in its own database transaction,
so a failure on one tenant (bad data, or an error from the database) leaves
the others in place; the command
prints what it created, updated and removed. `--dry-run` reports the same
counts and writes nothing.

### 7. Smaller things

- `transaction_list` said it filtered by tenant and did not. It now does
  (`?tenant=<id>`).
- Amounts went from JSON float straight into a decimal field. They are now
  parsed with `Decimal(str(value))` and must be a whole number of cents.
- The tenant list showed "No tenants found." while it was still loading.
- `CORS_ALLOWED_ORIGINS` allowed port 3000; the frontend runs on 3009.
- There were no tests.

## Decisions

### Balance = charges minus payments, with the PMS sign kept

Amounts are stored exactly as the PMS sends them and `type` gives the
direction. A negative charge is a credit and lowers the balance; a negative
payment is a returned payment and raises it.

*Not taken:* storing a signed amount (loses the PMS's own representation, and
accountants reconcile against PMS statements); using `abs()` (turns Daisy's
$80 credit into an $80 charge); reading the direction from the description
text.

Checked by hand against the PMS response, and asserted in
`backend/api/tests/test_pms_import.py`:

| PMS tenant | Charges | Payments | Balance |
|---|---|---|---|
| 1 Alice Wonderland | 5,920 | 5,920 | 0 |
| 2 Bob The Builder | 4,025 | 1,600 | 2,425 |
| 3 Daisy Ridley | 4,720 | 3,480 | 1,240 |
| 4 Christopher Jackson | 8,270 | 8,270 | 0 |
| 5 Emma Mitchell | 19,485 | 14,369 | 5,116 |

### The balance is derived, never stored

It is computed from the transactions on every read, in two places that are
tested to agree: `build_ledger` (running balance for one tenant) and
`Tenant.objects.with_balance()` (one query for the whole list).

*Not taken:* a `balance` column on the tenant, which can drift from the
transactions and has to be maintained by every future write path.

### The running balance is computed in Python, on the server

A ledger has at most 51 entries, so a loop is simpler to read and to explain
than a SQL window function. Balances are computed on the server in `Decimal`
and sent as strings. The browser never computes a balance. It does add up
already-computed balances for the Insights and Labels totals, which is exact
for amounts in whole cents at this size and would move to the server with
pagination.

### The import brings in every PMS tenant

The original command skipped any tenant not already in the local database,
which is 197 of 200. The request is visibility into tenant financials, so the
import creates them.

*Not taken:* importing ledgers only for the three seeded tenants.

*Open question:* this assumes the endpoint is scoped to one customer. If it
returns several customers' tenants, the model needs a customer or property
boundary first.

### Tenants are matched on the PMS id only, never on a name

The import finds a local tenant by `pms_tenant_id` and nothing else. The
seeded tenants state their PMS id in `seed_data.py` (Alice is 1, Bob is 2),
so they link on the first import and Bob's unit is updated to B205, because
the PMS is the source of truth. Charlie Chaplin has no PMS id, matches
nothing, keeps an empty ledger, and is reported on every import.

*Not taken:* adopting an unlinked local tenant whose name matches exactly.
That was the first implementation. Two independent reviews flagged it: two
people can share a name, and a ledger on the wrong person is worse than two
rows for one. Stating the id where the tenant is created is stricter and is
less code.

### Transactions the PMS no longer has are marked removed, not deleted

The local table is a copy of the PMS. If the PMS voids an entry and the copy
keeps counting it, the balance on screen can never reconcile with the PMS. So
an entry that disappears stops counting toward the balance. The row is kept,
stamped with `removed_from_pms_at`, and listed under "Removed from the PMS"
in the ledger, so there is a record of why a balance changed. If the entry
comes back, the stamp is cleared.

One guard: if the PMS returns an empty ledger for a tenant who has entries on
file, the import refuses that tenant and reports it. Every tenant in the PMS
has a ledger, so an empty one is far more likely a bad response than a tenant
whose whole history was voided, and acting on it would zero their balance.

*Not taken:* never removing (the balance drifts); deleting the row. Deleting
was the first implementation. An independent review pointed out that it
destroys the evidence an accountant would need to explain a change between
two days, and that costs one nullable column to fix.

### One bad entry holds back that tenant's whole ledger

If any entry in a tenant's ledger fails validation, none of that tenant's
changes are applied, the tenant is reported, the other tenants still import,
and the command exits non-zero.

*Not taken:* skipping only the bad entry (a ledger missing one entry shows a
plausible, wrong balance); aborting the whole import (one tenant's bad data
would block the other 199).

### Existing transactions are deleted by the migration

Rows written before `type` existed cannot be given a correct type. Rather
than default them to `charge` and show a wrong balance, migration `0004`
deletes them; the next import restores them from the PMS. With the original
command this table was always empty, since it never imported anything.

### The import can read a saved response (`--source`)

`import_transactions --source file.json` imports a saved PMS response. The
tests and the end-to-end suite use
`backend/api/tests/fixtures/pms_tenants_sample.json`, which is PMS tenants 1
to 5 exactly as the API returned them, so they run without the network and
assert against real data.

### Security deposits are reported apart from what the tenant owes

A deposit is the tenant's money, held by the landlord: a liability, not
income and not a receivable. The PMS puts deposit charges and payments in the
same ledger as rent, so each entry now carries a category, and the ledger
shows:

- **Balance**, unchanged, with what it is made of: rent and fees, and any
  deposit that has been charged but not yet paid.
- **Deposit held**: deposit money actually received and not refunded. It is
  shown beside the balance and is never added into it.

Insights totals the deposits held across the portfolio ($208,250 for the 200
PMS tenants).

All three are standing figures, so with a date range they are as of the end
date and include entries from before the start.

The category comes from the description: anything containing "security
deposit" is a deposit, everything else is rent and fees. That is the one
place a description is read for meaning (`backend/api/services/categories.py`),
and it never decides direction or amount. It matches all 400 deposit entries
in the PMS and nothing else.

*Not taken:* leaving deposits mixed in (the balance is right, but nothing
says how much is being held); a full chart of accounts (the PMS gives nothing
to map from). *Limit:* a description is free text. A real deployment should
get the category from the PMS or from a mapping the customer maintains; the
field is stored per entry so it can be corrected without changing code.
"Net charges" and "Net payments" still include deposit entries, as the PMS
presents them.

### Charges and payments are shown net, and labelled net

"Net charges" is charges less credits, and "Net payments" is payments less
returned payments. A $1,420 payment that later bounces shows as net payments
of $0.00, which is right for the balance but would be misleading under the
word "total", so the labels say net. The entries themselves are all in the
table.

### "Unit prefix", not "building"

The PMS calls the field a unit code and says nothing more. The filter and the
Insights chart group by the code's leading letter and call it a unit prefix.
It probably is a building; the data does not say so.

### A tenant with nothing on file has no balance

A tenant with no PMS record and no transactions is returned with
`balance: null` and shown as a dash. `$0.00` would say the account is
settled, which nobody knows. The ledger dialog shows the same dash. For the same reason an empty ledger is labelled
"no activity" instead of "Paid in full".

### The tenant list shows the PMS id

The first column is the PMS tenant id, not the local database id. It is the
number an accountant can look up in the PMS.

### Each ledger records when it was synced

`Tenant.ledger_synced_at` is set when that tenant's ledger is brought in line
with the PMS. A tenant whose ledger was rejected keeps its old time, so the
screen never claims a stale ledger is fresh.

### A date range carries an opening balance

`GET /api/tenants/<id>/ledger/?start=&end=` limits the ledger to a period.
Entries before `start` are rolled into an opening balance row, and the running
balance continues from it, so each row still shows the tenant's real balance
on that day. Entries after `end` are left out, which makes the balance the
balance as of `end`. The totals are for the period.

*Not taken:* a running balance that restarts at zero for the visible rows. It
is simpler and wrong: it would not match what the tenant owed on any day.

### CSV export is fetched, not linked

The export button fetches `/api/tenants/<id>/ledger.csv` and hands the file
to the browser. A plain link does not work under the dev server, whose proxy
answers a link click with the app's own HTML. The export covers the same
period that is on screen. A description that begins with `=`, `+`, `-` or `@`
is prefixed with an apostrophe so a spreadsheet does not run it as a formula.

### Labels are local, with three defaults

The accounting team can label tenants. "At risk" (red), "Requires follow up"
(orange) and "Defaulting" (black) are created by a migration; more can be
added in the app with any colour. Chip text is black or white by the colour's
luminance, so a custom colour cannot be unreadable. Labels live only in this
database and an import never touches them.

Label names are unique ignoring case, so "at risk" cannot be added beside
"At risk".

### Structured logs, without a logging library

The import and the PMS fetch log named events with fields
(`pms.import.finished transactions_created=12 ...`). `LOG_FORMAT=json` prints
each as one JSON object for a log pipeline. This is the standard library's
`logging` with a 20-line formatter in `backend/api/logging.py`.

*Not taken:* OpenTelemetry tracing. There is one outbound call and one
database; the durations that matter are already fields on the log events.
It becomes worth it when a second service needs correlating.

### Balances can be taken as of any date

`GET /api/tenants/?as_of=YYYY-MM-DD` counts only transactions dated on or
before that day, which is each tenant's balance at the close of it. The
tenant list has a date field for it and says plainly when the balances shown
are not today's. A test asserts this agrees with the ledger's balance as of
the same day.

### The roll-forward statement

`GET /api/reports/roll-forward/?start=&end=` returns, for a period, one row
per tenant: opening balance, net charges, net payments, closing balance, and
control totals. Every row and the totals obey
opening + charges - payments = closing. This is the statement that ties the
tenant sub-ledger to a general ledger control account at period end, and it
exports as CSV with the totals as the last row.

It is one aggregate query, not a ledger built per tenant. Tests assert that
its opening and closing agree with `build_ledger` for the same dates, and
that its closing total equals the month-end receivable from the monthly
report: three code paths, one number.

### Insights follows one date range

The From and To fields on Insights drive everything on the tab. The monthly
series and the roll-forward cover the period. The tiles and balance lists are
standing figures, so they are as of the end date, and each says so.

The total receivable is a level that carries from month to month, so it is a
line and is always cumulative from the first transaction, even when the range
starts later. Charges, payments and returned payments belong to their month,
so they are bars. The collection rate (net payments over net charges) is a
column in the monthly table rather than another chart; it is blank for a
month with nothing charged, and can exceed 100% when arrears are paid.

### The ledger opens as a dialog, and stays in date order

The ledger shows separate Charge and Payment columns and a running Balance
column, which is the layout an accountant expects. Its rows are not sortable:
a running balance only means something in date order.

### Sorting and filtering happen in the browser

The tenant table sorts by any column and filters by unit prefix, label and
balance range, and the roll-forward sorts by any column. With 200 tenants
this needs no server round trip. The rules are plain
functions in `frontend/src/tenantFilters.js`, tested on their own. Past a few
thousand tenants this should move to query parameters and pagination.

### Charts are drawn without a chart library

The charts are plain SVG and CSS rather than a new dependency: one component
for every month-by-month chart (`MonthlyChart.js`, about 130 lines) and one
for a ledger's balance over time (`BalanceChart.js`, about 130). Each chart's
numbers are also on the page as text or a table.

"Total outstanding" adds up only tenants who owe money. It is not reduced by
other tenants' credits, because a credit on one account does not pay down
another.

### Tests

- Backend: pytest with pytest-django (`cd backend && pytest`). They are in
  `requirements.txt` because that is the one file the dev container installs.
  Versions are pinned: unpinned, Python 3.12 and later would install Django 6
  while the dev container (Python 3.11) installs Django 5.2.
- Frontend: React Testing Library, already in the template
  (`cd frontend && npm test`).
- End to end: Playwright in `e2e/`, against its own database loaded from the
  sample file.
- CI (`.github/workflows/ci.yml`) runs all three suites and the frontend
  build on every push.

## Not done, and why

- **Authentication and per-customer scoping.** The template has none. This is
  the first thing a real deployment needs: today anyone who can reach the API
  can read every ledger and edit labels.
- **Pagination.** 200 tenants and at most 51 entries per ledger.
- **Scheduled imports.** The import is safe to run on a schedule, and each
  ledger shows when it was synced, but nothing schedules it.
- **Recording transactions here.** Built and tested, then taken out: see
  `docs/opportunities.md`.

Ideas for where this could go next are in `docs/opportunities.md`.

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
