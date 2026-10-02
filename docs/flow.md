# How the ledger works, end to end

Two flows meet in the local database. The **import** copies tenants and their
ledgers from the PMS into SQLite. The **read path** serves that copy to the
browser. The PMS is never called while a user is looking at a ledger.

## Import: PMS to local database

Run with `python manage.py import_transactions` from `backend/`.

```mermaid
flowchart TD
    A[import_transactions command] --> B{--source given?}
    B -- no --> C["GET /tenants/?includeLedgers=true<br/>30 s timeout"]
    B -- yes --> D[Read saved PMS response from file]
    C --> E{Response is a<br/>list of tenants?}
    D --> E
    E -- no --> X[CommandError: exit non-zero,<br/>nothing written]
    E -- yes --> F[For each PMS tenant]
    F --> G{Has tenant_id<br/>and a ledger list?}
    G -- no --> R[Record error, leave tenant untouched]
    G -- yes --> H[Open a database transaction<br/>for this tenant]
    H --> I{Local tenant with this<br/>pms_tenant_id?}
    I -- yes --> L[Update name and unit from the PMS]
    I -- no --> J{Exactly one unlinked local<br/>tenant with the same name?}
    J -- yes --> K[Link it: set pms_tenant_id] --> L
    J -- no --> M[Create a new tenant] --> L
    L --> N{Every ledger entry valid?<br/>known type, ISO date,<br/>whole cents, unique id}
    N -- no --> O[Roll back this tenant] --> R
    N -- yes --> P["Sync by (tenant, pms_id):<br/>create new, update changed,<br/>delete entries the PMS no longer has"]
    P --> Q[Commit]
    Q --> F
    R --> F
    F -- done --> S{Any errors?}
    S -- yes --> X2[Print summary and errors,<br/>exit non-zero]
    S -- no --> T[Print summary, exit 0]
```

Code: `backend/api/management/commands/import_transactions.py` is the thin
command; the rules live in `backend/api/services/pms_import.py`.

## Read path: View Ledger

```mermaid
sequenceDiagram
    actor U as Accountant
    participant R as React app
    participant D as Django API
    participant DB as SQLite

    U->>R: Open the dashboard
    R->>D: GET /api/tenants/
    D->>DB: Tenants annotated with balance<br/>(one query, Tenant.objects.with_balance)
    DB-->>D: rows
    D-->>R: [{id, pms_tenant_id, name, unit, balance}]
    R-->>U: Tenant table: sort by any column,<br/>filter by unit prefix and balance range

    U->>R: Click View Ledger
    R->>D: GET /api/tenants/{id}/ledger/
    D->>DB: That tenant's transactions
    DB-->>D: rows
    Note over D: build_ledger: sort by date then PMS id,<br/>accumulate the running balance in Decimal
    D-->>R: {tenant, total_charges, total_payments,<br/>balance, entries[...running_balance]}
    R-->>U: Ledger dialog: Date, Description,<br/>Charge, Payment, Balance

    U->>R: Open the Insights tab
    R->>D: GET /api/tenants/ and<br/>GET /api/reports/monthly-activity/
    D-->>R: balances, monthly charges and payments
    R-->>U: Totals, monthly trend, balance by building,<br/>largest balances due
```

Code: views in `backend/api/views.py`, balance rules in
`backend/api/services/ledger.py` and `Tenant.objects.with_balance()` in
`backend/api/models.py`, UI in `frontend/src/TenantList.js`,
`frontend/src/TenantLedger.js` and `frontend/src/Insights.js`.

## Data model

```mermaid
erDiagram
    TENANT ||--o{ TRANSACTION : has
    TENANT {
        bigint id PK "local id, never compared to PMS ids"
        int pms_tenant_id UK "PMS tenant_id, null if unlinked"
        string name
        string unit
    }
    TRANSACTION {
        bigint id PK "local id"
        bigint tenant_id FK
        string pms_id "PMS transaction id, unique per tenant"
        date date
        string description
        string type "charge or payment"
        decimal amount "as the PMS sends it, sign included"
    }
```

## How the balance is computed

The balance is what the tenant owes. It is never stored; it is derived from
the transactions every time, so it cannot drift from them.

```
effect of an entry = amount    when type is "charge"
                   = -amount   when type is "payment"

balance = sum of effects = total charges - total payments
```

Amounts keep the sign the PMS sends, and the type decides the direction:

| PMS entry | Example | Effect on balance |
|---|---|---|
| charge, positive | Rent Charge 1,500 | +1,500 |
| charge, negative | Utility Credit -80 | -80 (a credit) |
| payment, positive | Rent Payment 1,500 | -1,500 |
| payment, negative | Returned Payment - NSF -1,375 | +1,375 (the payment bounced) |

A positive balance is shown as "Balance due", a negative one as "Credit
balance", zero as "Paid in full". A tenant with no transactions at all is
shown as "no activity" rather than "Paid in full".
