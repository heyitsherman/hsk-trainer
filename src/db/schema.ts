import Dexie, { type EntityTable } from 'dexie';
import type { ActivatedWord, AppSettings, CardRow, ReviewLogRow, WeekProgress } from '../types';

export type SettingsRow = AppSettings & { key: 'app' };

export type HskDb = Dexie & {
  cards: EntityTable<CardRow, 'id'>;
  activated: EntityTable<ActivatedWord, 'vocabId'>;
  reviewLog: EntityTable<ReviewLogRow, 'id'>;
  weekProgress: EntityTable<WeekProgress, 'week'>;
  settings: EntityTable<SettingsRow, 'key'>;
};

export function openDb(name = 'hsk-trainer'): HskDb {
  const db = new Dexie(name) as HskDb;
  db.version(1).stores({
    cards: 'id, vocabId, type, due, state',
    activated: 'vocabId, activatedAt',
    reviewLog: '++id, cardId, reviewedAt',
    weekProgress: 'week',
    settings: 'key',
  });
  return db;
}

export const db = openDb();
