import React, { useEffect, useState } from 'react';
import {
  Github,
  KeyRound,
  LogIn,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { formatApiError } from '../../api/errors.ts';

// Must stay in sync with the backend registration schema (backend/src/modules/auth/auth.routes.ts).
const PASSWORD_PATTERN = '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}';
const PASSWORD_RULES =
  'At least 8 characters, with one uppercase letter, one lowercase letter, and one number.';

interface AuthDialogModalProps {
  isOpen: boolean;
  initialMode: 'login' | 'register';
  onClose: () => void;
}

export const AuthDialogModal: React.FC<AuthDialogModalProps> = ({
  isOpen,
  initialMode,
  onClose,
}) => {
  const {
    user,
    login,
    register,
    quickDemoLogin,
    startGitHubOAuthPopup,
    providers,
    isLoading,
    error,
    oauthStatus,
    clearError,
  } = useAuthStore();

  const { fetchSnippets, fetchFacets, refreshActiveSnippet } = useSnippetStore();
  const { fetchNotifications } = useRealtimeStore();

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      clearError();
    }
  }, [isOpen, initialMode]);

  // Immediately dismiss auth modal whenever a user is authenticated
  useEffect(() => {
    if (user && isOpen) {
      onClose();
    }
  }, [user, isOpen, onClose]);

  if (!isOpen) return null;

  const refreshAllAfterAuth = async () => {
    try {
      await Promise.all([
        fetchSnippets({ append: false }),
        fetchFacets(),
        refreshActiveSnippet(),
        fetchNotifications({ append: false }),
      ]);
    } catch {
      // Non-fatal
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
      } else {
        await register({
          email: email.trim(),
          username: username.trim(),
          displayName: displayName.trim(),
          password,
        });
      }
      onClose();
      refreshAllAfterAuth();
    } catch {
      // Error stored in authStore
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[28px] modal-surface shadow-2xl overflow-hidden border border-[var(--border)]">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'login' ? (
              <LogIn className="w-4 h-4 text-[var(--ink)]" />
            ) : (
              <UserPlus className="w-4 h-4 text-[var(--ink)]" />
            )}
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              {mode === 'login'
                ? 'Sign In to CodeCollab'
                : 'Create a CodeCollab Account'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 bg-[var(--surface-raised)]/50 p-1 rounded-[14px] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                clearError();
              }}
              className={`py-1.5 rounded-[12px] font-medium transition-all ${
                mode === 'login'
                  ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                clearError();
              }}
              className={`py-1.5 rounded-[12px] font-medium transition-all ${
                mode === 'register'
                  ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
              {error}
            </div>
          )}

          {oauthStatus && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)]">
              {oauthStatus}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'login' ? (
              <div>
                <label className="block font-medium text-[var(--ink-muted)] mb-1">
                  Email or Username
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@example.com or username"
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--ink-muted)] shadow-inset"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block font-medium text-[var(--ink-muted)] mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dev@example.com"
                    className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--ink-muted)] shadow-inset"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-[var(--ink-muted)] mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="username"
                      className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--ink-muted)] shadow-inset"
                    />
                    <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                      Letters, numbers, _ and - only.
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-[var(--ink-muted)] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Display Name"
                      className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--ink-muted)] shadow-inset"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block font-medium text-[var(--ink-muted)] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={mode === 'register' ? 8 : 1}
                pattern={mode === 'register' ? PASSWORD_PATTERN : undefined}
                title={mode === 'register' ? PASSWORD_RULES : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--ink-muted)] shadow-inset"
              />
              {mode === 'register' && (
                <p className="mt-1 text-[11px] text-[var(--ink-muted)]">{PASSWORD_RULES}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-[14px] bg-[var(--ink)] text-[var(--ink-contrast)] font-semibold shadow-raised hover:opacity-90 transition-opacity disabled:opacity-50 mt-2 cursor-pointer"
            >
              {isLoading
                ? 'Authenticating...'
                : mode === 'login'
                ? 'Sign In with Password'
                : 'Create Account'}
            </button>
          </form>

          {/* GitHub OAuth Popup Flow */}
          {providers.github && (
            <div className="pt-2 border-t border-[var(--border)] space-y-2">
              <button
                type="button"
                onClick={() => startGitHubOAuthPopup()}
                className="w-full py-2.5 rounded-[14px] border border-[var(--border)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Github className="w-4 h-4" />
                <span>Continue with GitHub</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    user,
    updateProfile,
    changePassword,
    startGitHubOAuthPopup,
    isLoading,
  } = useAuthStore();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      setDisplayName(user.displayName);
      setUsername(user.username);
      setEmail(user.email || '');
      setAvatarUrl(user.avatarUrl || '');
      setCurrentPassword('');
      setNewPassword('');
      setProfileMsg(null);
      setPasswordMsg(null);
      setModalError(null);
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const isNoreplyEmail = Boolean(user.email && user.email.includes('noreply'));
  const hasLocalPassword = Boolean(user.hasPassword);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setModalError(null);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
        email: email.trim() ? email.trim() : undefined,
      });
      setProfileMsg('Profile updated successfully.');
    } catch (err) {
      setModalError(formatApiError(err, 'Failed to update profile'));
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    setModalError(null);
    try {
      await changePassword({
        currentPassword: hasLocalPassword ? currentPassword : '',
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMsg(
        hasLocalPassword
          ? 'Password updated and other active sessions revoked.'
          : 'Password set successfully. You can now sign in with email and password.'
      );
    } catch (err) {
      setModalError(formatApiError(err, 'Failed to set password'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[28px] modal-surface shadow-2xl overflow-hidden border border-[var(--border)]">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-[var(--ink)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Account Profile &amp; Security Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs max-h-[85vh] overflow-y-auto">
          {modalError && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
              {modalError}
              {(modalError.includes('recent') ||
                modalError.includes('Recent') ||
                modalError.includes('REAUTH_REQUIRED')) && (
                <button
                  type="button"
                  onClick={() => startGitHubOAuthPopup()}
                  className="mt-2 block w-full py-1.5 rounded-[12px] bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] text-[var(--ink)] text-center font-medium cursor-pointer border border-[var(--border)]"
                >
                  Re-authenticate with GitHub
                </button>
              )}
            </div>
          )}

          {/* Connected GitHub Status */}
          {user.githubId && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-[14px] bg-[var(--surface-raised)]/60 border border-[var(--border)] text-[var(--ink)]">
              <Github className="w-4 h-4 text-[var(--ink-muted)]" />
              <span className="font-medium">Signed in with GitHub</span>
            </div>
          )}

          {/* Noreply placeholder warning */}
          {isNoreplyEmail && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
              Your account is using a placeholder email (
              <span className="font-mono">{user.email}</span>). Please update it with your real email address below.
            </div>
          )}

          {/* Profile Form */}
          <form onSubmit={handleSaveProfile} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--ink)]">
                Public Profile Information
              </h3>
              <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                Role: <strong className="text-[var(--ink)] capitalize">{user.globalRole}</strong>
              </span>
            </div>

            {profileMsg && (
              <div className="p-2.5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
                {profileMsg}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[var(--ink-muted)] mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] shadow-inset outline-none focus:border-[var(--ink-muted)]"
                />
              </div>
              <div>
                <label className="block text-[var(--ink-muted)] mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] font-mono shadow-inset outline-none focus:border-[var(--ink-muted)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[var(--ink-muted)] mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dev@example.com"
                className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] font-mono shadow-inset outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <div>
              <label className="block text-[var(--ink-muted)] mb-1">
                Avatar URL (Optional)
              </label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] shadow-inset outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 rounded-[14px] bg-[var(--ink)] text-[var(--ink-contrast)] font-semibold shadow-raised hover:opacity-90 transition-opacity cursor-pointer"
              >
                Save Profile
              </button>
            </div>
          </form>

          {/* Change or Set Password Form */}
          <form
            onSubmit={handleSavePassword}
            className="pt-4 border-t border-[var(--border)] space-y-3"
          >
            <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
              <KeyRound className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>{hasLocalPassword ? 'Change Password' : 'Set Password'}</span>
            </div>

            {!hasLocalPassword && (
              <p className="text-[11px] text-[var(--ink-muted)]">
                You signed in with GitHub and don&apos;t have a password yet. Setting a password allows you to sign in with email and password.
              </p>
            )}

            {passwordMsg && (
              <div className="p-2.5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
                {passwordMsg}
              </div>
            )}

            <div className={hasLocalPassword ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
              {hasLocalPassword && (
                <div>
                  <label className="block text-[var(--ink-muted)] mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] shadow-inset outline-none focus:border-[var(--ink-muted)]"
                  />
                </div>
              )}
              <div>
                <label className="block text-[var(--ink-muted)] mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] shadow-inset outline-none focus:border-[var(--ink-muted)]"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 rounded-[14px] border border-[var(--border)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
              >
                {hasLocalPassword ? 'Update Password' : 'Set Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
