import { useEffect, useRef, useState } from 'react';
import { exportBackup, exportMarkdown, importBackup, parseBackup } from '../db/backup';
import { getSettings, isNewCardLimitLocked, NEW_CARD_LOCK_DAYS, updateSettings } from '../db/queries';
import { db } from '../db/schema';
import type { AppSettings } from '../types';
import { SaveIndicator } from '../ui';

const DAY = 86_400_000;
const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * iOS only allows navigator.share() inside a fresh tap, so files are prepared on screen open and the
 * button hands over a ready File synchronously. On desktop a normal download is friendlier.
 */
function saveFile(file: File) {
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch((e: Error) => e.name !== 'AbortError' && download(file));
    return;
  }
  download(file);
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

interface Stats {
  days: number;
  perDay: number;
  medianSec: number;
}

async function recalibration(now = Date.now()): Promise<Stats | null> {
  // PRD §16: actual reviews/day and median seconds/card over the last 21 days.
  const logs = await db.reviewLog.where('reviewedAt').aboveOrEqual(now - 21 * DAY).toArray();
  if (!logs.length) return null;
  const days = Math.max(1, Math.ceil((now - Math.min(...logs.map((l) => l.reviewedAt))) / DAY));
  const ds = logs.map((l) => l.durationMs).sort((a, b) => a - b);
  return { days, perDay: logs.length / days, medianSec: ds[Math.floor(ds.length / 2)] / 1000 };
}

export function Settings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [files, setFiles] = useState<{ json: File; md: File; cards: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const [settings, backup, md] = await Promise.all([getSettings(db), exportBackup(db), exportMarkdown(db)]);
      setS(settings);
      setFiles({
        json: new File([JSON.stringify(backup)], `hsk-trainer-backup-${stamp()}.json`, { type: 'application/json' }),
        md: new File([md], `hsk-trainer-notes-${stamp()}.md`, { type: 'text/markdown' }),
        cards: backup.data.cards.length,
      });
      setStats(await recalibration());
    })();
  }, []);

  if (!s) return null;

  const patch = async (p: Partial<AppSettings>) => {
    setS(await updateSettings(p, db));
    setSavedAt(Date.now());
    if (p.theme) document.documentElement.dataset.theme = p.theme;
  };

  const onImport = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    try {
      const b = parseBackup(await file.text());
      const when = new Date(b.exportedAt).toLocaleString();
      if (!confirm(`Replace ALL data on this device with the backup from ${when} (${b.data.cards.length} cards, ${b.data.activated.length} words)? This cannot be undone.`)) return;
      await importBackup(b, db);
      location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (picker.current) picker.current.value = '';
    }
  };

  const locked = isNewCardLimitLocked(s);
  const unlockDate = new Date(s.createdAt + NEW_CARD_LOCK_DAYS * DAY).toLocaleDateString();

  return (
    <section className="settings">
      <div className="row-between">
        <h2>Settings</h2>
        <SaveIndicator savedAt={savedAt} />
      </div>

      <h3>Backup</h3>
      <p className="muted small">The only copy of your progress is on this device. Export regularly; it works offline.</p>
      <div className="button-col">
        <button className="secondary" disabled={!files} onClick={() => files && saveFile(files.json)}>
          Export backup (JSON{files ? ` · ${files.cards} cards` : ''})
        </button>
        <button className="secondary" disabled={!files} onClick={() => files && saveFile(files.md)}>
          Export notes (Markdown for Obsidian)
        </button>
        <button className="secondary" onClick={() => picker.current?.click()}>
          Import backup…
        </button>
        <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
        {error && <p className="error">{error}</p>}
      </div>

      <h3>Study</h3>
      <div className="setting-row">
        <span>
          New cards per day
          <br />
          <span className="muted small">{locked ? `Fixed at 10 until ${unlockDate}` : 'Lower it if you hit the cap most days'}</span>
        </span>
        <span className="stepper">
          <button disabled={locked || s.newCardsPerDay <= 1} onClick={() => void patch({ newCardsPerDay: s.newCardsPerDay - 1 })} aria-label="Fewer">
            −
          </button>
          <span>{locked ? 10 : s.newCardsPerDay}</span>
          <button disabled={locked || s.newCardsPerDay >= 30} onClick={() => void patch({ newCardsPerDay: s.newCardsPerDay + 1 })} aria-label="More">
            +
          </button>
        </span>
      </div>
      <div className="setting-row">
        <span>
          Daily review cap
          <br />
          <span className="muted small">Fixed. After a break, the backlog becomes a tail, not a wall.</span>
        </span>
        <span>{s.dailyReviewCap}</span>
      </div>
      {stats && (
        <p className="muted small">
          Last {stats.days} day{stats.days > 1 ? 's' : ''}: {stats.perDay.toFixed(0)} reviews/day, median {stats.medianSec.toFixed(1)} s/card ≈{' '}
          {((stats.perDay * stats.medianSec * 7) / 3600).toFixed(1)} h/week
        </p>
      )}

      <h3>Display</h3>
      <div className="setting-row">
        <span>Theme</span>
        <button className="secondary" onClick={() => void patch({ theme: s.theme === 'dark' ? 'light' : 'dark' })}>
          {s.theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>

      <h3>Storage</h3>
      <p className="muted small">
        Persistent storage:{' '}
        {s.persistGranted === null ? 'not requested yet' : s.persistGranted ? 'granted' : 'not granted, so keep exporting backups'}
        {' · '}Sync: not set up
      </p>

      <h3>Credits</h3>
      <p className="muted small credits">
        Vocabulary: HSK syllabus (CLEC, 2025). Definitions: <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict">CC-CEDICT</a> and{' '}
        <a href="https://en.wiktionary.org/">Wiktionary</a> (CC BY-SA). Sentences: <a href="https://tatoeba.org/">Tatoeba</a> (CC BY 2.0 FR). Audio:{' '}
        <a href="https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh">Kokoro TTS</a>, adequate for recognition, not a pronunciation model. Scheduling:{' '}
        <a href="https://github.com/open-spaced-repetition/ts-fsrs">FSRS</a>.
      </p>
    </section>
  );
}
