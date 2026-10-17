import { describe, expect, it } from 'vitest';
import type { CardRow, CardType } from '../types';
import { assembleQueue, dayEnd, dayStart } from './queue';
import { CardState } from './scheduler';

const NOW = new Date(2026, 9, 20, 9, 0).getTime(); // local 09:00
const HOUR = 3_600_000;

function card(i: number, over: Partial<CardRow> = {}): CardRow {
  return {
    id: `w-${String(i).padStart(4, '0')}:recognition`, vocabId: `w-${i}`, type: 'recognition',
    due: NOW - i * HOUR, stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0,
    reps: 3, lapses: 0, state: CardState.Review, last_review: NOW - 48 * HOUR, createdAt: 0, ...over,
  };
}
const fresh = (i: number, type: CardType = 'recognition', createdAt = i): CardRow =>
  card(i, { id: `n-${i}:${type}`, type, state: CardState.New, reps: 0, due: NOW, createdAt });

const base = { reviewedToday: new Set<string>(), introducedToday: 0, newLimit: 10, cap: 60, now: NOW };

describe('queue assembly + 60-cap (task 6)', () => {
  it('400 due cards → exactly 60, oldest-due first', () => {
    const cards = Array.from({ length: 400 }, (_, i) => card(i + 1));
    const q = assembleQueue({ ...base, cards });
    expect(q).toHaveLength(60);
    const dues = q.map((c) => c.due);
    expect(dues).toEqual([...dues].sort((a, b) => a - b));
    expect(q[0].id).toBe('w-0400:recognition'); // due 400 h ago
    expect(Math.max(...dues)).toBeLessThan(Math.min(...cards.filter((c) => !q.includes(c)).map((c) => c.due)));
  });

  it('cards due later today are included; tomorrow is not', () => {
    const today = card(1, { due: dayEnd(NOW) - 1 });
    const tomorrow = card(2, { due: dayEnd(NOW) + 1 });
    expect(assembleQueue({ ...base, cards: [today, tomorrow] })).toEqual([today]);
  });

  it('new cards follow due cards, limited by the new-card budget and the cap', () => {
    const due = Array.from({ length: 55 }, (_, i) => card(i + 1));
    const news = Array.from({ length: 20 }, (_, i) => fresh(i + 1));
    const q = assembleQueue({ ...base, cards: [...news, ...due] });
    expect(q).toHaveLength(60);
    expect(q.slice(55).every((c) => c.state === CardState.New)).toBe(true);
    expect(assembleQueue({ ...base, cards: news })).toHaveLength(10);
    expect(assembleQueue({ ...base, cards: news, introducedToday: 7 })).toHaveLength(3);
  });

  it('recognition cards get the new-card budget before ladder-spawned types', () => {
    const spawned = Array.from({ length: 8 }, (_, i) => fresh(i + 1, 'audio', 0));
    const activated = Array.from({ length: 5 }, (_, i) => fresh(i + 100, 'recognition', 10));
    const q = assembleQueue({ ...base, cards: [...spawned, ...activated] });
    expect(q.slice(0, 5).every((c) => c.type === 'recognition')).toBe(true);
    expect(q).toHaveLength(10);
  });

  it('the cap is per day: cards already reviewed today shrink it but are not re-charged', () => {
    const cards = Array.from({ length: 100 }, (_, i) => card(i + 1));
    const reviewedToday = new Set(Array.from({ length: 50 }, (_, i) => `x-${i}`));
    expect(assembleQueue({ ...base, cards, reviewedToday })).toHaveLength(10);
    const learning = card(500, { state: CardState.Learning });
    const full = new Set([...Array.from({ length: 60 }, (_, i) => `x-${i}`), learning.id]);
    expect(assembleQueue({ ...base, cards: [...cards, learning], reviewedToday: full })).toEqual([learning]);
  });

  it('day rolls over at 04:00 local', () => {
    const lateNight = new Date(2026, 9, 21, 2, 0).getTime();
    expect(dayStart(lateNight)).toBe(new Date(2026, 9, 20, 4, 0).getTime());
    expect(dayStart(NOW)).toBe(new Date(2026, 9, 20, 4, 0).getTime());
  });
});
