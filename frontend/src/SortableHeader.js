import React from 'react';
import { nextSort } from './tenantFilters';

// A column header that sorts its table: click to sort ascending, click again
// to flip. `aria-sort` tells a screen reader which column is active.
function SortableHeader({ column, sort, onSort }) {
    const active = sort.key === column.key;
    const direction = sort.direction === 'asc' ? 'ascending' : 'descending';
    return (
        <th
            scope="col"
            className={column.money ? 'money' : undefined}
            aria-sort={active ? direction : 'none'}
        >
            <button className="sort-button" onClick={() => onSort(nextSort(sort, column.key))}>
                {column.label}
                <span aria-hidden="true">
                    {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                </span>
            </button>
        </th>
    );
}

export default SortableHeader;
