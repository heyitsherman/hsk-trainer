import { useCallback, useEffect, useRef, useState } from 'react';
import { play, stopAudio, unlockAudio } from '../audio/player';
import { vocabById } from '../data/vocab';
import { getSettings } from '../db/queries';
import { db } from '../db/schema';
import { promoteAll } from '../srs/ladder';
import { dayEnd, loadQueue, nextDue } from '../srs/queue';
import { previewIntervals, schedule } from '../srs/scheduler';
import type { ActivatedWord, CardRow, Grade, Sentence, VocabEntry } from '../types';
import { formatDayTime, SaveIndicator } from '../ui';

/** Cards rescheduled within this window (FSRS learning steps) come back in the same session. */
const REQUEUE_MS = 30 * 60_000;
const GRADES: { g: Grade; label: string }[] = [
  { g: 1, label: 'Again' },
  { g: 2, label: 'Hard' },
  { g: 3, label: 'Good' },
  { g: 4, label: 'Easy' },
];

interface Session {
  queue: CardRow[];
  learning: CardRow[];
  done: number;
  counts: [number, number, number, number];
  startedAt: number;
}

type Phase = 'loading' | 'ready' | 'card' | 'done';

function pickNext(s: Session, now: number): CardRow | null {
  s.learning.sort((a, b) => a.due - b.due);
  if (s.learning[0] && s.learning[0].due <= now) return s.learning.shift()!;
  if (s.queue.length) return s.queue.shift()!;
  return s.learning.shift() ?? null; // nothing else left: learn ahead rather than make you wait
}

function blankOut(sentence: string, word: string): string {
  const target = sentence.includes(word) ? word : word.replace(/儿$/, '');
  return sentence.replace(target, '＿'.repeat([...target].length));
}

