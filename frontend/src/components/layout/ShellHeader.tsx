import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  ChevronDown,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  PanelRight,
  Plus,
  Settings,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { formatRoleLabel } from '../../utils/format.ts';

export interface ShellHeaderProps {
  onOpenAuthModal: (mode: 'login' | 'register') => void;
  onOpenProfileModal: () => void;
  onOpenCreateSnippetModal: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isRightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
}

export const ShellHeader: React.FC<ShellHeaderProps> = ({
  onOpenAuthModal,
  onOpenProfileModal,
  onOpenCreateSnippetModal,
  isSidebarOpen,
  onToggleSidebar,
  isRightPanelOpen,
  onToggleRightPanel,
}) => {
  const { user, logout } = useAuthStore();
  const { fetchSnippets, fetchFacets, refreshActiveSnippet } = useSnippetStore();
  const {
    isConnected,
    notifications,
    unreadCount,
    notificationsHasMore,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useRealtimeStore();

  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setShowNotifDropdown(false);
      }
      if (userRef.current && !userRef.current.contains(target)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleLogout = async () => {
    setShowUserDropdown(false);
    await logout();
    window.location.href = '/';
  };

  const canCreateSnippet = user && (user.globalRole === 'admin' || user.globalRole === 'editor');

  return (
    <header className="h-12 px-3 sm:px-4 flex items-center justify-between select-none shrink-0 z-30">
      {/* Mobile Sidebar Toggle & Mobile Logo */}
      <div className="flex items-center gap-2 md:hidden">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className="p-2 rounded-xl text-[var(--ink)]/80 hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-ring-visible"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <span className="font-semibold text-sm tracking-tight text-[var(--ink)]">CodeCollab</span>
      </div>

      <div className="hidden md:block" />

      {/* Right Actions: Live dot, Notifications, User Menu, Right Panel Toggle */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Connection status dot */}
        <div
          title={isConnected ? 'Connected' : 'Reconnecting'}
          aria-label={isConnected ? 'Connected' : 'Reconnecting'}
          className="flex items-center justify-center p-2 cursor-help"
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isConnected
                ? 'bg-[var(--ink)] shadow-xs'
                : 'bg-[var(--ink-muted)] opacity-30 animate-pulse'
            }`}
          />
        </div>

        {/* Notifications */}
        {user && (
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                const next = !showNotifDropdown;
                setShowNotifDropdown(next);
                if (next) fetchNotifications({ append: false });
              }}
              aria-label={`Notifications (${unreadCount} unread)`}
              title="Notifications"
              className="relative p-2 rounded-xl text-[var(--ink)]/80 hover:bg-[var(--surface-raised)] border border-transparent hover:border-[var(--border)] transition-colors focus-visible:outline-none focus-ring-visible"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--ink)] text-[10px] font-mono font-bold text-[var(--ink-contrast)] flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifDropdown && (
              <div className="absolute right-0 mt-2 w-80 max-h-96 flex flex-col rounded-2xl popover-surface shadow-2xl z-50">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    Notifications ({unreadCount} unread)
                  </span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllNotificationsRead()}
                      className="text-[11px] text-[var(--ink)] hover:underline flex items-center gap-1 focus-visible:outline-none focus-ring-visible"
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-[var(--ink)]" />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto divide-y divide-[var(--border)] flex-1">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[var(--ink-muted)]">
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3 text-xs transition-colors ${
                          n.readAt ? 'opacity-70' : 'bg-[var(--surface-raised)]/70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-[var(--ink)]">{n.title}</span>
                          {!n.readAt && (
                            <button
                              type="button"
                              onClick={() => markNotificationRead(n.id)}
                              className="text-[10px] font-mono text-[var(--ink)] hover:underline shrink-0"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--ink-muted)] mt-1">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
                {notificationsHasMore && (
                  <button
                    type="button"
                    onClick={() => fetchNotifications({ append: true })}
                    className="py-2 text-center text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] border-t border-[var(--border)]"
                  >
                    Load more notifications
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* User Menu / Sign In */}
        {user ? (
          <div className="relative" ref={userRef}>
            <button
              type="button"
              onClick={() => setShowUserDropdown((v) => !v)}
              aria-label="User menu"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--surface-raised)] text-[var(--ink)] text-xs transition-colors focus-visible:outline-none focus-ring-visible border border-[var(--border)] shadow-xs"
            >
              <div className="w-6 h-6 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[11px] font-semibold text-[var(--ink)] shadow-xs">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <span className="max-w-[100px] truncate hidden sm:inline">{user.displayName}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            </button>

            {showUserDropdown && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl popover-surface shadow-2xl py-1 z-50 divide-y divide-[var(--border)]">
                <div className="px-4 py-3">
                  <div className="font-medium text-xs text-[var(--ink)] flex items-center justify-between">
                    <span className="truncate">{user.displayName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] font-mono font-medium">
                      {formatRoleLabel(user.globalRole)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] font-mono mt-0.5 truncate">
                    @{user.username}
                  </div>
                </div>

                <div className="py-1">
                  {canCreateSnippet && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserDropdown(false);
                        onOpenCreateSnippetModal();
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-[var(--ink-muted)]" />
                      <span>New Snippet</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserDropdown(false);
                      onOpenProfileModal();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-[var(--ink-muted)]" />
                    <span>Settings</span>
                  </button>
                </div>

                <div className="py-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] flex items-center gap-2 transition-colors"
                  >
                    <LogOut className="w-4 h-4 text-[var(--ink-muted)]" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenAuthModal('login')}
              className="px-3.5 py-1.5 rounded-xl bg-[var(--ink)] text-[var(--ink-contrast)] text-xs font-semibold flex items-center gap-1.5 shadow-raised hover:opacity-90 transition-opacity focus-visible:outline-none focus-ring-visible cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-[var(--ink-contrast)]" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenAuthModal('register')}
              className="px-3 py-1.5 rounded-xl border border-[var(--border)] text-[var(--ink)] text-xs font-medium hover:bg-[var(--surface-raised)] transition-colors focus-visible:outline-none focus-ring-visible hidden sm:inline-block cursor-pointer"
            >
              Register
            </button>
          </div>
        )}

        {/* Right Panel Toggle Button */}
        {onToggleRightPanel && (
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label={isRightPanelOpen ? 'Collapse review panel' : 'Expand review panel'}
            title={isRightPanelOpen ? 'Collapse comments' : 'Expand comments'}
            className="p-2 rounded-xl text-[var(--ink)]/80 hover:bg-[var(--surface-raised)] transition-colors focus-visible:outline-none focus-ring-visible"
          >
            <PanelRight className="w-4 h-4 hidden lg:inline-block" />
            <MessageSquare className="w-4 h-4 lg:hidden" />
          </button>
        )}
      </div>
    </header>
  );
};
