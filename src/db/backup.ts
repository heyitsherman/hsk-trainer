// Export / import (PRD §11.3). Works offline, with sync off, on a device that has never synced.

import raw from '../data/schedule.json';
import type { ActivatedWord, CardRow, Module, ReviewLogRow, WeekProgress } from '../types';
import { db as defaultDb, type HskDb, type SettingsRow } from './schema';

const FORMAT = 'hsk-trainer-backup';
const VERSION = 1;

export interface Backup {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  data: {
    cards: CardRow[];
    activated: ActivatedWord[];
    reviewLog: ReviewLogRow[];
    weekProgress: WeekProgress[];
    settings: SettingsRow[];
  };
}

export async function exportBackup(db: HskDb = defaultDb, now = Date.now()): Promise<Backup> {
  return db.transaction('r', [db.cards, db.activated, db.reviewLog, db.weekProgress, db.settings], async () => ({
    format: FORMAT,
    version: VERSION,
    exportedAt: now,
    data: {
      cards: await db.cards.toArray(),
      activated: await db.activated.toArray(),
      reviewLog: await db.reviewLog.toArray(),
      weekProgress: await db.weekProgress.toArray(),
      settings: await db.settings.toArray(),
    },
  }));
}

/** Throws with a readable message if the file isn't a backup this version understands. */
export function parseBackup(text: string): Backup {
  let b: Backup;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (b?.format !== FORMAT) throw new Error('Not an HSK Trainer backup.');
  if (b.version > VERSION) throw new Error(`Backup is from a newer app version (${b.version}).`);
  for (const k of ['cards', 'activated', 'reviewLog', 'weekProgress', 'settings'] as const)
    if (!Array.isArray(b.data?.[k])) throw new Error(`Backup is missing "${k}".`);
  return b;
}

/** Replaces everything on this device with the backup, atomically. */
export async function importBackup(b: Backup, db: HskDb = defaultDb): Promise<void> {
  await db.transaction('rw', [db.cards, db.activated, db.reviewLog, db.weekProgress, db.settings], async () => {
    await Promise.all([db.cards.clear(), db.activated.clear(), db.reviewLog.clear(), db.weekProgress.clear(), db.settings.clear()]);
    await db.cards.bulkPut(b.data.cards);
    await db.activated.bulkPut(b.data.activated);
    await db.reviewLog.bulkPut(b.data.reviewLog);
    await db.weekProgress.bulkPut(b.data.weekProgress);
    await db.settings.bulkPut(b.data.settings);
  });
}

const modules = raw as Module[];
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

/** Week notes and assignment answers, ready to paste into an Obsidian vault. */
export async function exportMarkdown(db: HskDb = defaultDb, now = Date.now()): Promise<string> {
  const weeks = new Map((await db.weekProgress.toArray()).map((w) => [w.week, w]));
  const out = ['---', 'type: course-notes', 'course: HSK Trainer', `exported: ${date(now)}`, 'tags: [mandarin, hsk]', '---', '', '# HSK Trainer: notes and assignments', ''];
  for (const m of modules) {
    const w = weeks.get(m.week);
    const final = m.finalProject?.map((p, i) => ({ p, text: w?.finalProject?.[i]?.trim() ?? '' })).filter((x) => x.text) ?? [];
    if (!w || (!w.assignmentText.trim() && !w.notesText.trim() && !final.length)) continue;
    out.push(`## Week ${m.week}: ${m.title}`, '');
    if (w.completedAt) out.push(`Completed ${date(w.completedAt)}`, '');
    if (w.assignmentText.trim()) out.push('### Assignment', '', quote(m.assignment), '', w.assignmentText.trim(), '');
    if (w.notesText.trim()) out.push('### Notes', '', w.notesText.trim(), '');
    for (const { p, text } of final) out.push(`### Final project: ${p.title}`, '', quote(p.prompt), '', text, '');
  }
  return out.join('\n');
}
