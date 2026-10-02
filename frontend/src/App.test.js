import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const tenants = [
    { id: 1, pms_tenant_id: 1, name: 'Alice', unit: 'A101', balance: '0.00' },
    { id: 2, pms_tenant_id: 2, name: 'Bob', unit: 'B205', balance: '2425.00' },
    { id: 3, pms_tenant_id: 3, name: 'Zed', unit: 'B1', balance: '-550.00' },
];
const months = [
    { month: '2023-01', charges: '3000.00', payments: '1000.00' },
    { month: '2023-02', charges: '1500.00', payments: '-425.00' },
];

const routes = {
    '/api/tenants/': tenants,
    '/api/reports/monthly-activity/': months,
    '/api/tenants/2/ledger/': {
        tenant: tenants[1], start: null, end: null, opening_balance: '0.00',
        total_charges: '2425.00', total_payments: '0.00', balance: '2425.00', removed_entries: [],
        entries: [{ id: 9, pms_id: '9', date: '2023-01-01', description: 'Rent Charge - January', type: 'charge', amount: '2425.00', running_balance: '2425.00' }],
    },
};

beforeEach(() => {
    global.fetch = global.fetch || (() => {});
    jest.spyOn(global, 'fetch').mockImplementation(url => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(routes[url]),
    }));
});

afterEach(() => {
    jest.restoreAllMocks();
});

test('the Insights tab shows portfolio totals and charts', async () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Tenants' })).toHaveAttribute('aria-selected', 'true');

    userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

    expect(await screen.findByText('Total outstanding')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Insights' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Total outstanding').nextSibling).toHaveTextContent('$2,425.00');
    expect(screen.getByText('Credits held').nextSibling).toHaveTextContent('$550.00');

    const building = screen.getByRole('region', { name: 'Outstanding balance by building' });
    expect(within(building).getAllByRole('listitem').map(item => item.textContent)).toEqual(['A$0.00', 'B$2,425.00']);

    const monthly = screen.getByRole('region', { name: 'Charges and payments by month' });
    expect(within(monthly).getByRole('img')).toHaveAccessibleName('Charges and payments by month, Jan 2023 to Feb 2023');
    // The same numbers are available as a table for anyone who cannot use the chart.
    const rows = within(monthly).getAllByRole('row', { hidden: true }).slice(1);
    expect(rows.map(row => row.textContent)).toEqual(['Jan 2023$3,000.00$1,000.00', 'Feb 2023$1,500.00($425.00)']);
});

test('clicking a name under Largest balances due opens that tenant\'s ledger', async () => {
    render(<App />);
    userEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    const largest = await screen.findByRole('region', { name: 'Largest balances due' });

    userEvent.click(within(largest).getByRole('button', { name: 'View ledger for Bob' }));

    const dialog = await screen.findByRole('dialog', { name: 'Ledger: Bob (Unit B205)' });
    expect(await within(dialog).findByText('Rent Charge - January')).toBeInTheDocument();
    expect(within(dialog).getByText('Balance due').nextSibling).toHaveTextContent('$2,425.00');
});
