import { formatMonth, largestBalances, outstandingByBuilding, portfolioSummary } from './insightsData';

const tenants = [
    { id: 1, name: 'Alice', unit: 'A101', balance: '0.00' },
    { id: 2, name: 'Bob', unit: 'B205', balance: '2425.00' },
    { id: 3, name: 'Daisy', unit: 'A20', balance: '1240.00' },
    { id: 4, name: 'Zed', unit: 'B1', balance: '-550.00' },
    { id: 5, name: 'Carl', unit: null, balance: '50.00' },
];

test('outstanding is what is owed, not netted against other tenants\' credits', () => {
    expect(portfolioSummary(tenants)).toEqual({
        outstanding: 3715, owingCount: 3, credit: -550, creditCount: 1, settledCount: 1,
    });
});

test('building totals ignore credits and sort by building', () => {
    expect(outstandingByBuilding(tenants)).toEqual([
        { label: 'A', value: 1240 },
        { label: 'B', value: 2425 },
        { label: 'Other', value: 50 },
    ]);
});

test('largest balances lists only tenants who owe, biggest first', () => {
    expect(largestBalances(tenants, 2)).toEqual([
        { label: 'Bob (B205)', value: 2425, tenant: tenants[1] },
        { label: 'Daisy (A20)', value: 1240, tenant: tenants[2] },
    ]);
});

test('formats a month without a time zone shift', () => {
    expect([formatMonth('2023-01'), formatMonth('2021-12')]).toEqual(['Jan 2023', 'Dec 2021']);
});

test('a tenant with no balance on file is not counted as settled', () => {
    const summary = portfolioSummary([...tenants, { id: 9, name: 'Nobody', unit: 'A1', balance: null }]);

    expect(summary.settledCount).toBe(1);
    expect(summary.outstanding).toBe(3715);
});
