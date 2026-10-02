import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TenantList from './TenantList';
import { downloadFile } from './download';

jest.mock('./download');

const SYNCED = '2026-10-02T15:30:00Z';
const tenants = [
    { id: 11, pms_tenant_id: 3, name: 'Daisy Ridley', unit: 'C303', balance: '1420.00', ledger_synced_at: SYNCED },
    { id: 12, pms_tenant_id: 4, name: 'Chris Jackson', unit: 'G114', balance: '0.00', ledger_synced_at: SYNCED },
    { id: 13, pms_tenant_id: null, name: 'Charlie Chaplin', unit: 'C120', balance: null, ledger_synced_at: null },
    { id: 14, pms_tenant_id: 9, name: 'Zed Young', unit: 'G2', balance: '-550.00', ledger_synced_at: SYNCED },
];

function makeLedger(tenant, overrides = {}) {
    return {
        tenant, start: null, end: null, opening_balance: '0.00',
        total_charges: '0.00', total_payments: '0.00', balance: '0.00',
        entries: [], removed_entries: [], ...overrides,
    };
}

const ledger = makeLedger(tenants[0], {
    total_charges: '1420.00',
    total_payments: '0.00',
    balance: '1420.00',
    entries: [
        { id: 1, pms_id: '1', date: '2023-01-01', description: 'Rent Charge - January', type: 'charge', amount: '1500.00', running_balance: '1500.00' },
        { id: 2, pms_id: '2', date: '2023-01-02', description: 'Utility Credit', type: 'charge', amount: '-80.00', running_balance: '1420.00' },
        { id: 3, pms_id: '3', date: '2023-01-05', description: 'Rent Payment - January', type: 'payment', amount: '1420.00', running_balance: '0.00' },
        { id: 4, pms_id: '4', date: '2023-01-07', description: 'Returned Payment - NSF', type: 'payment', amount: '-1420.00', running_balance: '1420.00' },
    ],
});

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
    // The PMS id is shown, not the local database id.
    expect(cells(row).slice(0, 4)).toEqual(['3', 'Daisy Ridley', 'C303', '$1,420.00']);
    // No PMS record and no transactions: no id and no balance, rather than $0.00.
    expect(cells(screen.getByText('Charlie Chaplin').closest('tr')).slice(0, 4)).toEqual(['—', 'Charlie Chaplin', 'C120', '—']);
    expect(screen.getByText(/^Ledgers last synced from the PMS: /)).toBeInTheDocument();
});

function names() {
    return screen.getAllByRole('button', { name: /^View ledger for / })
        .map(button => button.getAttribute('aria-label').replace('View ledger for ', ''));
}

// State updates from an event land on the next render, so wait for them.
function expectNames(expected) {
    return waitFor(() => expect(names()).toEqual(expected));
}

test('column headers sort the table and flip direction on a second click', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);
    await screen.findByText('Daisy Ridley');
    await expectNames(['Charlie Chaplin', 'Chris Jackson', 'Daisy Ridley', 'Zed Young']);

    userEvent.click(screen.getByRole('button', { name: /^Balance/ }));
    await expectNames(['Zed Young', 'Chris Jackson', 'Daisy Ridley', 'Charlie Chaplin']);
    expect(screen.getByRole('columnheader', { name: /^Balance/ })).toHaveAttribute('aria-sort', 'ascending');

    userEvent.click(screen.getByRole('button', { name: /^Balance/ }));
    await expectNames(['Daisy Ridley', 'Chris Jackson', 'Zed Young', 'Charlie Chaplin']);
    expect(screen.getByRole('columnheader', { name: /^Balance/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /^Name/ })).toHaveAttribute('aria-sort', 'none');
});

test('filters by unit prefix and balance range, and can be cleared', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);
    await screen.findByText('Daisy Ridley');

    userEvent.selectOptions(screen.getByLabelText('Unit prefix'), 'G');
    await expectNames(['Chris Jackson', 'Zed Young']);

    fireEvent.change(screen.getByLabelText('Min balance'), { target: { value: '0' } });
    await expectNames(['Chris Jackson']);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 4 tenants');

    fireEvent.change(screen.getByLabelText('Min balance'), { target: { value: '5000' } });
    expect(await screen.findByText('No tenants match these filters.')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(names()).toHaveLength(4));

    fireEvent.change(screen.getByLabelText('Max balance'), { target: { value: '-1' } });
    await expectNames(['Zed Young']);
});

test('shows a loading state before the tenants arrive', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);

    expect(screen.getByText('Loading tenants...')).toBeInTheDocument();
    expect(screen.queryByText('No tenants found.')).not.toBeInTheDocument();
    await screen.findByText('Daisy Ridley');
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
    // First entry Jan 1, last Jan 7: one calendar month of activity.
    expect(within(dialog).getByText('Tenant for').nextSibling).toHaveTextContent('1 month');
    expect(within(dialog).getByRole('img')).toHaveAccessibleName('Balance from 01/01/2023 to 01/07/2023, ending at $1,420.00');
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
        '/api/tenants/12/ledger/': makeLedger(tenants[1]),
    });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Chris Jackson' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No transactions found for this tenant.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
    // $0.00 with no activity is not the same statement as "Paid in full".
    expect(within(dialog).getByText('Balance (no activity)')).toBeInTheDocument();
    expect(within(dialog).queryByText('Paid in full')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Tenant for')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
});

