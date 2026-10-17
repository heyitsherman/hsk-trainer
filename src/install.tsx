// PRD §4: the highest-severity risk. Safari deletes script-writable storage after 7 days without
// a visit; home-screen apps are exempt. So: gate on install, request persistence, keep export handy.

import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from './db/queries';
import { db } from './db/schema';

export interface Env {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean | undefined; // navigator.standalone (iOS only)
  displayModeStandalone: boolean;
}

export function currentEnv(): Env {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
  };
}

/** iPhone/iPod/iPad, including iPadOS which reports itself as a Mac with touch. Any iOS browser is WebKit. */
export const isIos = (e: Env) => /iPhone|iPad|iPod/.test(e.userAgent) || (e.platform === 'MacIntel' && e.maxTouchPoints > 1);

export const needsInstallGate = (e: Env) => isIos(e) && e.standalone !== true && !e.displayModeStandalone;

/** Requests persistent storage once per launch until granted; logs and stores the result. */
export async function ensurePersistence(): Promise<void> {
  if (!navigator.storage?.persist) return;
  const settings = await getSettings(db);
  if (settings.persistGranted) return;
  const granted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  console.info(`navigator.storage.persist(): ${granted ? 'granted' : 'not granted'}`);
  if (granted !== settings.persistGranted) await updateSettings({ persistGranted: granted }, db);
}

export function InstallGate() {
  const force = import.meta.env.DEV && new URLSearchParams(location.search).has('installGate');
  const [open, setOpen] = useState(() => force || needsInstallGate(currentEnv()));

  useEffect(() => {
    void ensurePersistence();
  }, []);

  if (!open) return null;
  const dismiss = () => {
    void updateSettings({ installDismissedAt: Date.now() }, db);
    setOpen(false); // shows again next launch while not installed
  };

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <h2 id="gate-title">Add this to your Home Screen</h2>
        <p>
          In a Safari tab, iOS deletes this app's data after <strong>7 days</strong> without a visit. One missed week would wipe
          every card and note. Apps opened from the Home Screen are exempt.
        </p>
        <ol>
          <li>
            Tap <strong>Share</strong> <span aria-hidden="true">⬆︎</span> in Safari's toolbar
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>
          </li>
          <li>Open HSK Trainer from the new icon and study from there</li>
        </ol>
        <button className="secondary wide" onClick={dismiss}>
          Continue in Safari for now
        </button>
      </div>
    </div>
  );
}
