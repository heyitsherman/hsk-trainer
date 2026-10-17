// Card-type promotion (PRD §9.1), chained (owner decision 2026-10-17).
//
// With default FSRS weights a well-known card's stability jumps 11 → ~46 in one review, so the PRD's
// independent thresholds (audio ≥14, production ≥30) would unlock every type on the same day. Each
// type therefore also waits for the previous type's own card to stabilise:
//   audio      ← recognition S ≥ 14
//   production ← recognition S ≥ 30  and  audio S ≥ 14
//   cloze      ← production S ≥ 14   and  a chosen sentence that contains the word
// Spawned cards enter as new cards; the queue gives them whatever new-card budget recognition leaves.

import { vocabById } from '../data/vocab';
import type { HskDb } from '../db/schema';
import type { ActivatedWord, CardRow, CardType } from '../types';
import { newCard } from './scheduler';

export const STABLE = 14;
export const PRODUCTION_RECOGNITION = 30;

const sentenceHasWord = (a: ActivatedWord | undefined, word: string) => {
  const s = a?.chosenSentence?.simplified;
  return !!s && (s.includes(word) || s.includes(word.replace(/儿$/, '')));
};

export function typesToSpawn(cards: Partial<Record<CardType, CardRow>>, clozeable: boolean): CardType[] {
  const S = (t: CardType) => cards[t]?.stability ?? 0;
  const want: CardType[] = [];
  if (S('recognition') >= STABLE) want.push('audio');
  if (S('recognition') >= PRODUCTION_RECOGNITION && S('audio') >= STABLE) want.push('production');
  if (clozeable && S('production') >= STABLE) want.push('cloze');
  return want.filter((t) => !cards[t]);
}

/** Runs once per session start. Idempotent: existing cards are never recreated. Returns cards spawned. */
export async function promoteAll(db: HskDb, now: number = Date.now()): Promise<number> {
  return db.transaction('rw', db.cards, db.activated, async () => {
    const [cards, activated] = await Promise.all([db.cards.toArray(), db.activated.toArray()]);
    const words = new Map(activated.map((a) => [a.vocabId, a]));
    const byWord = new Map<string, Partial<Record<CardType, CardRow>>>();
    for (const c of cards) (byWord.get(c.vocabId) ?? byWord.set(c.vocabId, {}).get(c.vocabId)!)[c.type] = c;
    const spawned: CardRow[] = [];
    for (const [vocabId, set] of byWord) {
      const word = vocabById.get(vocabId)?.simplified ?? '';
      for (const t of typesToSpawn(set, sentenceHasWord(words.get(vocabId), word)))
        spawned.push(newCard(`${vocabId}:${t}`, vocabId, t, now));
    }
    await db.cards.bulkPut(spawned);
    return spawned.length;
  });
}
