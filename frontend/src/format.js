const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    // Accounting style: negatives render as ($80.00) rather than -$80.00.
    currencySign: 'accounting',
});

// The API sends money as decimal strings ("1500.00") so nothing is lost in
// transit; they are only turned into numbers here, for display.
export function formatMoney(amount) {
    return currency.format(Number(amount));
}

// Dates arrive as "YYYY-MM-DD". `new Date("2023-01-01")` is midnight UTC,
// which displays as Dec 31 in US time zones, so format the parts directly.
export function formatDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return `${month}/${day}/${year}`;
}

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

// A sync time is a real instant, so unlike a ledger date it is shown in the
// reader's own time zone.
export function formatDateTime(isoDateTime) {
    return dateTime.format(new Date(isoDateTime));
}
