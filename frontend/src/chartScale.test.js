import { niceLimit } from './chartScale';

test('rounds an axis limit away from zero to a round number', () => {
    expect([1, 180, 227985, 250000, 0.4].map(niceLimit)).toEqual([1, 200, 250000, 250000, 0.5]);
    expect(niceLimit(0)).toBe(0);
    expect(niceLimit(-550)).toBe(-1000);
});
