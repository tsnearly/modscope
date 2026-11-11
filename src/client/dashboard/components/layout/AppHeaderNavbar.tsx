import * as React from 'react';
import { Icon } from '../ui/icon';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Tooltip } from '../ui/tooltip';
import { cn } from '../../utils/cn';
import type { View } from './AppSidebar';


export type ReportTab =
  'overview' | 'timing' | 'posts' | 'users' | 'content' | 'activity' | 'trends';

export type ScheduleTab = 'config' | 'jobs' | 'history';

export type ConfigTab = 'profile' | 'visualization' | 'dictionary';

export type HelpTab = 'help' | 'about';

export interface AppHeaderNavbarProps {
  activeView: View;
  activeReportTab?: ReportTab | undefined;
  onReportTabChange?:
    ((tab: ReportTab, e?: React.MouseEvent) => void) | undefined;
  reportTabs?: Array<{ tab: ReportTab; label: string }> | undefined;
  activeScheduleTab?: ScheduleTab | undefined;
  onScheduleTabChange?:
    ((tab: ScheduleTab, e?: React.MouseEvent) => void) | undefined;
  scheduleTabs?:
    Array<{ tab: ScheduleTab; label: string; icon?: string }> | undefined;
  activeConfigTab?: ConfigTab | undefined;
  onConfigTabChange?:
    ((tab: ConfigTab, e?: React.MouseEvent) => void) | undefined;
  configTabs?:
    Array<{ tab: ConfigTab; label: string; icon?: string }> | undefined;
  activeHelpTab?: HelpTab | undefined;
  onHelpTabChange?:
    ((tab: HelpTab, e?: React.MouseEvent) => void) | undefined;
  helpTabs?:
    Array<{ tab: HelpTab; label: string; icon?: string }> | undefined;
  isInlineConstrained?: boolean | undefined;
  excludeOfficial?: boolean | undefined;
  onToggleExcludeOfficial?: ((checked: boolean) => void) | undefined;
  onPrint?: (() => void) | undefined;
  webViewMode?: string | undefined;
  onRequestFullscreen?: ((e: React.MouseEvent) => void) | undefined;
  onToggleMobileSidebar?: (() => void) | undefined;
  subreddit?: string | undefined;
  scanDateFormatted?: string | undefined;
  isReadOnly?: boolean | undefined;
  onOpenShowcaseModal?: (() => void) | undefined;
}

