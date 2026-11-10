import React, { Suspense, useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuthStore } from './store/authStore.ts';
import { useSnippetStore } from './store/snippetStore.ts';
import { useRealtimeStore } from './store/realtimeStore.ts';
import { AppShell } from './components/layout/AppShell.tsx';
import { ActiveMainView } from './components/layout/navConfig.ts';
import { SnippetExplorerSidebar } from './components/snippets/SnippetExplorerSidebar.tsx';
import { CollaborativeMonacoWorkspace } from './components/editor/CollaborativeMonacoWorkspace.tsx';
import { CommentReviewSidebar } from './components/comments/CommentReviewSidebar.tsx';
import { VersionHistoryDiffModal } from './components/editor/VersionHistoryDiffModal.tsx';
import {
  CollaboratorsModal,
  CreateOrEditSnippetModal,
} from './components/snippets/SnippetModals.tsx';
import {
  AuthDialogModal,
  ProfileSettingsModal,
} from './components/auth/AuthModals.tsx';
import { ActivityFeedView } from './components/activity/ActivityFeedView.tsx';
import { AdminUsersView } from './components/admin/AdminUsersView.tsx';
import {
  getHasSeenLanding,
  setHasSeenLanding,
  shouldShowLanding,
} from './utils/landingRouting.ts';

const LandingView = React.lazy(() => import('./components/landing/LandingView.tsx'));

