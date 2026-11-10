import React, { useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiClientError } from '../../api/client.ts';
import { useAuthStore } from '../../store/authStore.ts';
import { GlobalRole, PaginatedResult, UserDTO } from '../../types/domain.ts';
import { CustomSelect } from '../ui/CustomSelect.tsx';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

export const AdminUsersView: React.FC = () => {
  const { user: currentUser, setUserDirect } = useAuthStore();

  const [users, setUsers] = useState<UserDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const loadUsers = async (opts = { append: false, searchQuery: query }) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '15' });
      if (opts.searchQuery.trim()) {
        params.set('q', opts.searchQuery.trim());
      }
      if (opts.append && nextCursor) {
        params.set('cursor', nextCursor);
      }

      const data = await apiFetch<PaginatedResult<UserDTO>>(
        `/api/users?${params.toString()}`
      );
      setUsers((prev) => (opts.append ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : 'Failed to load users';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers({ append: false, searchQuery: '' });
  }, []);

  const handleRoleChange = async (targetUser: UserDTO, newRole: GlobalRole) => {
    setUpdatingId(targetUser.id);
    setError(null);
    setStatusBanner(null);
    try {
      const res = await apiFetch<{ user: UserDTO }>(
        `/api/users/${targetUser.id}/role`,
        {
          method: 'PATCH',
          body: JSON.stringify({ globalRole: newRole }),
        }
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? res.user : u))
      );
      if (currentUser?.id === targetUser.id) {
        setUserDirect(res.user);
      }
      setStatusBanner(
        `Updated @${res.user.username}'s role to ${res.user.globalRole}.`
      );
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : 'Failed to update user role';
      setError(msg);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadUsers({ append: false, searchQuery: query });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header & Search */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <div className="flex items-center gap-2 text-[var(--accent-positive)] mb-1">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-xs uppercase tracking-wider font-semibold">Administration</span>
            </div>
            <h1 className="text-[30px] font-[300] tracking-tight text-[var(--ink)] leading-none">
              User Management
            </h1>
            <p className="text-xs text-[var(--ink-muted)] mt-1.5">
              Review platform members and assign global administrative roles.
            </p>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users..."
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-[14px] pl-8 pr-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-muted)] shadow-inset focus-ring-visible outline-none w-48 sm:w-60"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-xs font-medium text-[var(--ink)] transition-colors focus-ring-visible cursor-pointer"
            >
              Search
            </button>
            <button
              type="button"
              aria-label="Refresh user list"
              onClick={() => loadUsers({ append: false, searchQuery: query })}
              className="p-2 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus-ring-visible cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[var(--accent-positive)]' : ''}`}
              />
            </button>
          </form>
        </div>

        {error && (
          <div className="p-3.5 rounded-[16px] bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--ink)]">
            {error}
          </div>
        )}

        {statusBanner && (
          <div className="p-3.5 rounded-[16px] bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--ink)]">
            {statusBanner}
          </div>
        )}

        {/* Users Table */}
        <div className="frosted-surface rounded-[24px] border border-[var(--border-subtle)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/40 text-[11px] font-medium text-[var(--ink-muted)]">
                <tr>
                  <th className="py-3 px-5">User</th>
                  <th className="py-3 px-5">Email</th>
                  <th className="py-3 px-5">Global Role</th>
                  <th className="py-3 px-5">Created</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface-raised)]/30 transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-[var(--ink)]">
                        {u.displayName}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--ink-muted)]">
                        @{u.username}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs text-[var(--ink-muted)]">
                      {u.email}
                    </td>
                    <td className="py-3.5 px-5">
                      <span
                        className={`text-[11px] font-medium capitalize px-2.5 py-0.5 rounded-full border ${
                          u.globalRole === 'admin'
                            ? 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink)] font-semibold shadow-xs'
                            : u.globalRole === 'editor'
                            ? 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink)] font-medium'
                            : 'bg-[var(--surface-raised)] border-[var(--border-subtle)] text-[var(--ink-muted)]'
                        }`}
                      >
                        {u.globalRole}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 font-mono text-[11px] text-[var(--ink-muted)]">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-5 text-right flex justify-end">
                      <CustomSelect
                        disabled={updatingId === u.id}
                        value={u.globalRole}
                        onChange={(val) =>
                          handleRoleChange(u, val as GlobalRole)
                        }
                        options={ROLE_OPTIONS}
                        className="w-28 text-left"
                        aria-label={`Change role for ${u.username}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => loadUsers({ append: true, searchQuery: query })}
              className="px-5 py-2.5 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-xs font-medium text-[var(--ink)] transition-colors focus-ring-visible cursor-pointer"
            >
              Load more users
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
