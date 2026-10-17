import { useEffect, useMemo, useState } from 'react';
import { play } from '../audio/player';
import { vocab } from '../data/vocab';
import { activateWord, patchWeek, unlockedThrough, WEEKS } from '../db/queries';
import { db } from '../db/schema';
import type { ActivatedWord, Sentence, VocabEntry, WeekProgress } from '../types';
import { SaveIndicator } from '../ui';

type Choice = number | 'own' | 'none';

export function Curate() {
  const [weeks, setWeeks] = useState<WeekProgress[]>([]);
  const [activated, setActivated] = useState(new Map<string, ActivatedWord>());
  const [week, setWeek] = useState<number | null>(null);
  const [open, setOpen] = useState<VocabEntry | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = async () => {
    const [w, a] = await Promise.all([db.weekProgress.toArray(), db.activated.toArray()]);
    setWeeks(w);
    setActivated(new Map(a.map((x) => [x.vocabId, x])));
    return { w, a };
  };

  useEffect(() => {
    void refresh().then(({ w, a }) => {
      const done = new Set(a.map((x) => x.vocabId));
      const unlocked = unlockedThrough(w);
      // Open on the first unlocked week that still has dormant words.
      let n = 1;
      while (n < unlocked && vocab.filter((v) => v.week === n).every((v) => done.has(v.id))) n++;
      setWeek(n);
    });
  }, []);

  const unlocked = unlockedThrough(weeks);
  const words = useMemo(() => vocab.filter((v) => v.week === week), [week]);
  const progress = weeks.find((w) => w.week === week);
  const count = words.filter((v) => activated.has(v.id)).length;

  if (week === null) return null;

  const onSaved = async (entry: VocabEntry) => {
    const { a } = await refresh();
    setSavedAt(Date.now());
    const done = new Set(a.map((x) => x.vocabId));
    if (words.every((v) => done.has(v.id)) && !progress?.curatedAt) {
      await patchWeek(week, { curatedAt: Date.now() });
      await refresh();
    }
    const i = words.indexOf(entry);
    setOpen([...words.slice(i + 1), ...words.slice(0, i)].find((v) => !done.has(v.id)) ?? null);
  };

  const finishWeek = async () => {
    const left = words.length - count;
    if (left && !confirm(`${left} word${left > 1 ? 's' : ''} stay dormant. You can come back to them any time. Finish week ${week}?`)) return;
    await patchWeek(week, { curatedAt: Date.now() });
    await refresh();
    setSavedAt(Date.now());
  };

  if (open) {
    return (
      <WordForm
        key={open.id}
        entry={open}
        existing={activated.get(open.id)}
        onBack={() => setOpen(null)}
        onSaved={() => void onSaved(open)}
        savedAt={savedAt}
      />
    );
  }

  return (
    <section className="curate">
      <div className="weeks" role="tablist">
        {Array.from({ length: WEEKS }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            role="tab"
            aria-selected={n === week}
            className={`week-chip${n === week ? ' active' : ''}${weeks.find((w) => w.week === n)?.curatedAt ? ' done' : ''}`}
            disabled={n > unlocked}
            onClick={() => setWeek(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="row-between">
        <h2>Week {week}</h2>
        <span className="muted">
          {count} / {words.length} active
        </span>
      </div>
      <ul className="word-list">
        {words.map((v) => (
          <li key={v.id}>
            <button className="word-row" onClick={() => setOpen(v)}>
              <span className="zh-sm">{v.simplified}</span>
              <span className="pinyin-sm">{v.pinyin}</span>
              <span className="gloss">{v.definitions[0]}</span>
              <span className="tick">{activated.has(v.id) ? '✓' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row-between">
        {progress?.curatedAt ? (
          <span className="muted">Week {week} curation finished{week < WEEKS ? ` · week ${week + 1} unlocked` : ''}</span>
        ) : (
          <button className="secondary" onClick={() => void finishWeek()}>
            Finish week {week}
          </button>
        )}
        <SaveIndicator savedAt={savedAt} />
      </div>
    </section>
  );
}

function containsWord(sentence: string, word: string) {
  return sentence.includes(word) || sentence.includes(word.replace(/儿$/, ''));
}

function WordForm({
  entry,
  existing,
  onBack,
  onSaved,
  savedAt,
}: {
  entry: VocabEntry;
  existing: ActivatedWord | undefined;
  onBack: () => void;
  onSaved: () => void;
  savedAt: number | null;
}) {
  const prevIdx = entry.candidateSentences.findIndex((s) => s.tatoebaId && s.tatoebaId === existing?.chosenSentence?.tatoebaId);
  const initial: Choice = existing
    ? existing.chosenSentence === null
      ? 'none'
      : existing.chosenSentence.source === 'user'
        ? 'own'
        : Math.max(0, prevIdx)
    : entry.candidateSentences.length
      ? 0
      : 'own';
  const [choice, setChoice] = useState<Choice>(initial);
  const [ownZh, setOwnZh] = useState(existing?.chosenSentence?.source === 'user' ? existing.chosenSentence.simplified : '');
  const [ownEn, setOwnEn] = useState(existing?.chosenSentence?.source === 'user' ? existing.chosenSentence.english : '');
  const [note, setNote] = useState(existing?.userNote ?? '');
  const [saving, setSaving] = useState(false);

  const own: Sentence | null = ownZh.trim() ? { simplified: ownZh.trim(), pinyin: '', english: ownEn.trim(), source: 'user' } : null;
  const sentence = choice === 'none' ? null : choice === 'own' ? own : entry.candidateSentences[choice];
  const invalidOwn = choice === 'own' && !own;

  const save = async () => {
    setSaving(true);
    await activateWord(entry, sentence, note);
    setSaving(false);
    onSaved();
  };

  return (
    <section className="word-form">
      <div className="row-between">
        <button className="link" onClick={onBack}>
          ‹ Week {entry.week}
        </button>
        <SaveIndicator savedAt={savedAt} saving={saving} />
      </div>
      <div className="word-head" onClick={() => void play(entry.audioFile, entry.simplified)} role="button">
        <div className="hanzi">{entry.simplified}</div>
        <div className="pinyin">{entry.pinyin} ▶</div>
      </div>
      <ul className="defs">
        {entry.definitions.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>

      <h3>Example sentence</h3>
      <div className="choices" role="radiogroup">
        {entry.candidateSentences.map((s, i) => (
          <label key={s.tatoebaId} className={`choice${choice === i ? ' selected' : ''}`}>
            <input type="radio" name="sentence" checked={choice === i} onChange={() => setChoice(i)} />
            <span className="zh">{s.simplified}</span>
            <span className="pinyin small">{s.pinyin}</span>
            <span className="muted">{s.english}</span>
            <button className="replay" onClick={(e) => (e.preventDefault(), void play(s.audioFile, s.simplified))}>
              ▶
            </button>
          </label>
        ))}
        <label className={`choice${choice === 'own' ? ' selected' : ''}`}>
          <input type="radio" name="sentence" checked={choice === 'own'} onChange={() => setChoice('own')} />
          <span>Write my own</span>
          {choice === 'own' && (
            <>
              <input lang="zh-CN" placeholder={`A sentence using ${entry.simplified}`} value={ownZh} onChange={(e) => setOwnZh(e.target.value)} />
              <input placeholder="What it means (English)" value={ownEn} onChange={(e) => setOwnEn(e.target.value)} />
              {own && !containsWord(own.simplified, entry.simplified) && (
                <span className="muted small">Doesn't contain {entry.simplified}, so it can't become a fill-in-the-blank card.</span>
              )}
            </>
          )}
        </label>
        <label className={`choice${choice === 'none' ? ' selected' : ''}`}>
          <input type="radio" name="sentence" checked={choice === 'none'} onChange={() => setChoice('none')} />
          <span>No sentence</span>
        </label>
      </div>

      <h3>Note</h3>
      <input placeholder="Optional: a mnemonic, a context, anything" value={note} onChange={(e) => setNote(e.target.value)} />

      <button className="primary wide" onClick={() => void save()} disabled={saving || invalidOwn}>
        {existing ? 'Save' : 'Activate'}
      </button>
    </section>
  );
}
