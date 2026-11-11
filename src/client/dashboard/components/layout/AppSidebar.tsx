import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { MODSCOPE_SUPPORT_URL } from '../../../../shared/core/constants';
import { THEMES, type ThemeId } from '../../../../shared/types/settings.types';
import { useTheme, type Theme } from '../../../hooks/useTheme';
import { cn } from '../../utils/cn';
import { getIconPath } from '../../utils/iconMappings';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Sidebar } from '../ui/sidebar';

export type View =
  | 'report'
  | 'snapshots'
  | 'config'
  | 'schedule'
  | 'about'
  | 'metric'
  | 'delivery'
  | 'preferences'
  | 'help';

export interface AppSidebarProps {
  activeView: View;
  onViewChange: (view: View, e?: React.MouseEvent) => void;
  reportDataAvailable: boolean;
  currentUsername: string;
  currentUserAvatar?: string | undefined;
  appVersion: string;
  subreddit: string;
  layoutMode: 'sidebar' | 'classic';
  onToggleLayoutMode: () => void;
  webViewMode?: string | undefined;
  onRequestFullscreen?: ((e: React.MouseEvent) => void) | undefined;
  onOpenUpgradeModal?: (() => void) | undefined;
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
}

const THEME_COLORS: Record<ThemeId, string> = {
  modscopeflow: '#708877',
  clockwork: '#e56515',
  frozenmist: '#7ba3c0',
  amber: '#26788e',
  nocturne: '#979797',
  springtime: '#0b735f',
  rosemeadow: '#81142c',
  upvoted: '#ff4650',
};

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeView,
  onViewChange,
  reportDataAvailable,
  currentUsername,
  currentUserAvatar,
  appVersion: _appVersion,
  subreddit,
  layoutMode,
  onToggleLayoutMode,
  webViewMode: _webViewMode,
  onRequestFullscreen: _onRequestFullscreen,
  onOpenUpgradeModal,
  mobileOpen,
  onMobileOpenChange,
}) => {
  const { theme, changeTheme } = useTheme();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUserMenuOpen]);

  const primaryNavItems: Array<{
    view: View;
    label: string;
    icon: string;
    disabled?: boolean;
    badge?: string | number;
  }> = [
    {
      view: 'report',
      label: 'Report View',
      icon: 'lucide:layout-dashboard',
      disabled: !reportDataAvailable,
    },
    {
      view: 'snapshots',
      label: 'Snapshots',
      icon: 'lucide:database',
      disabled: false,
    },
    {
      view: 'config',
      label: 'Configuration',
      icon: 'lucide:settings',
      disabled: false,
    },
    {
      view: 'schedule',
      label: 'Job Scheduler',
      icon: 'lucide:calendar',
      disabled: false,
    },
    {
      view: 'metric',
      label: 'Metric Post',
      icon: 'lucide:bar-chart-2',
      disabled: false,
    },
    {
      view: 'delivery',
      label: 'Report Delivery',
      icon: 'lucide:send',
      disabled: false,
    },
  ];

  const secondaryNavItems: Array<{
    view: View;
    label: string;
    icon: string;
    disabled?: boolean;
  }> = [
    {
      view: 'preferences',
      label: 'Preferences',
      icon: 'lucide:sliders',
      disabled: false,
    },
    {
      view: 'help',
      label: 'Help',
      icon: 'lucide:help-circle',
      disabled: false,
    },
  ];

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs sm:hidden transition-opacity"
          onClick={() => onMobileOpenChange?.(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        collapsible={true}
        persist
        className={cn(
          'h-full select-none z-40',
          'max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:w-64 max-sm:shadow-2xl max-sm:transition-transform max-sm:duration-200',
          mobileOpen ? 'max-sm:translate-x-0' : 'max-sm:-translate-x-full',
          'sm:relative sm:translate-x-0'
        )}
      >
        <Sidebar.Header className="min-h-[52px] border-b border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 px-3 flex-shrink-0">
          <Sidebar.Brand
            href={MODSCOPE_SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            logo={getIconPath('app-icon-stylized.png')}
            name={
              <div className="flex flex-col min-w-0 leading-tight">
                <span className="font-extrabold text-sm tracking-tight text-white dark:text-zinc-100 truncate">
                  ModScope
                </span>
                {subreddit && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-400 truncate font-medium tracking-tight">
                    r/{subreddit}
                  </span>
                )}
              </div>
            }
          />
          <div className="flex items-center gap-1">
            <Sidebar.Collapse className="hidden sm:inline-flex" />
            {onMobileOpenChange && (
              <button
                type="button"
                onClick={() => onMobileOpenChange(false)}
                className="sm:hidden p-1.5 rounded hover:bg-zinc-800/10 dark:hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
                aria-label="Close navigation menu"
              >
                <Icon name="lucide:x" size={18} />
              </button>
            )}
          </div>
        </Sidebar.Header>

        <Sidebar.Nav className="flex-1 px-2 py-3 overflow-y-auto no-scrollbar">
          {primaryNavItems.map((item) => (
            <Sidebar.Item
              key={item.view}
              current={activeView === item.view}
              icon={<Icon name={item.icon} size={17} />}
              badge={item.badge}
              onClick={(e) => {
                if (!item.disabled) {
                  onMobileOpenChange?.(false);
                  onViewChange(item.view, e);
                }
              }}
              className={item.disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent' : ''}
            >
              {item.label}
            </Sidebar.Item>
          ))}
        </Sidebar.Nav>

        <div className="px-2 py-2 border-t border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 space-y-1 shrink-0">
          <Sidebar.Nav>
            {secondaryNavItems.map((item) => (
              <Sidebar.Item
                key={item.view}
                current={
                  activeView === item.view ||
                  (item.view === 'help' && activeView === 'about')
                }
                icon={<Icon name={item.icon} size={17} className={item.icon.endsWith('.png') ? 'opacity-70' : ''} />}
                onClick={(e) => {
                  if (!item.disabled) {
                    onMobileOpenChange?.(false);
                    onViewChange(item.view, e);
                  }
                }}
                className={item.disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent' : ''}
              >
                {item.label}
              </Sidebar.Item>
            ))}
          </Sidebar.Nav>
        </div>

      <div
        className="relative shrink-0 border-t border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 mt-auto pt-2 pb-1 px-1"
        ref={userMenuRef}
      >
        <Sidebar.Profile
          {...(currentUserAvatar ? { avatar: currentUserAvatar } : {})}
          name={
            <div className="flex flex-col min-w-0 leading-tight text-left">
              <span className="text-xs font-semibold truncate">
                {currentUsername || 'Moderator'}
              </span>
              <span className="text-[10px] opacity-70 truncate">
                u/{currentUsername || 'user'}
              </span>
            </div>
          }
          onClick={() => setIsUserMenuOpen((prev) => !prev)}
        />

        {isUserMenuOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-1.5 w-56 p-2.5 rounded-xl bg-[var(--color-surface,var(--color-bg))] dark:bg-zinc-900 border border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 shadow-xl z-50 space-y-3">
            <div className="border-b border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 pb-2 flex items-center gap-2.5">
              <Avatar
                src={currentUserAvatar}
                name={currentUsername || 'Moderator'}
                size="sm"
                circle
                color="blue"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[var(--color-text)] dark:text-zinc-100 truncate">
                  u/{currentUsername || 'Moderator'}
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] dark:text-zinc-400 truncate">
                  {subreddit ? `r/${subreddit}` : 'ModScope Analytics'}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] dark:text-zinc-500 mb-1.5">
                Theme
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      changeTheme(t.id as Theme);
                      setIsUserMenuOpen(false);
                      fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ display: { theme: t.id } }),
                      }).catch(() => {});
                    }}
                    title={t.label}
                    className={cn(
                      'flex flex-col items-center gap-1 p-1 rounded-md border text-[9px] transition-all',
                      theme === t.id
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-bold dark:border-blue-500 dark:bg-blue-500/20'
                        : 'border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-700 hover:bg-[var(--color-accent)] dark:hover:bg-white/10 text-[var(--color-text-muted)] dark:text-zinc-400'
                    )}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs"
                      style={{
                        backgroundColor: THEME_COLORS[t.id] || '#64748b',
                      }}
                    />
                    <span className="truncate w-full text-center leading-none">
                      {t.label.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 pt-2 space-y-1.5">
              {onOpenUpgradeModal && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenUpgradeModal();
                    setIsUserMenuOpen(false);
                  }}
                  className="w-full justify-center gap-1.5 py-1.5 px-2 text-xs font-medium border border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-700 bg-[var(--color-card)] dark:bg-zinc-800 hover:bg-[var(--color-accent)] dark:hover:bg-zinc-700 text-[var(--color-text)] dark:text-zinc-100 transition-colors"
                  icon="lucide:database"
                  iconSize={13}
                >
                  <span>Storage Schema &amp; Upgrades</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onToggleLayoutMode();
                  setIsUserMenuOpen(false);
                }}
                className="w-full justify-center gap-1.5 py-1.5 px-2 text-xs font-medium border border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-700 bg-[var(--color-card)] dark:bg-zinc-800 hover:bg-[var(--color-accent)] dark:hover:bg-zinc-700 text-[var(--color-text)] dark:text-zinc-100 transition-colors"
                icon="glass-adjustments.png"
                iconSize={13}
              >
                <span>
                  {layoutMode === 'sidebar'
                    ? 'Switch to Classic'
                    : 'Switch to Sidebar'}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sidebar>
  </>
);
};
