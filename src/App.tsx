import { useEffect, useState } from 'react';
import { getSettings } from './db/queries';
import { db } from './db/schema';
import { Curate } from './screens/Curate';
import { Review } from './screens/Review';
import { Schedule } from './screens/Schedule';
import { Today } from './screens/Today';

type Screen = 'today' | 'review' | 'curate' | 'schedule' | 'settings';

const TABS: { id: Screen; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'curate', label: 'Curate' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [screen, setScreen] = useState<Screen>('today');

  useEffect(() => {
    void getSettings(db).then((s) => (document.documentElement.dataset.theme = s.theme));
  }, []);

  if (screen === 'review') return <Review onExit={() => setScreen('today')} />;

  return (
    <div className="shell">
      <main className="screen">
        {screen === 'today' && <Today onStart={() => setScreen('review')} onCurate={() => setScreen('curate')} />}
        {screen === 'curate' && <Curate />}
        {screen === 'schedule' && <Schedule />}
        {screen === 'settings' && <p className="muted">Coming next.</p>}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === screen ? 'active' : ''} onClick={() => setScreen(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
