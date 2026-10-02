import React, { useEffect, useRef, useState } from 'react';
import BalanceChart from './BalanceChart';
import { downloadFile } from './download';
import { formatDate, formatDateTime, formatMoney } from './format';
import { tenancy } from './ledgerStats';

function balanceLabel(ledger) {
    if (ledger.end) return `Balance as of ${formatDate(ledger.end)}`;
    // An empty ledger is not "paid in full": nothing was ever billed, or the
    // tenant has no PMS record to import from.
    if (ledger.entries.length === 0 && !ledger.start) return 'Balance (no activity)';
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
    const headingRef = useRef(null);
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

    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    // Move focus into the dialog when it opens and hand it back to whatever
    // opened it on close, so keyboard and screen reader users keep their place.
    useEffect(() => {
        const opener = document.activeElement;
        headingRef.current.focus();
        return () => {
            if (opener && opener.focus) opener.focus();
        };
    }, []);

    // Exports the same period that is on screen.
    const exportCsv = () => {
        downloadFile(`/api/tenants/${tenant.id}/ledger.csv${query}`, `ledger-tenant-${tenant.id}.csv`)
            .catch(error => {
                console.error("Error exporting ledger:", error);
                setError(error);
            });
    };

    const setRangeField = name => event => setRange({ ...range, [name]: event.target.value });
    const tenure = ledger && tenancy(ledger.entries);

    return (
        <div className="ledger-backdrop" onClick={onClose}>
            <div
                className="ledger"
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

                {error && <p role="alert">Error loading ledger: {error.message}</p>}
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
                                <dt>{query ? 'Charges in period' : 'Total charges'}</dt>
                                <dd>{formatMoney(ledger.total_charges)}</dd>
                            </div>
                            <div>
                                <dt>{query ? 'Payments in period' : 'Total payments'}</dt>
                                <dd>{formatMoney(ledger.total_payments)}</dd>
                            </div>
                            <div className="ledger-balance">
                                <dt>{balanceLabel(ledger)}</dt>
                                <dd>{formatMoney(ledger.balance)}</dd>
                            </div>
                            {tenure && (
                                <div>
                                    <dt>{query ? 'Activity in period' : 'Tenant for'}</dt>
                                    <dd>{tenancyLabel(tenure)}</dd>
                                    <dd className="ledger-summary-detail">
                                        {formatDate(tenure.first)} to {formatDate(tenure.last)}, by ledger activity
                                    </dd>
                                </div>
                            )}
                        </dl>
                        <BalanceChart entries={ledger.entries} />
                        {ledger.entries.length === 0 && !ledger.start ? (
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
                                                <td>{entry.description}</td>
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
