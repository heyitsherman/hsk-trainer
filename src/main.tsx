import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './pwa';
import './styles.css';
import { ErrorBoundary } from './ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
