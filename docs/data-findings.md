# What the PMS data looks like

Everything in `docs/decisions.md` rests on these measurements. Each one can
be reproduced with the command beside it.

Save the response once:

```bash
curl -sS 'https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws/api/simulated-pms-integration-api/tenants/?includeLedgers=true' -o pms.json
```

| Finding | Value | Command |
|---|---|---|
| Tenants | 200 | `jq 'length' pms.json` |
| Ledger entries | 4,424 | `jq '[.[].ledger[]] \| length' pms.json` |
| Entries per tenant | 6 to 51 | `jq '[.[].ledger \| length] \| min, max' pms.json` |
| Transaction types | charge 2,491, payment 1,933 | `jq '[.[].ledger[]] \| group_by(.type) \| map({type: .[0].type, n: length})' pms.json` |
| Negative amounts | 213 (132 charges, 81 payments) | `jq '[.[].ledger[] \| select(.amount < 0)] \| group_by(.type) \| map({type: .[0].type, n: length})' pms.json` |
| Transaction id type | string | `jq '[.[].ledger[].id \| type] \| unique' pms.json` |
| Tenant id type | number | `jq '[.[].tenant_id \| type] \| unique' pms.json` |
| Transaction ids unique overall | 4,424 distinct | `jq '[.[].ledger[].id] \| unique \| length' pms.json` |
| Date format | all `YYYY-MM-DD` | `jq '[.[].ledger[].date \| gsub("[0-9]"; "9")] \| unique' pms.json` |
| Date range | 2021-12-17 to 2023-12-26 | `jq '[.[].ledger[].date] \| min, max' pms.json` |
| Amounts with cents | 0 | `jq '[.[].ledger[] \| select(.amount != (.amount \| floor))] \| length' pms.json` |
| Ledgers not in date order | 0 | `jq '[.[] \| select((.ledger \| map(.date)) != (.ledger \| map(.date) \| sort))] \| length' pms.json` |
| Ledgers where date-then-id order differs from PMS order | 0 | `jq '[.[] \| select((.ledger \| map([.date, (.id \| tonumber)])) != (.ledger \| map([.date, (.id \| tonumber)]) \| sort))] \| length' pms.json` |
| Tenants with a balance due / settled / in credit | 155 / 25 / 20 | `jq '[.[] \| .ledger \| map(if .type == "payment" then -.amount else .amount end) \| add] \| [map(select(. > 0)), map(select(. == 0)), map(select(. < 0))] \| map(length)' pms.json` |
| Sum of all balances | 449,037 | `jq '[.[].ledger[] \| if .type == "payment" then -.amount else .amount end] \| add' pms.json` |
| Security deposit entries | 200 charges and 200 payments, 208,250 each | `jq '[.[].ledger[] \| select(.description \| test("deposit"; "i"))] \| group_by(.description) \| map({d: .[0].description, n: length, total: (map(.amount) \| add)})' pms.json` |
| Naive sum of amounts, ignoring type | 5,198,353 | `jq '[.[].ledger[].amount] \| add' pms.json` |

## What the negative amounts are

Negative charges are credits. Every one has one of five descriptions:
Maintenance Inconvenience Credit, Rent Concession, Move-in Special Credit,
Utility Credit, Late Fee Waived.

Negative payments are returned payments. All 81 are described as
"Returned Payment - NSF (... Rent)", and each comes with a "Returned Payment
Fee" charge.

```bash
jq '[.[].ledger[] | select(.amount < 0) | {type, kind: (.description | gsub(" - .*"; "") | gsub(" \\(.*"; ""))}] | group_by(.kind) | map({kind: .[0].kind, type: .[0].type, n: length})' pms.json
```

## Local tenants against PMS tenants

```bash
jq '.[0:3] | map({tenant_id, name, unit})' pms.json
```

| | Seeded locally | In the PMS |
|---|---|---|
| 1 | Alice Wonderland, A101 | Alice Wonderland, A101 |
| 2 | Bob The Builder, B202 | Bob The Builder, **B205** |
| 3 | Charlie Chaplin, C303 | **Daisy Ridley**, C303 |

Charlie Chaplin is not in the PMS at all. PMS unit B202 belongs to tenant 83.

## How the API behaves

- Without `includeLedgers=true` it returns the same tenants with no `ledger`
  key, and still HTTP 200.
- Two consecutive calls returned byte-identical bodies.
- One call returns everything (about 520 KB); there is no pagination.
