import React, { useEffect, useState } from 'react';
import BalanceChart from './BalanceChart';
import { downloadFile } from './download';
import { formatDate, formatDateTime, formatMoney } from './format';
import { tenancy } from './ledgerStats';
import { useDialog } from './useDialog';

// Nothing on file at all: no entries, no period that could be hiding them,
// and nothing that was removed from the PMS.
function isEmpty(ledger) {
    return ledger.entries.length === 0 && !ledger.start && !ledger.end
        && ledger.removed_entries.length === 0;
}

function balanceLabel(ledger) {
    if (ledger.end) return `Balance as of ${formatDate(ledger.end)}`;
    // An empty ledger is not "paid in full": nothing was ever billed, or the
    // tenant has no PMS record to import from.
    if (isEmpty(ledger)) return 'Balance (no activity)';
    const value = Number(ledger.balance);
    if (value > 0) return 'Balance due';
    if (value < 0) return 'Credit balance';
    return 'Paid in full';
}

function tenancyLabel({ months }) {
    return `${months} ${months === 1 ? 'month' : 'months'}`;
}

function rangeQuery({ start, end }) {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return query ? `?${query}` : '';
}

function TenantLedger({ tenant, onClose }) {
    const [ledger, setLedger] = useState(null);
    const [error, setError] = useState(null);
    const [range, setRange] = useState({ start: '', end: '' });
    const { dialogRef, headingRef } = useDialog(onClose);
    const query = rangeQuery(range);

    useEffect(() => {
        let ignore = false;
        fetch(`/api/tenants/${tenant.id}/ledger/${query}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!ignore) {
                    setLedger(data);
                    setError(null);
                }
            })
            .catch(error => {
                console.error("Error fetching ledger:", error);
                if (!ignore) setError(error);
            });
        // Ignore a response that arrives after the ledger was closed or the
        // range changed again.
        return () => { ignore = true; };
    }, [tenant.id, query]);

    // Exports the same period that is on screen.
    const exportCsv = () => {
        downloadFile(`/api/tenants/${tenant.id}/ledger.csv${query}`, 'ledger.csv')
            .catch(error => {
                console.error("Error exporting ledger:", error);
                setError(new Error(`Export failed. ${error.message}`));
            });
    };

    const setRangeField = name => event => setRange({ ...range, [name]: event.target.value });
    const tenure = ledger && tenancy(ledger.entries);
    // Labels follow the response on screen, not the range just asked for, so
    // numbers are never shown under a heading for a period they do not cover.
    const ranged = Boolean(ledger && (ledger.start || ledger.end));
    const unknownBalance = Boolean(ledger && isEmpty(ledger) && ledger.tenant.pms_tenant_id === null);
    // A period's chart starts from the balance carried into it, like the table.
    const chartEntries = ledger && ledger.start
        ? [{ date: ledger.start, description: 'Opening balance', running_balance: ledger.opening_balance }, ...ledger.entries]
        : ledger && ledger.entries;

    return (
        <div className="ledger-backdrop" onClick={onClose}>
            <div
                className="ledger"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ledger-title"
                onClick={event => event.stopPropagation()}
            >
                <div className="ledger-header">
                    <h2 id="ledger-title" tabIndex={-1} ref={headingRef}>
                        Ledger: {tenant.name}{tenant.unit ? ` (Unit ${tenant.unit})` : ''}
                    </h2>
                    <button onClick={onClose}>Close</button>
                </div>
                <p className="ledger-meta">
                    {tenant.pms_tenant_id === null ? 'No PMS record' : `PMS tenant ID ${tenant.pms_tenant_id}`}
                    {ledger && ledger.tenant.ledger_synced_at
                        && ` · Synced from the PMS ${formatDateTime(ledger.tenant.ledger_synced_at)}`}
                </p>

                {error && (
                    <p role="alert">
                        Error loading ledger: {error.message}
                        {ledger && ' The figures below are from before this error.'}
                    </p>
                )}
                {!error && !ledger && <p>Loading ledger...</p>}
                {ledger && (
                    <>
                        <div className="ledger-controls">
                            <label>
                                From
                                <input type="date" value={range.start} max={range.end || undefined} onChange={setRangeField('start')} />
                            </label>
                            <label>
                                To
                                <input type="date" value={range.end} min={range.start || undefined} onChange={setRangeField('end')} />
                            </label>
                            <button onClick={() => setRange({ start: '', end: '' })} disabled={!query}>
                                All dates
                            </button>
                            <button className="ledger-export" onClick={exportCsv}>Export CSV</button>
                        </div>
                        <dl className="ledger-summary">
                            <div>
                                <dt>{ranged ? 'Net charges in period' : 'Net charges'}</dt>
                                <dd>{formatMoney(ledger.total_charges)}</dd>
                            </div>
                            <div>
                                <dt>{ranged ? 'Net payments in period' : 'Net payments'}</dt>
                                <dd>{formatMoney(ledger.total_payments)}</dd>
                            </div>
                            <div className="ledger-balance">
                                <dt>{balanceLabel(ledger)}</dt>
                                {/* With no PMS record and nothing on file the balance is
                                    unknown, as on the tenant list, not $0.00. */}
                                <dd>{unknownBalance ? '—' : formatMoney(ledger.balance)}</dd>
                                {/* What the balance is made of. A deposit still owed is
                                    shown only when there is one. */}
                                <dd className="ledger-summary-detail">
                                    Rent and fees {formatMoney(ledger.rent_and_fees_receivable)}
                                    {Number(ledger.deposit_due) !== 0 && `, deposit ${formatMoney(ledger.deposit_due)}`}
                                </dd>
                            </div>
                            <div>
                                <dt>Deposit held</dt>
                                <dd>{formatMoney(ledger.deposit_held)}</dd>
                                <dd className="ledger-summary-detail">The tenant's money, not part of the balance</dd>
                            </div>
                            {tenure && (
                                <div>
                                    <dt>{ranged ? 'Activity in period' : 'Tenant for'}</dt>
                                    <dd>{tenancyLabel(tenure)}</dd>
                                    <dd className="ledger-summary-detail">
                                        {formatDate(tenure.first)} to {formatDate(tenure.last)}, by ledger activity
                                    </dd>
                                </div>
                            )}
                        </dl>
                        <BalanceChart
                            entries={chartEntries}
                            onSelectRange={(start, end) => setRange({ start, end })}
                        />
                        {isEmpty(ledger) ? (
                            <p>
                                No transactions found for this tenant.
                                {ledger.tenant.pms_tenant_id === null && ' This tenant is not linked to a PMS record.'}
                            </p>
                        ) : (
                            <div className="ledger-table-scroll">
                                <table>
                                    <caption className="visually-hidden">
                                        Transactions for {tenant.name}, oldest first, with running balance
                                    </caption>
                                    <thead>
                                        <tr>
                                            <th scope="col">Date</th>
                                            <th scope="col">Description</th>
                                            <th scope="col" className="money">Charge</th>
                                            <th scope="col" className="money">Payment</th>
                                            <th scope="col" className="money">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledger.start && (
                                            <tr className="opening-balance">
                                                <td>{formatDate(ledger.start)}</td>
                                                <td>Opening balance</td>
                                                <td />
                                                <td />
                                                <td className="money">{formatMoney(ledger.opening_balance)}</td>
                                            </tr>
                                        )}
                                        {ledger.entries.map(entry => (
                                            <tr key={entry.id}>
                                                <td>{formatDate(entry.date)}</td>
                                                <td>
                                                    {entry.description}
                                                    {entry.category === 'deposit' && <span className="badge">Deposit</span>}
                                                </td>
                                                <td className="money">
                                                    {entry.type === 'charge' ? formatMoney(entry.amount) : ''}
                                                </td>
                                                <td className="money">
                                                    {entry.type === 'payment' ? formatMoney(entry.amount) : ''}
                                                </td>
                                                <td className="money">{formatMoney(entry.running_balance)}</td>
                                            </tr>
                                        ))}
                                        {ledger.entries.length === 0 && (
                                            <tr>
                                                <td colSpan={5}>No transactions in this period.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {ledger.removed_entries.length > 0 && (
                            <details className="ledger-section">
                                <summary>Removed from the PMS ({ledger.removed_entries.length})</summary>
                                <p>
                                    These entries were imported and later disappeared from the PMS.
                                    They are kept for reference and are not part of the balance.
                                </p>
                                <table>
                                    <thead>
                                        <tr>
                                            <th scope="col">Date</th>
                                            <th scope="col">Description</th>
                                            <th scope="col">Type</th>
                                            <th scope="col" className="money">Amount</th>
                                            <th scope="col">Removed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledger.removed_entries.map(entry => (
                                            <tr key={entry.id}>
                                                <td>{formatDate(entry.date)}</td>
                                                <td>{entry.description}</td>
                                                <td>{entry.type}</td>
                                                <td className="money">{formatMoney(entry.amount)}</td>
                                                <td>{formatDateTime(entry.removed_from_pms_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </details>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default TenantLedger;
