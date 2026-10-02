import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { downloadFile } from './download';

jest.mock('./download');

const tenants = [
    { id: 1, pms_tenant_id: 1, name: 'Alice', unit: 'A101', balance: '0.00', deposit_held: '1000.00', labels: [] },
    { id: 2, pms_tenant_id: 2, name: 'Bob', unit: 'B205', balance: '2425.00', deposit_held: '900.00', labels: [] },
    { id: 3, pms_tenant_id: 3, name: 'Zed', unit: 'B1', balance: '-550.00', deposit_held: '0.00', labels: [] },
];
const tenantsInJanuary = tenants.map(tenant => (tenant.id === 2 ? { ...tenant, balance: '750.00' } : tenant));
const months = [
    { month: '2023-01', charges: '3000.00', payments: '1000.00', returned_payments: '0.00', returned_count: 0, collection_rate: '0.3333', receivable: '2000.00' },
    { month: '2023-02', charges: '1500.00', payments: '-425.00', returned_payments: '1925.00', returned_count: 2, collection_rate: '-0.2833', receivable: '3925.00' },
];
const statement = {
    start: null,
    end: null,
    rows: [
        { tenant_id: 2, pms_tenant_id: 2, name: 'Bob', unit: 'B205', opening: '0.00', charges: '4025.00', payments: '1600.00', closing: '2425.00' },
        { tenant_id: 3, pms_tenant_id: 3, name: 'Zed', unit: 'B1', opening: '0.00', charges: '450.00', payments: '1000.00', closing: '-550.00' },
    ],
    totals: { opening: '0.00', charges: '4475.00', payments: '2600.00', closing: '1875.00' },
};
const januaryStatement = {
    start: '2023-01-01',
    end: '2023-01-31',
    rows: [{ tenant_id: 2, pms_tenant_id: 2, name: 'Bob', unit: 'B205', opening: '250.00', charges: '1500.00', payments: '1000.00', closing: '750.00' }],
    totals: { opening: '250.00', charges: '1500.00', payments: '1000.00', closing: '750.00' },
};

const routes = {
    '/api/tenants/': tenants,
    '/api/labels/': [],
    '/api/reports/monthly-activity/': months,
    '/api/reports/roll-forward/': statement,
    // Typing the From date before the To date asks for an open-ended period.
    '/api/reports/monthly-activity/?start=2023-01-01': months,
    '/api/reports/roll-forward/?start=2023-01-01': { ...statement, start: '2023-01-01' },
    '/api/tenants/?as_of=2023-01-31': tenantsInJanuary,
    '/api/reports/monthly-activity/?start=2023-01-01&end=2023-01-31': months.slice(0, 1),
    '/api/reports/roll-forward/?start=2023-01-01&end=2023-01-31': januaryStatement,
    '/api/tenants/2/ledger/': {
        tenant: tenants[1], start: null, end: null, opening_balance: '0.00',
        total_charges: '2425.00', total_payments: '0.00', balance: '2425.00',
        rent_and_fees_receivable: '2425.00', deposit_due: '0.00', deposit_held: '900.00', removed_entries: [],
        entries: [{ id: 9, pms_id: '9', date: '2023-01-01', description: 'Rent Charge - January', type: 'charge', category: 'rent_and_fees', amount: '2425.00', running_balance: '2425.00' }],
    },
};

let requested;

