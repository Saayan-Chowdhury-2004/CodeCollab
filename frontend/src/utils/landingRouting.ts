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
