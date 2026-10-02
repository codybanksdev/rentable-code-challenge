import React, { useEffect, useState } from 'react';
import { formatDate, formatMoney } from './format';

function balanceLabel(balance) {
    const value = Number(balance);
    if (value > 0) return 'Balance due';
    if (value < 0) return 'Credit balance';
    return 'Paid in full';
}

function TenantLedger({ tenant, onClose }) {
    const [ledger, setLedger] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let ignore = false;
        fetch(`/api/tenants/${tenant.id}/ledger/`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!ignore) setLedger(data);
            })
            .catch(error => {
                console.error("Error fetching ledger:", error);
                if (!ignore) setError(error);
            });
        // Ignore a response that arrives after the ledger was closed.
        return () => { ignore = true; };
    }, [tenant.id]);

    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

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
                    <h2 id="ledger-title">
                        Ledger: {tenant.name}{tenant.unit ? ` (Unit ${tenant.unit})` : ''}
                    </h2>
                    <button autoFocus onClick={onClose}>Close</button>
                </div>

                {error && <p role="alert">Error loading ledger: {error.message}</p>}
                {!error && !ledger && <p>Loading ledger...</p>}
                {ledger && (
                    <>
                        <dl className="ledger-summary">
                            <div>
                                <dt>Total charges</dt>
                                <dd>{formatMoney(ledger.total_charges)}</dd>
                            </div>
                            <div>
                                <dt>Total payments</dt>
                                <dd>{formatMoney(ledger.total_payments)}</dd>
                            </div>
                            <div className="ledger-balance">
                                <dt>{balanceLabel(ledger.balance)}</dt>
                                <dd>{formatMoney(ledger.balance)}</dd>
                            </div>
                        </dl>
                        {ledger.entries.length === 0 ? (
                            <p>No transactions found for this tenant.</p>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Description</th>
                                        <th className="money">Charge</th>
                                        <th className="money">Payment</th>
                                        <th className="money">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
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
                                </tbody>
                            </table>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default TenantLedger;
