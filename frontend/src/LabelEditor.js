import React, { useState } from 'react';
import LabelChip from './LabelChip';
import { sendJson } from './api';
import { useDialog } from './useDialog';

// Choose which labels a tenant has, or create a new label.
function LabelEditor({ tenant, labels, onClose, onSaved, onLabelCreated }) {
    const [selected, setSelected] = useState(() => new Set(tenant.labels.map(label => label.id)));
    const [newLabel, setNewLabel] = useState({ name: '', color: '#2a78d6' });
    const [error, setError] = useState(null);
    const { dialogRef, headingRef } = useDialog(onClose);

    const toggle = id => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };

    const createLabel = event => {
        event.preventDefault();
        setError(null);
        sendJson('POST', '/api/labels/', newLabel)
            .then(label => {
                onLabelCreated(label);
                // A label made here is meant for this tenant.
                setSelected(new Set([...selected, label.id]));
                setNewLabel({ name: '', color: newLabel.color });
            })
            .catch(setError);
    };

    const save = () => {
        setError(null);
        sendJson('PUT', `/api/tenants/${tenant.id}/labels/`, { label_ids: [...selected] })
            .then(saved => {
                onSaved(tenant.id, saved);
                onClose();
            })
            .catch(setError);
    };

    return (
        <div className="ledger-backdrop" onClick={onClose}>
            <div
                className="ledger label-editor"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="label-editor-title"
                onClick={event => event.stopPropagation()}
            >
                <div className="ledger-header">
                    <h2 id="label-editor-title" tabIndex={-1} ref={headingRef}>Labels: {tenant.name}</h2>
                    <button onClick={onClose}>Cancel</button>
                </div>
                <ul className="label-options">
                    {labels.map(label => (
                        <li key={label.id}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selected.has(label.id)}
                                    onChange={() => toggle(label.id)}
                                />
                                <LabelChip label={label} />
                            </label>
                        </li>
                    ))}
                </ul>
                <form className="new-label" onSubmit={createLabel}>
                    <label>
                        New label
                        <input
                            type="text"
                            required
                            maxLength={40}
                            value={newLabel.name}
                            onChange={event => setNewLabel({ ...newLabel, name: event.target.value })}
                        />
                    </label>
                    <label>
                        Colour
                        <input
                            type="color"
                            value={newLabel.color}
                            onChange={event => setNewLabel({ ...newLabel, color: event.target.value })}
                        />
                    </label>
                    <button type="submit">Create label</button>
                </form>
                {error && <p role="alert">Could not save. {error.message}</p>}
                <div className="label-editor-actions">
                    <button onClick={save}>Save labels</button>
                </div>
            </div>
        </div>
    );
}

export default LabelEditor;
