import { filterTenants, nextSort, NO_FILTERS, sortTenants, unitPrefix, unitPrefixes } from './tenantFilters';

const tenants = [
    { id: 1, name: 'Alice', unit: 'A101', balance: '0.00' },
    { id: 2, name: 'bob', unit: 'B205', balance: '2425.00' },
    { id: 3, name: 'Daisy', unit: 'A20', balance: '-550.00' },
    { id: 4, name: 'Carl', unit: null, balance: '50.00' },
];

const ids = list => list.map(tenant => tenant.id);

test('unit prefix is the leading letter, upper-cased, or empty', () => {
    expect([unitPrefix('A101'), unitPrefix('b2'), unitPrefix('101'), unitPrefix(null)]).toEqual(['A', 'B', '', '']);
    expect(unitPrefixes(tenants)).toEqual(['A', 'B']);
});

test('no filters keeps every tenant', () => {
    expect(ids(filterTenants(tenants, NO_FILTERS))).toEqual([1, 2, 3, 4]);
});

test('filters by unit prefix', () => {
    expect(ids(filterTenants(tenants, { ...NO_FILTERS, unitPrefix: 'A' }))).toEqual([1, 3]);
});

test('min and max balance are inclusive and combine', () => {
    expect(ids(filterTenants(tenants, { ...NO_FILTERS, minBalance: '50' }))).toEqual([2, 4]);
    expect(ids(filterTenants(tenants, { ...NO_FILTERS, maxBalance: '0' }))).toEqual([1, 3]);
    expect(ids(filterTenants(tenants, { ...NO_FILTERS, minBalance: '-600', maxBalance: '50' }))).toEqual([1, 3, 4]);
});

test('a half-typed bound is ignored rather than hiding every row', () => {
    expect(ids(filterTenants(tenants, { ...NO_FILTERS, minBalance: '-' }))).toEqual([1, 2, 3, 4]);
});

test('balance sorts as a number, not as text', () => {
    expect(ids(sortTenants(tenants, { key: 'balance', direction: 'asc' }))).toEqual([3, 1, 4, 2]);
    expect(ids(sortTenants(tenants, { key: 'balance', direction: 'desc' }))).toEqual([2, 4, 1, 3]);
});

test('unit sorts naturally and name ignores case', () => {
    expect(ids(sortTenants(tenants, { key: 'unit', direction: 'asc' }))).toEqual([4, 3, 1, 2]);
    expect(ids(sortTenants(tenants, { key: 'name', direction: 'asc' }))).toEqual([1, 2, 4, 3]);
});

test('sorting does not mutate its input', () => {
    sortTenants(tenants, { key: 'balance', direction: 'desc' });
    expect(ids(tenants)).toEqual([1, 2, 3, 4]);
});

test('clicking the active column flips direction; another column starts ascending', () => {
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'balance')).toEqual({ key: 'balance', direction: 'asc' });
});
