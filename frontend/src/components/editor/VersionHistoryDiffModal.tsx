import React, { useEffect, useState } from 'react';
import {
  GitCompare,
  History,
  RotateCcw,
  X,
} from 'lucide-react';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { CustomSelect } from '../ui/CustomSelect.tsx';

interface VersionHistoryDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VersionHistoryDiffModal: React.FC<
  VersionHistoryDiffModalProps
> = ({ isOpen, onClose }) => {
  const {
    activeSnippet,
    versions,
    versionsHasMore,
    isLoadingVersions,
    diffResult,
    isLoadingDiff,
    diffError,
    fetchVersions,
    computeDiff,
    restoreVersion,
    clearDiff,
  } = useSnippetStore();

  const { fetchComments } = useRealtimeStore();

  const [fromVersionId, setFromVersionId] = useState<string>('');
  const [toVersionId, setToVersionId] = useState<string>('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && activeSnippet) {
      fetchVersions(activeSnippet.id, { append: false });
      clearDiff();
      setStatusMessage(null);
    }
  }, [isOpen, activeSnippet?.id]);

  useEffect(() => {
    if (versions.length >= 2) {
      setToVersionId(versions[0].id);
      setFromVersionId(versions[1].id);
    } else if (versions.length === 1) {
      setToVersionId(versions[0].id);
      setFromVersionId(versions[0].id);
    }
  }, [versions]);

  if (!isOpen || !activeSnippet) return null;

  const canRestore =
    activeSnippet.effectiveRole === 'admin' ||
    activeSnippet.effectiveRole === 'owner' ||
    activeSnippet.effectiveRole === 'editor';

  const handleCompare = async () => {
    if (!fromVersionId || !toVersionId) return;
    await computeDiff(activeSnippet.id, fromVersionId, toVersionId);
  };

  const handleRestore = async (versionId: string, versionNumber: number) => {
    setRestoringId(versionId);
    setStatusMessage(null);
    try {
      await restoreVersion(activeSnippet.id, versionId);
      await fetchComments(activeSnippet.id);
      setStatusMessage(
        `Restored snippet content to v${versionNumber} (new snapshot recorded).`
      );
    } catch (err) {
      setStatusMessage((err as Error).message || 'Failed to restore version');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[88vh] rounded-[28px] modal-surface border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-[var(--ink)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                Version History &amp; Diff — {activeSnippet.title}
              </h2>
              <p className="text-xs text-[var(--ink-muted)]">
                Inspect snapshots with author/timestamp, compare versions line-by-line, or restore.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusMessage && (
          <div className="px-6 py-2 bg-[var(--surface-raised)] border-b border-[var(--border)] text-xs text-[var(--ink)]">
            {statusMessage}
          </div>
        )}

        {/* Two-Column Body: Version List (Left) + Two-Version Diff Viewer (Right) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Column: Paginated Versions List */}
          <div className="lg:col-span-5 border-r border-[var(--border)] flex flex-col min-h-0 bg-[var(--surface)]/10">
            <div className="p-3 border-b border-[var(--border)] text-xs font-semibold text-[var(--ink)]">
              Snapshots ({versions.length} loaded)
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
              {versions.map((ver) => (
                <div
                  key={ver.id}
                  className="p-3 text-xs space-y-1.5 hover:bg-[var(--surface-raised)]/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--ink)] bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-0.5 rounded-full">
                        v{ver.versionNumber}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)]">
                        {ver.source}
                      </span>
                    </div>

                    {canRestore && (
                      <button
                        type="button"
                        disabled={restoringId === ver.id}
                        onClick={() =>
                          handleRestore(ver.id, ver.versionNumber)
                        }
                        className="px-2.5 py-1 rounded-[10px] bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] text-[11px] text-[var(--ink)] border border-[var(--border)] flex items-center gap-1 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>
                          {restoringId === ver.id
                            ? 'Restoring...'
                            : 'Restore'}
                        </span>
                      </button>
                    )}
                  </div>

                  <p className="text-[var(--ink)] font-medium">{ver.summary}</p>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-muted)]">
                    <span>
                      By @{ver.authorUsername || 'system'}
                    </span>
                    <span>{new Date(ver.createdAt).toLocaleString()}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setFromVersionId(ver.id)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
                        fromVersionId === ver.id
                          ? 'bg-[var(--surface-raised)] border-[var(--ink)] text-[var(--ink)] font-semibold shadow-xs'
                          : 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink-muted)]'
                      }`}
                    >
                      Set Base (From)
                    </button>
                    <button
                      type="button"
                      onClick={() => setToVersionId(ver.id)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
                        toVersionId === ver.id
                          ? 'bg-[var(--surface-raised)] border-[var(--ink)] text-[var(--ink)] font-semibold shadow-xs'
                          : 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink-muted)]'
                      }`}
                    >
                      Set Target (To)
                    </button>
                  </div>
                </div>
              ))}

              {versionsHasMore && (
                <div className="p-3">
                  <button
                    type="button"
                    disabled={isLoadingVersions}
                    onClick={() =>
                      fetchVersions(activeSnippet.id, { append: true })
                    }
                    className="w-full py-1.5 rounded-[12px] border border-[var(--border)] text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
                  >
                    {isLoadingVersions
                      ? 'Loading...'
                      : 'Load Older Versions'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Two-Version Structured Diff Viewer */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-[var(--surface-raised)]/20">
            <div className="p-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900/60">
              <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
                <span className="text-[var(--ink-muted)] shrink-0">From:</span>
                <CustomSelect
                  value={fromVersionId}
                  onChange={setFromVersionId}
                  options={versions.map((v) => ({
                    value: v.id,
                    label: `v${v.versionNumber} — ${v.summary.slice(0, 24)}`,
                  }))}
                  className="w-44"
                  aria-label="Select comparison source version"
                />

                <span className="text-[var(--ink-muted)] shrink-0">To:</span>
                <CustomSelect
                  value={toVersionId}
                  onChange={setToVersionId}
                  options={versions.map((v) => ({
                    value: v.id,
                    label: `v${v.versionNumber} — ${v.summary.slice(0, 24)}`,
                  }))}
                  className="w-44"
                  aria-label="Select comparison target version"
                />
              </div>

              <button
                type="button"
                disabled={isLoadingDiff || !fromVersionId || !toVersionId}
                onClick={handleCompare}
                className="px-3.5 py-1.5 rounded-[12px] bg-[var(--ink)] hover:opacity-90 text-[var(--ink-contrast)] text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 transition-opacity"
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>
                  {isLoadingDiff ? 'Computing Diff...' : 'Compare Versions'}
                </span>
              </button>
            </div>

            {diffError && (
              <div className="p-3 bg-[var(--surface-raised)] border-b border-[var(--border)] text-xs text-[var(--ink)]">
                {diffError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
              {!diffResult ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--ink-muted)] gap-2 py-12">
                  <GitCompare className="w-6 h-6 text-[var(--ink-muted)] opacity-50" />
                  <span>
                    Select From and To versions above and click &ldquo;Compare
                    Versions&rdquo; to inspect line-by-line changes.
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Diff Stats Header */}
                  <div className="flex items-center justify-between p-2.5 rounded-[14px] bg-[var(--surface-raised)] border border-[var(--border)]">
                    <div>
                      <span className="text-[var(--ink)]">
                        Comparing{' '}
                        <strong className="text-[var(--ink)] font-bold">
                          v{diffResult.fromVersion.versionNumber}
                        </strong>{' '}
                        &rarr;{' '}
                        <strong className="text-[var(--ink)] font-bold">
                          v{diffResult.toVersion.versionNumber}
                        </strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--ink)] font-medium">
                        +{diffResult.stats.additions} additions
                      </span>
                      <span className="text-[var(--ink-muted)]">
                        -{diffResult.stats.deletions} deletions
                      </span>
                      <span className="text-[var(--ink-muted)]">
                        {diffResult.stats.unchanged} unchanged
                      </span>
                    </div>
                  </div>

                  {/* Diff Lines Table */}
                  <div className="rounded-[14px] border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                    {diffResult.lines.map((line, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start px-2 py-0.5 whitespace-pre-wrap ${
                          line.type === 'added'
                            ? 'bg-[var(--surface-raised)] text-[var(--ink)] font-medium'
                            : line.type === 'removed'
                            ? 'bg-[var(--surface)]/50 text-[var(--ink-muted)] line-through'
                            : 'text-[var(--ink-muted)]'
                        }`}
                      >
                        <span className="w-10 text-right pr-2 text-[var(--ink-muted)] opacity-60 select-none shrink-0">
                          {line.oldLineNumber ?? ''}
                        </span>
                        <span className="w-10 text-right pr-2 text-[var(--ink-muted)] opacity-60 select-none shrink-0">
                          {line.newLineNumber ?? ''}
                        </span>
                        <span className="w-5 text-center select-none shrink-0 font-bold">
                          {line.type === 'added'
                            ? '+'
                            : line.type === 'removed'
                            ? '-'
                            : ' '}
                        </span>
                        <span className="flex-1 break-all">
                          {line.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
