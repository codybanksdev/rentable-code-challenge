# Working in this repo with an AI assistant

A tenant ledger for an accounting team: Django + DRF backend (`backend/`),
React frontend (`frontend/`), Playwright suite (`e2e/`). Read
`docs/decisions.md` before changing behaviour and `docs/flow.md` for how data
moves.

## Run and test

```bash
./start.sh                                  # backend :8009, frontend :3009
cd backend && python manage.py import_transactions   # load ledgers from the PMS
cd backend && pytest
cd frontend && npm test -- --watchAll=false
cd e2e && npx playwright test               # stop ./start.sh first
```

Run the tests for whatever you touched before saying a change is done.

## Rules that are not negotiable

- **Money is `Decimal` on the server and a string in JSON.** Never a float.
  The frontend only converts to a number to format or to draw.
- **A balance is derived, never stored.** `build_ledger` and
  `Tenant.objects.with_balance()` are the only two definitions, and a test
  asserts they agree. Do not add a third.
- **Sign comes from the PMS, direction comes from `type`.** A negative charge
  is a credit; a negative payment is a returned payment. Do not use `abs()`
  and do not read meaning from `description`.
- **Local ids are not PMS ids.** Match tenants on `pms_tenant_id` and
  transactions on `(tenant, pms_id)`.
- **The import must be safe to rerun** and must leave a tenant untouched if
  any entry in that tenant's ledger is invalid.
- **Ledger dates are calendar dates.** Do not pass them through `new Date()`;
  see `frontend/src/format.js`.
- **Labels are local.** The import never reads or writes them.

## Conventions

- Business rules live in `backend/api/services/`; views and the management
  command stay thin.
- Backend tests are plain pytest functions in `backend/api/tests/`. Prefer the
  real-data fixture (`fixtures/pms_tenants_sample.json`) to invented numbers.
- Frontend rules that can be pure functions are (`tenantFilters.js`,
  `insightsData.js`, `ledgerStats.js`) and are tested without rendering.
- No new dependency without a reason recorded in `docs/decisions.md`.
- Migrations 0001 to 0003 came with the template; add new ones, do not edit.
- A changed decision means an updated `docs/decisions.md` in the same commit.
