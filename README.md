# Rentable Full Stack Code Challenge

## Table of Contents
* [Project Overview](#project-overview)
    * [Simulated PMS API](#simulated-pms-api)
        * [API Spec](#api-spec)
* [Getting Started](#getting-started)
    * [Loading the ledgers](#loading-the-ledgers)
    * [Running the tests](#running-the-tests)
    * [Solution notes](#solution-notes)
* [The Challenge](#the-challenge)
* [How to Submit](#how-to-submit)
* [FAQ](#faq)
* [Questions](#questions)

Welcome to the Rentable Full Stack Code Challenge! This challenge evaluates your ability to translate a business need into a working solution using AI-assisted development. AI tooling (e.g., Cursor, GitHub Copilot) is expected to be used, but you own every line of code you submit. Be prepared to walk through your implementation and explain why you chose the code you submitted.

## Project Overview

This project simulates a property management system for managing tenant's and their transaction ledgers.

There is a **React front end** that displays a list of Tenants with a button for viewing transaction ledgers. 

There is a **Python and Django backend** with APIs that return tenants and their transactions. The Django backend utilizes a SQLite database.

Transactions can be imported from the PMS integration API into the local database using the `import_transactions` management command. This command was written before the API spec was available and hasn't been checked against it.

### Simulated PMS API

Tenant and transaction data comes from a simulated external Property Management System (PMS) integration API, hosted separately from this project.

#### API Spec

[`backend/api/integration-data/PMS_API_SPEC.md`](backend/api/integration-data/PMS_API_SPEC.md)

## Getting Started

This repo includes a [Dev Container](https://containers.dev/) config (`.devcontainer/`). It's the quickest way to get running: the container installs dependencies, migrates, and seeds the database for you. Not using Dev Containers? `.devcontainer/post_create.sh` shows what you'd need to do yourself.

Once set up, run `./start.sh` from the project root. The backend runs at [`http://127.0.0.1:8009/`](http://127.0.0.1:8009/) and the frontend at [`http://localhost:3009/`](http://localhost:3009/).

### Loading the ledgers

The dev container seeds three tenants but does not import transactions. To
load all tenants and their ledgers from the PMS (200 tenants, 4,424
transactions), run:

```bash
cd backend && python manage.py import_transactions
```

It is safe to run again at any time. Useful options:

* `--dry-run` reports what would change and writes nothing.
* `--source api/tests/fixtures/pms_tenants_sample.json` imports a saved PMS response instead of calling the API.

Set `LOG_FORMAT=json` to get the import's log events as one JSON object per line.

### Running the tests

```bash
cd backend && pytest
```

```bash
cd frontend && npm test
```

The end-to-end suite starts its own backend and frontend on ports 8009 and
3009 with a throwaway database, so stop `./start.sh` first:

```bash
cd e2e && npm install && npx playwright install chromium && npx playwright test
```

### Solution notes

What was built, in the order an accountant would use it:

* **Tenant list** with each tenant's balance, PMS id and labels. Sort by any column; filter by unit prefix, label and balance range; show balances as of a past date.
* **View Ledger** opens that tenant's transactions, oldest first, with a running balance, the balance split into rent and fees owed and deposit held, a balance-over-time chart, a date range with an opening balance, and CSV export.
* **Import** (`import_transactions`) that matches the PMS spec: it requests ledgers, keys on PMS ids, keeps the transaction type, validates every entry, and is safe to rerun.
* **Insights**: total outstanding, deposits held, a receivable roll-forward statement with control totals and CSV export, and monthly charts, all for a chosen date range.
* **Labels** for marking tenants ("At risk", "Requires follow up", "Defaulting", or your own).

The documents are indexed in [`docs/README.md`](docs/README.md). Start with `docs/decisions.md`:

* [`docs/decisions.md`](docs/decisions.md): what was wrong with the original code, what changed, and why.
* [`docs/flow.md`](docs/flow.md): how data moves from the PMS to the ledger on screen, with diagrams.
* [`docs/data-findings.md`](docs/data-findings.md): what the PMS data looks like, with the commands to reproduce each number.
* [`docs/opportunities.md`](docs/opportunities.md): where this could go next.
* [`docs/ai-usage.md`](docs/ai-usage.md): how AI was used and what was verified by hand.

API endpoints:

| Endpoint | Returns |
|---|---|
| `GET /api/tenants/` | Tenants, each with its balance, deposit held and labels. Optional `as_of` (`YYYY-MM-DD`) gives balances at the close of that day. |
| `GET /api/tenants/<id>/ledger/` | One tenant's transactions with a running balance and totals. Optional `start` and `end` (`YYYY-MM-DD`). |
| `GET /api/tenants/<id>/ledger.csv` | The same ledger as a CSV download |
| `PUT /api/tenants/<id>/labels/` | Replace a tenant's labels (`{"label_ids": [...]}`) |
| `GET /api/labels/`, `POST /api/labels/` | List labels, or create one (`{"name", "color"}`) |
| `GET /api/transactions/?tenant=<id>` | Raw transactions, optionally for one tenant |
| `GET /api/reports/monthly-activity/` | Per month: net charges, net payments, returned payments, collection rate, receivable at month end. Optional `start` and `end`. |
| `GET /api/reports/roll-forward/` | Per tenant for a period: opening, net charges, net payments, closing, with control totals. Optional `start` and `end`. |
| `GET /api/reports/roll-forward.csv` | The same statement as a CSV download, ending in a totals row |

## The Challenge

The Head of Accounting at Couchman & Wavehill, one of our largest customers, is asking for ledger functionality. Their accounting team needs more visibility into tenant financials to reconcile their books efficiently. A View Ledger button has been added, but it currently does nothing. When they click it, they should see that tenant's transactions. And they need to see the balance on there too. We're trying to expand our relationship with them, so we want to do everything we can so that they want to move forward.


## How to Submit

This project is configured as a GitHub Template repository for you to clone, solve, and then push to your own GitHub account. To submit your solution, please follow these steps:

1.  **Create Your Own Repository:** On the Rentable Full Stack Code Challenge GitHub page, click the green "Use this template" button. This will allow you to create a new repository under your own GitHub account, pre-populated with this challenge's codebase.

2.  **Clone Your Repository:** Clone your newly created repository to your local machine using `git clone`.

3.  **Complete the Challenge:** Work on the challenge within your local clone.

4.  **Push Your Changes:** Commit your changes and push them to your repository on GitHub.

5.  **IMPORTANT - Share the Link:** Share the URL of your completed GitHub repository with your hiring contact.


## FAQ

*   **Will this be part of the Technical Interview?:** Your submitted code will be reviewed during a follow-up technical interview, where we will discuss your how you went about learning the codebase and implementation details. We will also perform a live code exercise building upon your solution.

*   **Can I use AI Tooling?** Yes. AI development tools (e.g., GitHub Copilot, ChatGPT, Cursor AI) are expected to be used. Be prepared to thoroughly discuss your implementation decisions during the follow-up interview, including any choices suggested by AI tooling.

## Questions

If you have any questions about the challenge, please feel free to email your hiring contact.