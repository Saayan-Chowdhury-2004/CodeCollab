import React from 'react';
import { ActiveMainView } from './navConfig.ts';
import { IconRail } from './IconRail.tsx';
import { ShellHeader } from './ShellHeader.tsx';

export interface AppShellProps {
  activeView: ActiveMainView;
  onSelectView: (view: ActiveMainView) => void;
  onOpenAuthModal: (mode: 'login' | 'register') => void;
  onOpenProfileModal: () => void;
  onOpenCreateSnippetModal: () => void;
  onHomeClick?: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isRightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  sidebarContent: React.ReactNode;
  mainContent: React.ReactNode;
  rightPanelContent?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeView,
  onSelectView,
  onOpenAuthModal,
  onOpenProfileModal,
  onOpenCreateSnippetModal,
  onHomeClick,
  isSidebarOpen,
  onToggleSidebar,
  isRightPanelOpen,
  onToggleRightPanel,
  sidebarContent,
  mainContent,
  rightPanelContent,
}) => {
  return (
    <div className="h-screen w-screen overflow-hidden flex bg-gradient-to-br from-[var(--canvas-from)] to-[var(--canvas-to)] text-[var(--ink)] select-none">
      {/* 1. Left Icon Rail (Floating rounded container) */}
      <IconRail
        activeView={activeView}
        onSelectView={onSelectView}
        onOpenProfileModal={onOpenProfileModal}
        onHomeClick={onHomeClick}
      />

      {/* 2. Main App Canvas Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden my-0 md:my-3 mr-0 md:mr-3 ml-0 md:ml-2">
        {/* Top Header Row (Connection dot, notifications, sign-in/user menu) */}
        <ShellHeader
          onOpenAuthModal={onOpenAuthModal}
          onOpenProfileModal={onOpenProfileModal}
          onOpenCreateSnippetModal={onOpenCreateSnippetModal}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={onToggleSidebar}
          isRightPanelOpen={isRightPanelOpen}
          onToggleRightPanel={onToggleRightPanel}
        />

        {/* 3. Multi-Panel Frosted App Window */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative gap-2 sm:gap-3 px-2 sm:px-3 pb-2 sm:pb-3">
          {/* Context Sidebar Drawer Backdrop on Mobile */}
          {isSidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-30 lg:hidden"
              onClick={onToggleSidebar}
            />
          )}

          {/* Context Sidebar Slot (Phase 3 target) */}
          <div
            className={`${
              isSidebarOpen ? 'flex' : 'hidden'
            } fixed lg:static inset-y-2 left-2 z-40 lg:z-auto h-[calc(100%-16px)] lg:h-full flex-col shrink-0`}
          >
            {sidebarContent}
          </div>

          {/* Main Frame Slot */}
          <main className="flex-1 flex min-h-0 min-w-0 overflow-hidden rounded-[28px] frosted-surface relative">
            {mainContent}
          </main>

          {/* Right Panel Drawer Backdrop on Mobile */}
          {isRightPanelOpen && rightPanelContent && (
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-30 lg:hidden"
              onClick={onToggleRightPanel}
            />
          )}

          {/* Right Panel Slot (Review comments / activity) */}
          {rightPanelContent && (
            <div
              className={`${
                isRightPanelOpen ? 'flex' : 'hidden'
              } fixed lg:static inset-x-2 bottom-2 h-[65vh] lg:h-full z-40 lg:z-auto rounded-[28px] frosted-surface flex-col shrink-0 overflow-hidden shadow-2xl lg:shadow-none`}
            >
              {rightPanelContent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

