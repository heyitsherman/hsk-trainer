import { useEffect, useState } from 'react';
import { getSettings } from '../db/queries';
import { db } from '../db/schema';
import { applyPendingUpdate } from '../pwa';
import { loadQueue, nextDue } from '../srs/queue';
import { formatDayTime } from '../ui';

interface Summary {
  queue: number;
  activated: number;
  next: number | null;
  dayN: number;
}

export function Today({ onStart, onCurate }: { onStart: () => void; onCurate: () => void }) {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    applyPendingUpdate(); // safe point to take a new version
    (async () => {
      const settings = await getSettings(db);
      const [queue, activated, next] = await Promise.all([loadQueue(db, settings), db.activated.count(), nextDue(db)]);
      const start = new Date(`${settings.startDate}T00:00`).getTime();
      setS({ queue: queue.length, activated, next, dayN: Math.floor((Date.now() - start) / 86_400_000) + 1 });
    })();
  }, []);

  if (!s) return null;
  return (
    <section className="today">
      <p className="muted">{s.dayN > 0 ? `Day ${s.dayN}` : `Starts in ${1 - s.dayN} day${s.dayN === 0 ? '' : 's'}`}</p>
      {s.queue > 0 ? (
        <button className="start-review" onClick={onStart}>
          <span className="start-count">{s.queue}</span>
          <span>cards due · start</span>
        </button>
      ) : (
        <div className="today-empty">
          <p className="summary-big">{s.activated ? 'Done for today' : 'No words yet'}</p>
          <p className="muted">{s.next ? `Next review ${formatDayTime(s.next)}` : ''}</p>
        </div>
      )}
      <button className="secondary" onClick={onCurate}>
        {s.activated ? `Curate new words · ${s.activated} active` : 'Activate your first words'}
      </button>
    </section>
  );
}
