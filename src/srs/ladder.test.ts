import { describe, expect, it } from 'vitest';
import { vocab } from '../data/vocab';
import { activateWord } from '../db/queries';
import { openDb } from '../db/schema';
import { promoteAll } from './ladder';

const NOW = Date.UTC(2026, 10, 20);
const word = vocab.find((v) => v.simplified === '喜欢')!;
const rec = `${word.id}:recognition`;

async function setup(name: string, withSentence = true) {
  const db = openDb(name);
  await activateWord(word, withSentence ? word.candidateSentences[0] : null, '', db, NOW);
  const setS = async (type: string, stability: number) =>
    db.cards.update(`${word.id}:${type}`, { stability, state: 2, reps: 5 });
  const types = async () => (await db.cards.where('vocabId').equals(word.id).toArray()).map((c) => c.type).sort();
  return { db, setS, types };
}

describe('ladder promotion (task 8, chained rule)', () => {
  it('recognition at stability 15 spawns audio only', async () => {
    const { db, setS, types } = await setup('ladder-15');
    await setS('recognition', 15);
    expect(await promoteAll(db, NOW)).toBe(1);
    expect(await types()).toEqual(['audio', 'recognition']);
    expect((await db.cards.get(`${word.id}:audio`))?.state).toBe(0); // enters as a new card
  });

  it('recognition at 31 spawns production only once audio is itself stable', async () => {
    const { db, setS, types } = await setup('ladder-31');
    await setS('recognition', 31);
    await promoteAll(db, NOW);
    expect(await types()).toEqual(['audio', 'recognition']); // no same-day collapse
    await setS('audio', 15);
    await promoteAll(db, NOW);
    expect(await types()).toEqual(['audio', 'production', 'recognition']);
  });

  it('no duplicates on re-run', async () => {
    const { db, setS } = await setup('ladder-rerun');
    await setS('recognition', 40);
    await promoteAll(db, NOW);
    await setS('audio', 20);
    await promoteAll(db, NOW);
    const count = await db.cards.count();
    expect(await promoteAll(db, NOW)).toBe(0);
    expect(await db.cards.count()).toBe(count);
    expect((await db.cards.get(rec))?.stability).toBe(40); // existing cards untouched
  });

  it('cloze needs a chosen sentence and a stable production card', async () => {
    const withS = await setup('ladder-cloze');
    await withS.setS('recognition', 40);
    await promoteAll(withS.db, NOW);
    await withS.setS('audio', 20);
    await promoteAll(withS.db, NOW);
    await withS.setS('production', 15);
    await promoteAll(withS.db, NOW);
    expect(await withS.types()).toContain('cloze');

    const without = await setup('ladder-nocloze', false);
    await without.setS('recognition', 40);
    await promoteAll(without.db, NOW);
    await without.setS('audio', 20);
    await promoteAll(without.db, NOW);
    await without.setS('production', 15);
    await promoteAll(without.db, NOW);
    expect(await without.types()).not.toContain('cloze');
  });
});
