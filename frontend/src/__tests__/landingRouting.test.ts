import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  shouldShowLanding,
  getHasSeenLanding,
  setHasSeenLanding,
} from '../utils/landingRouting.ts';

describe('shouldShowLanding routing predicate', () => {
  it('returns true for signed-out first-time visitors on root path', () => {
    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/',
      })
    ).toBe(true);

    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '',
      })
    ).toBe(true);
  });

  it('returns false for signed-out visitors who have chosen guest mode', () => {
    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: true,
        path: '/',
      })
    ).toBe(false);
  });

  it('returns false for signed-in users on root path', () => {
    expect(
      shouldShowLanding({
        isSignedIn: true,
        hasSeenLanding: false,
        path: '/',
      })
    ).toBe(false);

    expect(
      shouldShowLanding({
        isSignedIn: true,
        hasSeenLanding: true,
        path: '/',
      })
    ).toBe(false);
  });

  it('returns false for deep links or non-root paths even if signed out and first visit', () => {
    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/snippets/11111111-1111-4111-8111-111111111101',
      })
    ).toBe(false);

    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/api/docs',
      })
    ).toBe(false);

    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/admin',
      })
    ).toBe(false);
  });

  it('handles query strings and hash on root path correctly', () => {
    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/?ref=test',
      })
    ).toBe(true);

    expect(
      shouldShowLanding({
        isSignedIn: false,
        hasSeenLanding: false,
        path: '/#features',
      })
    ).toBe(true);
  });
});

describe('landing storage flag helpers', () => {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    length: 0,
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };

  beforeAll(() => {
    if (typeof globalThis.window === 'undefined') {
      (globalThis as unknown as { window: unknown }).window = {
        localStorage: mockStorage,
      };
    } else {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  beforeEach(() => {
    store.clear();
  });

  it('reads and writes seen flag reliably', () => {
    expect(getHasSeenLanding()).toBe(false);
    setHasSeenLanding(true);
    expect(getHasSeenLanding()).toBe(true);
    setHasSeenLanding(false);
    expect(getHasSeenLanding()).toBe(false);
  });

  it('gracefully handles localStorage failures without crashing', () => {
    const errorStorage: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
      key: () => null,
    };

    (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage =
      errorStorage;

    expect(() => getHasSeenLanding()).not.toThrow();
    expect(getHasSeenLanding()).toBe(false);

    expect(() => setHasSeenLanding(true)).not.toThrow();

    (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage =
      mockStorage;
  });
});