beforeEach(() => {
    requested = [];
    global.fetch = global.fetch || (() => {});
    jest.spyOn(global, 'fetch').mockImplementation(url => {
        requested.push(url);
        const body = routes[url];
        return Promise.resolve(body === undefined
            ? { ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not found.' }) }
            : { ok: true, status: 200, json: () => Promise.resolve(body) });
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

async function openInsights() {
    render(<App />);
    userEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    await screen.findByText('Total outstanding, today');
}

function rowTexts(region) {
    return within(region).getAllByRole('row').slice(1).map(row => row.textContent);
}

test('the Insights tab shows portfolio totals and charts', async () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Tenants' })).toHaveAttribute('aria-selected', 'true');

    userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

    expect(await screen.findByText('Total outstanding, today')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Insights' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Total outstanding, today').nextSibling).toHaveTextContent('$2,425.00');
    expect(screen.getByText('Credits held, today').nextSibling).toHaveTextContent('$550.00');
    expect(screen.getByText('Deposits held, today').nextSibling).toHaveTextContent('$1,900.00');

    const prefix = screen.getByRole('region', { name: 'Outstanding balance by unit prefix, today' });
    expect(within(prefix).getAllByRole('listitem').map(item => item.textContent)).toEqual(['A$0.00', 'B$2,425.00']);

    for (const title of ['Net charges and payments by month', 'Total receivable at month end', 'Returned payments by month']) {
        const chart = screen.getByRole('region', { name: title });
        expect(within(chart).getByRole('img')).toHaveAccessibleName(`${title}, Jan 2023 to Feb 2023`);
    }
});

test('the monthly figures include collection rate, returned payments and the receivable', async () => {
    await openInsights();

    expect(rowTexts(screen.getByRole('region', { name: 'Monthly figures' }))).toEqual([
        'Jan 2023$3,000.00$1,000.0033%$0.00$2,000.00',
        'Feb 2023$1,500.00($425.00)-28%$1,925.00 (2)$3,925.00',
    ]);
});

test('the roll-forward lists each tenant and ends with control totals', async () => {
    await openInsights();
    const section = screen.getByRole('region', { name: 'Receivable roll-forward' });

    expect(rowTexts(section)).toEqual([
        '2BobB205$0.00$4,025.00$1,600.00$2,425.00',
        '3ZedB1$0.00$450.00$1,000.00($550.00)',
        'Total, 2 tenants$0.00$4,475.00$2,600.00$1,875.00',
    ]);
    expect(within(section).getByText(/the first transaction to the latest\./)).toBeInTheDocument();

    downloadFile.mockResolvedValue();
    userEvent.click(within(section).getByRole('button', { name: 'Export CSV' }));
    expect(downloadFile).toHaveBeenCalledWith('/api/reports/roll-forward.csv', 'roll-forward.csv');
});

test('the date filter narrows every figure to the period and exports the same period', async () => {
    await openInsights();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2023-01-31' } });

    // Balances are as of the end date; the statement and series cover the period.
    expect(await screen.findByText('Total outstanding, as of 01/31/2023')).toBeInTheDocument();
    expect(screen.getByText('Total outstanding, as of 01/31/2023').nextSibling).toHaveTextContent('$750.00');
    // Every standing figure says which day it is for.
    expect(screen.getByText('Credits held, as of 01/31/2023')).toBeInTheDocument();
    expect(screen.getByText('Deposits held, as of 01/31/2023')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Receivable roll-forward' });
    expect(rowTexts(section)).toEqual([
        '2BobB205$250.00$1,500.00$1,000.00$750.00',
        'Total, 1 tenant$250.00$1,500.00$1,000.00$750.00',
    ]);
    expect(within(section).getByText(/01\/01\/2023 to 01\/31\/2023\./)).toBeInTheDocument();
    expect(rowTexts(screen.getByRole('region', { name: 'Monthly figures' }))).toHaveLength(1);

    downloadFile.mockResolvedValue();
    userEvent.click(within(section).getByRole('button', { name: 'Export CSV' }));
    expect(downloadFile).toHaveBeenCalledWith(
        '/api/reports/roll-forward.csv?start=2023-01-01&end=2023-01-31', 'roll-forward.csv',
    );

    userEvent.click(screen.getByRole('button', { name: 'All dates' }));
    expect(await screen.findByText('Total outstanding, today')).toBeInTheDocument();
});

test('clicking a name under Largest balances due opens that tenant\'s ledger', async () => {
    await openInsights();
    const largest = screen.getByRole('region', { name: 'Largest balances due, today' });

    userEvent.click(within(largest).getByRole('button', { name: 'View ledger for Bob' }));

    const dialog = await screen.findByRole('dialog', { name: 'Ledger: Bob (Unit B205)' });
    expect(await within(dialog).findByText('Rent Charge - January')).toBeInTheDocument();
    expect(within(dialog).getByText('Balance due').nextSibling).toHaveTextContent('$2,425.00');
});

test('the tenant list can show balances as of a date', async () => {
    render(<App />);
    const bob = () => screen.getByText('Bob').closest('tr');
    await screen.findByText('Bob');
    expect(within(bob()).getByText('$2,425.00')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Balances as of'), { target: { value: '2023-01-31' } });

    await waitFor(() => expect(within(bob()).getByText('$750.00')).toBeInTheDocument());
    expect(requested).toContain('/api/tenants/?as_of=2023-01-31');
    // The page says plainly that these are not today's balances.
    expect(screen.getByRole('note')).toHaveTextContent('Balances are as of 01/31/2023, not today.');
});

test('the roll-forward sorts by any column and keeps the totals row last', async () => {
    await openInsights();
    const section = screen.getByRole('region', { name: 'Receivable roll-forward' });
    const names = () => rowTexts(section).map(text => text.replace(/^\d+/, '').slice(0, 3));

    expect(names()).toEqual(['Bob', 'Zed', 'Tot']);

    userEvent.click(within(section).getByRole('button', { name: /^Closing/ }));
    await waitFor(() => expect(names()).toEqual(['Zed', 'Bob', 'Tot']));
    expect(within(section).getByRole('columnheader', { name: /^Closing/ })).toHaveAttribute('aria-sort', 'ascending');

    userEvent.click(within(section).getByRole('button', { name: /^Closing/ }));
    await waitFor(() => expect(names()).toEqual(['Bob', 'Zed', 'Tot']));
    expect(within(section).getByRole('columnheader', { name: /^Closing/ })).toHaveAttribute('aria-sort', 'descending');
});

test('a ledger opened from the roll-forward covers the same period', async () => {
    await openInsights();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2023-01-31' } });
    await screen.findByText('Total outstanding, as of 01/31/2023');
    routes['/api/tenants/2/ledger/?start=2023-01-01&end=2023-01-31'] = {
        ...routes['/api/tenants/2/ledger/'], start: '2023-01-01', end: '2023-01-31', opening_balance: '250.00', balance: '750.00',
    };

    const section = screen.getByRole('region', { name: 'Receivable roll-forward' });
    userEvent.click(within(section).getByRole('button', { name: 'View ledger for Bob' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Balance as of 01/31/2023')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('From')).toHaveValue('2023-01-01');
    expect(requested).toContain('/api/tenants/2/ledger/?start=2023-01-01&end=2023-01-31');
});
