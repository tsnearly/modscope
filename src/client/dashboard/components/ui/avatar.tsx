import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { context as devvitContext } from '@devvit/web/client';
import { cn } from '../../utils/cn';
import { Tooltip } from './tooltip';
import { Icon } from './icon';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type AvatarColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'auto';

export type AvatarBadgePosition =
  'top left' | 'top right' | 'bottom left' | 'bottom right';

export type AvatarBadgeVariant = 'solid' | 'outline';

const AVATAR_COLORS: AvatarColor[] = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

const avatarColorStyles: Record<string, string> = {
  red: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  orange:
    'bg-orange-200 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200',
  amber: 'bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  yellow:
    'bg-yellow-200 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-200',
  lime: 'bg-lime-200 text-lime-800 dark:bg-lime-900/60 dark:text-lime-200',
  green: 'bg-green-200 text-green-800 dark:bg-green-900/60 dark:text-green-200',
  emerald:
    'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  teal: 'bg-teal-200 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200',
  cyan: 'bg-cyan-200 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200',
  sky: 'bg-sky-200 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  blue: 'bg-blue-200 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  indigo:
    'bg-indigo-200 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  violet:
    'bg-violet-200 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  purple:
    'bg-purple-200 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
  fuchsia:
    'bg-fuchsia-200 text-fuchsia-800 dark:bg-fuchsia-900/60 dark:text-fuchsia-200',
  pink: 'bg-pink-200 text-pink-800 dark:bg-pink-900/60 dark:text-pink-200',
  rose: 'bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
};

const badgeColorStyles: Record<string, string> = {
  red: 'bg-red-500 dark:bg-red-400',
  orange: 'bg-orange-500 dark:bg-orange-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  yellow: 'bg-yellow-500 dark:bg-yellow-400',
  lime: 'bg-lime-500 dark:bg-lime-400',
  green: 'bg-green-500 dark:bg-green-400',
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  teal: 'bg-teal-500 dark:bg-teal-400',
  cyan: 'bg-cyan-500 dark:bg-cyan-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
  blue: 'bg-blue-500 dark:bg-blue-400',
  indigo: 'bg-indigo-500 dark:bg-indigo-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  purple: 'bg-purple-500 dark:bg-purple-400',
  fuchsia: 'bg-fuchsia-500 dark:bg-fuchsia-400',
  pink: 'bg-pink-500 dark:bg-pink-400',
  rose: 'bg-rose-500 dark:bg-rose-400',
  zinc: 'bg-zinc-400 dark:bg-zinc-300',
};

function getAutoColor(seed: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index] ?? 'blue';
}

function getInitials(name: string): string {
  if (!name) return '';
  const trimmed = name.replace(/^u\//, '').trim();
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }
  return trimmed.charAt(0).toUpperCase();
}

const avatarCache = new Map<string, string | null>();
const pendingAvatarRequests = new Map<string, Promise<string | null>>();
const avatarListeners = new Set<() => void>();

