import React, { useCallback, useEffect, useState } from 'react';
import MonthlyChart from './MonthlyChart';
import SortableHeader from './SortableHeader';
import TenantLedger from './TenantLedger';
import { getJson } from './api';
import { downloadFile } from './download';
import { formatDate, formatMoney } from './format';
import { formatMonth, largestBalances, outstandingByUnitPrefix, portfolioSummary } from './insightsData';
import { sortRows } from './tenantFilters';

// Net: credits reduce charges and returned payments reduce payments.
const ACTIVITY = [
    { key: 'charges', label: 'Net charges', color: '#2a78d6' },
    { key: 'payments', label: 'Net payments', color: '#eb6834' },
];
const RECEIVABLE = [{ key: 'receivable', label: 'Receivable', color: '#2a78d6' }];
const RETURNED = [{ key: 'returned_payments', label: 'Returned payments', color: '#2a78d6' }];

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

function rangeQuery({ start, end }) {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return query ? `?${query}` : '';
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

// The figures behind the monthly charts, plus the collection rate.
function MonthlyTable({ months }) {
    if (months.length === 0) return null;
    return (
        <section className="chart" aria-label="Monthly figures">
            <h3>Monthly figures</h3>
            <div className="report-scroll">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Month</th>
                            <th scope="col" className="money">Net charges</th>
                            <th scope="col" className="money">Net payments</th>
                            <th scope="col" className="money">Collection rate</th>
                            <th scope="col" className="money">Returned payments</th>
                            <th scope="col" className="money">Receivable at month end</th>
                        </tr>
                    </thead>
                    <tbody>
                        {months.map(month => (
                            <tr key={month.month}>
                                <td>{formatMonth(month.month)}</td>
                                <td className="money">{formatMoney(month.charges)}</td>
                                <td className="money">{formatMoney(month.payments)}</td>
                                <td className="money">
                                    {month.collection_rate === null ? '—' : percent.format(Number(month.collection_rate))}
                                </td>
                                <td className="money">
                                    {formatMoney(month.returned_payments)}
                                    {month.returned_count > 0 && ` (${month.returned_count})`}
                                </td>
                                <td className="money">{formatMoney(month.receivable)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

const ROLL_FORWARD_COLUMNS = [
    { key: 'pms_tenant_id', label: 'PMS ID', numeric: true },
    { key: 'name', label: 'Name' },
    { key: 'unit', label: 'Unit' },
    { key: 'opening', label: 'Opening', numeric: true, money: true },
    { key: 'charges', label: 'Net charges', numeric: true, money: true },
    { key: 'payments', label: 'Net payments', numeric: true, money: true },
    { key: 'closing', label: 'Closing', numeric: true, money: true },
];

// Opening + charges - payments = closing, per tenant and in total. This is
// the statement an accountant ties to the general ledger at period end.
function RollForward({ statement, query, onSelect }) {
    const [exportError, setExportError] = useState(null);
    const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
    const exportCsv = () => {
        setExportError(null);
        downloadFile(`/api/reports/roll-forward.csv${query}`, 'roll-forward.csv').catch(setExportError);
    };
    // Sorting reorders the rows only; the totals row stays the totals.
    const { totals } = statement;
    const rows = sortRows(statement.rows, sort, ROLL_FORWARD_COLUMNS, 'tenant_id');
    const title = 'Receivable roll-forward';
    return (
        <section className="chart" aria-label={title}>
            <div className="chart-heading">
                <h3>{title}</h3>
                <button onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
            </div>
            <p className="chart-note">
                Opening balance + net charges − net payments = closing balance, for
                {statement.start ? ` ${formatDate(statement.start)}` : ' the first transaction'} to
                {statement.end ? ` ${formatDate(statement.end)}` : ' the latest'}.
            </p>
            {exportError && <p role="alert">Export failed. {exportError.message}</p>}
            {rows.length === 0 ? <p>No tenants had transactions on or before the end of this period.</p> : (
                <div className="report-scroll">
                    <table>
                        <thead>
                            <tr>
                                {ROLL_FORWARD_COLUMNS.map(column => (
                                    <SortableHeader key={column.key} column={column} sort={sort} onSort={setSort} />
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.tenant_id}>
                                    <td>{row.pms_tenant_id ?? '—'}</td>
                                    <td>
                                        <button
                                            className="link-button"
                                            aria-label={`View ledger for ${row.name}`}
                                            onClick={() => onSelect({ id: row.tenant_id, pms_tenant_id: row.pms_tenant_id, name: row.name, unit: row.unit })}
                                        >
                                            {row.name}
                                        </button>
                                    </td>
                                    <td>{row.unit}</td>
                                    <td className="money">{formatMoney(row.opening)}</td>
                                    <td className="money">{formatMoney(row.charges)}</td>
                                    <td className="money">{formatMoney(row.payments)}</td>
                                    <td className="money">{formatMoney(row.closing)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th scope="row" colSpan={3}>Total, {rows.length} tenants</th>
                                <td className="money">{formatMoney(totals.opening)}</td>
                                <td className="money">{formatMoney(totals.charges)}</td>
                                <td className="money">{formatMoney(totals.payments)}</td>
                                <td className="money">{formatMoney(totals.closing)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    );
}

function Insights() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [range, setRange] = useState({ start: '', end: '' });
    const [ledgerTenant, setLedgerTenant] = useState(null);
    const closeLedger = useCallback(() => setLedgerTenant(null), []);
    const query = rangeQuery(range);
    const asOf = range.end ? `?as_of=${range.end}` : '';

    useEffect(() => {
        let ignore = false;
        Promise.all([
            // Balances are a standing figure, so they are taken as of the end
            // of the period; the monthly series and roll-forward cover it.
            getJson(`/api/tenants/${asOf}`),
            getJson(`/api/reports/monthly-activity/${query}`),
            getJson(`/api/reports/roll-forward/${query}`),
        ])
            .then(([tenants, months, statement]) => {
                // `query` is kept with the data so headings describe the
                // figures on screen, not a period still being fetched.
                if (!ignore) {
                    setData({ tenants, months, statement, query, end: range.end });
                    setError(null);
                }
            })
            .catch(error => {
                console.error("Error fetching insights:", error);
                if (!ignore) setError(error);
            });
        return () => { ignore = true; };
        // range.end is covered by asOf and query.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asOf, query]);

    const setRangeField = name => event => setRange({ ...range, [name]: event.target.value });
    const controls = (
        <div className="tenant-filters insight-filters">
            <label>
                From
                <input type="date" value={range.start} max={range.end || undefined} onChange={setRangeField('start')} />
            </label>
            <label>
                To
                <input type="date" value={range.end} min={range.start || undefined} onChange={setRangeField('end')} />
            </label>
            <button onClick={() => setRange({ start: '', end: '' })} disabled={!query}>All dates</button>
        </div>
    );

    if (!data) {
        return (
            <div className="insights">
                <h2>Insights</h2>
                {controls}
                {error ? <div role="alert">Error loading insights: {error.message}</div> : <div>Loading insights...</div>}
            </div>
        );
    }

    const summary = portfolioSummary(data.tenants);
    const when = data.end ? `as of ${formatDate(data.end)}` : 'today';
    return (
        <div className="insights">
            <h2>Insights</h2>
            {controls}
            {error && (
                <div role="alert">
                    Error loading insights: {error.message} The figures below are from before this error.
                </div>
            )}
            <div className="stat-row">
                <StatTile
                    label={`Total outstanding, ${when}`}
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
            <RollForward statement={data.statement} query={data.query} onSelect={setLedgerTenant} />
            <MonthlyChart title="Net charges and payments by month" months={data.months} series={ACTIVITY} kind="bars" />
            <MonthlyChart title="Total receivable at month end" months={data.months} series={RECEIVABLE} kind="line" />
            <MonthlyChart title="Returned payments by month" months={data.months} series={RETURNED} kind="bars" />
            <MonthlyTable months={data.months} />
            <BarList
                title={`Outstanding balance by unit prefix, ${when}`}
                rows={outstandingByUnitPrefix(data.tenants)}
                emptyText="No tenants yet."
            />
            <BarList
                title={`Largest balances due, ${when}`}
                rows={largestBalances(data.tenants)}
                emptyText="No tenant has a balance due."
                onSelect={setLedgerTenant}
            />
            {ledgerTenant && <TenantLedger tenant={ledgerTenant} onClose={closeLedger} />}
        </div>
    );
}

export default Insights;
