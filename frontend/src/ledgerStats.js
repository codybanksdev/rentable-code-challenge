// "YYYY-MM-DD" -> a day count, via UTC so no time zone can shift the date.
export function dayNumber(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
}

// How long the tenant has had ledger activity, in calendar months, counting
// both the first and last month: Dec 20 to Mar 5 is 4 months.
//
// The PMS gives no move-in or move-out date, so this is measured between the
// first and last ledger entries rather than up to today. A ledger that stops
// in March says nothing about whether the tenant is still there.
export function tenancy(entries) {
    if (entries.length === 0) return null;
    const dates = entries.map(entry => entry.date).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const [firstYear, firstMonth] = first.split('-').map(Number);
    const [lastYear, lastMonth] = last.split('-').map(Number);
    return { first, last, months: (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1 };
}
