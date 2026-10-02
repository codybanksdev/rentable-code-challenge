# Documentation

Notes on the tenant ledger: what was built, why, and what the data looks
like. The project's setup and test instructions are in the
[top-level README](../README.md).

## Read in this order

| Document | What it answers | Length |
|---|---|---|
| [decisions.md](decisions.md) | What was wrong with the original code, what changed, and why. Every judgment call names the alternative that was not taken. Start here. | Long |
| [flow.md](flow.md) | How data moves from the PMS into the database and onto the screen, as diagrams, plus the data model and the balance rule. | Medium |
| [data-findings.md](data-findings.md) | What the PMS data actually contains, with a command to reproduce each number. The evidence behind `decisions.md`. | Short |
| [opportunities.md](opportunities.md) | Where this could go next, ordered by how directly each idea helps an accountant reconcile. | Medium |
| [ai-usage.md](ai-usage.md) | Which AI tools were used, what was verified rather than trusted, and the mistakes the checks caught. | Short |

## Find something specific

| If you want to know | Look at |
|---|---|
| How a balance is computed, and what a negative amount means | [flow.md: How the balance is computed](flow.md#how-the-balance-is-computed) |
| Why the original import brought in nothing | [decisions.md: Defects in the original code](decisions.md#defects-in-the-original-code) |
| How local tenants are matched to PMS tenants | [decisions.md: Tenants are matched on the PMS id only](decisions.md#tenants-are-matched-on-the-pms-id-only-never-on-a-name) |
| What happens when a PMS entry disappears or is invalid | [decisions.md: marked removed](decisions.md#transactions-the-pms-no-longer-has-are-marked-removed-not-deleted), [one bad entry](decisions.md#one-bad-entry-holds-back-that-tenants-whole-ledger) |
| How security deposits are treated | [decisions.md: Security deposits](decisions.md#security-deposits-are-reported-apart-from-what-the-tenant-owes) |
| What a date range does to a ledger | [decisions.md: A date range carries an opening balance](decisions.md#a-date-range-carries-an-opening-balance) |
| What the roll-forward statement is | [decisions.md: The roll-forward statement](decisions.md#the-roll-forward-statement) |
| The import, step by step | [flow.md: Import](flow.md#import-pms-to-local-database) |
| The tables and their fields | [flow.md: Data model](flow.md#data-model) |
| Where the hand-checked balances come from | [data-findings.md](data-findings.md), and the table in [decisions.md](decisions.md#balance--charges-minus-payments-with-the-pms-sign-kept) |
| What is deliberately not built | [decisions.md: Not done, and why](decisions.md#not-done-and-why) |
| Questions still open for the customer | [decisions.md: Questions](decisions.md#questions-for-the-customer-and-the-pms-owner) |
| The API endpoints | [top-level README: Solution notes](../README.md#solution-notes) |

Working in this repo with an AI assistant: see [AGENTS.md](../AGENTS.md).
