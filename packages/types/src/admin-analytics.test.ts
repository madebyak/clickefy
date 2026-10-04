import { describe, expect, it } from 'vitest';

import {
  bucketKeys,
  bucketStart,
  csvRow,
  dubaiDateOf,
  dubaiDayStartUtc,
  marginPct,
  monthKeys,
  monthRange,
  parseAnalyticsRange,
} from './admin-analytics';

describe('Dubai calendar', () => {
  it('starts a Dubai day four hours before UTC midnight', () => {
    expect(dubaiDayStartUtc('2026-10-04').toISOString()).toBe('2026-10-03T20:00:00.000Z');
  });
  it('maps a late-evening UTC instant to the next Dubai date', () => {
    expect(dubaiDateOf(new Date('2026-10-03T20:00:00Z'))).toBe('2026-10-04');
    expect(dubaiDateOf(new Date('2026-10-03T19:59:59Z'))).toBe('2026-10-03');
  });
});

describe('parseAnalyticsRange', () => {
  it('defaults to the last 30 Dubai days ending today', () => {
    const r = parseAnalyticsRange(undefined, undefined, new Date('2026-10-04T22:30:00Z')); // already 5 Oct in Dubai
    expect(r.to).toBe('2026-10-05');
    expect(r.from).toBe('2026-09-06');
    expect(r.fromUtc.toISOString()).toBe('2026-09-05T20:00:00.000Z');
    expect(r.toUtc.toISOString()).toBe('2026-10-05T20:00:00.000Z');
  });
  it('rejects malformed, inverted and over-long ranges', () => {
    expect(() => parseAnalyticsRange('2026-02-30', '2026-03-01')).toThrow(/from/);
    expect(() => parseAnalyticsRange('2026-03-02', '2026-03-01')).toThrow(/after/);
    expect(() => parseAnalyticsRange('2025-01-01', '2026-03-01')).toThrow(/longer/);
    expect(() => parseAnalyticsRange('2026-1-1', '2026-03-01')).toThrow(/YYYY-MM-DD/);
  });
  it('covers a whole month', () => {
    const r = monthRange('2026-09');
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2026-09-30');
    expect(r.toUtc.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(() => monthRange('2026-13')).toThrow();
  });
});

describe('buckets', () => {
  it('truncates like Postgres date_trunc (weeks start Monday)', () => {
    expect(bucketStart('2026-10-04', 'day')).toBe('2026-10-04'); // a Sunday
    expect(bucketStart('2026-10-04', 'week')).toBe('2026-09-28');
    expect(bucketStart('2026-10-05', 'week')).toBe('2026-10-05');
    expect(bucketStart('2026-10-04', 'month')).toBe('2026-10-01');
  });
  it('lists every bucket the range touches so series can be zero-filled', () => {
    expect(bucketKeys({ from: '2026-09-29', to: '2026-10-02' }, 'day')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(bucketKeys({ from: '2026-09-29', to: '2026-10-13' }, 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(bucketKeys({ from: '2026-11-15', to: '2027-01-02' }, 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(monthKeys({ from: '2026-11-15', to: '2027-01-02' })).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('numbers and CSV', () => {
  it('reports margin as a percentage of credit value, null when nothing was paid', () => {
    expect(marginPct(10, 6)).toBe(40);
    expect(marginPct(0, 6)).toBeNull();
    expect(marginPct(1, 1.5)).toBe(-50);
  });
  it('quotes CSV cells that need it', () => {
    expect(csvRow(['a', 1, null, 'x,y', 'say "hi"', 'two\nlines'])).toBe('a,1,,"x,y","say ""hi""","two\nlines"');
  });
});
