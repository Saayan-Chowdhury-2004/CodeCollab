import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Folder,
  Tag,
} from 'lucide-react';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { getLanguageColor } from '../../utils/format.ts';

export const SidebarFacetsTree: React.FC = () => {
  const { facets, filters, setFilters } = useSnippetStore();
  const [isLanguagesOpen, setIsLanguagesOpen] = useState(true);
  const [isTagsOpen, setIsTagsOpen] = useState(true);

  return (
    <div className="space-y-2 select-none text-xs">
      <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--ink-muted)] px-2">
        Documents & Categories
      </div>

      {/* Languages Folder */}
      <div>
        <button
          type="button"
          onClick={() => setIsLanguagesOpen((v) => !v)}
          className="w-full flex items-center justify-between py-1.5 px-2 rounded-[14px] text-[var(--ink)] hover:bg-[var(--surface-raised)]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {isLanguagesOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            )}
            <Folder className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            <span className="font-medium">Languages</span>
          </div>
        </button>

        {isLanguagesOpen && (
          <div className="ml-4 pl-2 border-l border-[var(--border)] space-y-1 mt-1">
            {facets.languages.map((l) => {
              const isSelected = filters.language === l.language;
              const langColor = getLanguageColor(l.language);

              return (
                <button
                  key={l.language}
                  type="button"
                  onClick={() =>
                    setFilters({ language: isSelected ? '' : l.language })
                  }
                  className={`w-full flex items-center justify-between py-1 px-2 rounded-[14px] transition-colors duration-150 ${isSelected
                      ? 'bg-[var(--surface-raised)] shadow-raised text-[var(--ink)] font-medium'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
                    }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: langColor }}
                    />
                    <span className="truncate">{l.language}</span>
                  </div>
                </button>
              );
            })}
            {facets.languages.length === 0 && (
              <div className="text-[11px] text-[var(--ink-muted)] py-1 px-2">No languages</div>
            )}
          </div>
        )}
      </div>

      {/* Tags Folder */}
      <div>
        <button
          type="button"
          onClick={() => setIsTagsOpen((v) => !v)}
          className="w-full flex items-center justify-between py-1.5 px-2 rounded-[14px] text-[var(--ink)] hover:bg-[var(--surface-raised)]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {isTagsOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            )}
            <Folder className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
            <span className="font-medium">Tags</span>
          </div>
        </button>

        {isTagsOpen && (
          <div className="ml-4 pl-2 border-l border-[var(--border)] space-y-1 mt-1">
            {facets.tags.map((t) => {
              const isSelected = filters.tag === t.name;

              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() =>
                    setFilters({ tag: isSelected ? '' : t.name })
                  }
                  className={`w-full flex items-center justify-between py-1 px-2 rounded-[14px] transition-colors duration-150 ${isSelected
                      ? 'bg-[var(--surface-raised)] shadow-raised text-[var(--ink)] font-medium'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
                    }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Tag className="w-3 h-3 text-[var(--ink-muted)] shrink-0" />
                    <span className="truncate">#{t.name}</span>
                  </div>
                </button>
              );
            })}
            {facets.tags.length === 0 && (
              <div className="text-[11px] text-[var(--ink-muted)] py-1 px-2">No tags</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

