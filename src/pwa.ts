import { registerSW } from 'virtual:pwa-register';

// A new version is applied only while a safe screen (Today) is showing, never mid-review or mid-edit.
// The update can finish downloading at any moment (the audio precache is ~9 MB), so both orders are
// handled: ready-then-safe and safe-then-ready.
let updateReady = false;
let safe = false;

const updateSW = registerSW({
  onNeedRefresh() {
    updateReady = true;
    if (safe) void updateSW(true);
  },
});

export function setSafeToUpdate(isSafe: boolean): void {
  safe = isSafe;
  if (safe && updateReady) void updateSW(true);
}
