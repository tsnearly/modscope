import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';
import { getIconPath } from '../../utils/iconMappings';
import * as LucideIcons from 'lucide-react';

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

// Convert kebab-case "chevron-down" → PascalCase "ChevronDown" for Lucide lookup
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export interface IconProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'size'> {
  name?: string;
  src?: string;
  variant?: 'outline' | 'solid' | 'mini' | 'micro' | string;
  color?: string;
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
    const componentName = toPascalCase(iconName);
    const LucideIcon = (
      LucideIcons as unknown as Record<
        string,
        | React.ComponentType<{
            size?: number;
            color?: string;
            className?: string;
            style?: React.CSSProperties;
          }>
        | undefined
      >
    )[componentName];

    if (!LucideIcon) {
      console.warn(
        `[Icon] Lucide icon not found: "${componentName}" (from "${name}")`,
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
        className={cn(iconVariants({ size: size as any }), className)}
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
      className={cn(iconVariants({ size: size as any }), className)}
      style={iconStyle}
      {...props}
    />
  );
}
