import React, { useCallback, useEffect, useState } from 'react';
import TenantLedger from './TenantLedger';
import { formatMoney } from './format';

function TenantList() {
    const [tenants, setTenants] = useState([]);
    const [error, setError] = useState(null);
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const closeLedger = useCallback(() => setLedgerTenant(null), []);

    useEffect(() => {
        fetch('/api/tenants/')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => setTenants(data))
            .catch(error => {
                console.error("Error fetching tenants:", error);
                setError(error);
            });
    }, []);

    if (error) {
        return <div>Error loading tenants: {error.message}</div>;
    }

    return (
        <div className="tenant-list">
            <h2>Tenants</h2>
            {tenants.length === 0 ? (
                <p>No tenants found.</p>
            ) : (
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Unit</th>
                            <th className="money">Balance</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tenants.map(tenant => (
                            <tr key={tenant.id}>
                                <td>{tenant.id}</td>
                                <td>{tenant.name}</td>
                                <td>{tenant.unit}</td>
                                <td className="money">{formatMoney(tenant.balance)}</td>
                                <td>
                                    <button
                                        aria-label={`View ledger for ${tenant.name}`}
                                        onClick={() => setLedgerTenant(tenant)}
                                    >
                                        View Ledger
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
        </div>
    );
}

export default TenantList; 