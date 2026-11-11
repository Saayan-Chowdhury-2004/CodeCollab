export function formatRoleLabel(role?: string): string {
  if (!role) return 'Guest';
  const clean = role.toLowerCase().replace(/^role(_|:\s*)/, '').trim();
  if (clean === 'anonymous_viewer' || clean === 'anonymous') return 'Viewer';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function formatRelativeTime(dateInput: string | Date | number): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'object' ? dateInput : new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0 || isNaN(diffMs)) return 'just now';

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;

  return `${Math.floor(diffDays / 365)}y ago`;
}

export function getLanguageColor(_lang?: string): string {
  return 'var(--ink-muted)';
}

export function isVirtualOrDevUser(username?: string | null): boolean {
  if (!username) return false;
  const lower = username.toLowerCase().trim();
  return (
    lower.endsWith('dev') ||
    lower.endsWith('_dev') ||
    lower.includes('virtual') ||
    lower.includes('simulation') ||
    lower === 'elena_dev' ||
    lower === 'admin_alex' ||
    lower === 'marcus_code' ||
    lower === 'victor_read'
  );
}

