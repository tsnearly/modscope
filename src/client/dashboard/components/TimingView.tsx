import React, { useMemo, useState } from 'react';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { DAYS, FULL_DAYS, formatHourLabel } from '../utils/reportFormatting';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { Tooltip } from './ui/tooltip';

interface TimingViewProps {
  heatmapResult: any;
  iconContext: IconContext;
}

export function TimingView({ heatmapResult, iconContext }: TimingViewProps) {
  const heatmapData = heatmapResult.grid;
  const [hiddenCategories, setHiddenCategories] = useState<
    Record<string, boolean>
  >({});

  const tiers = useMemo(() => {
    const rawRanges = [
      heatmapResult?.thresholds?.low,
      heatmapResult?.thresholds?.medium,
      heatmapResult?.thresholds?.high,
      heatmapResult?.thresholds?.extreme,
      heatmapResult?.thresholds?.superhigh,
    ].map((pair, index) => {
      const fallback = index + 1;
      const rawMin = Number(pair?.[0]);
      const rawMax = Number(pair?.[1]);
      const min = Number.isFinite(rawMin) ? Math.max(1, Math.round(rawMin)) : fallback;
      const max = Number.isFinite(rawMax)
        ? Math.max(min, Math.round(rawMax))
        : index === 4
          ? Infinity
          : min;
      return [min, max] as [number, number];
    });

    const baseTiers = [
      { intensity: 1, key: 'i1', label: 'low', color: 'var(--heatmap-1)' },
      { intensity: 2, key: 'i2', label: 'medium', color: 'var(--heatmap-3)' },
      { intensity: 3, key: 'i3', label: 'high', color: 'var(--heatmap-5)' },
      { intensity: 4, key: 'i4', label: 'extreme', color: 'var(--heatmap-7)' },
      {
        intensity: 5,
        key: 'i5',
        label: 'superhigh',
        color: 'var(--heatmap-9)',
      },
    ];

    let previousUpper = 0;

    return baseTiers.map((tier, idx) => {
      const [rawMin, rawMax] = rawRanges[idx] ?? [idx + 1, idx + 1];
      const min = idx === 0 ? rawMin : Math.max(rawMin, previousUpper + 1);
      const max =
        idx === baseTiers.length - 1
          ? Number.isFinite(rawMax)
            ? Math.max(min, rawMax)
            : Infinity
          : Math.max(min, rawMax);

      if (Number.isFinite(max)) {
        previousUpper = max;
      }

      return {
        ...tier,
        range: [min, max] as [number, number],
      };
    });
  }, [heatmapResult.thresholds]);

  const getCellColor = (intensity: number): string => {
    if (intensity === 0) {
      if (hiddenCategories.none) {
        return 'transparent';
      }
      return 'var(--color-bg)';
    }

    const tierKey = `i${intensity}`;
    if (tierKey && hiddenCategories[tierKey]) {
      return 'transparent';
    }

    const colors = [
      'var(--color-bg)',
      'var(--heatmap-1)',
      'var(--heatmap-3)',
      'var(--heatmap-5)',
      'var(--heatmap-7)',
      'var(--heatmap-9)',
    ];
    return colors[intensity] ?? colors[0] ?? 'var(--color-bg)';
  };

  const renderLegend = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        fontSize: '9px',
        marginBottom: '12px',
        position: 'relative',
        zIndex: 3,
      }}
    >
      <button
        type="button"
        onClick={() =>
          setHiddenCategories((prev) => ({ ...prev, none: !prev.none }))
        }
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
        <span
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '2px',
            background: 'var(--color-bg)',
            border: `1px solid ${hiddenCategories.none ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}`,
          }}
        />
        <span>none: 0</span>
      </button>
      {tiers.map(({ key, label, color, range }) => (
        <button
          key={key}
          type="button"
          onClick={() =>
            setHiddenCategories((prev) => ({ ...prev, [key]: !prev[key] }))
          }
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
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '2px',
              background: color,
              border: `1px solid ${hiddenCategories[key] ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}`,
            }}
          />
          <span>
            {label}: {range[0]}
            {range[1] === Infinity
              ? '+'
              : range[1] === range[0]
                ? ''
                : `\u2013${range[1]}`}
          </span>
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
                    <Tooltip
                      key={h}
                      delayDuration={80}
                      content={
                        <span className="whitespace-pre-line">
                          {`${dayLabel} - ${hourLabel}\n${data.count} post${data.count !== 1 ? 's' : ''}`}
                        </span>
                      }
                    >
                      <div
                        style={{
                          aspectRatio: '1',
                          borderRadius: '2px',
                          background: getCellColor(data.intensity),
                          border: '1px solid var(--color-border)',
                          opacity: 0.9,
                          cursor: 'default',
                        }}
                        aria-label={`${dayLabel} - ${hourLabel}\n${data.count} post${data.count !== 1 ? 's' : ''}`}
                      />
                    </Tooltip>
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
