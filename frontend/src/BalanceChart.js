import React, { useState } from 'react';
import { axisMoney, niceLimit } from './chartScale';
import { formatDate, formatMoney } from './format';
import { dayNumber } from './ledgerStats';

const WIDTH = 720;
const HEIGHT = 150;
const PAD = { top: 12, right: 16, bottom: 24, left: 56 };

// The tenant's balance after each ledger entry. Drawn as steps, because a
// balance holds its value between entries; it does not drift toward the next.
//
// Dragging across the chart selects a period: `onSelectRange` is called with
// the dates of the first and last entries inside the drag. The From and To
// date fields do the same thing for anyone not using a pointer.
function BalanceChart({ entries, onSelectRange }) {
    const [hoveredIndex, setHovered] = useState(null);
    // The entry index where the current drag began, or null when not dragging.
    const [dragStart, setDragStart] = useState(null);
    if (entries.length < 2) return null;
    // Selecting a period swaps in a shorter list of entries while the pointer
    // is still over the chart, so an index from the old list may be past the
    // end of the new one.
    const hovered = hoveredIndex !== null && hoveredIndex < entries.length ? hoveredIndex : null;

    const balances = entries.map(entry => Number(entry.running_balance));
    const days = entries.map(entry => dayNumber(entry.date));
    const top = niceLimit(Math.max(...balances, 1));
    const bottom = niceLimit(Math.min(...balances, 0));
    const span = days[days.length - 1] - days[0] || 1;
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const x = index => PAD.left + ((days[index] - days[0]) / span) * plotWidth;
    const y = value => PAD.top + plotHeight * (1 - (value - bottom) / (top - bottom));
    const last = entries.length - 1;

    const path = balances.map((balance, index) => (
        index === 0 ? `M${x(0)},${y(balance)}` : `H${x(index)}V${y(balance)}`
    )).join('');

    // The entry nearest the pointer, so the whole plot is the hit target.
    const nearest = event => {
        const box = event.currentTarget.getBoundingClientRect();
        const pointer = ((event.clientX - box.left) / box.width) * WIDTH;
        let best = 0;
        entries.forEach((entry, index) => {
            if (Math.abs(x(index) - pointer) < Math.abs(x(best) - pointer)) best = index;
        });
        return best;
    };

    const finishDrag = event => {
        if (dragStart === null) return;
        const end = nearest(event);
        setDragStart(null);
        // A click without movement is not a selection.
        if (end !== dragStart && onSelectRange) {
            const [from, to] = [Math.min(dragStart, end), Math.max(dragStart, end)];
            onSelectRange(entries[from].date, entries[to].date);
        }
    };

    const selecting = dragStart !== null && hovered !== null && hovered !== dragStart;
    const selection = selecting && [Math.min(dragStart, hovered), Math.max(dragStart, hovered)];

    return (
        <section className="balance-chart" aria-label="Balance over time">
            <h3>Balance over time</h3>
            <div className="line-chart">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    aria-label={`Balance from ${formatDate(entries[0].date)} to ${formatDate(entries[last].date)}, ending at ${formatMoney(balances[last])}`}
                    onMouseDown={event => {
                        event.preventDefault();
                        setDragStart(nearest(event));
                    }}
                    onMouseMove={event => setHovered(nearest(event))}
                    onMouseUp={finishDrag}
                    onMouseLeave={() => {
                        setHovered(null);
                        setDragStart(null);
                    }}
                >
                    {selection && (
                        <rect
                            className="chart-selection"
                            x={x(selection[0])}
                            y={PAD.top}
                            width={x(selection[1]) - x(selection[0])}
                            height={plotHeight}
                        />
                    )}
                    {[...new Set([bottom, 0, top])].map(tick => (
                        <g key={tick}>
                            <line className={tick === 0 ? 'zero-line' : 'grid-line'} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
                            <text className="axis-text" x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                                {axisMoney.format(tick)}
                            </text>
                        </g>
                    ))}
                    <text className="axis-text" x={PAD.left} y={HEIGHT - 6} textAnchor="start">{formatDate(entries[0].date)}</text>
                    <text className="axis-text" x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">{formatDate(entries[last].date)}</text>
                    <path d={path} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinejoin="round" />
                    {hovered !== null && (
                        <g>
                            <line className="crosshair" x1={x(hovered)} x2={x(hovered)} y1={PAD.top} y2={PAD.top + plotHeight} />
                            <circle cx={x(hovered)} cy={y(balances[hovered])} r="4" fill="#2a78d6" stroke="#fff" strokeWidth="2" />
                        </g>
                    )}
                </svg>
                {hovered !== null && (
                    <div className="chart-tooltip" role="status" style={{ left: `${(x(hovered) / WIDTH) * 100}%` }}>
                        {selection ? (
                            <strong>{formatDate(entries[selection[0]].date)} to {formatDate(entries[selection[1]].date)}</strong>
                        ) : (
                            <>
                                <strong>{formatDate(entries[hovered].date)}</strong>
                                <div>{entries[hovered].description}</div>
                                <div>Balance: {formatMoney(balances[hovered])}</div>
                            </>
                        )}
                    </div>
                )}
            </div>
            {onSelectRange && <p className="chart-hint">Drag across the chart to show just that period.</p>}
        </section>
    );
}

export default BalanceChart;
