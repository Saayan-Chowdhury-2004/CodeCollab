import React from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { ActiveMainView, NAV_ITEMS } from './navConfig.ts';
import { useAuthStore } from '../../store/authStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { LandingLogo } from '../landing/LandingLogo.tsx';

export interface IconRailProps {
  activeView: ActiveMainView;
  onSelectView: (view: ActiveMainView) => void;
  onOpenProfileModal: () => void;
  onHomeClick?: () => void;
}

export const IconRail: React.FC<IconRailProps> = ({
  activeView,
  onSelectView,
  onOpenProfileModal,
  onHomeClick,
}) => {
  const { user } = useAuthStore();
  const { isConnected } = useRealtimeStore();
  const { resolvedTheme, toggleTheme } = useThemeStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.disabled && (!item.visible || item.visible({ user, isConnected })),
  );

  return (
    <aside
      className="hidden md:flex flex-col items-center justify-between py-4 px-2 w-16 shrink-0 my-3 ml-3 rounded-[28px] bg-[var(--rail-bg)] border border-[var(--rail-border)] shadow-2xl z-40 select-none"
      aria-label="Navigation rail"
    >
      {/* Top Logo / Brand Tile */}
      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={onHomeClick ? onHomeClick : () => onSelectView('workspace')}
          aria-label="Home"
          className="w-10 h-10 rounded-2xl bg-[var(--rail-active-tile)] border border-[var(--rail-border)] flex items-center justify-center text-[var(--rail-icon)] shadow-sm hover:scale-105 transition-transform focus-visible:outline-none focus-ring-visible"
        >
          <LandingLogo className="w-5 h-5 text-current" />
        </button>

        {/* Navigation Items */}
        <nav className="flex flex-col items-center gap-2 mt-2" aria-label="Main Navigation">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.view;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.view) {
                    onSelectView(item.view);
                  } else if (item.href) {
                    window.open(item.href, '_blank', 'noreferrer');
                  }
                }}
                aria-label={item.label}
                title={item.label}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all focus-visible:outline-none focus-ring-visible ${isActive
                    ? 'bg-[var(--rail-active-tile)] text-[var(--rail-icon)] shadow-raised'
                    : 'text-[var(--rail-icon)]/70 hover:text-[var(--rail-icon)] hover:bg-[var(--rail-active-tile)]/50'
                  }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Tile: Theme Toggle & Settings */}
      <div className="flex flex-col items-center gap-2 pt-2 border-t border-[var(--rail-border)]/50 w-full">
        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-[var(--rail-icon)]/70 hover:text-[var(--rail-icon)] hover:bg-[var(--rail-active-tile)]/50 transition-colors focus-visible:outline-none focus-ring-visible"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-5 h-5 text-[var(--rail-icon)]" />
          ) : (
            <Moon className="w-5 h-5 text-[var(--rail-icon)]" />
          )}
        </button>

        {/* Settings */}
        {user && (
          <button
            type="button"
            onClick={onOpenProfileModal}
            aria-label="Profile and Settings"
            title="Settings"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[var(--rail-icon)]/70 hover:text-[var(--rail-icon)] hover:bg-[var(--rail-active-tile)]/50 transition-colors focus-visible:outline-none focus-ring-visible"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
      </div>
    </aside>
  );
};