export function registerAvatar(username: string, url: string | null): void {
  const clean = username.replace(/^u\//, '').trim().toLowerCase();
  if (!clean) return;
  avatarCache.set(clean, url);
  avatarListeners.forEach((l) => l());
}

export function getCachedAvatar(username?: string): string | null | undefined {
  if (!username) return undefined;
  const clean = username.replace(/^u\//, '').trim().toLowerCase();
  if (!clean || clean === '[deleted]' || clean === 'none') return null;

  try {
    const currentName = (devvitContext as any)?.username;
    const currentAvatar =
      (devvitContext as any)?.snoovatar || (devvitContext as any)?.avatar;
    if (currentName && currentName.toLowerCase() === clean && currentAvatar) {
      if (!avatarCache.has(clean)) {
        avatarCache.set(clean, currentAvatar);
      }
      return currentAvatar;
    }
  } catch {
    // context may be unavailable in some test runs
  }

  return avatarCache.get(clean);
}

export async function fetchAvatarUrl(username: string): Promise<string | null> {
  const clean = username.replace(/^u\//, '').trim().toLowerCase();
  if (!clean || clean === '[deleted]' || clean === 'none') return null;

  if (avatarCache.has(clean)) {
    return avatarCache.get(clean) ?? null;
  }

  const inFlight = pendingAvatarRequests.get(clean);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const currentName = (devvitContext as any)?.username || '';
      const init: RequestInit = currentName
        ? { headers: { 'x-modscope-session-id': currentName } }
        : {};
      const res = await fetch(
        `/api/users/${encodeURIComponent(clean)}/avatar`,
        init
      );
      if (res.ok) {
        const data = await res.json();
        const rawUrl =
          ((data?.avatarUrl ?? data?.snoovatarUrl ?? data?.avatar) as string) ||
          null;
        const url = rawUrl ? rawUrl.replace(/&amp;/g, '&') : null;
        avatarCache.set(clean, url);
        avatarListeners.forEach((l) => l());
        return url;
      }
    } catch {
      // network failure
    }
    avatarCache.set(clean, null);
    avatarListeners.forEach((l) => l());
    return null;
  })().finally(() => {
    pendingAvatarRequests.delete(clean);
  });

  pendingAvatarRequests.set(clean, promise);
  return promise;
}

export interface AvatarBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: AvatarColor | 'zinc' | undefined;
  circle?: boolean | undefined;
  position?: AvatarBadgePosition | undefined;
  variant?: AvatarBadgeVariant | undefined;
}

export const AvatarBadge = React.forwardRef<HTMLDivElement, AvatarBadgeProps>(
  (
    {
      className,
      color,
      circle = false,
      position = 'bottom right',
      variant = 'solid',
      children,
      ...props
    },
    ref
  ) => {
    const isOutline = variant === 'outline';
    const isDot = !children && children !== 0;

    const positionClasses: Record<AvatarBadgePosition, string> = {
      'top left': 'top-0 left-0',
      'top right': 'top-0 right-0',
      'bottom left': 'bottom-0 left-0',
      'bottom right': 'bottom-0 right-0',
    };

    const resolvedColor = color
      ? badgeColorStyles[color]
      : isDot
        ? 'bg-green-500 dark:bg-green-400'
        : 'bg-white dark:bg-zinc-900 text-zinc-800 dark:text-white';

    return (
      <div
        ref={ref}
        className={cn(
          'absolute ring-[2px] ring-white dark:ring-zinc-900 z-10 h-3 min-w-3 flex items-center justify-center tabular-nums overflow-hidden text-[.625rem] font-medium leading-none select-none',
          circle ? 'rounded-full' : 'rounded-[3px]',
          positionClasses[position],
          resolvedColor,
          isOutline &&
            (circle
              ? 'after:absolute after:inset-[3px] after:bg-white dark:after:bg-zinc-900 after:rounded-full'
              : 'after:absolute after:inset-[3px] after:bg-white dark:after:bg-zinc-900 after:rounded-[1px]'),
          !isDot && 'px-1 min-w-[14px] h-3.5 text-[9px]',
          className
        )}
        aria-hidden="true"
        {...props}
      >
        {children}
      </div>
    );
  }
);
AvatarBadge.displayName = 'AvatarBadge';

export interface AvatarProps extends React.HTMLAttributes<
  HTMLDivElement | HTMLButtonElement | HTMLAnchorElement
> {
  name?: string | undefined;
  src?: string | undefined;
  avatar?: string | undefined;
  snoovatar?: string | undefined;
  initials?: string | undefined;
  alt?: string | undefined;
  size?: AvatarSize | undefined;
  color?: AvatarColor | undefined;
  colorSeed?: string | number | undefined;
  'color:seed'?: string | number | undefined;
  circle?: boolean | undefined;
  icon?: string | React.ReactNode | undefined;
  iconVariant?: 'outline' | 'solid' | undefined;
  'icon:variant'?: 'outline' | 'solid' | undefined;
  tooltip?: string | boolean | React.ReactNode | undefined;
  tooltipPosition?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  'tooltip:position'?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  badge?: string | number | boolean | React.ReactNode | undefined;
  badgeColor?: AvatarColor | 'zinc' | undefined;
  'badge:color'?: AvatarColor | 'zinc' | undefined;
  badgeCircle?: boolean | undefined;
  'badge:circle'?: boolean | undefined;
  badgePosition?: AvatarBadgePosition | undefined;
  'badge:position'?: AvatarBadgePosition | undefined;
  badgeVariant?: AvatarBadgeVariant | undefined;
  'badge:variant'?: AvatarBadgeVariant | undefined;
  as?: 'button' | 'div' | undefined;
  href?: string | undefined;
  asChild?: boolean | undefined;
}

