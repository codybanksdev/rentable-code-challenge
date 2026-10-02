import React, { useCallback, useEffect, useState } from 'react';
import TenantLedger from './TenantLedger';
import { formatMoney } from './format';
import {
    COLUMNS, NO_FILTERS, filterTenants, nextSort, sortTenants, unitPrefixes,
} from './tenantFilters';

function TenantList() {
    // null until the first response, so "loading" and "no tenants" are distinct.
    const [tenants, setTenants] = useState(null);
    const [error, setError] = useState(null);
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
    const [filters, setFilters] = useState(NO_FILTERS);
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

    if (tenants === null) {
        return <div>Loading tenants...</div>;
    }

    const setFilter = name => event => setFilters({ ...filters, [name]: event.target.value });
    const visibleTenants = sortTenants(filterTenants(tenants, filters), sort);
    const filtered = Object.keys(NO_FILTERS).some(name => filters[name] !== '');

    return (
        <div className="tenant-list">
            <h2>Tenants</h2>
            {tenants.length === 0 ? (
                <p>No tenants found.</p>
            ) : (
                <>
                    <div className="tenant-filters">
                        <label>
                            Unit prefix
                            <select value={filters.unitPrefix} onChange={setFilter('unitPrefix')}>
                                <option value="">All</option>
                                {unitPrefixes(tenants).map(prefix => (
                                    <option key={prefix} value={prefix}>{prefix}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Min balance
                            <input
                                type="number"
                                step="any"
                                value={filters.minBalance}
                                onChange={setFilter('minBalance')}
                            />
                        </label>
                        <label>
                            Max balance
                            <input
                                type="number"
                                step="any"
                                value={filters.maxBalance}
                                onChange={setFilter('maxBalance')}
                            />
                        </label>
                        <button onClick={() => setFilters(NO_FILTERS)} disabled={!filtered}>
                            Clear filters
                        </button>
                        <span role="status">
                            Showing {visibleTenants.length} of {tenants.length} tenants
                        </span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                {COLUMNS.map(column => {
                                    const active = sort.key === column.key;
                                    const direction = sort.direction === 'asc' ? 'ascending' : 'descending';
                                    return (
                                        <th
                                            key={column.key}
                                            className={column.key === 'balance' ? 'money' : undefined}
                                            aria-sort={active ? direction : 'none'}
                                        >
                                            <button
                                                className="sort-button"
                                                onClick={() => setSort(nextSort(sort, column.key))}
                                            >
                                                {column.label}
                                                <span aria-hidden="true">
                                                    {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                                                </span>
                                            </button>
                                        </th>
                                    );
                                })}
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleTenants.map(tenant => (
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
                            {visibleTenants.length === 0 && (
                                <tr>
                                    <td colSpan={COLUMNS.length + 1}>No tenants match these filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
        </div>
    );
}

export default TenantList;
