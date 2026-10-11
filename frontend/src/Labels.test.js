import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { readableTextColor } from './LabelChip';

const AT_RISK = { id: 1, name: 'At risk', color: '#c62828' };
const FOLLOW_UP = { id: 2, name: 'Requires follow up', color: '#e65100' };
const DEFAULTING = { id: 3, name: 'Defaulting', color: '#000000' };

let tenants;
let labels;
let requests;

beforeEach(() => {
    tenants = [
        { id: 1, pms_tenant_id: 1, name: 'Alice', unit: 'A101', balance: '0.00', ledger_synced_at: null, labels: [] },
        { id: 2, pms_tenant_id: 2, name: 'Bob', unit: 'B205', balance: '2425.00', ledger_synced_at: null, labels: [AT_RISK] },
        { id: 3, pms_tenant_id: 3, name: 'Daisy', unit: 'C303', balance: '1240.00', ledger_synced_at: null, labels: [AT_RISK, FOLLOW_UP] },
    ];
    labels = [AT_RISK, DEFAULTING, FOLLOW_UP];
    requests = [];
    global.fetch = global.fetch || (() => {});
    jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
        const method = options.method || 'GET';
        const data = options.body ? JSON.parse(options.body) : undefined;
        requests.push({ method, url, data });
        let body;
        if (url === '/api/tenants/') body = tenants;
        else if (url === '/api/labels/' && method === 'POST') body = { id: 9, ...data };
        else if (url === '/api/labels/') body = labels;
        else if (method === 'PUT') body = [...labels, { id: 9, name: 'Payment plan', color: '#2a78d6' }].filter(label => data.label_ids.includes(label.id));
        else body = [];
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function rowNames() {
    return screen.getAllByRole('button', { name: /^View ledger for / })
        .map(button => button.getAttribute('aria-label').replace('View ledger for ', ''));
}

test('chip text is white on dark colours and black on light ones', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#c62828')).toBe('#ffffff');
    expect(readableTextColor('#ffe082')).toBe('#000000');
});

test('the tenant list shows each tenant\'s labels and filters by label', async () => {
    render(<App />);
    const bob = (await screen.findByText('Bob')).closest('tr');
    expect(within(bob).getByText('At risk')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Requires follow up' });

    userEvent.selectOptions(screen.getByLabelText('Label'), 'Requires follow up');
    await waitFor(() => expect(rowNames()).toEqual(['Daisy']));

    userEvent.selectOptions(screen.getByLabelText('Label'), 'At risk');
    await waitFor(() => expect(rowNames()).toEqual(['Bob', 'Daisy']));
});

test('editing a tenant\'s labels saves the chosen set and updates the row', async () => {
    render(<App />);
    await screen.findByRole('option', { name: 'Defaulting' });
    userEvent.click(await screen.findByRole('button', { name: 'Edit labels for Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Labels: Bob' });
    expect(within(dialog).getByRole('checkbox', { name: 'At risk' })).toBeChecked();

    userEvent.click(within(dialog).getByRole('checkbox', { name: 'At risk' }));
    userEvent.click(within(dialog).getByRole('checkbox', { name: 'Defaulting' }));
    userEvent.click(within(dialog).getByRole('button', { name: 'Save labels' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests).toContainEqual({ method: 'PUT', url: '/api/tenants/2/labels/', data: { label_ids: [3] } });
    const bob = screen.getByText('Bob').closest('tr');
    expect(within(bob).getByText('Defaulting')).toBeInTheDocument();
    expect(within(bob).queryByText('At risk')).not.toBeInTheDocument();
});

test('a custom label can be created and is selected for the tenant', async () => {
    render(<App />);
    await screen.findByRole('option', { name: 'Defaulting' });
    userEvent.click(await screen.findByRole('button', { name: 'Edit labels for Alice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Labels: Alice' });

    fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: 'Payment plan' } });
    fireEvent.change(within(dialog).getByLabelText('Colour'), { target: { value: '#2a78d6' } });
    userEvent.click(within(dialog).getByRole('button', { name: 'Create label' }));

    expect(await within(dialog).findByRole('checkbox', { name: 'Payment plan' })).toBeChecked();
    expect(requests).toContainEqual({ method: 'POST', url: '/api/labels/', data: { name: 'Payment plan', color: '#2a78d6' } });

    userEvent.click(within(dialog).getByRole('button', { name: 'Save labels' }));
    await waitFor(() => expect(requests).toContainEqual(
        { method: 'PUT', url: '/api/tenants/1/labels/', data: { label_ids: [9] } },
    ));
});

test('the Labels tab groups tenants by label and can show one label', async () => {
    render(<App />);
    userEvent.click(screen.getByRole('tab', { name: 'Labels' }));

    const atRisk = await screen.findByRole('region', { name: 'At risk' });
    expect(within(atRisk).getByText('2 tenants, $3,665.00 due')).toBeInTheDocument();
    expect(within(atRisk).getAllByRole('row').slice(1).map(row => row.textContent)).toEqual([
        '2BobB205$2,425.00', '3DaisyC303$1,240.00',
    ]);
    expect(within(screen.getByRole('region', { name: 'Defaulting' })).getByText('No tenants have this label.')).toBeInTheDocument();

    userEvent.selectOptions(screen.getByLabelText('Label'), 'Requires follow up');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'At risk' })).not.toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'Requires follow up' })).getByText('Daisy')).toBeInTheDocument();
});
