import React, { useState } from 'react';
import { axisMoney, niceLimit } from './chartScale';
import { formatMoney } from './format';
import { formatMonth } from './insightsData';

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };
// Gap between bars inside a month, and the share of a month's width left
// empty between groups, so adjacent months do not read as one block.
const BAR_GAP = 2;
const GROUP_FILL = 0.7;

// One chart for every month-by-month series on Insights.
//   kind="bars": one bar per series per month, side by side. For comparing
//                amounts that belong to the month (charges against payments).
//   kind="line": one line per series. For a level that carries from month to
//                month (the receivable).
// A legend is shown only when there is more than one series; with one, the
// title already says what is plotted. Hovering a month reads out its values.
function MonthlyChart({ title, months, series, kind = 'bars' }) {
    const [hoveredIndex, setHovered] = useState(null);
    if (months.length === 0) {
        return <section className="chart" aria-label={title}><h3>{title}</h3><p>No transactions in this period.</p></section>;
    }
    const hovered = hoveredIndex !== null && hoveredIndex < months.length ? hoveredIndex : null;

    const values = months.flatMap(month => series.map(one => Number(month[one.key])));
    const top = niceLimit(Math.max(...values, 1));
    const bottom = niceLimit(Math.min(...values, 0));
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const slot = plotWidth / months.length;
    const center = index => PAD.left + slot * (index + 0.5);
    const y = value => PAD.top + plotHeight * (1 - (value - bottom) / (top - bottom));
    const barWidth = Math.max((slot * GROUP_FILL - BAR_GAP * (series.length - 1)) / series.length, 1);
    const last = months.length - 1;
    const labelled = [...new Set([0, Math.floor(last / 2), last])];

    return (
        <section className="chart" aria-label={title}>
            <h3>{title}</h3>
            {series.length > 1 && (
                <ul className="legend">
                    {series.map(one => (
                        <li key={one.key}>
                            <span className="legend-swatch" style={{ backgroundColor: one.color }} />
                            {one.label}
                        </li>
                    ))}
                </ul>
            )}
            <div className="line-chart">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    aria-label={`${title}, ${formatMonth(months[0].month)} to ${formatMonth(months[last].month)}`}
                >
                    {[...new Set([bottom, (bottom + top) / 2, top])].map(tick => (
                        <g key={tick}>
                            <line className="grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
                            <text className="axis-text" x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                                {axisMoney.format(tick)}
                            </text>
                        </g>
                    ))}
                    {bottom < 0 && <line className="zero-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} />}
                    {labelled.map(index => (
                        <text key={index} className="axis-text" x={center(index)} y={HEIGHT - 8} textAnchor="middle">
                            {formatMonth(months[index].month)}
                        </text>
                    ))}
                    {kind === 'bars' && months.map((month, index) => series.map((one, position) => {
                        const value = Number(month[one.key]);
                        const groupWidth = barWidth * series.length + BAR_GAP * (series.length - 1);
                        return (
                            <rect
                                key={`${month.month}-${one.key}`}
                                x={center(index) - groupWidth / 2 + position * (barWidth + BAR_GAP)}
                                // A bar grows from zero, up for a positive value and down for a negative one.
                                y={Math.min(y(value), y(0))}
                                width={barWidth}
                                height={Math.abs(y(value) - y(0))}
                                fill={one.color}
                            />
                        );
                    }))}
                    {kind === 'line' && series.map(one => (
                        <polyline
                            key={one.key}
                            fill="none"
                            stroke={one.color}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            points={months.map((month, index) => `${center(index)},${y(Number(month[one.key]))}`).join(' ')}
                        />
                    ))}
                    {hovered !== null && (
                        <g>
                            <line className="crosshair" x1={center(hovered)} x2={center(hovered)} y1={PAD.top} y2={PAD.top + plotHeight} />
                            {kind === 'line' && series.map(one => (
                                <circle key={one.key} cx={center(hovered)} cy={y(Number(months[hovered][one.key]))} r="4" fill={one.color} stroke="#fff" strokeWidth="2" />
                            ))}
                        </g>
                    )}
                    {/* One full-height hit target per month, wider than the marks. */}
                    {months.map((month, index) => (
                        <rect
                            key={month.month}
                            data-month={month.month}
                            x={PAD.left + slot * index}
                            y={PAD.top}
                            width={slot}
                            height={plotHeight}
                            fill="transparent"
                            onMouseEnter={() => setHovered(index)}
                            onMouseLeave={() => setHovered(null)}
                        />
                    ))}
                </svg>
                {hovered !== null && (
                    <div className="chart-tooltip" role="status" style={{ left: `${(center(hovered) / WIDTH) * 100}%` }}>
                        <strong>{formatMonth(months[hovered].month)}</strong>
                        {series.map(one => (
                            <div key={one.key}>{one.label}: {formatMoney(months[hovered][one.key])}</div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

export default MonthlyChart;
