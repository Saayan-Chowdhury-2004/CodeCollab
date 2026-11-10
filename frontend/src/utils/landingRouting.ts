const SEEN_LANDING_KEY = 'cc-seen-landing';

export interface ShouldShowLandingParams {
  isSignedIn: boolean;
  hasSeenLanding?: boolean;
  path: string;
}

/**
 * Predicate deciding whether the landing/dashboard page should be shown.
 * - Always shown for anyone who is not logged in on the root path '/'.
 * - Deep links (/snippets/:id, /api/*, etc.) or signed-in sessions show their respective view.
 */
export function shouldShowLanding({
  isSignedIn,
  path,
}: ShouldShowLandingParams): boolean {
  if (isSignedIn) {
    return false;
  }
  const cleanPath = (path || '/').split('?')[0].split('#')[0];
  return cleanPath === '/' || cleanPath === '';
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (
      typeof globalThis !== 'undefined' &&
      (globalThis as unknown as { localStorage?: Storage }).localStorage
    ) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Safe local storage reader for the landing dismissal flag.
 * Returns false on missing storage or exception.
 */
export function getHasSeenLanding(): boolean {
  try {
    const storage = getStorage();
    if (!storage) {
      return false;
    }
    return storage.getItem(SEEN_LANDING_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Safe local storage writer for the landing dismissal flag.
 */
export function setHasSeenLanding(seen: boolean): void {
  try {
    const storage = getStorage();
    if (!storage) {
      return;
    }
    if (seen) {
      storage.setItem(SEEN_LANDING_KEY, '1');
    } else {
      storage.removeItem(SEEN_LANDING_KEY);
    }
  } catch {
    // Non-fatal: local storage may be blocked in restrictive browser modes
  }
}
