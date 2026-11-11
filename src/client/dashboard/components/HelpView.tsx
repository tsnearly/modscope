import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';

export function HelpView() {
  return (
    <div className="help-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="lucide:help-circle"
        iconSize={24}
        title="Help"
        subtitle="Documentation, guides, and assistance"
        className="p-3 sm:p-6 bg-transparent border-b border-border flex-shrink-0"
      />

      <div className="view-content flex-1 overflow-y-auto px-2 pb-2 pt-4 sm:px-6 sm:pb-6 sm:pt-8 flex items-center justify-center">
        <div className="max-w-md w-full text-center p-4 sm:p-8 rounded-2xl border border-border bg-[var(--color-card,var(--color-bg))] shadow-sm space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
            <Icon name="lucide:help-circle" size={28} />
          </div>

          <div className="space-y-1.5">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
              Coming Soon
            </span>
            <h3 className="text-lg font-bold text-[var(--color-text)]">
              Help Center &amp; Documentation
            </h3>
          </div>

          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            Detailed guides, video walkthroughs, and analytics interpretation tutorials are currently in preparation and will be available in an upcoming release.
          </p>
        </div>
      </div>
    </div>
  );
}
