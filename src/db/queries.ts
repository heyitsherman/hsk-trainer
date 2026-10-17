import { newCard } from '../srs/scheduler';
import type { ActivatedWord, AppSettings, Sentence, VocabEntry, WeekProgress } from '../types';
import { db as defaultDb, type HskDb, type SettingsRow } from './schema';

export const WEEKS = 12;

export const emptyWeek = (week: number): WeekProgress => ({
  week,
  tasksCompleted: [],
  assignmentText: '',
  notesText: '',
  curatedAt: null,
  completedAt: null,
});

export async function getWeek(week: number, db: HskDb = defaultDb): Promise<WeekProgress> {
  return (await db.weekProgress.get(week)) ?? emptyWeek(week);
}

export async function patchWeek(week: number, patch: Partial<WeekProgress>, db: HskDb = defaultDb): Promise<WeekProgress> {
  return db.transaction('rw', db.weekProgress, async () => {
    const next = { ...(await getWeek(week, db)), ...patch, week };
    await db.weekProgress.put(next);
    return next;
  });
}

/** Progress-anchored (PRD §13): week N unlocks once week N−1's curation is complete. */
export function unlockedThrough(weeks: WeekProgress[]): number {
  const done = new Set(weeks.filter((w) => w.curatedAt !== null).map((w) => w.week));
  let n = 1;
  while (n < WEEKS && done.has(n)) n++;
  return n;
}

/** Curation commit (PRD §10): ActivatedWord + recognition card, atomically. Re-saving keeps the card. */
export async function activateWord(
  entry: VocabEntry,
  chosenSentence: Sentence | null,
  userNote: string,
  db: HskDb = defaultDb,
  now = Date.now(),
): Promise<void> {
  await db.transaction('rw', db.activated, db.cards, async () => {
    const prev = await db.activated.get(entry.id);
    const row: ActivatedWord = { vocabId: entry.id, activatedAt: prev?.activatedAt ?? now, chosenSentence };
    if (userNote.trim()) row.userNote = userNote.trim();
    await db.activated.put(row);
    const id = `${entry.id}:recognition`;
    if (!(await db.cards.get(id))) await db.cards.put(newCard(id, entry.id, 'recognition', now));
  });
}

const DAY = 86_400_000;
export const NEW_CARD_LOCK_DAYS = 14;

export function defaultSettings(now: number): AppSettings {
  return {
    newCardsPerDay: 10,
    dailyReviewCap: 60,
    syncEnabled: false,
    syncToken: null,
    lastSyncAt: null,
    startDate: '2026-10-20',
    installDismissedAt: null,
    theme: 'dark',
    createdAt: now,
    persistGranted: null,
  };
}

const strip = ({ key: _, ...settings }: SettingsRow): AppSettings => settings;

export async function getSettings(db: HskDb = defaultDb, now = Date.now()): Promise<AppSettings> {
  const row = await db.settings.get('app');
  if (row) return { ...defaultSettings(row.createdAt), ...strip(row) };
  const settings = defaultSettings(now);
  await db.settings.put({ key: 'app', ...settings });
  return settings;
}

export async function updateSettings(patch: Partial<AppSettings>, db: HskDb = defaultDb): Promise<AppSettings> {
  const next: SettingsRow = { key: 'app', ...(await getSettings(db)), ...patch };
  await db.settings.put(next);
  return strip(next);
}

export function isNewCardLimitLocked(s: AppSettings, now = Date.now()): boolean {
  return now < s.createdAt + NEW_CARD_LOCK_DAYS * DAY;
}

/** New-card limit is fixed at 10 for the first 14 days, then user-adjustable (PRD §9.3). */
export function newCardLimit(s: AppSettings, now = Date.now()): number {
  return isNewCardLimitLocked(s, now) ? 10 : s.newCardsPerDay;
}
