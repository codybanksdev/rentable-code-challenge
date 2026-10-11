import { dayNumber, tenancy } from './ledgerStats';

const on = date => ({ date });

test('tenancy counts calendar months from first to last entry, inclusive', () => {
    expect(tenancy([on('2022-12-20'), on('2023-01-01'), on('2023-03-05')]))
        .toEqual({ first: '2022-12-20', last: '2023-03-05', months: 4 });
});

test('entries in one month are one month, whatever order they arrive in', () => {
    expect(tenancy([on('2023-01-28'), on('2023-01-02')]))
        .toEqual({ first: '2023-01-02', last: '2023-01-28', months: 1 });
});

test('an empty ledger has no tenancy', () => {
    expect(tenancy([])).toBeNull();
});

test('day numbers are whole days apart with no time zone drift', () => {
    expect(dayNumber('2023-03-01') - dayNumber('2023-02-28')).toBe(1);
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2);
});
