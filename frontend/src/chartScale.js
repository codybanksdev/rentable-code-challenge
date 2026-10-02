// Axis helpers shared by the charts.

export const axisMoney = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
});

// Round an axis limit away from zero to 1, 2, 2.5, 5 or 10 times a power of ten.
export function niceLimit(value) {
    if (value === 0) return 0;
    const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
    const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= Math.abs(value));
    return Math.sign(value) * step * magnitude;
}
