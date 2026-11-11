import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';
import { Icon } from './icon';
import type { AvatarColor } from './avatar';

const navlistBadgeColorStyles: Record<string, string> = {
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

export interface NavlistProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

const NavlistRoot = React.forwardRef<HTMLElement, NavlistProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'nav';
    return (
      <Comp
        ref={ref}
        className={cn('flex flex-col space-y-[2px] w-full', className)}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
NavlistRoot.displayName = 'Navlist';

export interface NavlistItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string | undefined;
  current?: boolean | undefined;
  icon?: string | React.ReactNode | undefined;
  badge?: string | number | boolean | React.ReactNode | undefined;
  badgeColor?: AvatarColor | 'zinc' | undefined;
  'badge:color'?: AvatarColor | 'zinc' | undefined;
  badgeVariant?: 'solid' | 'outline' | undefined;
  'badge:variant'?: 'solid' | 'outline' | undefined;
  asChild?: boolean | undefined;
}

export const NavlistItem = React.forwardRef<
  HTMLAnchorElement,
  NavlistItemProps
>(
  (
    {
      href,
      current,
      icon,
      badge,
      badgeColor,
      'badge:color': badgeColorProp,
      badgeVariant = 'solid',
      'badge:variant': badgeVariantProp,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
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

    const Comp: React.ElementType = asChild ? Slot : href ? 'a' : 'button';

    const renderIcon = () => {
      if (!icon) return null;
      if (typeof icon === 'string') {
        return (
          <div className="relative shrink-0 me-3">
            <Icon
              name={icon}
              size={16}
              className="size-4 shrink-0 text-current"
            />
          </div>
        );
      }
      return <div className="relative shrink-0 me-3">{icon}</div>;
    };

    const renderBadge = () => {
      if (!badge && badge !== 0) return null;
      if (React.isValidElement(badge)) {
        return <span className="ms-auto shrink-0">{badge}</span>;
      }
      const colorClass =
        activeBadgeColor && navlistBadgeColorStyles[activeBadgeColor]
          ? navlistBadgeColorStyles[activeBadgeColor]
          : navlistBadgeColorStyles.default;

      return (
        <span
          className={cn(
            'text-xs font-medium rounded-sm px-1 py-0.5 min-w-5 text-center ms-auto shrink-0 tabular-nums leading-none',
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
        type={Comp === 'button' ? 'button' : undefined}
        data-current={isCurrent ? '' : undefined}
        className={cn(
          'h-10 lg:h-8 relative flex items-center rounded-lg py-0 text-start w-full px-3 my-px select-none text-sm font-medium transition-colors outline-none cursor-pointer',
          'text-[var(--nav-item-text,var(--text-muted,var(--color-text-muted,#71717a)))] dark:text-white/80',
          'hover:text-[var(--nav-item-hover,var(--text-primary,var(--color-text,#18181b)))] dark:hover:text-white',
          'hover:bg-[var(--nav-item-active-bg,var(--color-secondary,rgba(0,0,0,0.04)))] dark:hover:bg-white/[7%]',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'data-current:bg-[var(--nav-item-active-bg,var(--color-accent,#f4f4f5))] dark:data-current:bg-white/[10%]',
          'data-current:text-[var(--nav-item-active-text,#ffffff)] dark:data-current:text-white data-current:font-semibold',
          className
        )}
        {...props}
      >
        {renderIcon()}
        <span className="flex-1 text-sm font-medium leading-none whitespace-nowrap">
          {children}
        </span>
        {renderBadge()}
      </Comp>
    );
  }
);
NavlistItem.displayName = 'NavlistItem';

export interface NavlistGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
}

export const NavlistGroup = React.forwardRef<HTMLDivElement, NavlistGroupProps>(
  (
    {
      heading,
      expandable = false,
      expanded = true,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = React.useState(expanded);

    React.useEffect(() => {
      setIsOpen(expanded);
    }, [expanded]);

    if (expandable) {
      return (
        <div
          ref={ref}
          data-open={isOpen ? '' : undefined}
          className={cn('group/disclosure block', className)}
          {...props}
        >
          {heading && (
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className="w-full h-10 lg:h-8 flex items-center group/disclosure-button mb-[2px] rounded-lg hover:bg-zinc-800/5 dark:hover:bg-white/[7%] text-zinc-500 hover:text-zinc-800 dark:text-white/80 dark:hover:text-white transition-colors select-none text-start px-3"
            >
              <div className="pe-2 shrink-0">
                <svg
                  className={cn(
                    'size-3 shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-90'
                  )}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium leading-none">
                {heading}
              </span>
            </button>
          )}

          {isOpen && (
            <div className="relative space-y-[2px] ps-7">
              <div className="absolute inset-y-[3px] w-px bg-zinc-200 dark:bg-white/20 start-0 ms-4" />
              {children}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn('block space-y-[2px]', className)}
        {...props}
      >
        {heading && (
          <div className="px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground leading-none">
              {heading}
            </div>
          </div>
        )}
        <div className="space-y-[2px]">{children}</div>
      </div>
    );
  }
);
NavlistGroup.displayName = 'NavlistGroup';

export const Navlist = Object.assign(NavlistRoot, {
  Item: NavlistItem,
  Group: NavlistGroup,
});
