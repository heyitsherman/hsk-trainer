import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

// A waiting service worker is applied only from a safe screen (never mid-review); see App.
export const pwa = {
  updateReady: false,
  apply: registerSW({
    onNeedRefresh() {
      pwa.updateReady = true;
    },
  }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
