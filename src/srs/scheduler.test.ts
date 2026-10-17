import { describe, expect, it } from 'vitest';
import { CardState, formatInterval, newCard, previewIntervals, schedule } from './scheduler';

const NOW = Date.UTC(2026, 9, 20, 8);
const DAY = 86_400_000;

describe('FSRS wrapper (task 5)', () => {
  it('Good on a new card → Learning with a future due', () => {
    const c = schedule(newCard('w-0001:recognition', 'w-0001', 'recognition', NOW), 3, NOW);
    expect(c.state).toBe(CardState.Learning);
    expect(c.due).toBeGreaterThan(NOW);
    expect(c.reps).toBe(1);
    expect(c.last_review).toBe(NOW);
  });

  it('a lapse reduces stability', () => {
    let c = newCard('x', 'x', 'recognition', NOW);
    let t = NOW;
    for (let i = 0; i < 4; i++) {
      c = schedule(c, 3, t);
      t = c.due;
    }
    expect(c.state).toBe(CardState.Review);
    const before = c.stability;
    const lapsed = schedule(c, 1, t);
    expect(lapsed.stability).toBeLessThan(before);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.state).toBe(CardState.Relearning);
  });

  it('round-trips through epoch-ms storage without Date objects', () => {
    const c = schedule(newCard('x', 'x', 'audio', NOW), 3, NOW);
    expect(typeof c.due).toBe('number');
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it('previews four ordered intervals', () => {
    const p = previewIntervals(newCard('x', 'x', 'recognition', NOW), NOW);
    expect(Object.keys(p)).toEqual(['1', '2', '3', '4']);
    expect(p[1]).toMatch(/m$/);
  });

  it('formats intervals', () => {
    expect(formatInterval(30_000)).toBe('1m');
    expect(formatInterval(10 * 60_000)).toBe('10m');
    expect(formatInterval(4 * DAY)).toBe('4d');
    expect(formatInterval(62 * DAY)).toBe('2mo');
    expect(formatInterval(400 * DAY)).toBe('1.1y');
  });
});
