import React, { useEffect, useCallback } from 'react';
import { getIconPath } from '../utils/iconMappings';
import { Button } from './ui/button';
import { Icon } from './ui/icon';

export interface ShowcaseWelcomeModalProps {
  open: boolean;
  onEnter: () => void;
  subreddit?: string;
}

export const ShowcaseWelcomeModal: React.FC<ShowcaseWelcomeModalProps> = ({
  open,
  onEnter,
  subreddit = 'ModScope',
}) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onEnter();
      }
    },
    [onEnter]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const backdropSrc = getIconPath('showcase-backdrop.png');
  const logoSrc = getIconPath('app-icon-stylized.png');

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 sm:p-6 overflow-hidden select-none">
      {/* Blurred background image backdrop */}
      {backdropSrc ? (
        <img
          src={backdropSrc}
          alt="Dashboard Preview Backdrop"
          className="absolute inset-0 w-full h-full object-cover filter blur-md scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950" />
      )}

      {/* Atmospheric vignette overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Superimposed Showcase Card */}
      <div className="relative z-10 w-full max-w-xl bg-slate-900/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl text-white backdrop-blur-xl animate-in fade-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center text-center">
          {logoSrc && (
            <img
              src={logoSrc}
              alt="ModScope Logo"
              className="w-16 h-16 sm:w-20 sm:h-20 mb-4 drop-shadow-xl"
            />
          )}

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Showcase Mode • r/{subreddit}
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
            Explore ModScope
          </h1>
          <p className="text-sm text-slate-300 max-w-md mb-6 leading-relaxed">
            Welcome! ModScope is running in interactive showcase mode on r/{subreddit}.
            Take it for a spin and test drive its moderation analytics before installing it in your subreddit.
          </p>

          {/* Feature Highlights Grid */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-6 text-xs text-slate-200">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Icon name="lucide:layout-dashboard" size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="block text-white font-medium">All Tabs Available</strong>
                Explore reports, snapshots, timing heatmaps, and metric posts.
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Icon name="lucide:play" size={18} className="text-cyan-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="block text-white font-medium">Live Execution</strong>
                Initiate live snapshots and run jobs immediately to test workflows.
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Icon name="lucide:sliders" size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="block text-white font-medium">Appearance &amp; Themes</strong>
                Personalize themes in Preferences (persisted in your local browser storage).
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Icon name="lucide:shield-check" size={18} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="block text-white font-medium">Safe Sandbox</strong>
                Shared SR configuration and snapshot deletions remain protected.
              </div>
            </div>
          </div>

          {/* Action Button & Enter Hint */}
          <div className="flex flex-col items-center gap-2.5 w-full">
            <Button
              onClick={onEnter}
              variant="default"
              size="lg"
              className="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-3 rounded-xl transition-all"
            >
              <span>Enter Dashboard</span>
              <kbd className="px-2 py-0.5 text-xs font-mono bg-emerald-700/80 rounded border border-emerald-500/50 text-emerald-100">
                ↵ Enter
              </kbd>
            </Button>
            <p className="text-[11px] text-slate-400">
              Press <kbd className="font-mono text-slate-300">Enter</kbd> on your keyboard or click the button above to enter.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
