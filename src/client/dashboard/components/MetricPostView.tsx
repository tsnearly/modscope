import React, { useEffect, useRef, useState } from 'react';
import { AnalyticsSnapshot } from '../../../shared/types/api.types';
import {
  MetricPostConfig,
  PostsByFlairSectionConfig,
  SectionConfig,
  SectionId,
  UserListSectionConfig,
} from '../../../shared/types/metricPost.types';
import { SidebarWidgetConfig } from '../../../shared/types/metricSidebar.types';
import { THEMES } from '../../../shared/types/settings.types';
import { MetricPostWidget } from './MetricPostRenderer';
import { renderFlairWithEmojis } from './ui/FlairBadge';
import { AccordionItem, AccordionRoot } from './ui/accordion';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { RadioGroup, RadioItem } from './ui/radio';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Switch } from './ui/switch';
import { TimePicker } from './ui/time-picker';

const SECTION_TITLE_CASE: Record<SectionId, string> = {
  TOP_CONTRIBUTORS: 'Top Contributors',
  TOP_INFLUENCERS: 'Top Influencers',
  PROJECTED_GROWTH: 'Projected Growth',
  MEMBER_GROWTH: 'Member Growth',
  POST_ACTIVITY: 'Post Activity',
  COMMENT_ACTIVITY: 'Comment Activity',
  POSTS_BY_FLAIR: 'Posts by Flair',
};

const SECTION_ICONS_MAP: Record<SectionId, string> = {
  TOP_INFLUENCERS: 'mono-attract.png',
  TOP_CONTRIBUTORS: 'mono-write.png',
  PROJECTED_GROWTH: 'mono-trend.png',
  MEMBER_GROWTH: 'mono-score.png',
  POST_ACTIVITY: 'mono-layers.png',
  COMMENT_ACTIVITY: 'mono-comments-alt.png',
  POSTS_BY_FLAIR: 'mono-tags.png',
};

const DAYS_OF_WEEK = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

export interface MetricPostViewProps {
  isReadOnly?: boolean;
}

