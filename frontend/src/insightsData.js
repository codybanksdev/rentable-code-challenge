// Pure roll-ups of the tenant list for the Insights tab.
import { unitPrefix } from './tenantFilters';

export function portfolioSummary(tenants) {
    // Tenants with no balance on file are in none of these groups.
    const balances = tenants
        .filter(tenant => tenant.balance !== null)
        .map(tenant => Number(tenant.balance));
    const owing = balances.filter(balance => balance > 0);
    const credits = balances.filter(balance => balance < 0);
    const sum = values => values.reduce((total, value) => total + value, 0);
    return {
        // What is owed, not netted against other tenants' credits: a credit
        // on one account does not pay down another.
        outstanding: sum(owing),
        owingCount: owing.length,
        credit: sum(credits),
        creditCount: credits.length,
        settledCount: balances.length - owing.length - credits.length,
        // Security deposits the landlord is holding for tenants: a liability,
        // reported apart from what tenants owe.
        depositsHeld: sum(tenants.map(tenant => Number(tenant.deposit_held || 0))),
        depositCount: tenants.filter(tenant => Number(tenant.deposit_held || 0) > 0).length,
    };
}

// Outstanding balance per unit prefix (the unit code's leading letter), A to
// Z. The PMS only says "unit code"; whether a prefix is a building is not
// something the data states, so it is not called one.
export function outstandingByUnitPrefix(tenants) {
    const totals = new Map();
    tenants.forEach(tenant => {
        const prefix = unitPrefix(tenant.unit) || 'Other';
        const owed = Math.max(Number(tenant.balance), 0);
        totals.set(prefix, (totals.get(prefix) || 0) + owed);
    });
    return [...totals.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function largestBalances(tenants, count = 10) {
    return tenants
        .filter(tenant => Number(tenant.balance) > 0)
        .sort((a, b) => Number(b.balance) - Number(a.balance) || a.id - b.id)
        .slice(0, count)
        .map(tenant => ({
            label: `${tenant.name}${tenant.unit ? ` (${tenant.unit})` : ''}`,
            value: Number(tenant.balance),
            tenant,
        }));
}

// "2023-01" -> "Jan 2023", without building a Date (no time zone involved).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatMonth(month) {
    const [year, number] = month.split('-');
    return `${MONTHS[Number(number) - 1]} ${year}`;
}
