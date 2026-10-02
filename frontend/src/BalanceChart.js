import React, { useState } from 'react';
import { axisMoney, niceLimit } from './chartScale';
import { formatDate, formatMoney } from './format';
import { dayNumber } from './ledgerStats';

const WIDTH = 720;
const HEIGHT = 150;
const PAD = { top: 12, right: 16, bottom: 24, left: 56 };

// The tenant's balance after each ledger entry. Drawn as steps, because a
// balance holds its value between entries; it does not drift toward the next.
function BalanceChart({ entries }) {
    const [hovered, setHovered] = useState(null);
    if (entries.length < 2) return null;

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

    // The pointer picks the nearest entry, so the whole plot is the hit target.
    const onMouseMove = event => {
        const box = event.currentTarget.getBoundingClientRect();
        const pointer = ((event.clientX - box.left) / box.width) * WIDTH;
        let nearest = 0;
        entries.forEach((entry, index) => {
            if (Math.abs(x(index) - pointer) < Math.abs(x(nearest) - pointer)) nearest = index;
        });
        setHovered(nearest);
    };

    return (
        <section className="balance-chart" aria-label="Balance over time">
            <h3>Balance over time</h3>
            <div className="line-chart">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    aria-label={`Balance from ${formatDate(entries[0].date)} to ${formatDate(entries[last].date)}, ending at ${formatMoney(balances[last])}`}
                    onMouseMove={onMouseMove}
                    onMouseLeave={() => setHovered(null)}
                >
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
                        <strong>{formatDate(entries[hovered].date)}</strong>
                        <div>{entries[hovered].description}</div>
                        <div>Balance: {formatMoney(balances[hovered])}</div>
                    </div>
                )}
            </div>
        </section>
    );
}

export default BalanceChart;