export default function App() {
  const { bootstrapAuth, user, bootstrapped } = useAuthStore();
  const { fetchSnippets, fetchFacets, selectSnippet, activeSnippet } = useSnippetStore();
  const {
    initRealtimeListeners,
    fetchNotifications,
    liveToastNotification,
    dismissToast,
  } = useRealtimeStore();

  const [hasSeenLanding, setHasSeenLandingState] = useState(() => getHasSeenLanding());
  const [activeView, setActiveView] = useState<ActiveMainView>('workspace');
  const [authModalMode, setAuthModalMode] = useState<
    'login' | 'register' | null
  >(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [snippetModalMode, setSnippetModalMode] = useState<
    'create' | 'edit' | null
  >(null);
  const [showVersionHistoryModal, setShowVersionHistoryModal] = useState(false);
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(false);

  const showLanding = shouldShowLanding({
    isSignedIn: Boolean(user),
    hasSeenLanding,
    path: window.location.pathname,
  });

  // When user is authenticated, mark landing as seen
  useEffect(() => {
    if (user) {
      setHasSeenLanding(true);
      setHasSeenLandingState(true);
    }
  }, [user]);

  // Manage body scroll: landing page allows full window scroll; workspace contains its own panel scroll
  useEffect(() => {
    if (showLanding) {
      document.body.style.overflowY = 'auto';
      document.documentElement.style.overflowY = 'auto';
      return () => {
        document.body.style.overflowY = 'hidden';
        document.documentElement.style.overflowY = 'hidden';
      };
    } else {
      document.body.style.overflowY = 'hidden';
      document.documentElement.style.overflowY = 'hidden';
    }
  }, [showLanding]);

  // Responsive panel states
  // Sidebar open by default >= 1024px
  // Right panel open by default >= 1280px, collapsed below 1280px
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1280;
    }
    return true;
  });

  const [rightPanelTab, setRightPanelTab] = useState<'comments' | 'versions' | 'collaborators' | 'activity'>('comments');

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 1024) {
        setIsSidebarOpen(false);
        setIsRightPanelOpen(false);
      } else if (width < 1280) {
        setIsSidebarOpen(true);
        setIsRightPanelOpen(false);
      } else {
        setIsSidebarOpen(true);
        setIsRightPanelOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    initRealtimeListeners();
    (async () => {
      await bootstrapAuth();
      await Promise.all([
        fetchSnippets({ append: false }),
        fetchFacets(),
      ]);
      if (useAuthStore.getState().user) {
        await fetchNotifications({ append: false });
      }

      // Deep-link support: /snippets/:id or ?snippet=:id
      const pathMatch = /^\/snippets\/([0-9a-fA-F-]{36})$/.exec(window.location.pathname);
      const searchParamSnippet = new URLSearchParams(window.location.search).get('snippet');
      const targetSnippetId = pathMatch ? pathMatch[1] : searchParamSnippet;

      if (targetSnippetId) {
        setActiveView('workspace');
        await selectSnippet(targetSnippetId);
      } else {
        const available = useSnippetStore.getState().items;
        if (available.length > 0 && !useSnippetStore.getState().activeSnippet) {
          await selectSnippet(available[0].id);
        }
      }
    })();

    const handlePopState = async () => {
      const match = /^\/snippets\/([0-9a-fA-F-]{36})$/.exec(window.location.pathname);
      if (match) {
        setActiveView('workspace');
        await selectSnippet(match[1]);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync active snippet to browser URL
  useEffect(() => {
    if (activeSnippet) {
      const targetPath = `/snippets/${activeSnippet.id}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    } else if (window.location.pathname.startsWith('/snippets/')) {
      window.history.pushState(null, '', '/');
    }
  }, [activeSnippet?.id]);

  const handleNavigateToSnippet = async (snippetId: string) => {
    setActiveView('workspace');
    await selectSnippet(snippetId);
  };

  const handleHomeClick = () => {
    if (!user) {
      setHasSeenLanding(false);
      setHasSeenLandingState(false);
      if (window.location.pathname !== '/') {
        window.history.pushState(null, '', '/');
      }
    } else {
      setActiveView('workspace');
    }
  };

  if (!bootstrapped) {
    return (
      <div className="h-screen w-screen bg-gradient-to-br from-[var(--canvas-from)] to-[var(--canvas-to)] flex items-center justify-center select-none">
        <div
          className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--ink)] animate-spin"
          aria-label="Loading session"
        />
      </div>
    );
  }

  if (showLanding) {
    return (
      <Suspense
        fallback={
          <div className="h-screen w-screen bg-gradient-to-br from-[var(--canvas-from)] to-[var(--canvas-to)] flex items-center justify-center select-none">
            <div
              className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--ink)] animate-spin"
              aria-label="Loading landing page"
            />
          </div>
        }
      >
        <LandingView
          onGetStarted={() => {
            setAuthModalMode('register');
          }}
          onSignIn={() => {
            setAuthModalMode('login');
          }}
        />
        <AuthDialogModal
          isOpen={authModalMode !== null}
          initialMode={authModalMode || 'login'}
          onClose={() => setAuthModalMode(null)}
        />
      </Suspense>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col select-none relative">
      <AppShell
        activeView={activeView}
        onSelectView={setActiveView}
        onOpenAuthModal={(mode) => setAuthModalMode(mode)}
        onOpenProfileModal={() => setShowProfileModal(true)}
        onOpenCreateSnippetModal={() => setSnippetModalMode('create')}
        onHomeClick={handleHomeClick}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        isRightPanelOpen={isRightPanelOpen}
        onToggleRightPanel={() => setIsRightPanelOpen((v) => !v)}
        sidebarContent={
          activeView === 'workspace' ? (
            <SnippetExplorerSidebar
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              onOpenAuthModal={(mode) => setAuthModalMode(mode)}
              onOpenProfileModal={() => setShowProfileModal(true)}
              onOpenCreateSnippetModal={() => {
                if (!user) {
                  setAuthModalMode('login');
                } else {
                  setSnippetModalMode('create');
                }
              }}
            />
          ) : null
        }
        mainContent={
          activeView === 'workspace' ? (
            <CollaborativeMonacoWorkspace
              isSidebarOpen={isSidebarOpen}
              onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
              onOpenVersionHistoryModal={() => setShowVersionHistoryModal(true)}
              onOpenCollaboratorsModal={() => setShowCollaboratorsModal(true)}
              onOpenEditSnippetModal={() => setSnippetModalMode('edit')}
              onOpenRightPanel={() => setIsRightPanelOpen(true)}
              onOpenRightPanelTab={(tab) => {
                setRightPanelTab(tab);
                setIsRightPanelOpen(true);
              }}
            />
          ) : activeView === 'activity' ? (
            <ActivityFeedView onNavigateToSnippet={handleNavigateToSnippet} />
          ) : activeView === 'admin' ? (
            user?.globalRole === 'admin' ? (
              <AdminUsersView />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--ink-muted)]">
                Admin role required to view user role management.
              </div>
            )
          ) : null
        }
        rightPanelContent={
          activeView === 'workspace' || activeView === 'activity' ? (
            <CommentReviewSidebar
              isOpen={isRightPanelOpen}
              onClose={() => setIsRightPanelOpen(false)}
              activeTab={rightPanelTab}
              onTabChange={setRightPanelTab}
              onOpenVersionHistoryModal={() => setShowVersionHistoryModal(true)}
              onOpenCollaboratorsModal={() => setShowCollaboratorsModal(true)}
            />
          ) : null
        }
      />

      {/* Live Socket Notification Toast */}
      {liveToastNotification && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm popover-surface rounded-2xl shadow-2xl p-3 text-xs flex items-start gap-3">
          <Bell className="w-4 h-4 text-[var(--ink)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-[var(--ink)]">
              {liveToastNotification.title}
            </div>
            <p className="text-[var(--ink-muted)] mt-0.5">
              {liveToastNotification.message}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissToast}
            aria-label="Dismiss notification"
            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Modals */}
      <AuthDialogModal
        isOpen={authModalMode !== null}
        initialMode={authModalMode || 'login'}
        onClose={() => setAuthModalMode(null)}
      />

      <ProfileSettingsModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />

      <CreateOrEditSnippetModal
        isOpen={snippetModalMode !== null}
        mode={snippetModalMode || 'create'}
        onClose={() => setSnippetModalMode(null)}
      />

      <CollaboratorsModal
        isOpen={showCollaboratorsModal}
        onClose={() => setShowCollaboratorsModal(false)}
      />

      <VersionHistoryDiffModal
        isOpen={showVersionHistoryModal}
        onClose={() => setShowVersionHistoryModal(false)}
      />
    </div>
  );
}
