import React, { useMemo, useState } from 'react';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { DAYS, FULL_DAYS, formatHourLabel } from '../utils/reportFormatting';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';

interface TimingViewProps {
  heatmapResult: any;
  iconContext: IconContext;
}

export function TimingView({ heatmapResult, iconContext }: TimingViewProps) {
  const heatmapData = heatmapResult.grid;
  const [hiddenCategories, setHiddenCategories] = useState<Record<string, boolean>>({});

  const tiers = useMemo(() => {
    if (!heatmapResult.thresholds) return [];
    
    const baseTiers = [
      {
        key: 'low',
        label: 'low',
        color: 'var(--heatmap-1)',
        t: heatmapResult.thresholds.low,
      },
      {
        key: 'medium',
        label: 'medium',
        color: 'var(--heatmap-3)',
        t: heatmapResult.thresholds.medium,
      },
      {
        key: 'high',
        label: 'high',
        color: 'var(--heatmap-5)',
        t: heatmapResult.thresholds.high,
      },
      {
        key: 'extreme',
        label: 'extreme',
        color: 'var(--heatmap-7)',
        t: heatmapResult.thresholds.extreme,
      },
      {
        key: 'superhigh',
        label: 'superhigh',
        color: 'var(--heatmap-9)',
        t: heatmapResult.thresholds.superhigh,
      },
    ];
    
    return baseTiers.filter(({ t }, idx, arr) => idx === 0 || t[0] !== arr[idx - 1]!.t[0]);
  }, [heatmapResult.thresholds]);

  const getCellColor = (intensity: number): string => {
    if (intensity === 0) {
      if (hiddenCategories.none) {
        return 'transparent';
      }
      return 'var(--color-bg)';
    }
    
    if (intensity > 0 && intensity <= tiers.length) {
      const tier = tiers[intensity - 1];
      if (tier && hiddenCategories[tier.key]) {
        return 'transparent';
      }
    }
    
    const colors = [
      'var(--color-bg)',
      'var(--heatmap-1)',
      'var(--heatmap-3)',
      'var(--heatmap-5)',
      'var(--heatmap-7)',
      'var(--heatmap-9)',
    ];
    return colors[intensity] || colors[0];
  };

  const renderLegend = () => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '9px', marginBottom: '12px', position: 'relative', zIndex: 3 }}>
      <button
        type="button"
        onClick={() => setHiddenCategories(prev => ({ ...prev, none: !prev.none }))}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          opacity: hiddenCategories.none ? 0.45 : 1,
          color: 'var(--text-muted)',
          textDecoration: hiddenCategories.none ? 'line-through' : 'none',
          fontWeight: 500,
        }}
        aria-pressed={!hiddenCategories.none}
      >
        <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'var(--color-bg)', border: `1px solid ${hiddenCategories.none ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}` }} />
        <span>none: 0</span>
      </button>
      {tiers.map(({ key, label, color, t }) => (
        <button
          key={key}
          type="button"
          onClick={() => setHiddenCategories(prev => ({ ...prev, [key]: !prev[key] }))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            opacity: hiddenCategories[key] ? 0.45 : 1,
            color: 'var(--text-muted)',
            textDecoration: hiddenCategories[key] ? 'line-through' : 'none',
            fontWeight: 500,
          }}
          aria-pressed={!hiddenCategories[key]}
        >
          <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: color, border: `1px solid ${hiddenCategories[key] ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}` }} />
          <span>{label}: {t[0]}{t[1] === Infinity ? '+' : `\u2013${t[1]}`}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <Chart
        title="Activity Heatmap (Post Frequency)"
        icon={
          <Icon
            src={getDataGroupingIcon('activity_heatmap', iconContext)}
            size={16}
          />
        }
        height="auto"
      >
        <div className="p-3">
          {heatmapResult.thresholds && renderLegend()}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '30px repeat(24, 1fr)',
              gap: '2px',
              fontSize: '8px',
              color: '#94a3b8',
            }}
          >
            <div></div>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                {i}
              </div>
            ))}
            {DAYS.map((day, d) => (
              <React.Fragment key={d}>
                <div style={{ textAlign: 'right', paddingRight: '4px' }}>
                  {day}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const data = heatmapData[`${d}-${h}`] || {
                    intensity: 0,
                    count: 0,
                  };
                  const dayLabel = FULL_DAYS[d] || DAYS[d] || 'Unknown day';
                  const hourLabel = formatHourLabel(h);
                  return (
                    <div
                      key={h}
                      style={{
                        aspectRatio: '1',
                        borderRadius: '2px',
                        background: getCellColor(data.intensity),
                        cursor: 'default',
                      }}
                      title={`${dayLabel} - ${hourLabel}\n${data.count} post${data.count !== 1 ? 's' : ''}`}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </Chart>
    </div>
  );
}
