import React, { useState } from 'react';

const EMPTY = { date: '', description: '', type: 'charge', amount: '' };

// DRF returns {field: [messages]}; show them as one readable line.
function describeErrors(body) {
    return Object.entries(body)
        .map(([field, messages]) => `${field}: ${[].concat(messages).join(' ')}`)
        .join(' ');
}

// Records an entry on this tenant's ledger. It is stored without a PMS id,
// shown with a "Local" badge, and never changed by an import.
function AddTransactionForm({ tenantId, onAdded }) {
    const [values, setValues] = useState(EMPTY);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const setField = name => event => setValues({ ...values, [name]: event.target.value });

    const onSubmit = event => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        fetch(`/api/tenants/${tenantId}/transactions/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        })
            .then(response => response.json().then(body => ({ response, body })))
            .then(({ response, body }) => {
                if (!response.ok) {
                    throw new Error(describeErrors(body));
                }
                setValues(EMPTY);
                onAdded();
            })
            .catch(error => setError(error))
            .finally(() => setSaving(false));
    };

    return (
        <form className="add-transaction" onSubmit={onSubmit}>
            <label>
                Date
                <input type="date" required value={values.date} onChange={setField('date')} />
            </label>
            <label>
                Description
                <input type="text" required maxLength={255} value={values.description} onChange={setField('description')} />
            </label>
            <label>
                Type
                <select value={values.type} onChange={setField('type')}>
                    <option value="charge">Charge</option>
                    <option value="payment">Payment</option>
                </select>
            </label>
            <label>
                Amount
                <input type="number" required step="0.01" value={values.amount} onChange={setField('amount')} />
            </label>
            <button type="submit" disabled={saving}>Add transaction</button>
            <p className="add-transaction-hint">
                Use a negative amount for a credit (charge) or a returned payment (payment).
            </p>
            {error && <p role="alert">Could not add the transaction. {error.message}</p>}
        </form>
    );
}

export default AddTransactionForm;