test('an unlinked tenant\'s empty ledger says it has no PMS record', async () => {
    mockApi({
        '/api/tenants/': tenants,
        '/api/tenants/13/ledger/': makeLedger(tenants[2]),
    });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Charlie Chaplin' }));

    expect(await screen.findByText(/This tenant is not linked to a PMS record\./)).toBeInTheDocument();
});

test('a failed ledger request shows an error', async () => {
    mockApi({ '/api/tenants/': tenants });
    render(<TenantList />);

    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error loading ledger: HTTP error! status: 500');
});

function mockFetch(handler) {
    jest.spyOn(global, 'fetch').mockImplementation((url, options) => {
        const { status = 200, body } = handler(url, options);
        return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    });
}

async function openDaisy() {
    render(<TenantList />);
    userEvent.click(await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' }));
    return screen.findByRole('dialog');
}

test('a date range refetches the ledger and shows the opening balance', async () => {
    const ranged = makeLedger(tenants[0], {
        start: '2023-01-05', end: '2023-01-31', opening_balance: '1420.00',
        total_charges: '0.00', total_payments: '1420.00', balance: '1420.00',
        entries: ledger.entries.slice(2),
    });
    mockApi({
        '/api/tenants/': tenants,
        '/api/tenants/11/ledger/': ledger,
        '/api/tenants/11/ledger/?start=2023-01-05&end=2023-01-31': ranged,
    });
    const dialog = await openDaisy();
    await within(dialog).findByText('Total charges');

    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2023-01-05' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2023-01-31' } });

    expect(await within(dialog).findByText('Balance as of 01/31/2023')).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(cells(rows[0])).toEqual(['01/05/2023', 'Opening balance', '', '', '$1,420.00']);
    expect(rows).toHaveLength(3);
    expect(within(dialog).getByText('Charges in period')).toBeInTheDocument();
    // The export covers the same period as the screen.
    downloadFile.mockResolvedValue();
    userEvent.click(within(dialog).getByRole('button', { name: 'Export CSV' }));
    expect(downloadFile).toHaveBeenCalledWith(
        '/api/tenants/11/ledger.csv?start=2023-01-05&end=2023-01-31', 'ledger-tenant-11.csv',
    );
});

test('the ledger shows the PMS tenant id and when it was synced', async () => {
    mockApi({ '/api/tenants/': tenants, '/api/tenants/11/ledger/': ledger });
    const dialog = await openDaisy();

    expect(await within(dialog).findByText(/^PMS tenant ID 3 · Synced from the PMS /)).toBeInTheDocument();
});

test('entries removed from the PMS are listed apart from the ledger', async () => {
    mockApi({
        '/api/tenants/': tenants,
        '/api/tenants/11/ledger/': makeLedger(tenants[0], {
            ...ledger,
            removed_entries: [{ id: 9, pms_id: '9', tenant: 11, date: '2023-01-03', description: 'Late Fee Charge', type: 'charge', amount: '50.00', removed_from_pms_at: SYNCED }],
        }),
    });
    const dialog = await openDaisy();

    expect(await within(dialog).findByText('Removed from the PMS (1)')).toBeInTheDocument();
    expect(within(dialog).getByText('Late Fee Charge')).toBeInTheDocument();
    expect(within(dialog).getByText('Balance due').nextSibling).toHaveTextContent('$1,420.00');
});

test('adding a transaction posts it and reloads the ledger', async () => {
    const added = { id: 5, pms_id: null, date: '2023-01-08', description: 'Courtesy credit', type: 'charge', amount: '-20.00', running_balance: '1400.00' };
    let posted = null;
    mockFetch((url, options) => {
        if (url === '/api/tenants/') return { body: tenants };
        if (options && options.method === 'POST') {
            posted = { url, body: JSON.parse(options.body) };
            return { status: 201, body: added };
        }
        return { body: posted ? makeLedger(tenants[0], { ...ledger, balance: '1400.00', entries: [...ledger.entries, added] }) : ledger };
    });
    const dialog = await openDaisy();
    await within(dialog).findByText('Total charges');

    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2023-01-08' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Courtesy credit' } });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '-20.00' } });
    userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));

    const row = (await within(dialog).findByText('Courtesy credit')).closest('tr');
    expect(posted).toEqual({
        url: '/api/tenants/11/transactions/',
        body: { date: '2023-01-08', description: 'Courtesy credit', type: 'charge', amount: '-20.00' },
    });
    // An entry with no PMS id is marked so nobody looks for it in the PMS.
    expect(within(row).getByText('Local')).toBeInTheDocument();
    expect(within(dialog).getByText('Balance due').nextSibling).toHaveTextContent('$1,400.00');
});

test('a rejected transaction shows the server\'s reason', async () => {
    mockFetch((url, options) => {
        if (url === '/api/tenants/') return { body: tenants };
        if (options && options.method === 'POST') return { status: 400, body: { amount: ['Amount cannot be zero.'] } };
        return { body: ledger };
    });
    const dialog = await openDaisy();
    await within(dialog).findByText('Total charges');

    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2023-01-08' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Nothing' } });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '0' } });
    userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not add the transaction. amount: Amount cannot be zero.');
});

test('focus moves into the ledger on open and back to the button on close', async () => {
    mockApi({ '/api/tenants/': tenants, '/api/tenants/11/ledger/': ledger });
    render(<TenantList />);
    const open = await screen.findByRole('button', { name: 'View ledger for Daisy Ridley' });
    open.focus();

    userEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus();

    userEvent.keyboard('{Escape}');
    await waitFor(() => expect(open).toHaveFocus());
});
