# How AI was used

The README says AI tooling is expected and that the candidate owns every
line. This is what that looked like here.

## Contents

- [Tools](#tools)
- [What was checked rather than trusted](#what-was-checked-rather-than-trusted)
- [Mistakes the checks caught](#mistakes-the-checks-caught)

## Tools

- **Claude Code** wrote most of the code, tests and documents in this repo,
  working from my direction in one long session.
- **OpenAI Codex CLI** and a second Claude model were each asked to analyse
  the original template independently, without seeing the plan or each
  other's work, and later to review the implementation. Where they disagreed
  with the implementation, the disagreement and the outcome are recorded in
  `docs/decisions.md`.

## What was checked rather than trusted

- **The balance formula.** Three independent analyses computed the balance
  for PMS tenants 1 to 5 from the raw API response and got the same numbers
  (0, 2,425, 1,240, 0, 5,116). Those numbers are asserted in
  `backend/api/tests/test_pms_import.py`.
- **All 200 balances.** The database's balances were compared with a `jq`
  calculation over the raw response; they match for every tenant.
- **The data claims.** Every count in `docs/data-findings.md` has the command
  that produces it.
- **The UI.** The ledger, filters, charts and labels were exercised in a real
  browser by the Playwright suite in `e2e/`, not only in unit tests.
- **Numbers that should agree.** The roll-forward's closing total, the
  month-end receivable and the ledger balances as of the same day come from
  three different code paths, and tests assert they match.

## Mistakes the checks caught

- A `requirements.txt` edit joined two package names on one line, which pip
  rejects. Caught by an independent review.
- An empty ledger was labelled "Paid in full". Caught by both reviewers.
- The CSV export was first a plain link, which the dev server answers with
  the app's HTML instead of the file. Caught by the end-to-end test.
- The sticky table header painted over the ledger dialog. Caught by eye, then
  pinned with a test that fails without the fix.
- Adding `--dry-run` wrapped every import in one database transaction, so one
  tenant's database error would have undone all the others, while the docs
  said each tenant committed on its own. Caught by an independent review.
- The import first matched seeded tenants to the PMS by name. Both reviewers
  flagged that two people can share a name; it now matches on the PMS id only.
- Selecting a period on the balance chart crashed, because the pointer still
  pointed at an entry that was no longer on screen. Caught by a unit test
  written for the feature.
