import { describe, expect, it } from 'vitest';
import { needsInstallGate, type Env } from './install';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ipadOs = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const env = (over: Partial<Env>): Env => ({ userAgent: iphone, platform: 'iPhone', maxTouchPoints: 5, standalone: false, displayModeStandalone: false, ...over });

describe('iOS install gate (task 12)', () => {
  it('shows in an iPhone Safari tab', () => expect(needsInstallGate(env({}))).toBe(true));
  it('is suppressed when launched from the Home Screen', () => {
    expect(needsInstallGate(env({ standalone: true }))).toBe(false);
    expect(needsInstallGate(env({ displayModeStandalone: true }))).toBe(false);
  });
  it('covers iPadOS reporting as a Mac', () => expect(needsInstallGate(env({ userAgent: ipadOs, platform: 'MacIntel' }))).toBe(true));
  it('never shows on desktop', () =>
    expect(needsInstallGate(env({ userAgent: windows, platform: 'Win32', maxTouchPoints: 0, standalone: undefined }))).toBe(false));
});
