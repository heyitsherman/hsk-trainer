import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './schema';
import { defaultSettings, getSettings, newCardLimit, updateSettings } from './queries';
import type { CardRow } from '../types';

const db = openDb('test-schema');
afterEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('dexie schema round-trips every store', () => {
  it('cards (epoch-ms dates, indexed by due)', async () => {
    const card: CardRow = {
      id: 'w-0001:recognition', vocabId: 'w-0001', type: 'recognition', due: 1_760_000_000_000,
      stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0,
      reps: 0, lapses: 0, state: 0, last_review: null, createdAt: 1_760_000_000_000,
    };
    await db.cards.put(card);
    await db.cards.put({ ...card, id: 'w-0002:recognition', vocabId: 'w-0002', due: card.due - 1 });
    expect(await db.cards.get(card.id)).toEqual(card);
    const byDue = await db.cards.where('due').belowOrEqual(card.due).sortBy('due');
    expect(byDue.map((c) => c.vocabId)).toEqual(['w-0002', 'w-0001']);
  });

  it('activated', async () => {
    const row = {
      vocabId: 'w-0001', activatedAt: 1, userNote: 'n',
      chosenSentence: { simplified: '我爱你。', pinyin: 'Wǒ ài nǐ.', english: 'I love you.', source: 'tatoeba' as const, tatoebaId: 139673 },
    };
    await db.activated.put(row);
    expect(await db.activated.get('w-0001')).toEqual(row);
  });

  it('reviewLog auto-increments', async () => {
    const a = await db.reviewLog.add({ cardId: 'x', rating: 3, reviewedAt: 1, durationMs: 4000, stabilityAfter: 2.3 });
    const b = await db.reviewLog.add({ cardId: 'x', rating: 1, reviewedAt: 2, durationMs: 9000, stabilityAfter: 0.4 });
    expect(b).toBeGreaterThan(a!);
    expect(await db.reviewLog.where('cardId').equals('x').count()).toBe(2);
  });

  it('weekProgress', async () => {
    const row = { week: 12, tasksCompleted: [0, 2], assignmentText: 'a', notesText: 'n', curatedAt: 5, completedAt: null, finalProject: ['', 'x', ''] };
    await db.weekProgress.put(row);
    expect(await db.weekProgress.get(12)).toEqual(row);
  });

  it('settings: defaults created once, patches persist', async () => {
    const s = await getSettings(db, 1000);
    expect(s).toMatchObject({ newCardsPerDay: 10, dailyReviewCap: 60, syncEnabled: false, startDate: '2026-10-20', createdAt: 1000 });
    await updateSettings({ theme: 'light', newCardsPerDay: 15 }, db);
    expect(await getSettings(db, 9999)).toMatchObject({ theme: 'light', newCardsPerDay: 15, createdAt: 1000 });
  });

  it('new-card limit is locked at 10 for the first 14 days', () => {
    const s = { ...defaultSettings(0), newCardsPerDay: 25 };
    expect(newCardLimit(s, 13 * 86_400_000)).toBe(10);
    expect(newCardLimit(s, 14 * 86_400_000)).toBe(25);
  });
});
