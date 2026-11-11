import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';
import { Icon } from './icon';
import type { AvatarColor } from './avatar';

const navBadgeColorStyles: Record<string, string> = {
  default:
    'text-zinc-700 dark:text-zinc-200 bg-zinc-400/15 dark:bg-zinc-400/40',
  zinc: 'text-zinc-700 dark:text-zinc-200 bg-zinc-400/15 dark:bg-zinc-400/40',
  red: 'text-red-800 dark:text-red-200 bg-red-400/25 dark:bg-red-400/40',
  orange:
    'text-orange-800 dark:text-orange-200 bg-orange-400/25 dark:bg-orange-400/40',
  amber:
    'text-amber-800 dark:text-amber-200 bg-amber-400/25 dark:bg-amber-400/40',
  yellow:
    'text-yellow-800 dark:text-yellow-200 bg-yellow-400/25 dark:bg-yellow-400/40',
  lime: 'text-lime-800 dark:text-lime-200 bg-lime-400/25 dark:bg-lime-400/40',
  green:
    'text-green-800 dark:text-green-200 bg-green-400/25 dark:bg-green-400/40',
  emerald:
    'text-emerald-800 dark:text-emerald-200 bg-emerald-400/25 dark:bg-emerald-400/40',
  teal: 'text-teal-800 dark:text-teal-200 bg-teal-400/25 dark:bg-teal-400/40',
  cyan: 'text-cyan-800 dark:text-cyan-200 bg-cyan-400/25 dark:bg-cyan-400/40',
  sky: 'text-sky-800 dark:text-sky-200 bg-sky-400/25 dark:bg-sky-400/40',
  blue: 'text-blue-800 dark:text-blue-200 bg-blue-400/25 dark:bg-blue-400/40',
  indigo:
    'text-indigo-800 dark:text-indigo-200 bg-indigo-400/25 dark:bg-indigo-400/40',
  violet:
    'text-violet-800 dark:text-violet-200 bg-violet-400/25 dark:bg-violet-400/40',
  purple:
    'text-purple-800 dark:text-purple-200 bg-purple-400/25 dark:bg-purple-400/40',
  fuchsia:
    'text-fuchsia-800 dark:text-fuchsia-200 bg-fuchsia-400/25 dark:bg-fuchsia-400/40',
  pink: 'text-pink-800 dark:text-pink-200 bg-pink-400/25 dark:bg-pink-400/40',
  rose: 'text-rose-800 dark:text-rose-200 bg-rose-400/25 dark:bg-rose-400/40',
};

export interface NavbarProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

const NavbarRoot = React.forwardRef<HTMLElement, NavbarProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'nav';
    return (
      <Comp
        ref={ref}
        className={cn('flex items-center gap-0.5 py-3 relative', className)}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
NavbarRoot.displayName = 'Navbar';

export interface NavbarItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  current?: boolean;
  icon?: string | React.ReactNode;
  iconTrailing?: string | React.ReactNode;
  'icon:trailing'?: string | React.ReactNode;
  badge?: string | number | boolean | React.ReactNode;
  badgeColor?: AvatarColor | 'zinc';
  'badge:color'?: AvatarColor | 'zinc';
  badgeVariant?: 'solid' | 'outline';
  'badge:variant'?: 'solid' | 'outline';
  asChild?: boolean;
}

export const NavbarItem = React.forwardRef<HTMLAnchorElement, NavbarItemProps>(
  (
    {
      href,
      current,
      icon,
      iconTrailing,
      'icon:trailing': iconTrailingProp,
      badge,
      badgeColor,
      'badge:color': badgeColorProp,
      badgeVariant = 'solid',
      'badge:variant': badgeVariantProp,
      asChild = false,
      className,
      children,
      type: propType,
      ...props
    },
    ref
  ) => {
    const activeIconTrailing = iconTrailingProp ?? iconTrailing;
    const activeBadgeColor = badgeColorProp ?? badgeColor;
    const activeBadgeVariant = badgeVariantProp ?? badgeVariant;

    // Auto-detect current if not explicitly provided
    const isCurrent = React.useMemo(() => {
      if (current !== undefined) return Boolean(current);
      if (typeof window !== 'undefined' && href) {
        return (
          window.location.pathname === href || window.location.hash === href
        );
      }
      return false;
    }, [current, href]);

    const Comp = (asChild ? Slot : href ? 'a' : 'button') as any;

    const renderIcon = () => {
      if (!icon) return null;
      if (typeof icon === 'string') {
        return (
          <Icon
            name={icon}
            size={16}
            className="size-4 shrink-0 me-2 text-current"
          />
        );
      }
      return <span className="me-2 shrink-0">{icon}</span>;
    };

    const renderTrailingIcon = () => {
      if (!activeIconTrailing) return null;
      if (typeof activeIconTrailing === 'string') {
        return (
          <Icon
            name={activeIconTrailing}
            size={16}
            className="size-4 shrink-0 ms-2 text-current"
          />
        );
      }
      return <span className="ms-2 shrink-0">{activeIconTrailing}</span>;
    };

    const renderBadge = () => {
      if (!badge && badge !== 0) return null;
      if (React.isValidElement(badge)) {
        return <span className="ms-2 shrink-0">{badge}</span>;
      }
      const colorClass =
        activeBadgeColor && navBadgeColorStyles[activeBadgeColor]
          ? navBadgeColorStyles[activeBadgeColor]
          : navBadgeColorStyles.default;

      return (
        <span
          className={cn(
            'text-xs font-medium rounded-sm px-1 py-0.5 min-w-5 text-center ms-2 shrink-0 tabular-nums leading-none',
            activeBadgeVariant === 'outline'
              ? 'border border-current bg-transparent'
              : colorClass
          )}
        >
          {badge === true ? null : badge}
        </span>
      );
    };

    return (
      <Comp
        ref={ref as any}
        href={!asChild && href ? href : undefined}
        type={
          Comp === 'button'
            ? (propType as 'button' | 'submit' | 'reset') || 'button'
            : undefined
        }
        data-current={isCurrent ? '' : undefined}
        className={cn(
          'px-3 h-8 flex items-center rounded-lg relative select-none text-sm font-medium transition-colors outline-none cursor-pointer',
          'text-[var(--nav-item-text,var(--text-muted,var(--color-text-muted,#71717a)))] dark:text-white/80',
          'hover:text-[var(--nav-item-hover,var(--text-primary,var(--color-text,#18181b)))] dark:hover:text-white',
          'hover:bg-[var(--nav-item-active-bg,var(--color-secondary,rgba(0,0,0,0.05)))] dark:hover:bg-white/10',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'data-current:text-[var(--nav-item-active-text,var(--color-accent,var(--text-primary,currentColor)))] data-current:font-semibold',
          'data-current:after:absolute data-current:after:-bottom-3 data-current:after:inset-x-0 data-current:after:h-[2px] data-current:after:bg-[var(--color-accent,var(--color-primary,currentColor))]',
          className
        )}
        {...props}
      >
        {renderIcon()}
        <span className="flex-1 text-sm font-medium leading-none whitespace-nowrap">
          {children}
        </span>
        {renderBadge()}
        {renderTrailingIcon()}
      </Comp>
    );
  }
);
NavbarItem.displayName = 'NavbarItem';

export const Navbar = Object.assign(NavbarRoot, {
  Item: NavbarItem,
});
