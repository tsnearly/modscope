import { getTodayIsoDate } from '../../../shared/utils/dateUtils';
import { OwnerUtilitiesSection } from './OwnerUtilitiesSection.js';
import { Accordion } from './ui/accordion';
import { Button } from './ui/button';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';

interface AboutViewProps {
  appVersion: string;
  currentUsername?: string | undefined;
  onOpenUpgradeModal?: (() => void) | undefined;
  onRefreshSnapshots?: (() => Promise<void> | void) | undefined;
}

function AboutView({
  appVersion,
  currentUsername,
  onOpenUpgradeModal,
  onRefreshSnapshots,
}: AboutViewProps) {
  const isOwner = (currentUsername || '').toLowerCase() === 'seetigerlearn';

  return (
    <div className="about-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="app-icon-stylized"
        iconSize={48}
        title="About ModScope"
        subtitle="Advanced subreddit analytics for moderators"
        className="p-3 sm:p-6 bg-transparent border-b border-border flex-shrink-0"
      />

      <div className="view-content flex-1 overflow-y-auto px-2 pb-2 pt-1 sm:px-6 sm:pb-6 sm:pt-2">
        {/* Version & Support Card */}
        <div className="card mb-4 sm:mb-6 !bg-background border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="flex-1 p-3 sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Version Information
              </h3>
              <p className="text-sm font-medium text-primary">
                ModScope v{appVersion}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Build: {getTodayIsoDate()}
              </p>
              <p className="text-xs text-muted-foreground">
                Phase: Massive data overhaul, metric widget, side stats sync
              </p>
              {onOpenUpgradeModal && (
                <div className="mt-4 pt-3 border-t border-border">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onOpenUpgradeModal}
                    className="text-xs flex items-center gap-1.5"
                  >
                    <Icon name="lucide:database" size={14} />
                    <span>Storage Schema &amp; Upgrades</span>
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 p-3 sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Support
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                For questions or issues, please contact the ModScope team in r/ModScope. We
                aim to respond to all inquiries within 24 hours.
              </p>
            </div>
          </div>
        </div>

        <Accordion title="What is ModScope?">
          <p className="card-body">
            ModScope is a comprehensive analytics tool designed to help Reddit
            moderators understand their community's engagement patterns, content
            trends, and user behavior.
          </p>
        </Accordion>

        <Accordion title="Features">
          <ul className="card-list">
            <li className="card-list-item flex items-center gap-2">
              <Icon name="mono-score.png" size={16} className="flex-shrink-0" />{' '}
              Comprehensive engagement scoring
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon name="mono-write.png" size={16} className="flex-shrink-0" />{' '}
              User activity analysis (Contributors &amp; Influencers)
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-layers.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Content DNA breakdown
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-planner.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Optimal posting time recommendations
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-week-view.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Activity heatmaps
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon name="mono-tags.png" size={16} className="flex-shrink-0" />{' '}
              Keyword and flair analysis
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-ratings.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Historical trend tracking
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-analysis-chart.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Advanced data visualizations
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-set-up.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Modular report configuration with customizable data visualizations
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-mail-by-timer.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Automated report delivery to multiple recipients via PM &amp;
              ModMail
            </li>
            <li className="card-list-item flex items-center gap-2">
              <Icon
                name="mono-loudspeaker.png"
                size={16}
                className="flex-shrink-0"
              />{' '}
              Automated user-forward metric post publishing &amp; subscriber
              notifications
            </li>
          </ul>
        </Accordion>

        {isOwner && (
          <Accordion title="Owner Utilities">
            <div className="card-body px-0 py-2">
              <OwnerUtilitiesSection
                currentUsername={currentUsername}
                onImportSuccess={onRefreshSnapshots}
              />
            </div>
          </Accordion>
        )}
      </div>
    </div>
  );
}

export default AboutView;
