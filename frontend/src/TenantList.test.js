import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TenantList from './TenantList';

const tenants = [
    { id: 11, pms_tenant_id: 3, name: 'Daisy Ridley', unit: 'C303', balance: '1420.00' },
    { id: 12, pms_tenant_id: 4, name: 'Chris Jackson', unit: 'G114', balance: '0.00' },
];

const ledger = {
    tenant: tenants[0],
    total_charges: '1420.00',
    total_payments: '0.00',
    balance: '1420.00',
    entries: [
        { id: 1, pms_id: '1', date: '2023-01-01', description: 'Rent Charge - January', type: 'charge', amount: '1500.00', running_balance: '1500.00' },
        { id: 2, pms_id: '2', date: '2023-01-02', description: 'Utility Credit', type: 'charge', amount: '-80.00', running_balance: '1420.00' },
        { id: 3, pms_id: '3', date: '2023-01-05', description: 'Rent Payment - January', type: 'payment', amount: '1420.00', running_balance: '0.00' },
        { id: 4, pms_id: '4', date: '2023-01-07', description: 'Returned Payment - NSF', type: 'payment', amount: '-1420.00', running_balance: '1420.00' },
    ],
};

function mockApi(routes) {
    jest.spyOn(global, 'fetch').mockImplementation(url => {
        const body = routes[url];
        return Promise.resolve(
            body === undefined
                ? { ok: false, status: 500, json: () => Promise.resolve({}) }
                : { ok: true, status: 200, json: () => Promise.resolve(body) }
        );
    });
}

function cells(row) {
    return within(row).getAllByRole('cell').map(cell => cell.textContent);
}

beforeEach(() => {
    global.fetch = global.fetch || (() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

test('lists tenants with their balance', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);

    const row = (await screen.findByText('Daisy Ridley')).closest('tr');
    expect(cells(row).slice(0, 4)).toEqual(['11', 'Daisy Ridley', 'C303', '$1,420.00']);
});

test('View Ledger shows that tenant\'s transactions, running balance and totals', async () => {
    mockApi({ '/api/tenants/': tenants, '/api/tenants/11/ledger/': ledger });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' }));

    const dialog = await screen.findByRole('dialog', { name: 'Ledger: Daisy Ridley (Unit C303)' });
    const rows = (await within(dialog).findAllByRole('row')).slice(1);
    // Date is shown as written by the PMS, with no time zone shift.
    expect(rows.map(cells)).toEqual([
        ['01/01/2023', 'Rent Charge - January', '$1,500.00', '', '$1,500.00'],
        ['01/02/2023', 'Utility Credit', '($80.00)', '', '$1,420.00'],
        ['01/05/2023', 'Rent Payment - January', '', '$1,420.00', '$0.00'],
        ['01/07/2023', 'Returned Payment - NSF', '', '($1,420.00)', '$1,420.00'],
    ]);
    expect(within(dialog).getByText('Balance due').nextSibling).toHaveTextContent('$1,420.00');
    expect(within(dialog).getByText('Total charges').nextSibling).toHaveTextContent('$1,420.00');
    expect(within(dialog).getByText('Total payments').nextSibling).toHaveTextContent('$0.00');
});

test('the ledger closes with the Close button and with Escape', async () => {
    mockApi({ '/api/tenants/': tenants, '/api/tenants/11/ledger/': ledger });
    render(<TenantList />);
    const open = await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' });

    userEvent.click(open);
    userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    userEvent.click(open);
    await screen.findByRole('dialog');
    userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a tenant with no transactions gets an empty state, not an empty table', async () => {
    mockApi({
        '/api/tenants/': tenants,
        '/api/tenants/12/ledger/': { tenant: tenants[1], total_charges: '0.00', total_payments: '0.00', balance: '0.00', entries: [] },
    });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Chris Jackson' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No transactions found for this tenant.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
});

test('a failed ledger request shows an error', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error loading ledger: HTTP error! status: 500');
});
