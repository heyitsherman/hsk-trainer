import { describe, expect, it } from 'vitest';
import { activateWord, getSettings, patchWeek } from './queries';
import { exportBackup, exportMarkdown, importBackup, parseBackup } from './backup';
import { openDb } from './schema';
import { schedule } from '../srs/scheduler';
import { vocab } from '../data/vocab';

describe('export / import (task 11)', () => {
  it('round-trips through JSON into an empty database', async () => {
    const a = openDb('backup-a');
    await getSettings(a, 1);
    for (const v of vocab.slice(0, 5)) await activateWord(v, v.candidateSentences[0] ?? null, 'n', a, 1000);
    const c = (await a.cards.toArray())[0];
    await a.cards.put(schedule(c, 3, 2000));
    await a.reviewLog.add({ cardId: c.id, rating: 3, reviewedAt: 2000, durationMs: 1, stabilityAfter: 2 });
    await patchWeek(1, { assignmentText: '我叫…', tasksCompleted: [0] }, a);

    const text = JSON.stringify(await exportBackup(a));
    const b = openDb('backup-b');
    await importBackup(parseBackup(text), b);

    const sort = <T extends { id?: unknown }>(xs: T[]) => xs.sort((x, y) => String(x.id).localeCompare(String(y.id)));
    expect(sort(await b.cards.toArray())).toEqual(sort(await a.cards.toArray()));
    expect(await b.activated.count()).toBe(5);
    expect(await b.reviewLog.toArray()).toEqual(await a.reviewLog.toArray());
    expect((await b.weekProgress.get(1))?.assignmentText).toBe('我叫…');
    expect((await getSettings(b)).createdAt).toBe(1);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow('Not a JSON file');
    expect(() => parseBackup('{"format":"x"}')).toThrow('Not an HSK Trainer backup');
  });

  it('markdown contains only weeks with writing', async () => {
    const d = openDb('backup-md');
    await patchWeek(3, { assignmentText: 'Self intro', notesText: '是/有/在' }, d);
    const md = await exportMarkdown(d, 0);
    expect(md).toContain('## Week 3: Who you are');
    expect(md).toContain('Self intro');
    expect(md).not.toContain('## Week 1:');
  });
});
