// The only module that imports ts-fsrs (PRD §8.1). Everything else sees CardRow with epoch-ms dates.

import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type State } from 'ts-fsrs';
import type { CardRow, CardType, Grade } from '../types';

const f = fsrs(
  generatorParameters({
    request_retention: 0.9, // PRD §8.2; default weights, no hand-tuning
    enable_fuzz: true, // ts-fsrs 5.x defaults this to false
  }),
);

export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

const toFsrs = (c: CardRow): FsrsCard => ({
  due: new Date(c.due),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as State,
  last_review: c.last_review === null ? undefined : new Date(c.last_review),
});

const fromFsrs = (base: CardRow, c: FsrsCard): CardRow => ({
  ...base,
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.last_review ? c.last_review.getTime() : null,
});

export function newCard(id: string, vocabId: string, type: CardType, now: number = Date.now()): CardRow {
  const base = { id, vocabId, type, createdAt: now } as CardRow;
  return fromFsrs(base, createEmptyCard(new Date(now)));
}

export function schedule(card: CardRow, rating: Grade, now: number = Date.now()): CardRow {
  return fromFsrs(card, f.next(toFsrs(card), new Date(now), rating).card);
}

export function formatInterval(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

/** Human-readable interval for each answer button ("10m", "4d", "2mo"). */
export function previewIntervals(card: CardRow, now: number = Date.now()): Record<Grade, string> {
  const preview = f.repeat(toFsrs(card), new Date(now));
  const out = {} as Record<Grade, string>;
  for (const g of [1, 2, 3, 4] as Grade[]) out[g] = formatInterval(preview[g].card.due.getTime() - now);
  return out;
}