const AvatarRoot = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      name,
      src,
      avatar,
      snoovatar,
      initials,
      alt,
      size = 'md',
      color,
      colorSeed,
      'color:seed': colorSeedProp,
      circle = false,
      icon,
      iconVariant = 'solid',
      'icon:variant': iconVariantProp,
      tooltip,
      tooltipPosition = 'top',
      'tooltip:position': tooltipPositionProp,
      badge,
      badgeColor,
      'badge:color': badgeColorProp,
      badgeCircle = false,
      'badge:circle': badgeCircleProp,
      badgePosition = 'bottom right',
      'badge:position': badgePositionProp,
      badgeVariant = 'solid',
      'badge:variant': badgeVariantProp,
      as = 'div',
      href,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const activeColorSeed = colorSeedProp ?? colorSeed;
    const activeIconVariant = iconVariantProp ?? iconVariant;
    const activeTooltipPosition = tooltipPositionProp ?? tooltipPosition;
    const activeBadgeColor = badgeColorProp ?? badgeColor;
    const activeBadgeCircle = badgeCircleProp ?? badgeCircle;
    const activeBadgePosition = badgePositionProp ?? badgePosition;
    const activeBadgeVariant = badgeVariantProp ?? badgeVariant;

    // Resolve color scheme
    let resolvedColor = color;
    if (color === 'auto') {
      const seed =
        activeColorSeed !== undefined ? String(activeColorSeed) : (name ?? '');
      resolvedColor = getAutoColor(seed);
    }

    const colorClasses =
      resolvedColor && avatarColorStyles[resolvedColor]
        ? avatarColorStyles[resolvedColor]
        : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-800 dark:text-white';

    const sizeClasses: Record<
      AvatarSize,
      { root: string; radius: string; afterRadius: string; iconSize: number }
    > = {
      xs: {
        root: 'size-6 text-xs',
        radius: circle ? 'rounded-full' : 'rounded-sm',
        afterRadius: circle ? 'after:rounded-full' : 'after:rounded-sm',
        iconSize: 12,
      },
      sm: {
        root: 'size-8 text-xs',
        radius: circle ? 'rounded-full' : 'rounded-md',
        afterRadius: circle ? 'after:rounded-full' : 'after:rounded-md',
        iconSize: 16,
      },
      md: {
        root: 'size-10 text-sm',
        radius: circle ? 'rounded-full' : 'rounded-lg',
        afterRadius: circle ? 'after:rounded-full' : 'after:rounded-lg',
        iconSize: 20,
      },
      lg: {
        root: 'size-12 text-base',
        radius: circle ? 'rounded-full' : 'rounded-lg',
        afterRadius: circle ? 'after:rounded-full' : 'after:rounded-lg',
        iconSize: 24,
      },
      xl: {
        root: 'size-16 text-base',
        radius: circle ? 'rounded-full' : 'rounded-xl',
        afterRadius: circle ? 'after:rounded-full' : 'after:rounded-xl',
        iconSize: 32,
      },
    };

    const currentSize = sizeClasses[size] ?? sizeClasses.md;

    const [imageError, setImageError] = React.useState(false);
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

    const explicitSrc = src || avatar || snoovatar;

    React.useEffect(() => {
      setImageError(false);
    }, [explicitSrc, name]);

    const cachedAvatar = getCachedAvatar(name);

    React.useEffect(() => {
      if (explicitSrc || !name) return;
      const clean = name.replace(/^u\//, '').trim().toLowerCase();
      if (!clean || clean === '[deleted]' || clean === 'none') return;

      const listener = () => forceUpdate();
      avatarListeners.add(listener);

      if (cachedAvatar === undefined) {
        fetchAvatarUrl(clean);
      }

      return () => {
        avatarListeners.delete(listener);
      };
    }, [explicitSrc, name, cachedAvatar]);

    const rawResolvedSrc = explicitSrc || (name ? cachedAvatar : null);
    const resolvedSrc = rawResolvedSrc
      ? rawResolvedSrc.replace(/&amp;/g, '&')
      : null;
    const showImage = !imageError && Boolean(resolvedSrc);

    // Determine content: actual avatar image if available, with initials as last resort fallback
    const renderContent = () => {
      if (showImage && resolvedSrc) {
        return (
          <img
            src={resolvedSrc}
            alt={alt ?? name ?? ''}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className={cn(
              'size-full object-cover select-none',
              currentSize.radius
            )}
          />
        );
      }

      if (children) {
        return <span className="select-none">{children}</span>;
      }

      if (initials) {
        return <span className="select-none font-medium">{initials}</span>;
      }

      if (icon) {
        if (typeof icon === 'string') {
          return (
            <Icon
              name={icon}
              size={currentSize.iconSize}
              variant={activeIconVariant}
              className="shrink-0"
            />
          );
        }
        return icon;
      }

      // Last resort fallback measure: display user initials
      if (name) {
        return (
          <span className="select-none font-medium">{getInitials(name)}</span>
        );
      }

      return null;
    };

    // Render badge
    const renderBadge = () => {
      if (!badge && badge !== 0) return null;
      if (React.isValidElement(badge)) {
        return badge;
      }
      return (
        <AvatarBadge
          color={activeBadgeColor}
          circle={activeBadgeCircle}
          position={activeBadgePosition}
          variant={activeBadgeVariant}
        >
          {badge === true ? null : badge}
        </AvatarBadge>
      );
    };

    // Determine target wrapper element
    let Comp: React.ElementType = asChild ? Slot : 'div';
    if (!asChild) {
      if (href) {
        Comp = 'a';
      } else if (as === 'button') {
        Comp = 'button';
      }
    }

    const avatarElement = (
      <Comp
        ref={ref as any}
        href={!asChild && href ? href : undefined}
        data-slot="avatar"
        data-size={size}
        data-circle={circle ? 'true' : undefined}
        className={cn(
          'relative flex-none isolate inline-flex items-center justify-center font-medium select-none overflow-hidden transition-colors',
          'after:absolute after:inset-0 after:ring-1 after:ring-inset after:ring-black/10 dark:after:ring-white/10 after:pointer-events-none',
          currentSize.root,
          currentSize.radius,
          currentSize.afterRadius,
          !showImage && colorClasses,
          Comp === 'button' &&
            'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          Comp === 'a' &&
            'cursor-pointer no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className
        )}
        {...props}
      >
        {renderContent()}
        {renderBadge()}
      </Comp>
    );

    // Tooltip wrapping
    const resolvedTooltipContent = tooltip === true ? name : tooltip;

    if (resolvedTooltipContent) {
      return (
        <Tooltip content={resolvedTooltipContent} side={activeTooltipPosition}>
          {avatarElement}
        </Tooltip>
      );
    }

    return avatarElement;
  }
);
AvatarRoot.displayName = 'Avatar';

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean | undefined;
}

export const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(
          'flex isolate items-center *:not-first:-ml-2 **:ring-white **:dark:ring-zinc-900 **:data-[slot=avatar]:ring-4 **:data-[slot=avatar]:data-[size=sm]:ring-2 **:data-[slot=avatar]:data-[size=xs]:ring-2',
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
AvatarGroup.displayName = 'AvatarGroup';

export const Avatar = Object.assign(AvatarRoot, {
  Group: AvatarGroup,
  Badge: AvatarBadge,
});