export const MetricPostView: React.FC<MetricPostViewProps> = ({
  isReadOnly = false,
}) => {
  const [config, setConfig] = useState<MetricPostConfig | null>(null);
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [availableFlairs, setAvailableFlairs] = useState<string[]>([]);
  const [customFlairInput, setCustomFlairInput] = useState('');
  const [customEmojis, setCustomEmojis] = useState<Record<string, string>>({});
  const effectiveEmojis = React.useMemo(
    () => ({
      ...(snapshot as any)?.meta?.customEmojis,
      ...(snapshot as any)?.customEmojis,
      ...customEmojis,
    }),
    [snapshot, customEmojis]
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [statusInfo, setStatusInfo] = useState<{
    postId?: string;
    postUrl?: string;
    publishTimestamp?: number;
    approvingModUsername?: string;
  } | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  // ── Sidebar Sync State ──
  const [sidebarConfig, setSidebarConfig] = useState<SidebarWidgetConfig>({
    enabled: false,
    widgetTitle: 'r/{subreddit} · Community Pulse',
    showCommunityStats: true,
    showVelocitySummary: true,
    showTopContributors: true,
    contributorItemCount: 3,
    showTopInfluencer: true,
    influencerItemCount: 3,
    showPrimePostingTime: true,
    showSubscriberMilestone: true,
    refreshInterval: 'every6hours',
  });
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [expandedAccordions, setExpandedAccordions] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(
        'modscope:metricpost:expanded-accordions'
      );
      if (stored) return JSON.parse(stored);
    } catch {}
    return ['sidebar-sync'];
  });

  const handleAccordionChange = (items: string[]) => {
    setExpandedAccordions(items);
    try {
      localStorage.setItem(
        'modscope:metricpost:expanded-accordions',
        JSON.stringify(items)
      );
    } catch {}
  };

  const saveSidebarConfig = (newConfig: SidebarWidgetConfig) => {
    setSidebarConfig(newConfig);
    if (newConfig.enabled) {
      setExpandedAccordions((prev) =>
        prev.includes('sidebar-sync') ? prev : [...prev, 'sidebar-sync']
      );
    }
    if (isReadOnly) return;
    fetch('/api/metricpost/sidebar-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    }).catch((err) => console.error('Failed to save sidebar config', err));
  };

  const handlePreviewSidebar = async () => {
    setLoadingPreview(true);
    setPreviewText(null);
    setPreviewError(null);
    try {
      const res = await fetch('/api/metricpost/sidebar-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sidebarConfig,
          config,
          tzOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.previewText) {
        setPreviewText(data.previewText);
      } else {
        setPreviewError(
          data.message ||
            'No published Metric Post yet — publish one to preview sidebar content.'
        );
      }
    } catch (err: any) {
      setPreviewError(err.message || 'Error connecting to preview API.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const DEFAULT_METRIC_CONFIG: MetricPostConfig = {
    sections: [
      {
        sectionId: 'TOP_INFLUENCERS',
        enabled: true,
        displayOrder: 1,
        showCounts: true,
        itemCount: 5,
      },
      {
        sectionId: 'TOP_CONTRIBUTORS',
        enabled: true,
        displayOrder: 2,
        showCounts: true,
        itemCount: 5,
      },
      { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 3 },
      { sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 4 },
      { sectionId: 'POST_ACTIVITY', enabled: true, displayOrder: 5 },
      { sectionId: 'COMMENT_ACTIVITY', enabled: true, displayOrder: 6 },
      {
        sectionId: 'POSTS_BY_FLAIR',
        enabled: true,
        displayOrder: 7,
        selectedFlairs: [],
        showAsPercentage: false,
      },
    ],
    schedule: {
      enabled: true,
      frequency: 'weekly',
      intervalDays: 3,
      daysOfWeek: [1], // Monday
      dayOfMonth: 1,
      timeOfDay: '09:00',
      titleFormat: 'Community Metrics - {subreddit} - {date}',
      syncSidebarWidget: true,
    },
    activeTheme: 'upvoted',
  };

  useEffect(() => {
    // 1. Fetch Config
    fetch('/api/metricpost/config')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.sections) && data.schedule) {
          setConfig({
            ...DEFAULT_METRIC_CONFIG,
            ...data,
            schedule: {
              ...DEFAULT_METRIC_CONFIG.schedule,
              ...data.schedule,
              enabled:
                typeof data.schedule.enabled === 'boolean'
                  ? data.schedule.enabled
                  : true,
            },
          });
        } else {
          setConfig(DEFAULT_METRIC_CONFIG);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load metric post config', err);
        setConfig(DEFAULT_METRIC_CONFIG);
        setLoading(false);
      });

    // 2. Fetch Status
    fetch('/api/metricpost/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.published) {
          setStatusInfo(data.published);
        }
      })
      .catch(() => {});

    // 3. Fetch Flairs from actual subreddit
    fetch('/api/metricpost/flairs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.flairs && Array.isArray(data.flairs)) {
          setAvailableFlairs((prev) =>
            Array.from(new Set([...prev, ...data.flairs]))
          );
        }
        if (data?.customEmojis && Object.keys(data.customEmojis).length > 0) {
          setCustomEmojis((prev) => ({ ...prev, ...data.customEmojis }));
          setSnapshot((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              meta: {
                ...prev.meta,
                customEmojis: {
                  ...(prev.meta?.customEmojis || {}),
                  ...data.customEmojis,
                },
              },
            };
          });
        }
      })
      .catch(() => {});

    // 4. Fetch latest snapshot for preview and dynamic flair extraction
    fetch('/api/snapshots')
      .then((res) => res.json())
      .then(async (data) => {
        if (Array.isArray(data) && data.length > 0) {
          const scanId = data[0].scanId || (data[0] as any)?.meta?.scanId;
          if (scanId) {
            const snapRes = await fetch(`/api/snapshots/${scanId}`);
            if (snapRes.ok) {
              const snapJson = await snapRes.json();
              if (
                snapJson?.meta?.customEmojis &&
                Object.keys(snapJson.meta.customEmojis).length > 0
              ) {
                setCustomEmojis((prev) => ({
                  ...snapJson.meta.customEmojis,
                  ...prev,
                }));
              }
              setSnapshot((prev: any) => ({
                ...snapJson,
                meta: {
                  ...snapJson.meta,
                  customEmojis: {
                    ...(snapJson.meta?.customEmojis || {}),
                    ...(prev?.meta?.customEmojis || {}),
                  },
                },
              }));
            }
          }
        }
      })
      .catch(() => {});

    // 5. Fetch Sidebar Config
    fetch('/api/metricpost/sidebar-config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data === 'object') {
          setSidebarConfig((prev) => ({ ...prev, ...data }));
          if (data.enabled) {
            setExpandedAccordions((prev) =>
              prev.includes('sidebar-sync') ? prev : [...prev, 'sidebar-sync']
            );
          }
        }
      })
      .catch(() => {});
  }, []);

  // Dynamically extract flairs from snapshot data
  useEffect(() => {
    if (snapshot) {
      const snap = snapshot as any;
      if (
        snap.meta?.customEmojis &&
        Object.keys(snap.meta.customEmojis).length > 0
      ) {
        setCustomEmojis((prev) => ({
          ...snap.meta.customEmojis,
          ...prev,
        }));
      }
      const fromSnapshot = new Set<string>();
      if (snap.posts && Array.isArray(snap.posts)) {
        snap.posts.forEach((p: any) => {
          if (p.flair && p.flair !== 'none' && p.flair !== 'Unflaired') {
            fromSnapshot.add(p.flair);
          }
        });
      }
      if (snap.contentDna?.flairs) {
        Object.keys(snap.contentDna.flairs).forEach((f) => {
          if (f && f !== 'none' && f !== 'Unflaired') fromSnapshot.add(f);
        });
      }
      if (snap.trends?.flairDistributions) {
        snap.trends.flairDistributions.forEach((d: any) => {
          if (d.flairs) {
            Object.keys(d.flairs).forEach((f) => {
              if (f && f !== 'none' && f !== 'Unflaired') fromSnapshot.add(f);
            });
          }
        });
      }
      if (fromSnapshot.size > 0) {
        setAvailableFlairs((prev) =>
          Array.from(new Set([...prev, ...Array.from(fromSnapshot)]))
        );
      }
    }
  }, [snapshot]);

  const saveConfig = async (newConfig: MetricPostConfig) => {
    setConfig(newConfig);
    if (isReadOnly) return;
    try {
      await fetch('/api/metricpost/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
    } catch (err) {
      console.error('Failed to save metric post config', err);
    }
  };

  const updateSection = (
    sectionId: SectionId,
    updates: Partial<SectionConfig>
  ) => {
    if (!config) return;
    const newSections = config.sections.map((s) =>
      s.sectionId === sectionId ? ({ ...s, ...updates } as SectionConfig) : s
    );
    saveConfig({ ...config, sections: newSections });
  };

  const updateSchedule = (updates: Partial<MetricPostConfig['schedule']>) => {
    if (!config) return;
    saveConfig({ ...config, schedule: { ...config.schedule, ...updates } });
  };

  const toggleDayOfWeek = (day: number) => {
    if (!config) return;
    const current = config.schedule.daysOfWeek || [1];
    let next: number[];
    if (current.includes(day)) {
      next = current.filter((d) => d !== day);
      if (next.length === 0) next = [day]; // keep at least one
    } else {
      next = [...current, day].sort((a, b) => a - b);
    }
    updateSchedule({ daysOfWeek: next });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!config) return;
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (sourceIndex === targetIndex) return;

    const newSections = [...config.sections];
    const [movedItem] = newSections.splice(sourceIndex, 1);
    if (movedItem) {
      newSections.splice(targetIndex, 0, movedItem);
    }

    // Update display order
    newSections.forEach((s, idx) => {
      s.displayOrder = idx + 1;
    });
    saveConfig({ ...config, sections: newSections });
  };

  const handleAddCustomFlair = () => {
    const trimmed = customFlairInput.trim();
    if (!trimmed) return;
    if (!availableFlairs.includes(trimmed)) {
      setAvailableFlairs((prev) => [...prev, trimmed]);
    }
    const currentFlairs =
      (
        config?.sections.find(
          (s) => s.sectionId === 'POSTS_BY_FLAIR'
        ) as PostsByFlairSectionConfig
      )?.selectedFlairs || [];
    if (!currentFlairs.includes(trimmed)) {
      updateSection('POSTS_BY_FLAIR', {
        selectedFlairs: [...currentFlairs, trimmed],
      });
    }
    setCustomFlairInput('');
  };

  const handlePublishNow = async () => {
    if (isReadOnly || publishing) return;
    setPublishing(true);
    setPublishMessage(null);

    try {
      if (config) {
        await saveConfig(config);
      }

      const res = await fetch('/api/metricpost/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const now = data.publishTimestamp || Date.now();
        const assignedPostId = data.postId || data.redditPostId;
        const sub =
          snapshot?.meta?.subreddit && snapshot.meta.subreddit !== 'community'
            ? snapshot.meta.subreddit
            : 'modscope_dev';
        const bareId = assignedPostId ? assignedPostId.replace(/^t3_/, '') : '';
        const postUrl =
          data.postUrl ||
          (bareId ? `https://reddit.com/r/${sub}/comments/${bareId}` : undefined);

        setStatusInfo({
          postId: assignedPostId,
          postUrl,
          publishTimestamp: now,
          approvingModUsername: data.approvingModUsername || 'You',
        });
        setPublishMessage(
          postUrl
            ? `Successfully published post: ${postUrl}`
            : `Successfully published post ${assignedPostId}!`
        );

        // Refresh publication status from server
        fetch('/api/metricpost/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((statusData) => {
            if (statusData?.published) {
              setStatusInfo((prev) => ({
                ...prev,
                ...statusData.published,
                postUrl: statusData.published.postUrl || postUrl,
              }));
            }
          })
          .catch(() => {});
      } else {
        setPublishMessage(
          `Publish failed: ${data.reason || data.message || 'Unknown error'}`
        );
      }
    } catch (err: any) {
      setPublishMessage(`Publish error: ${err.message || String(err)}`);
    } finally {
      setPublishing(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading configuration...
      </div>
    );
  }

  const formattedLastPublished = statusInfo?.publishTimestamp
    ? new Date(statusInfo.publishTimestamp).toLocaleString()
    : 'Never';

  const currentFrequency = config.schedule.frequency || 'weekly';
  const isScheduleEnabled = config.schedule.enabled !== false;

  const isContributorsEnabled =
    config?.sections?.some(
      (s) => s.sectionId === 'TOP_CONTRIBUTORS' && s.enabled
    ) ?? true;
  const isInfluencersEnabled =
    config?.sections?.some(
      (s) => s.sectionId === 'TOP_INFLUENCERS' && s.enabled
    ) ?? true;
  const isMilestoneEnabled =
    config?.sections?.some(
      (s) =>
        (s.sectionId === 'PROJECTED_GROWTH' ||
          s.sectionId === 'MEMBER_GROWTH') &&
        s.enabled
    ) ?? true;

  return (
    <div className="metric-post-view h-full flex flex-col bg-[var(--color-bg)]">
      {/* ── Top Header matching Schedule View ── */}
      <EntityTitle
        icon="scheduler-tasks.png"
        title="Community Metric Post"
        subtitle="Configure automated recurring metric posts and community subscriber notifications"
        className="mb-1 sm:mb-2 p-2 sm:p-4 bg-transparent border-b border-border flex-shrink-0"
        actions={
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <Button
              variant={showPreview ? 'secondary' : 'outline'}
              onClick={() => {
                const nextState = !showPreview;
                setShowPreview(nextState);
                if (nextState) {
                  setTimeout(() => {
                    scrollContainerRef.current?.scrollTo({
                      top: 0,
                      behavior: 'smooth',
                    });
                  }, 50);
                }
              }}
              icon={showPreview ? 'lucide:eye-off' : 'lucide:eye'}
              className="text-xs h-7 sm:h-9 px-2 sm:px-3"
            >
              {showPreview ? 'Exit Preview' : 'Preview'}
            </Button>
            <Button
              variant="default"
              disabled={isReadOnly || publishing}
              loading={publishing}
              onClick={handlePublishNow}
              icon={publishing ? '' : 'lucide:send'}
              className="text-xs h-7 sm:h-9 px-2 sm:px-3"
              title={
                isReadOnly
                  ? 'Publishing is disabled in showcase mode'
                  : undefined
              }
            >
              Publish Now
            </Button>
          </div>
        }
      />

      {/* ── Scrollable Body Area ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-2 pb-2 pt-1 sm:px-6 sm:pb-6 sm:pt-2 space-y-4 sm:space-y-6 w-full"
      >
        {/* Publish Result Message */}
        {publishMessage && (
          <div
            className={`px-4 py-2.5 text-xs font-semibold rounded-lg border flex items-center justify-between gap-3 flex-shrink-0 ${
              publishMessage.startsWith('Successfully')
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
            }`}
          >
            <span className="truncate">{publishMessage}</span>
            {statusInfo?.postUrl && (
              <a
                href={statusInfo.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline flex-shrink-0 hover:opacity-80"
              >
                Open Post ↗
              </a>
            )}
          </div>
        )}

        {/* Live Widget Preview */}
        {showPreview && (
          <Card className="overflow-hidden shadow-md border-border bg-background flex-shrink-0">
            <CardHeader className="bg-muted/50 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Icon
                      name="mono-computer-data-analysis-chart.png"
                      size={20}
                    />
                    Live Widget Preview
                  </CardTitle>
                  <CardDescription>
                    Interactive preview using active theme (
                    {config.activeTheme || 'upvoted'}) and latest snapshot data
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowPreview(false)}
                >
                  Exit Preview
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 bg-muted/20 flex justify-center">
              {snapshot ? (
                <div className="w-full max-w-md shadow-lg rounded-2xl overflow-hidden border border-slate-200/80">
                  <MetricPostWidget
                    snapshot={snapshot}
                    config={config}
                    context="MOD_PANEL"
                    customEmojis={customEmojis}
                  />
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-xs">
                  No snapshot data available to render preview. Run an analysis
                  scan first from the Snapshots tab.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!showPreview && (
          <>
            {/* ── 0. COLOR THEME CONFIGURATION CARD ── */}
            <Card className="overflow-hidden shadow-md border-border bg-background">
              <CardHeader className="bg-muted/50 border-b border-border p-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="lucide:swatch-book" size={20} />
                  Color Theme
                </CardTitle>
                <CardDescription>
                  Select one of the standard ModScope color themes for the
                  published post widget
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                  Available Themes
                </Label>
                <RadioGroup
                  value={config.activeTheme || 'upvoted'}
                  onChange={(val) =>
                    saveConfig({ ...config, activeTheme: val })
                  }
                  variant="cards"
                  className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                >
                  {THEMES.map((theme) => {
                    const isDefault = theme.id === 'upvoted';
                    return (
                      <RadioItem
                        key={theme.id}
                        value={theme.id}
                        label={
                          <span className="flex items-center justify-between gap-1 w-full">
                            <span>{theme.label}</span>
                            {isDefault && (
                              <span className="text-[9px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                Default
                              </span>
                            )}
                          </span>
                        }
                        description={
                          isDefault
                            ? 'Reddit standard styling'
                            : `${theme.label} palette`
                        }
                      />
                    );
                  })}
                </RadioGroup>
              </CardContent>
            </Card>

            {/* ── 1. SECTION CONFIGURATION CARD ── */}
            <Card className="overflow-hidden shadow-md border-border bg-background">
              <CardHeader className="bg-muted/50 border-b border-border p-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="lucide:layout-dashboard" size={20} />
                  Section Configuration
                </CardTitle>
                <CardDescription>
                  Enable and drag to order sections displayed in the community
                  metric post
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 block flex items-center gap-2">
                  <span
                    className="w-1 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-secondary)' }}
                  />
                  Active Sections
                </Label>

                <div className="space-y-3">
                  {config.sections
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((section, index) => (
                      <div
                        key={section.sectionId}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDrop(e, index)}
                        className="flex flex-col border border-border rounded-lg p-3 bg-muted/20 hover:bg-muted/30 transition-colors cursor-move"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-muted-foreground text-xs select-none">
                              ⋮⋮
                            </div>
                            <Icon
                              name={
                                SECTION_ICONS_MAP[section.sectionId] ||
                                'mono-score.png'
                              }
                              size={16}
                              className="flex-shrink-0 opacity-80"
                            />
                            <span className="font-bold text-sm text-foreground">
                              {SECTION_TITLE_CASE[section.sectionId] ||
                                section.sectionId}
                            </span>
                          </div>
                          <Switch
                            checked={section.enabled}
                            onCheckedChange={(checked) =>
                              updateSection(section.sectionId, {
                                enabled: checked,
                              })
                            }
                          />
                        </div>

                        {/* Scrunched up inline parameters */}
                        {section.enabled &&
                          (section.sectionId === 'TOP_CONTRIBUTORS' ||
                            section.sectionId === 'TOP_INFLUENCERS') && (
                            <div className="mt-2.5 flex items-center gap-4 pl-7 pr-3 py-1.5 bg-muted/40 rounded-md border border-border/50 text-xs w-fit">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                                  Show top:
                                </span>
                                <Input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={
                                    (section as UserListSectionConfig)
                                      .itemCount || 5
                                  }
                                  onChange={(e) =>
                                    updateSection(section.sectionId, {
                                      itemCount:
                                        parseInt(e.target.value, 10) || 5,
                                    })
                                  }
                                  className="w-14 h-7 text-xs px-2"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                                  Show counts:
                                </span>
                                <Switch
                                  checked={
                                    (section as UserListSectionConfig)
                                      .showCounts ?? true
                                  }
                                  onCheckedChange={(checked) =>
                                    updateSection(section.sectionId, {
                                      showCounts: checked,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          )}

                        {section.enabled &&
                          section.sectionId === 'POSTS_BY_FLAIR' && (
                            <div className="mt-2.5 flex flex-col gap-2.5 pl-7 pr-3 py-2 bg-muted/40 rounded-md border border-border/50 text-xs">
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  Filter by Post Flairs (from Subreddit):
                                </span>
                                {availableFlairs.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground italic py-0.5">
                                    No flairs detected yet. Add custom flairs
                                    below.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {availableFlairs.map((f) => {
                                      const selected = (
                                        (section as PostsByFlairSectionConfig)
                                          .selectedFlairs || []
                                      ).includes(f);
                                      return (
                                        <button
                                          key={f}
                                          type="button"
                                          onClick={() => {
                                            const current =
                                              (
                                                section as PostsByFlairSectionConfig
                                              ).selectedFlairs || [];
                                            const next = selected
                                              ? current.filter((x) => x !== f)
                                              : [...current, f];
                                            updateSection(section.sectionId, {
                                              selectedFlairs: next,
                                            });
                                          }}
                                          className={`px-2.5 py-0.5 text-[11px] rounded-full border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                                            selected
                                              ? 'bg-primary text-primary-foreground border-primary font-medium'
                                              : 'bg-background text-muted-foreground border-border hover:bg-muted/60'
                                          }`}
                                        >
                                          <span className="inline-flex items-center leading-none">
                                            {renderFlairWithEmojis(
                                              f,
                                              effectiveEmojis,
                                              14
                                            )}
                                          </span>
                                          <span className="shrink-0 font-bold ml-0.5">
                                            {selected ? '✓' : '+'}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Custom flair add input */}
                                <div className="flex items-center gap-2 pt-1 max-w-sm">
                                  <Input
                                    placeholder="Add custom flair..."
                                    value={customFlairInput}
                                    onChange={(e) =>
                                      setCustomFlairInput(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddCustomFlair();
                                      }
                                    }}
                                    className="h-7 text-xs flex-1"
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="xs"
                                    onClick={handleAddCustomFlair}
                                    disabled={!customFlairInput.trim()}
                                    className="h-7 px-2.5 text-xs"
                                  >
                                    Add
                                  </Button>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  Show as percentage distribution:
                                </span>
                                <Switch
                                  checked={
                                    (section as PostsByFlairSectionConfig)
                                      .showAsPercentage ?? false
                                  }
                                  onCheckedChange={(checked) =>
                                    updateSection(section.sectionId, {
                                      showAsPercentage: checked,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          )}
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* ── 2. AUTOMATED RECURRENCE CONFIGURATION CARD ── */}
            <Card className="overflow-hidden shadow-md border-border bg-background">
              <CardHeader className="bg-muted/50 border-b border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Icon name="scheduler-configuration.png" size={20} />
                    Automated Recurrence Configuration
                  </CardTitle>
                  <CardDescription>
                    {isScheduleEnabled
                      ? 'Automated metric posts are active and scheduled according to the cadence below'
                      : 'Automated metric post schedule is turned off. No recurring posts will be published'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 self-start sm:self-center shrink-0">
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                      isScheduleEnabled
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}
                  >
                    {isScheduleEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    checked={isScheduleEnabled}
                    onCheckedChange={(checked) =>
                      updateSchedule({ enabled: checked })
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {!isScheduleEnabled && (
                  <div className="flex items-start gap-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-xs">
                    <Icon
                      name="mono-warn.png"
                      size={16}
                      className="shrink-0 mt-0.5"
                    />
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">
                        Automated schedule is currently paused
                      </p>
                      <p className="text-muted-foreground">
                        Recurring metric posts will not run automatically. You can toggle the switch above to re-activate this schedule at any time, or publish immediately on-demand using the <strong>Publish Now</strong> button in the header.
                      </p>
                    </div>
                  </div>
                )}

                <div
                  className={`space-y-5 transition-opacity ${
                    !isScheduleEnabled ? 'opacity-40 pointer-events-none' : ''
                  }`}
                >
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                    Publication Frequency Tier
                  </Label>

                {/* Frequency Tier Cards Grid with Unique Icons */}
                <RadioGroup
                  value={currentFrequency}
                  onChange={(val) => updateSchedule({ frequency: val })}
                  variant="cards"
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                >
                  <RadioItem
                    value="daily"
                    label="Daily Posts"
                    description="High-frequency publication updating metrics every day."
                    icon="scheduler-daily.png"
                  />
                  <RadioItem
                    value="every_n_days"
                    label="Every N Days"
                    description="Periodic publication repeating on a custom interval of days."
                    icon="scheduler-everynth.png"
                  />
                  <RadioItem
                    value="weekly"
                    label="Weekly Posts (Recommended)"
                    description="Weekly community digest posted on selected day(s)."
                    icon="scheduler-weekly.png"
                  />
                  <RadioItem
                    value="biweekly"
                    label="Bi-Weekly Posts"
                    description="Mid-month and month-end publication rhythm (1st & 15th)."
                    icon="scheduler-biweekly.png"
                  />
                  <RadioItem
                    value="monthly"
                    label="Monthly Posts"
                    description="Monthly summary published once per month on target day."
                    icon="scheduler-monthly.png"
                  />
                </RadioGroup>

                {/* Dynamic Detail Panel based on Selected Frequency */}
                <div className="p-4 bg-muted/20 rounded-xl border border-border/70 space-y-4">
                  {currentFrequency === 'every_n_days' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Interval in Days (N)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={config.schedule.intervalDays || 3}
                          onChange={(e) =>
                            updateSchedule({
                              intervalDays: Math.max(
                                1,
                                parseInt(e.target.value, 10) || 3
                              ),
                            })
                          }
                          className="w-24 h-9 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">
                          days between publications (e.g. every{' '}
                          {config.schedule.intervalDays || 3} days)
                        </span>
                      </div>
                    </div>
                  )}

                  {currentFrequency === 'weekly' && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-foreground">
                        Publish On Day(s) of Week
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {DAYS_OF_WEEK.map((d) => {
                          const selected = (
                            config.schedule.daysOfWeek || [1]
                          ).includes(d.day);
                          return (
                            <button
                              key={d.day}
                              type="button"
                              onClick={() => toggleDayOfWeek(d.day)}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                                selected
                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                  : 'bg-background text-muted-foreground border-border hover:bg-muted/60'
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {currentFrequency === 'biweekly' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Bi-Weekly Schedule Rhythm
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Automated publication will occur twice each month on the{' '}
                        <strong>1st</strong> and <strong>15th</strong> calendar
                        days.
                      </p>
                    </div>
                  )}

                  {currentFrequency === 'monthly' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Day of the Month (1–31)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={config.schedule.dayOfMonth || 1}
                          onChange={(e) =>
                            updateSchedule({
                              dayOfMonth: Math.min(
                                31,
                                Math.max(1, parseInt(e.target.value, 10) || 1)
                              ),
                            })
                          }
                          className="w-24 h-9 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">
                          day of each month (e.g. on the{' '}
                          {config.schedule.dayOfMonth || 1}st/th)
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/50">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Time of Day (Local)
                      </Label>
                      <TimePicker
                        value={config.schedule.timeOfDay || '09:00'}
                        onChange={(val) => updateSchedule({ timeOfDay: val })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Post Flair
                      </Label>
                      <Select
                        value={config.schedule.flairId || 'none'}
                        onValueChange={(val) =>
                          updateSchedule({ flairId: val === 'none' ? '' : val })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs w-full">
                          <SelectValue placeholder="Select flair (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {availableFlairs.map((f) => (
                            <SelectItem key={f} value={f}>
                              <span className="inline-flex items-center gap-1.5">
                                {renderFlairWithEmojis(f, effectiveEmojis, 14)}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border/50">
                    <Label className="text-xs font-semibold text-foreground">
                      Post Title Format
                    </Label>
                    <Input
                      value={config.schedule.titleFormat}
                      onChange={(e) =>
                        updateSchedule({ titleFormat: e.target.value })
                      }
                      placeholder="Community Metrics - {subreddit} - {date}"
                      className="h-9 text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Available tokens: {'{subreddit}, {date}, {period}'}
                    </p>
                  </div>
                </div>
                </div>
              </CardContent>
            </Card>

            {/* ── 2b. SIDEBAR SYNC CONFIGURATION ACCORDION ── */}
            <AccordionRoot
              expanded={expandedAccordions}
              onExpandedChange={handleAccordionChange}
              className="w-full"
              cardStyle={true}
            >
              <AccordionItem
                id="sidebar-sync"
                heading={
                  <div className="flex flex-col gap-0.5">
                    <div className="text-lg font-semibold flex items-center gap-2 text-foreground">
                      <Icon name="scheduler-configuration.png" size={20} />
                      Sidebar Sync
                    </div>
                    <p className="text-xs text-muted-foreground font-normal">
                      Configure automatic synchronization of metric summaries to
                      the subreddit right-column sidebar widget
                    </p>
                  </div>
                }
                className="shadow-md border-border bg-background"
              >
                <div className="space-y-6 pt-2">
                  {/* Master toggle */}
                  <div className="flex items-start justify-between p-4 bg-card rounded-xl border border-border">
                    <div className="space-y-1 pr-4">
                      <Label className="text-sm font-bold text-foreground block">
                        Sync to Subreddit Sidebar Widget
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Automatically updates a summary widget in the subreddit
                        sidebar
                      </p>
                      {sidebarConfig.enabled && statusInfo?.postId && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Widget will be created on next publish or within the
                          selected refresh interval.
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={sidebarConfig.enabled}
                      onCheckedChange={(checked) =>
                        saveSidebarConfig({
                          ...sidebarConfig,
                          enabled: checked,
                        })
                      }
                    />
                  </div>

                  {sidebarConfig.enabled && (
                    <div className="space-y-6 pt-2">
                      {/* Widget title input */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-foreground">
                            Widget title
                          </Label>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {sidebarConfig.widgetTitle.length}/50
                          </span>
                        </div>
                        <Input
                          maxLength={50}
                          value={sidebarConfig.widgetTitle}
                          onChange={(e) =>
                            saveSidebarConfig({
                              ...sidebarConfig,
                              widgetTitle: e.target.value,
                            })
                          }
                          placeholder="r/{subreddit} · Community Pulse"
                          className="h-9 text-xs"
                        />
                      </div>

                      {/* Content toggles */}
                      <div className="space-y-3">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block flex items-center gap-2">
                          <span
                            className="w-1 h-4 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: 'var(--color-secondary)',
                            }}
                          />
                          Content Sections
                        </Label>

                        {/* Community stats */}
                        <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-muted/30 transition-colors">
                          <span className="text-xs font-medium text-foreground">
                            Community stats (subscribers, posts/day,
                            comments/day, engagement)
                          </span>
                          <Switch
                            checked={sidebarConfig.showCommunityStats}
                            onCheckedChange={(checked) =>
                              saveSidebarConfig({
                                ...sidebarConfig,
                                showCommunityStats: checked,
                              })
                            }
                          />
                        </div>

                        {/* Community trend indicator */}
                        <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-muted/30 transition-colors">
                          <span className="text-xs font-medium text-foreground">
                            Community trend indicator
                          </span>
                          <Switch
                            checked={sidebarConfig.showVelocitySummary}
                            onCheckedChange={(checked) =>
                              saveSidebarConfig({
                                ...sidebarConfig,
                                showVelocitySummary: checked,
                              })
                            }
                          />
                        </div>

                        {/* Top contributors */}
                        <div className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-card">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span
                                className={`text-xs font-medium ${!isContributorsEnabled ? 'text-muted-foreground' : 'text-foreground'}`}
                              >
                                Top contributors
                              </span>
                              <span className="text-[11px] text-muted-foreground italic">
                                Requires Top Contributors section to be enabled
                                above
                              </span>
                            </div>
                            <Switch
                              disabled={!isContributorsEnabled}
                              checked={
                                isContributorsEnabled &&
                                sidebarConfig.showTopContributors
                              }
                              onCheckedChange={(checked) =>
                                saveSidebarConfig({
                                  ...sidebarConfig,
                                  showTopContributors: checked,
                                })
                              }
                            />
                          </div>
                          {isContributorsEnabled &&
                            sidebarConfig.showTopContributors && (
                              <div className="flex items-center justify-between pt-1.5 border-t border-border/40 w-full">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                                    Show top:
                                  </span>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={
                                      sidebarConfig.contributorItemCount || 3
                                    }
                                    onChange={(e) =>
                                      saveSidebarConfig({
                                        ...sidebarConfig,
                                        contributorItemCount: Math.min(
                                          5,
                                          Math.max(
                                            1,
                                            parseInt(e.target.value, 10) || 3
                                          )
                                        ),
                                      })
                                    }
                                    className="w-14 h-6 text-xs px-2"
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  (1–5, default 3)
                                </span>
                              </div>
                            )}
                        </div>

                        {/* Top influencers */}
                        <div className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-card">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span
                                className={`text-xs font-medium ${!isInfluencersEnabled ? 'text-muted-foreground' : 'text-foreground'}`}
                              >
                                Top influencers
                              </span>
                              <span className="text-[11px] text-muted-foreground italic">
                                Requires Top Influencers section to be enabled
                                above
                              </span>
                            </div>
                            <Switch
                              disabled={!isInfluencersEnabled}
                              checked={
                                isInfluencersEnabled &&
                                sidebarConfig.showTopInfluencer
                              }
                              onCheckedChange={(checked) =>
                                saveSidebarConfig({
                                  ...sidebarConfig,
                                  showTopInfluencer: checked,
                                })
                              }
                            />
                          </div>
                          {isInfluencersEnabled &&
                            sidebarConfig.showTopInfluencer && (
                              <div className="flex items-center justify-between pt-1.5 border-t border-border/40 w-full">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                                    Show top:
                                  </span>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={
                                      sidebarConfig.influencerItemCount || 3
                                    }
                                    onChange={(e) =>
                                      saveSidebarConfig({
                                        ...sidebarConfig,
                                        influencerItemCount: Math.min(
                                          5,
                                          Math.max(
                                            1,
                                            parseInt(e.target.value, 10) || 3
                                          )
                                        ),
                                      })
                                    }
                                    className="w-14 h-6 text-xs px-2"
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  (1–5, default 3)
                                </span>
                              </div>
                            )}
                        </div>

                        {/* Best posting time */}
                        <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground">
                              Best posting time
                            </span>
                            <span className="text-[11px] text-muted-foreground italic">
                              Requires Prime Posting Times section to be enabled
                              above
                            </span>
                          </div>
                          <Switch
                            checked={sidebarConfig.showPrimePostingTime}
                            onCheckedChange={(checked) =>
                              saveSidebarConfig({
                                ...sidebarConfig,
                                showPrimePostingTime: checked,
                              })
                            }
                          />
                        </div>

                        {/* Subscriber milestone */}
                        <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex flex-col">
                            <span
                              className={`text-xs font-medium ${!isMilestoneEnabled ? 'text-muted-foreground' : 'text-foreground'}`}
                            >
                              Subscriber milestone
                            </span>
                            <span className="text-[11px] text-muted-foreground italic">
                              Requires Subscriber Milestone section to be
                              enabled above
                            </span>
                          </div>
                          <Switch
                            disabled={!isMilestoneEnabled}
                            checked={
                              isMilestoneEnabled &&
                              sidebarConfig.showSubscriberMilestone
                            }
                            onCheckedChange={(checked) =>
                              saveSidebarConfig({
                                ...sidebarConfig,
                                showSubscriberMilestone: checked,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* Refresh interval selector */}
                      <div className="space-y-2 pt-2 border-t border-border/50">
                        <Label className="text-xs font-semibold text-foreground block">
                          Subscriber count refresh between posts
                        </Label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { id: 'off', label: 'Off' },
                            { id: 'hourly', label: 'Hourly' },
                            { id: 'every6hours', label: 'Every 6 hours' },
                            { id: 'daily', label: 'Daily' },
                          ].map((opt) => {
                            const selected =
                              sidebarConfig.refreshInterval === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() =>
                                  saveSidebarConfig({
                                    ...sidebarConfig,
                                    refreshInterval: opt.id as any,
                                  })
                                }
                                className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                                  selected
                                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                    : 'bg-card text-muted-foreground border-border hover:bg-muted/50'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Updates subscriber count and trend indicator only.
                          Full content updates only on new Metric Post publish.
                        </p>
                      </div>

                      {/* Preview Button & Monospace Panel */}
                      <div className="space-y-3 pt-3 border-t border-border/50">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingPreview}
                          onClick={handlePreviewSidebar}
                          icon="lucide:eye"
                        >
                          {loadingPreview
                            ? 'Loading preview...'
                            : 'Preview sidebar content'}
                        </Button>

                        {previewError && (
                          <p className="text-xs text-destructive italic">
                            {previewError}
                          </p>
                        )}

                        {previewText && (
                          <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-muted-foreground block">
                              Sidebar Widget Output Preview:
                            </Label>
                            <pre className="font-mono text-xs p-4 bg-muted/60 text-foreground rounded-lg whitespace-pre-wrap border border-border">
                              {previewText}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </AccordionItem>
            </AccordionRoot>

            {/* ── 3. PUBLICATION STATUS CARD ── */}
            <Card className="overflow-hidden shadow-md border-border bg-background">
              <CardHeader className="bg-muted/50 border-b border-border p-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="scheduler-jobhistory.png" size={20} />
                  Publication Status
                </CardTitle>
                <CardDescription>
                  Audit details for the latest automated or manual post
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3.5 bg-muted/20 rounded-lg border border-border/60">
                    <span className="text-muted-foreground block text-[11px]">
                      Last published:
                    </span>
                    <strong className="text-foreground block mt-1 font-semibold text-sm">
                      {formattedLastPublished}
                    </strong>
                    {statusInfo?.postId && (
                      <span className="text-[10px] text-muted-foreground font-mono block truncate mt-0.5">
                        ID: {statusInfo.postId}
                      </span>
                    )}
                    {statusInfo?.postUrl && (
                      <a
                        href={statusInfo.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1 mt-1 truncate"
                      >
                        View Post ↗
                      </a>
                    )}
                  </div>
                  <div className="p-3.5 bg-muted/20 rounded-lg border border-border/60">
                    <span className="text-muted-foreground block text-[11px]">
                      Recurrence cadence:
                    </span>
                    <strong className="text-foreground capitalize block mt-1 font-semibold text-sm">
                      {!isScheduleEnabled ? (
                        <span className="text-amber-500 font-medium">
                          Disabled
                        </span>
                      ) : (
                        `${config.schedule.frequency.replace(/_/g, ' ')} at ${config.schedule.timeOfDay || '09:00'}`
                      )}
                    </strong>
                  </div>
                  <div className="p-3.5 bg-muted/20 rounded-lg border border-border/60">
                    <span className="text-muted-foreground block text-[11px]">
                      Approving moderator:
                    </span>
                    <strong className="text-foreground block mt-1 font-semibold text-sm">
                      {statusInfo?.approvingModUsername || 'None'}
                    </strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default MetricPostView;
