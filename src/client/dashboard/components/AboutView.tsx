import { OwnerUtilitiesSection } from './OwnerUtilitiesSection.js';
import { Accordion } from './ui/accordion';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';

interface AboutViewProps {
  appVersion: string;
  currentUsername?: string;
}

function AboutView({ appVersion, currentUsername }: AboutViewProps) {
  const isOwner = (currentUsername || '').toLowerCase() === 'seetigerlearn';

  return (
    <div className="about-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="app-icon-stylized"
        iconSize={64}
        title="About ModScope"
        subtitle="Advanced subreddit analytics for moderators"
        className="p-6 bg-transparent border-b border-border flex-shrink-0"
      />

      <div className="view-content flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <div className="card mb-6 !bg-background">
          <div className="flex divide-x divide-border">
            <div className="flex-1" style={{ padding: '1.5rem' }}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Version Information
              </h3>
              <p className="text-sm font-medium text-primary">
                ModScope v{appVersion}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Build: {new Date().toISOString().split('T')[0]}
              </p>
              <p className="text-xs text-muted-foreground">
                Phase: Final Testing/Initial Rollout
              </p>
              {isOwner && <OwnerUtilitiesSection />}
            </div>
            <div className="flex-1" style={{ padding: '1.5rem' }}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Support
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                For questions or issues, please contact the ModScope team. We
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
          </ul>
        </Accordion>
      </div>
    </div>
  );
}

export default AboutView;
