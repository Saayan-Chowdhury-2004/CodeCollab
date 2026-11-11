import { describe, it, expect } from 'vitest';
import { shouldShowLanding } from '../utils/landingRouting.ts';

describe('shouldShowLanding routing predicate', () => {
  it('returns true for signed-out visitors on root path regardless of hasSeenLanding', () => {
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
        hasSeenLanding: true,
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
