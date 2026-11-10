import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { apiFetch } from '../../api/client.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import {
  CollaboratorRole,
  PaginatedResult,
  SnippetVisibility,
  UserDTO,
} from '../../types/domain.ts';
import { CustomSelect } from '../ui/CustomSelect.tsx';

interface CreateOrEditSnippetModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  onClose: () => void;
}

const LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'sql',
  'go',
  'rust',
  'java',
  'json',
  'markdown',
  'bash',
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public (Indexed in Global Search)' },
  { value: 'unlisted', label: 'Unlisted (Direct Link Only)' },
  { value: 'private', label: 'Private (Owner & Collaborators Only)' },
];

const ROLE_OPTIONS = [
  { value: 'editor', label: 'Editor (Read + Write)' },
  { value: 'viewer', label: 'Viewer (Read + Comment)' },
];

export const CreateOrEditSnippetModal: React.FC<
  CreateOrEditSnippetModalProps
> = ({ isOpen, mode, onClose }) => {
  const { activeSnippet, createSnippet, updateActiveSnippet } =
    useSnippetStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('typescript');
  const [visibility, setVisibility] = useState<SnippetVisibility>('public');
  const [tagsInput, setTagsInput] = useState('typescript, backend');
  const [content, setContent] = useState(
    '// Start writing or pasting your snippet here\nexport function example() {\n  return true;\n}\n'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (mode === 'edit' && activeSnippet) {
      setTitle(activeSnippet.title);
      setDescription(activeSnippet.description);
      setLanguage(activeSnippet.language);
      setVisibility(activeSnippet.visibility);
      setTagsInput(activeSnippet.tags.join(', '));
      setContent(activeSnippet.currentContent);
    } else {
      setTitle('');
      setDescription('');
      setLanguage('typescript');
      setVisibility('public');
      setTagsInput('typescript, crdt');
      setContent(
        '// Collaborative code snippet\nexport async function handler(req: Request): Promise<Response> {\n  return new Response("OK", { status: 200 });\n}\n'
      );
    }
  }, [isOpen, mode, activeSnippet]);

  if (!isOpen) return null;

  const canChangeVisibility =
    mode === 'create' ||
    activeSnippet?.effectiveRole === 'admin' ||
    activeSnippet?.effectiveRole === 'owner';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    try {
      if (mode === 'create') {
        await createSnippet({
          title: title.trim(),
          description: description.trim(),
          language,
          visibility,
          content,
          tags: parsedTags,
        });
      } else {
        await updateActiveSnippet({
          title: title.trim(),
          description: description.trim(),
          language,
          ...(canChangeVisibility ? { visibility } : {}),
          tags: parsedTags,
        });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to save snippet');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-[28px] modal-surface border border-[var(--border)] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            {mode === 'create'
              ? 'Create Collaborative Code Snippet'
              : 'Edit Snippet Metadata & Visibility'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
              {error}
            </div>
          )}

          <div>
            <label className="block font-medium text-[var(--ink-muted)] mb-1">
              Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Distributed Token Bucket Rate Limiter"
              className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--focus-ring)] shadow-inset"
            />
          </div>

          <div>
            <label className="block font-medium text-[var(--ink-muted)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of the snippet..."
              className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:border-[var(--focus-ring)] shadow-inset"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[var(--ink-muted)] mb-1">
                Language
              </label>
              <CustomSelect
                value={language}
                onChange={setLanguage}
                options={LANGUAGES}
                aria-label="Select language"
              />
            </div>

            <div>
              <label className="block font-medium text-[var(--ink-muted)] mb-1">
                Visibility
              </label>
              <CustomSelect
                disabled={!canChangeVisibility}
                value={visibility}
                onChange={(val) => setVisibility(val as SnippetVisibility)}
                options={VISIBILITY_OPTIONS}
                aria-label="Select visibility"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-[var(--ink-muted)] mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="auth, security, postgres"
              className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] font-mono shadow-inset outline-none focus:border-[var(--focus-ring)]"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label className="block font-medium text-[var(--ink-muted)] mb-1">
                Initial Code Content (v1)
              </label>
              <textarea
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] p-3 font-mono text-xs text-[var(--ink)] shadow-inset outline-none focus:border-[var(--focus-ring)]"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[14px] border border-[var(--border)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-[14px] bg-[var(--ink)] text-[var(--ink-contrast)] font-semibold shadow-raised hover:opacity-90 flex items-center gap-1.5 transition-opacity cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {isSaving
                  ? 'Saving...'
                  : mode === 'create'
                  ? 'Create Snippet'
                  : 'Save Changes'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CollaboratorsModal: React.FC<CollaboratorsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { activeSnippet, addCollaborator, removeCollaborator } =
    useSnippetStore();

  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [role, setRole] = useState<CollaboratorRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dropdown search states
  const [suggestions, setSuggestions] = useState<UserDTO[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search for users
  useEffect(() => {
    const trimmed = usernameOrEmail.trim();
    if (!trimmed) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<PaginatedResult<UserDTO>>(
          `/api/users?q=${encodeURIComponent(trimmed)}&limit=8`
        );
        setSuggestions(res.items || []);
        setShowDropdown(true);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [usernameOrEmail]);

  if (!isOpen || !activeSnippet) return null;

  const canManage =
    activeSnippet.effectiveRole === 'admin' ||
    activeSnippet.effectiveRole === 'owner';

  const handleAdd = async (e?: React.FormEvent, directUsername?: string) => {
    if (e) e.preventDefault();
    const val = (directUsername || usernameOrEmail).trim();
    if (!val) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await addCollaborator(activeSnippet.id, {
        ...(val.includes('@') ? { email: val } : { username: val }),
        role,
      });
      setUsernameOrEmail('');
      setShowDropdown(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to add collaborator');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectUser = (user: UserDTO) => {
    setUsernameOrEmail(user.username);
    setShowDropdown(false);
    // If user is already a collaborator, default to their current role
    const existing = activeSnippet.collaborators.find((c) => c.userId === user.id);
    if (existing) {
      setRole(existing.role);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[28px] modal-surface border border-[var(--border)] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--ink)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Snippet Collaborators &amp; Access
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
          {error && (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
              {error}
            </div>
          )}

          {canManage ? (
            <div className="space-y-2">
              <label className="block font-medium text-[var(--ink-muted)]">
                Add or Update Collaborator
              </label>
              <form onSubmit={(e) => handleAdd(e)} className="flex items-center gap-2">
                <div ref={dropdownRef} className="flex-1 relative">
                  <div className="relative">
                    <input
                      type="text"
                      value={usernameOrEmail}
                      onFocus={() => {
                        if (suggestions.length > 0) setShowDropdown(true);
                      }}
                      onChange={(e) => setUsernameOrEmail(e.target.value)}
                      placeholder="Type name, @username or email..."
                      className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 pl-9 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink-muted)] placeholder:[var(--ink-muted)] shadow-inset"
                    />
                    <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    {isSearching && (
                      <Loader2 className="w-3.5 h-3.5 text-[var(--ink)] absolute right-3 top-1/2 -translate-y-1/2 animate-spin pointer-events-none" />
                    )}
                  </div>

                  {/* Search Autocomplete Dropdown */}
                  {showDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-2xl popover-surface shadow-2xl max-h-56 overflow-y-auto divide-y divide-[var(--border)] border border-[var(--border)]">
                      {suggestions.length > 0 ? (
                        suggestions.map((u) => {
                          const isOwner = u.id === activeSnippet.ownerId;
                          const existingCollab = activeSnippet.collaborators.find(
                            (c) => c.userId === u.id
                          );

                          return (
                            <div
                              key={u.id}
                              onClick={() => !isOwner && handleSelectUser(u)}
                              className={`p-2.5 flex items-center justify-between gap-2 transition-colors ${
                                isOwner
                                  ? 'opacity-60 cursor-not-allowed bg-[var(--surface-raised)]/40'
                                  : 'hover:bg-[var(--surface-raised)] cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-6 h-6 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[10px] font-semibold text-[var(--ink)] shrink-0">
                                  {u.displayName.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-[var(--ink)] truncate">
                                    {u.displayName}
                                  </div>
                                  <div className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                                    @{u.username}
                                    {u.email ? ` · ${u.email}` : ''}
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-1.5">
                                {isOwner ? (
                                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] font-medium">
                                    Owner
                                  </span>
                                ) : existingCollab ? (
                                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)]">
                                    {existingCollab.role}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAdd(undefined, u.username);
                                    }}
                                    className="px-2.5 py-1 rounded-[10px] bg-[var(--ink)] text-[var(--ink-contrast)] text-[11px] font-medium shadow-raised cursor-pointer"
                                  >
                                    Add
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-3 text-center text-[var(--ink-muted)] text-xs">
                          {isSearching ? (
                            'Searching users...'
                          ) : (
                            <>No users found matching &ldquo;{usernameOrEmail}&rdquo;</>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <CustomSelect
                  value={role}
                  onChange={(val) => setRole(val as CollaboratorRole)}
                  options={ROLE_OPTIONS}
                  className="w-48 shrink-0"
                  aria-label="Select collaborator role"
                />

                <button
                  type="submit"
                  disabled={isSubmitting || !usernameOrEmail.trim()}
                  className="px-4 py-2 rounded-[14px] bg-[var(--ink)] text-[var(--ink-contrast)] disabled:opacity-50 font-semibold flex items-center gap-1.5 shadow-raised hover:opacity-90 transition-opacity shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Adding...' : 'Add'}</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-[var(--surface-raised)]/40 border border-[var(--border)] text-[var(--ink-muted)]">
              Only the snippet owner (@{activeSnippet.owner.username}) or an
              admin can modify collaborators.
            </div>
          )}

          {/* Collaborators List */}
          <div className="border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] bg-[var(--surface-raised)]/20 overflow-hidden shadow-inset">
            <div className="p-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-[var(--ink)]">
                  {activeSnippet.owner.displayName} (@{activeSnippet.owner.username})
                </div>
                <div className="text-[11px] text-[var(--ink-muted)]">Snippet Owner</div>
              </div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] font-medium">
                OWNER
              </span>
            </div>

            {activeSnippet.collaborators.map((collab) => (
              <div
                key={collab.id}
                className="p-3 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-medium text-[var(--ink)]">
                    {collab.displayName} (@{collab.username})
                  </div>
                  <div className="text-[11px] font-mono text-[var(--ink-muted)]">
                    {collab.email}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                      collab.role === 'editor'
                        ? 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink)] font-semibold'
                        : 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink-muted)]'
                    }`}
                  >
                    {collab.role}
                  </span>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        removeCollaborator(activeSnippet.id, collab.userId)
                      }
                      className="p-1 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
                      title="Remove Collaborator"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
