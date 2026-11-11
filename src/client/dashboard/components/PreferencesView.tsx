import { THEMES } from '../../../shared/types/settings.types';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { cn } from '../utils/cn';
import { EntityTitle } from './ui/entity-title';
import { Section, SectionCard } from './ui/section';

const THEME_COLORS: Record<string, string> = {
  modscopeflow: '#708877',
  clockwork: '#e56515',
  frozenmist: '#7ba3c0',
  amber: '#26788e',
  nocturne: '#607274',
  springtime: '#a1c181',
  rosemeadow: '#b86b77',
  upvoted: '#ff4500',
};

const THEME_DESCRIPTIONS: Record<string, string> = {
  modscopeflow: 'Balanced sage green with gentle forest accents',
  clockwork: 'Vibrant high-contrast warm orange and bronze',
  frozenmist: 'Cool arctic blues with crisp slate undertones',
  amber: 'Deep ocean cyan with warm amber highlights',
  nocturne: 'Sophisticated charcoal with muted dark elegance',
  springtime: 'Fresh botanical green with lively contrasts',
  rosemeadow: 'Subtle blush rose with earthy neutrals',
  upvoted: 'Classic Reddit orangered with modern vibrancy',
};

export interface PreferencesViewProps {
  isReadOnly?: boolean;
}

export function PreferencesView({ isReadOnly }: PreferencesViewProps = {}) {
  const { theme, changeTheme } = useTheme();

  const handleSelectTheme = (themeId: string) => {
    changeTheme(themeId as Theme);
    if (!isReadOnly) {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display: { theme: themeId } }),
      }).catch(() => {});
    }
  };

  return (
    <div className="preferences-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="lucide:sliders"
        iconSize={24}
        title="Preferences"
        subtitle="Manage your personal display settings and appearance"
        className="p-3 sm:p-6 bg-transparent border-b border-border flex-shrink-0"
      />

      <div className="view-content flex-1 overflow-y-auto px-2 pb-2 pt-2 sm:px-6 sm:pb-6 sm:pt-4 space-y-4 sm:space-y-6">
        <Section
          title="Theme"
          subtitle="Choose the color palette for your ModScope workspace"
          icon="lucide:swatch-book"
        >
          <SectionCard>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              {THEMES.map((t) => {
                const isSelected = theme === t.id;
                const swatchColor = THEME_COLORS[t.id] || '#64748b';
                const description = THEME_DESCRIPTIONS[t.id];

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectTheme(t.id)}
                    className={cn(
                      'group relative flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer select-none',
                      'hover:shadow-md hover:border-border/80',
                      isSelected
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8 ring-1 ring-[var(--color-primary)]'
                        : 'border-border/60 bg-[var(--color-card,var(--color-bg))] hover:bg-zinc-500/5'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className="w-5 h-5 rounded-full border border-white/20 shadow-xs shrink-0"
                        style={{ backgroundColor: swatchColor }}
                      />
                      {isSelected && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-primary)] text-white">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {t.label}
                    </div>
                    {description && (
                      <div className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2 leading-snug">
                        {description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </Section>
      </div>
    </div>
  );
}
