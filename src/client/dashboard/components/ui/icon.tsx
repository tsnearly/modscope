import { cva, type VariantProps } from 'class-variance-authority';
import {
  BarChart2,
  Calendar,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Edit,
  Layers,
  LayoutDashboard,
  Play,
  Plus,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Sliders,
  SwatchBook,
  Trash,
  Trash2,
  X,
} from 'lucide-react';
import React from 'react';
import { cn } from '../../utils/cn';
import { getIconPath } from '../../utils/iconMappings';

const iconVariants = cva('inline-block object-contain flex-shrink-0', {
  variants: {
    size: {
      xxs: 'h-2 w-2',
      xs: 'h-3 w-3',
      sm: 'h-4 w-4',
      md: 'h-5 w-5',
      lg: 'h-6 w-6',
      xl: 'h-8 w-8',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
});

const lucideIconMap = {
  'bar-chart-2': BarChart2,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  clock: Clock,
  database: Database,
  edit: Edit,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  play: Play,
  plus: Plus,
  'refresh-ccw': RefreshCcw,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  save: Save,
  settings: Settings,
  sliders: Sliders,
  'swatch-book': SwatchBook,
  trash: Trash,
  'trash-2': Trash2,
  x: X,
} as const;

export interface IconProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'size'> {
  name?: string;
  src?: string;
  variant?: 'outline' | 'solid' | 'mini' | 'micro' | string;
  color?: string | undefined;
  size?: VariantProps<typeof iconVariants>['size'] | number;
}

export function Icon({
  name,
  src,
  size = 'sm',
  variant,
  color,
  className,
  alt = '',
  style,
  ...props
}: IconProps) {
  // ── Lucide library path: "lucide:chevron-down" ──────────────────────────
  const lucideRef = name?.startsWith('lucide:')
    ? name
    : src?.startsWith('lucide:')
      ? src
      : undefined;
  if (lucideRef) {
    const iconName = lucideRef.slice(7); // strip "lucide:"
    const LucideIcon =
      lucideIconMap[iconName as keyof typeof lucideIconMap];

    if (!LucideIcon) {
      console.warn(
        `[Icon] Lucide icon not found: "${iconName}" (from "${name}")`,
      );
      return null;
    }

    const pxSize =
      typeof size === 'number'
        ? size
        : ({ xxs: 8, xs: 12, sm: 16, md: 20, lg: 24, xl: 32 }[size ?? 'sm'] ??
          16);
    return (
      <LucideIcon
        size={pxSize}
        color={color ?? 'currentColor'}
        className={className ?? ''}
        style={style ?? {}}
      />
    );
  }

  // ── PNG/SVG asset path ───────────────────────────────────────────────────
  let lookupName = name || '';
  if (variant && !lookupName.includes(':')) {
    const standardVariants = ['outline', 'solid', 'mini', 'micro'];
    if (standardVariants.includes(variant)) {
      lookupName = `${variant}:${lookupName}`;
    }
  }

  const resolvedSrc = src || (lookupName ? getIconPath(lookupName) : '');
  if (!resolvedSrc) {
    return null;
  }

  const iconStyle: React.CSSProperties = { ...style };

  // When color is set, render a mask-image div (background-color tinted by icon shape).
  // Must be a <div>, not <img> — mask on <img> clips the original pixels, not a fill.
  if (color) {
    const maskedStyle: React.CSSProperties = {
      display: 'inline-block',
      flexShrink: 0,
      backgroundColor: color,
      maskImage: `url(${resolvedSrc})`,
      maskRepeat: 'no-repeat',
      maskPosition: 'center',
      maskSize: 'contain',
      WebkitMaskImage: `url(${resolvedSrc})`,
      WebkitMaskRepeat: 'no-repeat',
      WebkitMaskPosition: 'center',
      WebkitMaskSize: 'contain',
      ...style,
    };

    if (typeof size === 'number') {
      return (
        <div
          className={cn('flex-shrink-0', className)}
          style={{ width: size, height: size, ...maskedStyle }}
        />
      );
    }
    return (
      <div
        className={cn(iconVariants({ size: (typeof size === "string" &&  (size as any) === "default" ? "sm" : size) as any }), className)}
        style={maskedStyle}
      />
    );
  }

  if (typeof size === 'number') {
    return (
      <img
        src={resolvedSrc}
        alt={alt}
        className={cn('inline-block object-contain flex-shrink-0', className)}
        style={{ width: size, height: size, ...iconStyle }}
        {...props}
      />
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={cn(iconVariants({ size: (typeof size === "string" &&  (size as any) === "default" ? "sm" : size) as any }), className)}
      style={iconStyle}
      {...props}
    />
  );
}
