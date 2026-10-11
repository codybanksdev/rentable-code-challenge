import React, { useCallback, useEffect, useState } from 'react';
import LabelChip from './LabelChip';
import TenantLedger from './TenantLedger';
import { getJson } from './api';
import { formatMoney } from './format';

// Tenants grouped by label: the accounting team's worklists.
function LabelsTab() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [labelId, setLabelId] = useState('');
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const closeLedger = useCallback(() => setLedgerTenant(null), []);

    useEffect(() => {
        let ignore = false;
        Promise.all([getJson('/api/tenants/'), getJson('/api/labels/')])
            .then(([tenants, labels]) => {
                if (!ignore) setData({ tenants, labels });
            })
            .catch(error => {
                console.error("Error fetching labels:", error);
                if (!ignore) setError(error);
            });
        return () => { ignore = true; };
    }, []);

    if (error) {
        return <div role="alert">Error loading labels: {error.message}</div>;
    }
    if (!data) {
        return <div>Loading labels...</div>;
    }

    const shown = data.labels.filter(label => labelId === '' || String(label.id) === labelId);
    return (
        <div className="labels-tab">
            <h2>Tenants by label</h2>
            <div className="tenant-filters">
                <label>
                    Label
                    <select value={labelId} onChange={event => setLabelId(event.target.value)}>
                        <option value="">All labels</option>
                        {data.labels.map(label => (
                            <option key={label.id} value={label.id}>{label.name}</option>
                        ))}
                    </select>
                </label>
            </div>
            {shown.map(label => {
                const tenants = data.tenants.filter(tenant => tenant.labels.some(own => own.id === label.id));
                // Credits do not offset what other tenants owe.
                const owed = tenants.reduce((total, tenant) => total + Math.max(Number(tenant.balance), 0), 0);
                return (
                    <section key={label.id} className="label-group" aria-label={label.name}>
                        <h3>
                            <LabelChip label={label} />
                            <span className="label-group-count">
                                {tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}
                                {tenants.length > 0 && `, ${formatMoney(owed)} due`}
                            </span>
                        </h3>
                        {tenants.length === 0 ? <p>No tenants have this label.</p> : (
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">PMS ID</th>
                                        <th scope="col">Name</th>
                                        <th scope="col">Unit</th>
                                        <th scope="col" className="money">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tenants.map(tenant => (
                                        <tr key={tenant.id}>
                                            <td>{tenant.pms_tenant_id ?? '—'}</td>
                                            <td>
                                                <button
                                                    className="link-button"
                                                    aria-label={`View ledger for ${tenant.name}`}
                                                    onClick={() => setLedgerTenant(tenant)}
                                                >
                                                    {tenant.name}
                                                </button>
                                            </td>
                                            <td>{tenant.unit}</td>
                                            <td className="money">
                                                {tenant.balance === null ? '—' : formatMoney(tenant.balance)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                );
            })}
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
        </div>
    );
}

export default LabelsTab;
