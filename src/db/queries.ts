import type { AppSettings } from '../types';
import { db as defaultDb, type HskDb, type SettingsRow } from './schema';

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
