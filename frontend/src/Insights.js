import React, { useCallback, useEffect, useState } from 'react';
import TenantLedger from './TenantLedger';
import { axisMoney, niceLimit } from './chartScale';
import { formatMoney } from './format';
import { formatMonth, largestBalances, outstandingByUnitPrefix, portfolioSummary } from './insightsData';

const SERIES = [
    // Net: credits reduce charges and returned payments reduce payments.
    { key: 'charges', label: 'Net charges', color: '#2a78d6' },
    { key: 'payments', label: 'Net payments', color: '#eb6834' },
];

function fetchJson(url) {
    return fetch(url).then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    });
}

function StatTile({ label, value, detail }) {
    return (
        <div className="stat-tile">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
            {detail && <div className="stat-detail">{detail}</div>}
        </div>
    );
}

// One series, so one colour and no legend: the heading names what is measured.
// With `onSelect`, each row's label is a button that opens that row's tenant.
function BarList({ title, rows, emptyText, onSelect }) {
    const max = Math.max(...rows.map(row => row.value), 0);
    return (
        <section className="chart" aria-label={title}>
            <h3>{title}</h3>
            {rows.length === 0 ? <p>{emptyText}</p> : (
                <ul className="bar-list">
                    {rows.map(row => (
                        <li key={row.label} title={`${row.label}: ${formatMoney(row.value)}`}>
                            <span className="bar-label">
                                {onSelect ? (
                                    <button
                                        aria-label={`View ledger for ${row.tenant.name}`}
                                        onClick={() => onSelect(row.tenant)}
                                    >
                                        {row.label}
                                    </button>
                                ) : row.label}
                            </span>
                            <span className="bar-track">
                                <span
                                    className="bar-fill"
                                    style={{ width: max > 0 ? `${(row.value / max) * 100}%` : 0 }}
                                />
                            </span>
                            <span className="bar-value money">{formatMoney(row.value)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 16, right: 32, bottom: 28, left: 64 };

function MonthlyActivityChart({ months }) {
    const [hovered, setHovered] = useState(null);
    const title = 'Net charges and payments by month';
    if (months.length === 0) {
        return <section className="chart" aria-label={title}><h3>{title}</h3><p>No transactions yet.</p></section>;
    }

    const values = months.flatMap(month => SERIES.map(series => Number(month[series.key])));
    const top = niceLimit(Math.max(...values, 1));
    const bottom = niceLimit(Math.min(...values, 0));
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const step = months.length > 1 ? plotWidth / (months.length - 1) : 0;
    const x = index => PAD.left + index * step;
    const y = value => PAD.top + plotHeight * (1 - (value - bottom) / (top - bottom));
    const ticks = [bottom, bottom + (top - bottom) / 2, top];
    const last = months.length - 1;

    return (
        <section className="chart" aria-label={title}>
            <h3>{title}</h3>
            <ul className="legend">
                {SERIES.map(series => (
                    <li key={series.key}>
                        <span className="legend-swatch" style={{ backgroundColor: series.color }} />
                        {series.label}
                    </li>
                ))}
            </ul>
            <div className="line-chart">
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}, ${formatMonth(months[0].month)} to ${formatMonth(months[last].month)}`}>
                    {ticks.map(tick => (
                        <g key={tick}>
                            <line className="grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
                            <text className="axis-text" x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                                {axisMoney.format(tick)}
                            </text>
                        </g>
                    ))}
                    {[0, Math.floor(last / 2), last].filter((index, position, all) => all.indexOf(index) === position).map(index => (
                        <text key={index} className="axis-text" x={x(index)} y={HEIGHT - 8} textAnchor="middle">
                            {formatMonth(months[index].month)}
                        </text>
                    ))}
                    {SERIES.map(series => (
                        <g key={series.key}>
                            <polyline
                                fill="none"
                                stroke={series.color}
                                strokeWidth="2"
                                strokeLinejoin="round"
                                points={months.map((month, index) => `${x(index)},${y(Number(month[series.key]))}`).join(' ')}
                            />
                        </g>
                    ))}
                    {hovered !== null && (
                        <g>
                            <line className="crosshair" x1={x(hovered)} x2={x(hovered)} y1={PAD.top} y2={PAD.top + plotHeight} />
                            {SERIES.map(series => (
                                <circle key={series.key} cx={x(hovered)} cy={y(Number(months[hovered][series.key]))} r="4" fill={series.color} stroke="#fff" strokeWidth="2" />
                            ))}
                        </g>
                    )}
                    {/* One full-height hit target per month, wider than the marks. */}
                    {months.map((month, index) => (
                        <rect
                            key={month.month}
                            data-month={month.month}
                            x={x(index) - (step || plotWidth) / 2}
                            y={PAD.top}
                            width={step || plotWidth}
                            height={plotHeight}
                            fill="transparent"
                            onMouseEnter={() => setHovered(index)}
                            onMouseLeave={() => setHovered(null)}
                        />
                    ))}
                </svg>
                {hovered !== null && (
                    <div className="chart-tooltip" role="status" style={{ left: `${(x(hovered) / WIDTH) * 100}%` }}>
                        <strong>{formatMonth(months[hovered].month)}</strong>
                        {SERIES.map(series => (
                            <div key={series.key}>{series.label}: {formatMoney(months[hovered][series.key])}</div>
                        ))}
                    </div>
                )}
            </div>
            <details>
                <summary>View as table</summary>
                <table>
                    <thead>
                        <tr>
                            <th>Month</th>
                            <th className="money">Net charges</th>
                            <th className="money">Net payments</th>
                        </tr>
                    </thead>
                    <tbody>
                        {months.map(month => (
                            <tr key={month.month}>
                                <td>{formatMonth(month.month)}</td>
                                <td className="money">{formatMoney(month.charges)}</td>
                                <td className="money">{formatMoney(month.payments)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </section>
    );
}

function Insights() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const closeLedger = useCallback(() => setLedgerTenant(null), []);

    useEffect(() => {
        let ignore = false;
        Promise.all([fetchJson('/api/tenants/'), fetchJson('/api/reports/monthly-activity/')])
            .then(([tenants, months]) => {
                if (!ignore) setData({ tenants, months });
            })
            .catch(error => {
                console.error("Error fetching insights:", error);
                if (!ignore) setError(error);
            });
        return () => { ignore = true; };
    }, []);

    if (error) {
        return <div role="alert">Error loading insights: {error.message}</div>;
    }
    if (!data) {
        return <div>Loading insights...</div>;
    }

    const summary = portfolioSummary(data.tenants);
    return (
        <div className="insights">
            <h2>Insights</h2>
            <div className="stat-row">
                <StatTile
                    label="Total outstanding"
                    value={formatMoney(summary.outstanding)}
                    detail={`${summary.owingCount} tenants with a balance due`}
                />
                <StatTile
                    label="Credits held"
                    value={formatMoney(Math.abs(summary.credit))}
                    detail={`${summary.creditCount} tenants with a credit balance`}
                />
                <StatTile
                    label="Deposits held"
                    value={formatMoney(summary.depositsHeld)}
                    detail={`for ${summary.depositCount} tenants; owed back to them`}
                />
                <StatTile
                    label="Settled"
                    value={summary.settledCount}
                    detail="tenants with a $0.00 balance"
                />
            </div>
            <MonthlyActivityChart months={data.months} />
            <BarList
                title="Outstanding balance by unit prefix"
                rows={outstandingByUnitPrefix(data.tenants)}
                emptyText="No tenants yet."
            />
            <BarList
                title="Largest balances due"
                rows={largestBalances(data.tenants)}
                emptyText="No tenant has a balance due."
                onSelect={setLedgerTenant}
            />
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
        </div>
    );
}

export default Insights;
