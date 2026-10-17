// Small shared UI bits.

import { Component, type ReactNode } from 'react';

/** A render error must never look like data loss: everything is already in IndexedDB. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center" style={{ height: '100%', padding: 16 }}>
        <p className="summary-big">Something broke</p>
        <p className="muted">Your progress is saved. {this.state.error.message}</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export const formatTime = (ms: number) => time.format(ms);
export const formatDayTime = (ms: number) => dayTime.format(ms);

/** PRD §11.2: visible save state on every screen that mutates data. */
export function SaveIndicator({ savedAt, saving = false }: { savedAt: number | null; saving?: boolean }) {
  return (
    <span className="save" aria-live="polite">
      {saving ? 'saving…' : savedAt ? `saved · ${formatTime(savedAt)}` : ''}
    </span>
  );
}