export function Review({ onExit }: { onExit: () => void }) {
  const session = useRef<Session>({ queue: [], learning: [], done: 0, counts: [0, 0, 0, 0], startedAt: 0 });
  const activated = useRef(new Map<string, ActivatedWord>());
  const shownAt = useRef(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [current, setCurrent] = useState<CardRow | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const now = Date.now();
      await promoteAll(db, now); // ladder check once per session start (PRD §9.1)
      const [settings, words] = await Promise.all([getSettings(db), db.activated.toArray()]);
      const queue = await loadQueue(db, settings, now);
      if (!live) return;
      activated.current = new Map(words.map((w) => [w.vocabId, w]));
      session.current.queue = queue;
      if (queue.length) setPhase('ready');
      else {
        setNext(await nextDue(db, now));
        setPhase('done');
      }
    })();
    return () => {
      live = false;
      stopAudio();
    };
  }, []);

  const entry: VocabEntry | undefined = current ? vocabById.get(current.vocabId) : undefined;
  const sentence: Sentence | null = current ? activated.current.get(current.vocabId)?.chosenSentence ?? null : null;

  const show = useCallback((card: CardRow | null) => {
    setRevealed(false);
    setCurrent(card);
    shownAt.current = Date.now();
    if (!card) {
      void nextDue(db).then(setNext);
      setPhase('done');
      return;
    }
    const e = vocabById.get(card.vocabId);
    if (e && card.type === 'audio') void play(e.audioFile, e.simplified); // audio-only front
  }, []);

  const start = () => {
    unlockAudio(); // first tap of the session: iOS gesture requirement (PRD §9.4)
    session.current.startedAt = Date.now();
    setPhase('card');
    show(pickNext(session.current, Date.now()));
  };

  const reveal = useCallback(() => {
    if (!current || !entry || revealed) return;
    setRevealed(true);
    if (current.type === 'cloze' && sentence) void play(sentence.audioFile, sentence.simplified);
    else if (current.type !== 'audio') void play(entry.audioFile, entry.simplified);
  }, [current, entry, revealed, sentence]);

  const grade = useCallback(
    async (g: Grade) => {
      if (!current || !revealed || busy) return;
      setBusy(true);
      const now = Date.now();
      const updated = schedule(current, g, now);
      await db.transaction('rw', db.cards, db.reviewLog, async () => {
        await db.cards.put(updated);
        await db.reviewLog.add({
          cardId: updated.id,
          rating: g,
          reviewedAt: now,
          durationMs: now - shownAt.current,
          stabilityAfter: updated.stability,
        });
      });
      setSavedAt(Date.now());
      const s = session.current;
      s.counts[g - 1]++;
      if (updated.due - now < REQUEUE_MS && updated.due < dayEnd(now)) s.learning.push(updated);
      else s.done++;
      setBusy(false);
      show(pickNext(s, Date.now()));
    },
    [busy, current, revealed, show],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (phase === 'ready' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        start();
      } else if (phase === 'card') {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          reveal();
        } else if (['1', '2', '3', '4'].includes(e.key)) void grade(Number(e.key) as Grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const s = session.current;
  const remaining = s.queue.length + s.learning.length + (current ? 1 : 0);
  const progress = s.done / Math.max(1, s.done + remaining);

  return (
    <div className="review">
      <header className="review-bar">
        <button className="icon-btn" onClick={onExit} aria-label="End session">
          ×
        </button>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="count">{phase === 'card' ? remaining : ''}</span>
      </header>

      {phase === 'loading' && <div className="center muted">Loading…</div>}

      {phase === 'ready' && (
        <button className="center start" onClick={start}>
          <span className="start-count">{s.queue.length}</span>
          <span className="muted">cards · tap to start</span>
        </button>
      )}

      {phase === 'card' && current && entry && (
        <>
          <button className="card" onClick={reveal} aria-label={revealed ? 'Card' : 'Reveal answer'}>
            <CardFace card={current} entry={entry} sentence={sentence} revealed={revealed} />
          </button>
          <footer className="answer">
            {revealed ? (
              <Grades card={current} onGrade={grade} disabled={busy} />
            ) : (
              <button className="reveal-btn" onClick={reveal}>
                Show answer
              </button>
            )}
            <SaveIndicator savedAt={savedAt} />
          </footer>
        </>
      )}

      {phase === 'done' && (
        <div className="center summary">
          {s.done + s.learning.length > 0 ? (
            <>
              <p className="summary-big">{s.done} cards</p>
              <p className="muted">
                again {s.counts[0]} · hard {s.counts[1]} · good {s.counts[2]} · easy {s.counts[3]}
                {s.startedAt ? ` · ${Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000))} min` : ''}
              </p>
            </>
          ) : (
            <p className="summary-big">Nothing due</p>
          )}
          <p className="muted">{next ? `Next review ${formatDayTime(next)}` : 'Activate words in Curate to start reviewing.'}</p>
          <SaveIndicator savedAt={savedAt} />
          <button className="primary" onClick={onExit}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function Grades({ card, onGrade, disabled }: { card: CardRow; onGrade: (g: Grade) => void; disabled: boolean }) {
  const intervals = previewIntervals(card, Date.now());
  return (
    <div className="grades">
      {GRADES.map(({ g, label }) => (
        <button key={g} className={`grade g${g}`} onClick={() => onGrade(g)} disabled={disabled}>
          <span>{label}</span>
          <small>{intervals[g]}</small>
        </button>
      ))}
    </div>
  );
}

function CardFace({ card, entry, sentence, revealed }: { card: CardRow; entry: VocabEntry; sentence: Sentence | null; revealed: boolean }) {
  const replay = (e: React.MouseEvent, file: string | undefined, text: string) => {
    e.stopPropagation();
    void play(file, text);
  };
  const answer = (
    <div className="back">
      <div className="hanzi">{entry.simplified}</div>
      <div className="pinyin">{entry.pinyin}</div>
      <ul className="defs">
        {entry.definitions.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      {entry.partOfSpeech && <div className="pos muted">{entry.partOfSpeech}</div>}
      <span className="replay" role="button" onClick={(e) => replay(e, entry.audioFile, entry.simplified)}>
        ▶ word
      </span>
      {sentence && (
        <div className="sentence">
          <div className="zh">{sentence.simplified}</div>
          {sentence.pinyin && <div className="pinyin small">{sentence.pinyin}</div>}
          <div className="muted">{sentence.english}</div>
          <span className="replay" role="button" onClick={(e) => replay(e, sentence.audioFile, sentence.simplified)}>
            ▶ sentence
          </span>
        </div>
      )}
    </div>
  );

  if (revealed) return answer;
  switch (card.type) {
    case 'recognition': // never pinyin on the front (PRD §9.2)
      return <div className="hanzi front">{entry.simplified}</div>;
    case 'audio':
      return (
        <div className="front">
          <span className="listen" role="button" onClick={(e) => replay(e, entry.audioFile, entry.simplified)}>
            🔊
          </span>
          <div className="muted">What did you hear?</div>
        </div>
      );
    case 'production':
      return (
        <div className="front">
          <ul className="defs prompt">
            {entry.definitions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="muted">Say and picture the word</div>
        </div>
      );
    case 'cloze':
      return (
        <div className="front">
          <div className="zh cloze">{sentence ? blankOut(sentence.simplified, entry.simplified) : entry.simplified}</div>
          {sentence && <div className="muted">{sentence.english}</div>}
        </div>
      );
  }
}
