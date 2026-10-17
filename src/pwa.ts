import { registerSW } from 'virtual:pwa-register';

// A waiting service worker is applied only from a safe screen (Today), never mid-review.
let updateReady = false;
const updateSW = registerSW({
  onNeedRefresh() {
    updateReady = true;
  },
});

export function applyPendingUpdate(): void {
  if (updateReady) void updateSW(true);
}
