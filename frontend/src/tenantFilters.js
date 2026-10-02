// Pure sorting and filtering for the tenant table, kept out of the component
// so the rules can be tested without rendering anything.

export const COLUMNS = [
    { key: 'id', label: 'ID', numeric: true },
    { key: 'name', label: 'Name' },
    { key: 'unit', label: 'Unit' },
    { key: 'balance', label: 'Balance', numeric: true },
];

export const NO_FILTERS = { unitPrefix: '', minBalance: '', maxBalance: '' };

// "A101" -> "A". Units with no leading letter have no prefix.
export function unitPrefix(unit) {
    const first = (unit || '').charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '';
}

export function unitPrefixes(tenants) {
    return [...new Set(tenants.map(tenant => unitPrefix(tenant.unit)).filter(Boolean))].sort();
}

// A blank or non-numeric bound means "no bound", so a half-typed value such
// as "-" does not hide every row.
function parseBound(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function filterTenants(tenants, { unitPrefix: prefix, minBalance, maxBalance }) {
    const min = parseBound(minBalance);
    const max = parseBound(maxBalance);
    return tenants.filter(tenant => {
        const balance = Number(tenant.balance);
        if (prefix && unitPrefix(tenant.unit) !== prefix) return false;
        if (min !== null && balance < min) return false;
        if (max !== null && balance > max) return false;
        return true;
    });
}

const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

export function sortTenants(tenants, { key, direction }) {
    const column = COLUMNS.find(candidate => candidate.key === key);
    const sign = direction === 'desc' ? -1 : 1;
    return [...tenants].sort((a, b) => {
        const order = column.numeric
            ? Number(a[key]) - Number(b[key])
            // Numeric collation puts unit "A2" before "A10".
            : collator.compare(a[key] || '', b[key] || '');
        // Ties fall back to id so the order never depends on the previous sort.
        return (order || a.id - b.id) * sign;
    });
}

// Clicking the active column flips it; clicking another starts ascending.
export function nextSort(current, key) {
    if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    }
    return { key, direction: 'asc' };
}
