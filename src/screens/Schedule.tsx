import { useCallback, useEffect, useRef, useState } from 'react';
import raw from '../data/schedule.json';
import { vocab } from '../data/vocab';
import { getSettings, getWeek, patchWeek, unlockedThrough, WEEKS } from '../db/queries';
import { db } from '../db/schema';
import type { Module, WeekProgress } from '../types';
import { SaveIndicator } from '../ui';

const modules = raw as Module[];
const DEBOUNCE_MS = 500; // PRD §11.1

/**
 * Text field persisted with a 500 ms debounce. Pending writes flush when the app is backgrounded
 * (iOS can suspend a home-screen app at any moment) and on unmount.
 */
function useDebouncedField(save: (value: string) => Promise<void>) {
  const pending = useRef<string | null>(null);
  const timer = useRef<number>(0);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    void save(v);
  }, [save]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
  return (value: string) => {
    pending.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, DEBOUNCE_MS);
  };
}

export function Schedule() {
  const [all, setAll] = useState<WeekProgress[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');

  useEffect(() => {
    void (async () => {
      const [rows, s] = await Promise.all([db.weekProgress.toArray(), getSettings(db)]);
      setAll(rows);
      setStartDate(s.startDate);
      setWeek(unlockedThrough(rows));
    })();
  }, []);

  if (week === null) return null;
  const unlocked = unlockedThrough(all);
  const elapsed = Math.floor((Date.now() - new Date(`${startDate}T00:00`).getTime()) / 86_400_000);

  return (
    <section className="schedule">
      <p className="muted">
        {elapsed >= 0 ? `Week ${Math.floor(elapsed / 7) + 1} of the calendar since ${startDate}` : `Starts ${startDate}`}
        {' · '}
        {all.filter((w) => w.completedAt).length} / {WEEKS} modules complete
      </p>
      <div className="weeks" role="tablist">
        {modules.map((m) => (
          <button
            key={m.week}
            role="tab"
            aria-selected={m.week === week}
            className={`week-chip${m.week === week ? ' active' : ''}${all.find((w) => w.week === m.week)?.completedAt ? ' done' : ''}`}
            disabled={m.week > unlocked}
            onClick={() => setWeek(m.week)}
          >
            {m.week}
          </button>
        ))}
      </div>
      <WeekView key={week} module={modules[week - 1]} onChange={(p) => setAll((xs) => [...xs.filter((x) => x.week !== p.week), p])} />
    </section>
  );
}

function WeekView({ module: m, onChange }: { module: Module; onChange: (p: WeekProgress) => void }) {
  const [p, setP] = useState<WeekProgress | null>(null);
  const [active, setActive] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const final = useRef<string[]>(['', '', '']);

  useEffect(() => {
    void getWeek(m.week).then((w) => {
      final.current = [...(w.finalProject ?? ['', '', ''])];
      setP(w);
    });
    const ids = vocab.filter((v) => v.week === m.week).map((v) => v.id);
    void db.activated.where('vocabId').anyOf(ids).count().then(setActive);
  }, [m.week]);

  const persist = useCallback(
    async (patch: Partial<WeekProgress>) => {
      const next = await patchWeek(m.week, patch);
      setSavedAt(Date.now());
      onChange(next);
    },
    [m.week, onChange],
  );

  const saveAssignment = useDebouncedField(useCallback((v: string) => persist({ assignmentText: v }), [persist]));
  const saveNotes = useDebouncedField(useCallback((v: string) => persist({ notesText: v }), [persist]));
  const saveFinal = useDebouncedField(
    useCallback(async (v: string) => persist({ finalProject: JSON.parse(v) as string[] }), [persist]),
  );

  if (!p) return null;

  const toggle = (i: number) => {
    const tasksCompleted = p.tasksCompleted.includes(i) ? p.tasksCompleted.filter((x) => x !== i) : [...p.tasksCompleted, i].sort();
    // A module counts as complete only when every task is checked (course page rule).
    const completedAt = tasksCompleted.length === m.tasks.length ? (p.completedAt ?? Date.now()) : null;
    setP({ ...p, tasksCompleted, completedAt });
    void persist({ tasksCompleted, completedAt }); // immediate, not debounced
  };

  return (
    <article className="module">
      <div className="row-between">
        <h2>
          {m.week}. {m.title}
        </h2>
        <SaveIndicator savedAt={savedAt} />
      </div>
      <p>{m.focus}</p>
      <p className="muted small">
        {active} / {m.wordCount} words active
      </p>

      <h3>Tasks</h3>
      <ul className="tasks">
        {m.tasks.map((t, i) => (
          <li key={i}>
            <label className="task">
              <input type="checkbox" checked={p.tasksCompleted.includes(i)} onChange={() => toggle(i)} />
              <span>{t}</span>
            </label>
          </li>
        ))}
      </ul>

      <h3>Resources</h3>
      <ul className="resources">
        {m.resources.map((r) => (
          <li key={r.url}>
            <a href={r.url} target="_blank" rel="noopener noreferrer">
              {r.label} ↗
            </a>
          </li>
        ))}
      </ul>

      <h3>Business thread</h3>
      <p>{m.businessThread}</p>
      <h3>Field task · Singapore</h3>
      <p>{m.fieldTask}</p>

      <h3>Assignment</h3>
      <p>{m.assignment}</p>
      <textarea
        defaultValue={p.assignmentText}
        aria-label={`Week ${m.week} assignment`}
        onChange={(e) => saveAssignment(e.target.value)}
      />

      <h3>Notes</h3>
      <textarea defaultValue={p.notesText} aria-label={`Week ${m.week} notes`} onChange={(e) => saveNotes(e.target.value)} />

      {m.finalProject && (
        <>
          <h3>Final project</h3>
          {m.finalProject.map((part, i) => (
            <div key={i} className="final-part">
              <p>
                <strong>{part.title}.</strong> {part.prompt}
              </p>
              <textarea
                defaultValue={final.current[i]}
                aria-label={part.title}
                onChange={(e) => {
                  final.current[i] = e.target.value;
                  saveFinal(JSON.stringify(final.current));
                }}
              />
            </div>
          ))}
        </>
      )}
    </article>
  );
}