export const AppHeaderNavbar: React.FC<AppHeaderNavbarProps> = ({
  activeView,
  activeReportTab,
  onReportTabChange,
  reportTabs,
  activeScheduleTab,
  onScheduleTabChange,
  scheduleTabs,
  activeConfigTab,
  onConfigTabChange,
  configTabs,
  activeHelpTab,
  onHelpTabChange,
  helpTabs,
  isInlineConstrained,
  excludeOfficial,
  onToggleExcludeOfficial,
  onPrint,
  webViewMode,
  onRequestFullscreen,
  onToggleMobileSidebar,
  subreddit,
  scanDateFormatted,
  isReadOnly,
  onOpenShowcaseModal,
}) => {
  const isInline = webViewMode !== 'expanded';
  const showReportTabs =
    activeView === 'report' && reportTabs && reportTabs.length > 0;
  const showScheduleTabs =
    activeView === 'schedule' && scheduleTabs && scheduleTabs.length > 0;
  const showConfigTabs =
    activeView === 'config' && configTabs && configTabs.length > 0;
  const showHelpTabs =
    (activeView === 'help' || activeView === 'about') &&
    helpTabs &&
    helpTabs.length > 0;

  return (
    <header className="flex-shrink-0 bg-[var(--color-bg)] z-20">
      {/* ── Top Bar with Mobile Toggle, View Title & Global Actions ── */}
      <div className="flex items-center justify-between px-3 gap-2 h-[52px] border-b border-border/60">
        {/* Left: View Title & Subreddit Context Breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          {onToggleMobileSidebar && (
            <button
              type="button"
              onClick={onToggleMobileSidebar}
              className="flex sm:hidden p-1.5 rounded-md border border-border text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent)] items-center justify-center shrink-0 cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              <Icon name="lucide:menu" size={16} />
            </button>
          )}

          <div className="flex items-center gap-1.5 text-xs font-semibold truncate">
            <span className="text-[var(--color-primary)] font-bold capitalize">
              {activeView === 'metric'
                ? 'Metric Post'
                : activeView === 'delivery'
                  ? 'Delivery Schedules'
                  : activeView === 'config'
                    ? 'Configuration'
                    : activeView === 'about'
                      ? 'About ModScope'
                      : activeView === 'help'
                        ? 'Help Center'
                        : activeView}
            </span>
            {scanDateFormatted && activeView === 'report' && (
              <>
                <span className="text-[var(--color-text-muted)] opacity-40 hidden sm:inline">
                  •
                </span>
                <span className="text-[var(--color-text-muted)] text-[11px] font-normal hidden sm:inline">
                  {scanDateFormatted}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: Actions Container */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {activeView === 'report' && onToggleExcludeOfficial && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] font-medium">
              <span className="hidden md:inline text-[11px]">
                Exclude Official
              </span>
              <Checkbox
                checked={!!excludeOfficial}
                onCheckedChange={(checked) =>
                  onToggleExcludeOfficial(checked as boolean)
                }
              />
            </div>
          )}

          {activeView === 'report' && onPrint && (
            <Tooltip content="Export / Print HTML Report" side="bottom">
              <Button
                size="sm"
                variant="outline"
                onClick={onPrint}
                icon="mono-html"
                iconSize={16}
                className="h-7 px-2 text-xs"
              >
                <span className="hidden sm:inline">Export</span>
              </Button>
            </Tooltip>
          )}

          {isReadOnly && (
            <Tooltip content="ModScope is in interactive showcase mode on this subreddit. Click to view showcase details." side="bottom">
              <button
                type="button"
                onClick={onOpenShowcaseModal}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer hover:bg-emerald-500/20 transition-all flex-shrink-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Showcase Mode</span>
              </button>
            </Tooltip>
          )}

          {isInline && onRequestFullscreen && (
            <Tooltip content="Open Full Screen" side="bottom">
              <Button
                size="sm"
                variant="outline"
                square
                onClick={onRequestFullscreen}
                className="h-7 w-7 p-0"
                aria-label="Open full screen"
              >
                <Icon
                  name="x-full-screen.png"
                  alt="Open full screen"
                  className="opacity-70"
                  size={16}
                />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Scrollable Navbar for Sub-Tabs ── */}
      {showReportTabs && (
        <nav
          role="tablist"
          aria-label="Report Subsections"
          className="border-b border-border/60 bg-[var(--color-accent,rgba(0,0,0,0.02))] px-2 py-1 flex items-center overflow-x-auto no-scrollbar gap-1 scroll-smooth"
        >
          {reportTabs.map((t) => {
            const isActive = activeReportTab === t.tab;
            const opensFullscreen =
              (isInline || isInlineConstrained) && t.tab !== 'overview';

            const tabButton = (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={(e) => onReportTabChange?.(t.tab, e)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1 flex-shrink-0 cursor-pointer',
                  isActive
                    ? 'bg-[var(--tab-active-bg,var(--color-primary))] text-[var(--tab-active-text,#ffffff)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card,rgba(0,0,0,0.05))]'
                )}
              >
                <span>{t.label}</span>
                {opensFullscreen && (
                  <span
                    className="opacity-60 text-[10px] ml-0.5"
                    aria-hidden="true"
                  >
                    ↗
                  </span>
                )}
              </button>
            );

            if (opensFullscreen) {
              return (
                <Tooltip key={t.tab} content="Open Full Screen" side="bottom">
                  {tabButton}
                </Tooltip>
              );
            }

            return tabButton;
          })}
        </nav>
      )}

      {/* ── Scrollable Navbar for Schedule Sub-Tabs ── */}
      {showScheduleTabs && (
        <nav
          role="tablist"
          aria-label="Schedule Subsections"
          className="border-b border-border/60 bg-[var(--color-accent,rgba(0,0,0,0.02))] px-2 py-1 flex items-center overflow-x-auto no-scrollbar gap-1 scroll-smooth"
        >
          {scheduleTabs.map((t) => {
            const isActive = activeScheduleTab === t.tab;

            return (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={(e) => onScheduleTabChange?.(t.tab, e)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 cursor-pointer',
                  isActive
                    ? 'bg-[var(--tab-active-bg,var(--color-primary))] text-[var(--tab-active-text,#ffffff)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card,rgba(0,0,0,0.05))]'
                )}
              >
                {t.icon && <Icon name={t.icon} size={14} />}
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Scrollable Navbar for Config Sub-Tabs ── */}
      {showConfigTabs && (
        <nav
          role="tablist"
          aria-label="Configuration Subsections"
          className="border-b border-border/60 bg-[var(--color-accent,rgba(0,0,0,0.02))] px-2 py-1 flex items-center overflow-x-auto no-scrollbar gap-1 scroll-smooth"
        >
          {configTabs.map((t) => {
            const isActive = activeConfigTab === t.tab;

            return (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={(e) => onConfigTabChange?.(t.tab, e)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 cursor-pointer',
                  isActive
                    ? 'bg-[var(--tab-active-bg,var(--color-primary))] text-[var(--tab-active-text,#ffffff)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card,rgba(0,0,0,0.05))]'
                )}
              >
                {t.icon && <Icon name={t.icon} size={14} />}
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Scrollable Navbar for Help Sub-Tabs ── */}
      {showHelpTabs && (
        <nav
          role="tablist"
          aria-label="Help Subsections"
          className="border-b border-border/60 bg-[var(--color-accent,rgba(0,0,0,0.02))] px-2 py-1 flex items-center overflow-x-auto no-scrollbar gap-1 scroll-smooth"
        >
          {helpTabs.map((t) => {
            const isActive =
              (activeHelpTab || (activeView === 'about' ? 'about' : 'help')) ===
              t.tab;

            return (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={(e) => onHelpTabChange?.(t.tab, e)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 cursor-pointer',
                  isActive
                    ? 'bg-[var(--tab-active-bg,var(--color-primary))] text-[var(--tab-active-text,#ffffff)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card,rgba(0,0,0,0.05))]'
                )}
              >
                {t.icon && <Icon name={t.icon} size={14} />}
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
};
