import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  LogIn,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserPlus,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { useThemeStore } from '../../store/themeStore.ts';

export interface SidebarProfileBlockProps {
  onOpenAuthModal?: (mode: 'login' | 'register') => void;
  onOpenProfileModal?: () => void;
}

export const SidebarProfileBlock: React.FC<SidebarProfileBlockProps> = ({
  onOpenAuthModal,
  onOpenProfileModal,
}) => {
  const { user, logout } = useAuthStore();
  const { fetchSnippets, fetchFacets, refreshActiveSnippet } = useSnippetStore();
  const { resolvedTheme, toggleTheme } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    window.location.href = '/';
  };

  return (
    <div className="relative select-none" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label="User profile and settings"
        className="w-full flex items-center gap-3 p-2 rounded-[20px] hover:bg-[var(--surface-raised)]/60 transition-colors text-left focus-visible:outline-none focus-ring-visible"
      >
        <div className="w-9 h-9 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-sm font-semibold text-[var(--ink)] shrink-0 shadow-raised">
          {user ? user.displayName.charAt(0).toUpperCase() : '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 font-medium text-xs text-[var(--ink)]">
            <span className="truncate">{user ? user.displayName : 'Guest User'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] truncate">
            {user ? (user.email || `@${user.username}`) : 'Sign in to sync'}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 rounded-2xl popover-surface shadow-2xl py-1.5 z-50 divide-y divide-[var(--border)]">
          {user ? (
            <>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    if (onOpenProfileModal) onOpenProfileModal();
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
                >
                  <Settings className="w-4 h-4 text-[var(--ink-muted)]" />
                  <span>Profile Settings</span>
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
                >
                  {resolvedTheme === 'dark' ? (
                    <Sun className="w-4 h-4 text-[var(--ink)]" />
                  ) : (
                    <Moon className="w-4 h-4 text-[var(--ink)]" />
                  )}
                  <span>Theme: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}</span>
                </button>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
                >
                  <LogOut className="w-4 h-4 text-[var(--ink-muted)]" />
                  <span>Sign Out</span>
                </button>
              </div>
            </>
          ) : (
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  if (onOpenAuthModal) onOpenAuthModal('login');
                }}
                className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
              >
                <LogIn className="w-4 h-4 text-[var(--ink)]" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  if (onOpenAuthModal) onOpenAuthModal('register');
                }}
                className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
              >
                <UserPlus className="w-4 h-4 text-[var(--ink-muted)]" />
                <span>Register</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2.5 transition-colors"
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="w-4 h-4 text-[var(--ink)]" />
                ) : (
                  <Moon className="w-4 h-4 text-[var(--ink)]" />
                )}
                <span>Theme: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
