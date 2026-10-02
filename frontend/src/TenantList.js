import React, { useCallback, useEffect, useState } from 'react';
import LabelChip from './LabelChip';
import LabelEditor from './LabelEditor';
import SortableHeader from './SortableHeader';
import TenantLedger from './TenantLedger';
import { getJson } from './api';
import { formatDate, formatDateTime, formatMoney } from './format';
import {
    COLUMNS, NO_FILTERS, filterTenants, sortTenants, unitPrefixes,
} from './tenantFilters';

function TenantList() {
    // null until the first response, so "loading" and "no tenants" are distinct.
    const [tenants, setTenants] = useState(null);
    const [error, setError] = useState(null);
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
    const [filters, setFilters] = useState(NO_FILTERS);
    // Blank means today. Otherwise balances are as of the close of this day.
    const [asOf, setAsOf] = useState('');
    const closeLedger = useCallback(() => setLedgerTenant(null), []);
    const [labels, setLabels] = useState([]);
    const [labelTenant, setLabelTenant] = useState(null);
    const closeLabels = useCallback(() => setLabelTenant(null), []);

    useEffect(() => {
        let ignore = false;
        fetch(`/api/tenants/${asOf ? `?as_of=${asOf}` : ''}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            // The date is kept with the rows so the heading always describes
            // the balances on screen.
            .then(data => {
                if (!ignore) setTenants(data.map(tenant => ({ ...tenant, asOf })));
            })
            .catch(error => {
                console.error("Error fetching tenants:", error);
                if (!ignore) setError(error);
            });
        return () => { ignore = true; };
    }, [asOf]);

    useEffect(() => {
        // Labels are an extra: the list is still usable if they fail to load.
        getJson('/api/labels/').then(setLabels).catch(error => console.error("Error fetching labels:", error));
    }, []);

    if (error) {
        return <div>Error loading tenants: {error.message}</div>;
    }

    if (tenants === null) {
        return <div>Loading tenants...</div>;
    }

    const applyLabels = (tenantId, saved) => setTenants(
        tenants.map(tenant => (tenant.id === tenantId ? { ...tenant, labels: saved } : tenant)),
    );
    const setFilter = name => event => setFilters({ ...filters, [name]: event.target.value });
    const visibleTenants = sortTenants(filterTenants(tenants, filters), sort);
    const filtered = Object.keys(NO_FILTERS).some(name => filters[name] !== '');
    // ISO timestamps sort as text; the newest is when the PMS was last read.
    const lastSynced = tenants.map(tenant => tenant.ledger_synced_at).filter(Boolean).sort().pop();
    const shownAsOf = tenants.length > 0 ? tenants[0].asOf : '';
    const neverSynced = tenants.filter(tenant => !tenant.ledger_synced_at).length;

    return (
        <div className="tenant-list">
            <h2 className="visually-hidden">Tenants</h2>
            <p className="sync-status">
                {lastSynced
                    ? `Most recent ledger sync from the PMS: ${formatDateTime(lastSynced)}.`
                    : 'Ledgers have not been synced from the PMS yet.'}
                {/* The newest time says nothing about the rest, so say how
                    many have never been synced at all. */}
                {lastSynced && neverSynced > 0 && ` ${neverSynced} never synced.`}
            </p>
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
                            Label
                            <select value={filters.labelId} onChange={setFilter('labelId')}>
                                <option value="">All</option>
                                {labels.map(label => (
                                    <option key={label.id} value={label.id}>{label.name}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Balances as of
                            <input type="date" value={asOf} onChange={event => setAsOf(event.target.value)} />
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
                    {shownAsOf && (
                        <p className="as-of-note" role="note">
                            Balances are as of {formatDate(shownAsOf)}, not today.
                        </p>
                    )}
                    <table>
                        <caption className="visually-hidden">Tenants and their balances</caption>
                        <thead>
                            <tr>
                                {COLUMNS.map(column => (
                                    <SortableHeader key={column.key} column={column} sort={sort} onSort={setSort} />
                                ))}
                                <th scope="col">Labels</th>
                                <th scope="col">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleTenants.map(tenant => (
                                <tr key={tenant.id}>
                                    <td>{tenant.pms_tenant_id ?? <span title="No PMS record">—</span>}</td>
                                    <td>{tenant.name}</td>
                                    <td>{tenant.unit}</td>
                                    <td className="money">
                                        {tenant.balance === null
                                            ? <span title="No PMS record and no transactions">—</span>
                                            : formatMoney(tenant.balance)}
                                    </td>
                                    <td className="label-cell">
                                        {(tenant.labels || []).map(label => <LabelChip key={label.id} label={label} />)}
                                        <button
                                            className="link-button"
                                            aria-label={`Edit labels for ${tenant.name}`}
                                            onClick={() => setLabelTenant(tenant)}
                                        >
                                            Edit
                                        </button>
                                    </td>
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
                                    <td colSpan={COLUMNS.length + 2}>No tenants match these filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
            {labelTenant && (
                <LabelEditor
                    tenant={labelTenant}
                    labels={labels}
                    onClose={closeLabels}
                    onSaved={applyLabels}
                    onLabelCreated={label => setLabels([...labels, label])}
                />
            )}
        </div>
    );
}

export default TenantList;
