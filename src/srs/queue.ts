// Daily queue assembly with the 60-card cap (PRD §9.3). Pure; the DB wrapper is loadQueue().

import type { HskDb } from '../db/schema';
import { newCardLimit } from '../db/queries';
import type { AppSettings, CardRow } from '../types';
import { CardState } from './scheduler';

/** The study day rolls over at 04:00 local, so a late-night session counts as "today". */
const ROLLOVER_HOUR = 4;

export function dayStart(now: number): number {
  const d = new Date(now);
  d.setHours(ROLLOVER_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function dayEnd(now: number): number {
  const d = new Date(dayStart(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export interface QueueInput {
  cards: CardRow[];
  /** Distinct cards already reviewed today. They don't consume the cap again (learning steps). */
  reviewedToday: Set<string>;
  /** New cards already started today. */
  introducedToday: number;
  newLimit: number;
  cap: number;
  now: number;
}

/**
 * queue = [due cards, oldest-due first] ++ [new cards, up to the new-card limit], capped.
 * Overflow is not dropped: it stays due and leads tomorrow's queue.
 * New cards: recognition (newly activated words) before ladder-spawned types, so activation is
 * never starved by promotions; spawned cards take whatever budget is left.
 */
export function assembleQueue({ cards, reviewedToday, introducedToday, newLimit, cap, now }: QueueInput): CardRow[] {
  const end = dayEnd(now);
  const due = cards
    .filter((c) => c.state !== CardState.New && c.due < end)
    .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));

  let slots = Math.max(0, cap - reviewedToday.size);
  const queue: CardRow[] = [];
  for (const c of due) {
    if (reviewedToday.has(c.id)) queue.push(c);
    else if (slots > 0) {
      queue.push(c);
      slots--;
    }
  }

  const fresh = cards
    .filter((c) => c.state === CardState.New)
    .sort((a, b) => Number(a.type !== 'recognition') - Number(b.type !== 'recognition') || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  queue.push(...fresh.slice(0, Math.min(Math.max(0, newLimit - introducedToday), slots)));
  return queue;
}

export async function loadQueue(db: HskDb, settings: AppSettings, now = Date.now()): Promise<CardRow[]> {
  const [cards, logs] = await Promise.all([
    db.cards.toArray(),
    db.reviewLog.where('reviewedAt').aboveOrEqual(dayStart(now)).toArray(),
  ]);
  const todayCount = new Map<string, number>();
  for (const l of logs) todayCount.set(l.cardId, (todayCount.get(l.cardId) ?? 0) + 1);
  // A card was introduced today if every one of its reviews happened today.
  const introducedToday = cards.filter((c) => c.reps > 0 && todayCount.get(c.id) === c.reps).length;
  return assembleQueue({
    cards,
    reviewedToday: new Set(todayCount.keys()),
    introducedToday,
    newLimit: newCardLimit(settings, now),
    cap: settings.dailyReviewCap,
    now,
  });
}

/** Earliest due time among cards not in today's queue, for the session-end summary. */
export async function nextDue(db: HskDb, now = Date.now()): Promise<number | null> {
  const next = await db.cards.where('due').aboveOrEqual(dayEnd(now)).first();
  return next?.due ?? null;
}
