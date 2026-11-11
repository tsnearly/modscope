import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';
import { Icon } from './icon';
import { Tooltip } from './tooltip';
import { Avatar } from './avatar';
import { Button, type ButtonProps } from './button';

interface SidebarContextValue {
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isMobileOpen: boolean;
  setIsMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCollapse: () => void;
  toggleMobile: () => void;
  collapsible: 'mobile' | boolean;
  breakpoint: number;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    return {
      isCollapsed: false,
      setIsCollapsed: () => {},
      isMobileOpen: false,
      setIsMobileOpen: () => {},
      toggleCollapse: () => {},
      toggleMobile: () => {},
      collapsible: 'mobile' as const,
      breakpoint: 1024,
    };
  }
  return context;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  sticky?: boolean;
  collapsible?: 'mobile' | boolean;
  breakpoint?: number | string;
  stashable?: boolean; // Deprecated alias for collapsible="mobile"
  persist?: boolean;
  asChild?: boolean;
}

const SidebarRoot = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      sticky = false,
      collapsible = 'mobile',
      breakpoint = 1024,
      stashable,
      persist = true,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const resolvedCollapsible = stashable ? 'mobile' : collapsible;

    const parsedBreakpoint = React.useMemo(() => {
      if (typeof breakpoint === 'number') return breakpoint;
      if (typeof breakpoint === 'string') {
        if (breakpoint.endsWith('rem')) {
          return parseFloat(breakpoint) * 16;
        }
        return parseInt(breakpoint, 10) || 1024;
      }
      return 1024;
    }, [breakpoint]);

    const [isCollapsed, setIsCollapsed] = React.useState<boolean>(() => {
      if (
        typeof window !== 'undefined' &&
        persist &&
        resolvedCollapsible === true
      ) {
        try {
          return localStorage.getItem('modscope:sidebar:collapsed') === 'true';
        } catch {
          return false;
        }
      }
      return false;
    });

    const [isMobileOpen, setIsMobileOpen] = React.useState(false);

    React.useEffect(() => {
      if (
        persist &&
        resolvedCollapsible === true &&
        typeof window !== 'undefined'
      ) {
        try {
          localStorage.setItem(
            'modscope:sidebar:collapsed',
            String(isCollapsed)
          );
        } catch {}
      }
    }, [isCollapsed, persist, resolvedCollapsible]);

    const toggleCollapse = React.useCallback(() => {
      setIsCollapsed((prev) => !prev);
    }, []);

    const toggleMobile = React.useCallback(() => {
      setIsMobileOpen((prev) => !prev);
    }, []);

    const contextValue = React.useMemo<SidebarContextValue>(
      () => ({
        isCollapsed,
        setIsCollapsed,
        isMobileOpen,
        setIsMobileOpen,
        toggleCollapse,
        toggleMobile,
        collapsible: resolvedCollapsible,
        breakpoint: parsedBreakpoint,
      }),
      [
        isCollapsed,
        isMobileOpen,
        toggleCollapse,
        toggleMobile,
        resolvedCollapsible,
        parsedBreakpoint,
      ]
    );

    const Comp = asChild ? Slot : 'aside';

    return (
      <SidebarContext.Provider value={contextValue}>
        {/* Mobile Backdrop */}
        {resolvedCollapsible === 'mobile' && isMobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden transition-opacity"
            onClick={() => setIsMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <Comp
          ref={ref}
          data-collapsed={isCollapsed ? 'true' : undefined}
          data-mobile-open={isMobileOpen ? 'true' : undefined}
          className={cn(
            'flex flex-col shrink-0 transition-all duration-200 z-40',
            'bg-[var(--color-surface,var(--nav-bg,#ffffff))] dark:bg-zinc-900',
            'text-[var(--text-primary,var(--color-text,#18181b))] dark:text-zinc-100',
            'border-r border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800',
            sticky && 'sticky top-0',
            resolvedCollapsible === 'mobile'
              ? [
                  'h-screen',
                  isCollapsed ? 'lg:w-16' : 'lg:w-64',
                  'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-64 max-lg:shadow-xl',
                  isMobileOpen
                    ? 'max-lg:translate-x-0'
                    : 'max-lg:-translate-x-full lg:translate-x-0',
                  'p-3 space-y-3 overflow-y-auto overflow-x-hidden',
                ]
              : [
                  'h-full relative overflow-visible',
                  isCollapsed ? 'w-14 sm:w-16' : 'w-48 sm:w-52',
                  'translate-x-0',
                ],
            className
          )}
          {...props}
        >
          {children}
        </Comp>
      </SidebarContext.Provider>
    );
  }
);
SidebarRoot.displayName = 'Sidebar';

export interface SidebarHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

export const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  SidebarHeaderProps
>(({ className, asChild = false, children, ...props }, ref) => {
  const { isCollapsed } = useSidebar();
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      className={cn(
        'flex items-center min-h-10 px-1 gap-2 shrink-0',
        isCollapsed ? 'flex-col justify-center py-2 px-1' : 'justify-between',
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  );
});
SidebarHeader.displayName = 'SidebarHeader';

export interface SidebarBrandProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  logo?: string;
  logoDark?: string;
  'logo:dark'?: string;
  name?: React.ReactNode;
  asChild?: boolean;
}

export const SidebarBrand = React.forwardRef<
  HTMLAnchorElement,
  SidebarBrandProps
>(
  (
    {
      href = '/',
      logo,
      logoDark,
      'logo:dark': logoDarkProp,
      name,
      asChild = false,
      className,
      ...props
    },
    ref
  ) => {
    const { isCollapsed } = useSidebar();
    const activeLogoDark = logoDarkProp ?? logoDark;
    const Comp = asChild ? Slot : 'a';

    return (
      <Comp
        ref={ref}
        href={!asChild ? href : undefined}
        className={cn(
          'flex items-center gap-2.5 min-w-0 text-inherit no-underline select-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md transition-colors',
          className
        )}
        {...props}
      >
        {logo && (
          <div className="flex items-center justify-center size-7 rounded-sm shrink-0 overflow-hidden">
            {activeLogoDark ? (
              <>
                <img
                  src={logo}
                  alt={typeof name === 'string' ? name : ''}
                  className="size-full object-contain dark:hidden"
                />
                <img
                  src={activeLogoDark}
                  alt={typeof name === 'string' ? name : ''}
                  className="size-full object-contain hidden dark:block"
                />
              </>
            ) : (
              <img
                src={logo}
                alt={typeof name === 'string' ? name : ''}
                className="size-full object-contain"
              />
            )}
          </div>
        )}
        {name && !isCollapsed && (
          <span className="font-semibold text-sm truncate leading-none text-[var(--text-primary,var(--color-text,currentColor))]">
            {name}
          </span>
        )}
      </Comp>
    );
  }
);
SidebarBrand.displayName = 'SidebarBrand';

export interface SidebarCollapseProps extends Omit<ButtonProps, 'children' | 'inset'> {
  inset?: string;
  tooltip?: string;
}

export const SidebarCollapse = React.forwardRef<
  HTMLButtonElement,
  SidebarCollapseProps
>(
  (
    { inset: _inset, tooltip = 'Toggle sidebar', className, onClick, ...props },
    ref
  ) => {
    const { isCollapsed, toggleCollapse, setIsMobileOpen, collapsible } = useSidebar();

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (
        typeof window !== 'undefined' &&
        window.innerWidth < 1024 &&
        collapsible === 'mobile'
      ) {
        setIsMobileOpen(false);
      } else {
        toggleCollapse();
      }
      onClick?.(e);
    };

    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        tooltip={tooltip}
        tooltipPosition="right"
        aria-label={typeof tooltip === 'string' ? tooltip : 'Toggle sidebar'}
        onClick={handleClick}
        className={cn(
          'size-auto p-0 m-0 bg-transparent hover:bg-transparent active:bg-transparent',
          'border-0 shadow-none rounded-none outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'cursor-pointer select-none transition-transform active:scale-95',
          className
        )}
        {...props}
      >
        <Icon
          name={isCollapsed ? 'x-switch-off.png' : 'x-switch-on.png'}
          size={24}
          alt={typeof tooltip === 'string' ? tooltip : 'Toggle sidebar'}
          className="w-6 h-6 object-contain dark:invert [data-theme=nocturne]_&]:invert brightness-110 hover:opacity-80 transition-opacity"
          aria-hidden="true"
        />
      </Button>
    );
  }
);
SidebarCollapse.displayName = 'SidebarCollapse';

export interface SidebarToggleProps extends Omit<ButtonProps, 'children' | 'icon' | 'inset'> {
  icon?: string | React.ReactNode;
  inset?: string;
}

export const SidebarToggle = React.forwardRef<
  HTMLButtonElement,
  SidebarToggleProps
>(({ icon = 'menu', inset, className, onClick, ...props }, ref) => {
  const { toggleMobile } = useSidebar();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    toggleMobile();
    onClick?.(e);
  };

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label="Toggle sidebar"
      className={cn(
        'size-9 text-[var(--text-primary,var(--color-text,#18181b))] dark:text-zinc-100',
        'hover:bg-zinc-800/5 dark:hover:bg-white/10',
        inset === 'left' && '-ms-2',
        inset === 'right' && '-me-2',
        className
      )}
      {...props}
    >
      {typeof icon === 'string' ? (
        <Icon name={icon} size={20} className="size-5 shrink-0" />
      ) : (
        icon
      )}
    </Button>
  );
});
SidebarToggle.displayName = 'SidebarToggle';

export interface SidebarSearchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string;
}

export const SidebarSearch = React.forwardRef<
  HTMLInputElement,
  SidebarSearchProps
>(({ placeholder = 'Search...', className, ...props }, ref) => {
  const { isCollapsed } = useSidebar();

  if (isCollapsed) {
    return (
      <div
        className="flex items-center justify-center size-9 mx-auto rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800/5 dark:hover:bg-white/10 cursor-pointer"
        title={placeholder}
      >
        <svg
          className="size-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex items-center w-full rounded-lg border border-[var(--border-default,var(--color-border,#e4e4e7))] dark:border-zinc-800 bg-[var(--color-bg,#f4f4f5)] dark:bg-zinc-800/50 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all',
        className
      )}
    >
      <svg
        className="size-4 shrink-0 me-2 text-[var(--text-muted,var(--color-text-muted,#71717a))] dark:text-zinc-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="2"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-[var(--text-primary,var(--color-text,#18181b))] dark:text-zinc-100 placeholder-[var(--text-muted,var(--color-text-muted,#a1a1aa))] dark:placeholder-zinc-500 outline-none"
        {...props}
      />
    </div>
  );
});
SidebarSearch.displayName = 'SidebarSearch';

export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

export const SidebarNav = React.forwardRef<HTMLElement, SidebarNavProps>(
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
SidebarNav.displayName = 'SidebarNav';

export interface SidebarItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  icon?: string | React.ReactNode;
  badge?: string | number | boolean | React.ReactNode;
  current?: boolean;
  tooltip?: string;
  asChild?: boolean;
}

export const SidebarItem = React.forwardRef<
  HTMLAnchorElement,
  SidebarItemProps
>(
  (
    {
      href,
      icon,
      badge,
      current,
      tooltip,
      asChild = false,
      className,
      children,
      type: _type,
      ...props
    },
    ref
  ) => {
    const { isCollapsed } = useSidebar();

    const isCurrent = React.useMemo(() => {
      if (current !== undefined) return Boolean(current);
      if (typeof window !== 'undefined' && href) {
        return (
          window.location.pathname === href || window.location.hash === href
        );
      }
      return false;
    }, [current, href]);

    const Comp: any = asChild ? Slot : href ? 'a' : 'button';

    const itemElement = (
      <Comp
        ref={ref as any}
        href={!asChild && href ? href : undefined}
        type={!asChild && !href ? ('button' as const) : undefined}
        data-current={isCurrent ? '' : undefined}
        className={cn(
          'h-9 relative flex items-center rounded-lg px-2.5 py-0 text-start w-full select-none text-sm font-medium transition-colors outline-none cursor-pointer',
          'text-[var(--text-muted,var(--color-text-muted,#71717a))] dark:text-zinc-400',
          'hover:text-[var(--text-primary,var(--color-text,#18181b))] dark:hover:text-zinc-100',
          'hover:bg-[var(--color-secondary,var(--color-bg,rgba(0,0,0,0.04)))] dark:hover:bg-white/[7%]',
          'focus-visible:ring-2 focus-visible:ring-ring',
          'data-current:bg-[var(--nav-item-active-bg,var(--color-accent,#f4f4f5))] dark:data-current:bg-white/[10%]',
          'data-current:text-[var(--nav-item-active-text,var(--text-primary,#18181b))] dark:data-current:text-white',
          'data-current:font-semibold',
          isCollapsed ? 'justify-center px-0' : 'gap-3',
          className
        )}
        {...props}
      >
        {icon && (
          <div className="relative shrink-0 flex items-center justify-center">
            {typeof icon === 'string' ? (
              <Icon
                name={icon}
                size={18}
                className="size-4.5 shrink-0 text-current"
              />
            ) : (
              icon
            )}
          </div>
        )}
        {!isCollapsed && (
          <>
            <span className="flex-1 text-sm font-medium leading-none whitespace-nowrap truncate">
              {children}
            </span>
            {badge && (
              <span className="text-xs font-medium rounded-sm px-1.5 py-0.5 text-center ms-auto shrink-0 tabular-nums leading-none bg-[var(--color-secondary,rgba(0,0,0,0.06))] dark:bg-zinc-800 text-[var(--text-primary,currentColor)]">
                {badge === true ? null : badge}
              </span>
            )}
          </>
        )}
      </Comp>
    );

    if (isCollapsed) {
      const tooltipContent =
        tooltip ?? (typeof children === 'string' ? children : undefined);
      if (tooltipContent) {
        return (
          <Tooltip content={tooltipContent} side="right">
            {itemElement}
          </Tooltip>
        );
      }
    }

    return itemElement;
  }
);
SidebarItem.displayName = 'SidebarItem';

export interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode;
  expandable?: boolean;
  icon?: string | React.ReactNode;
  expanded?: boolean;
}

export const SidebarGroup = React.forwardRef<HTMLDivElement, SidebarGroupProps>(
  (
    {
      heading,
      expandable = false,
      icon,
      expanded = true,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { isCollapsed } = useSidebar();
    const [isOpen, setIsOpen] = React.useState(expanded);

    React.useEffect(() => {
      setIsOpen(expanded);
    }, [expanded]);

    // Spec: Groups without an icon specified will be hidden when the sidebar is collapsed
    if (isCollapsed && !icon) {
      return null;
    }

    if (isCollapsed && icon) {
      return (
        <div
          ref={ref}
          className={cn('space-y-[2px] w-full', className)}
          {...props}
        >
          {children}
        </div>
      );
    }

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
              className="w-full h-8 flex items-center group/disclosure-button mb-[2px] rounded-lg hover:bg-zinc-800/5 dark:hover:bg-white/[7%] text-[var(--text-muted,var(--color-text-muted,#71717a))] hover:text-[var(--text-primary,var(--color-text,#18181b))] dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors select-none text-start px-2.5"
            >
              {icon ? (
                <div className="pe-2 shrink-0">
                  {typeof icon === 'string' ? (
                    <Icon name={icon} size={16} className="size-4 shrink-0" />
                  ) : (
                    icon
                  )}
                </div>
              ) : (
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
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </div>
              )}
              <span className="text-xs font-semibold uppercase tracking-wider leading-none">
                {heading}
              </span>
            </button>
          )}

          {isOpen && (
            <div className="relative space-y-[2px] ps-4">
              <div className="absolute inset-y-[3px] w-px bg-[var(--border-default,var(--color-border,#e4e4e7))] dark:bg-zinc-800 start-0 ms-2" />
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
          <div className="px-2.5 py-1.5 flex items-center gap-2">
            {icon && (
              <div className="shrink-0 text-[var(--text-muted,var(--color-text-muted,#71717a))]">
                {typeof icon === 'string' ? (
                  <Icon name={icon} size={16} className="size-4 shrink-0" />
                ) : (
                  icon
                )}
              </div>
            )}
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted,var(--color-text-muted,#71717a))] dark:text-zinc-500 leading-none">
              {heading}
            </div>
          </div>
        )}
        <div className="space-y-[2px]">{children}</div>
      </div>
    );
  }
);
SidebarGroup.displayName = 'SidebarGroup';

export const SidebarSpacer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex-1 min-h-4', className)} {...props} />
));
SidebarSpacer.displayName = 'SidebarSpacer';

export interface SidebarProfileProps extends React.HTMLAttributes<HTMLDivElement> {
  avatar?: string;
  name?: React.ReactNode;
}

export const SidebarProfile = React.forwardRef<
  HTMLDivElement,
  SidebarProfileProps
>(({ avatar, name, className, ...props }, ref) => {
  const { isCollapsed } = useSidebar();

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2.5 p-1.5 rounded-lg select-none transition-colors hover:bg-zinc-800/5 dark:hover:bg-white/10 cursor-pointer',
        isCollapsed ? 'justify-center p-1' : '',
        className
      )}
      {...props}
    >
      <Avatar
        src={avatar}
        name={typeof name === 'string' ? name : undefined}
        size="sm"
        circle
      />
      {!isCollapsed && name && (
        <span className="text-sm font-medium leading-none truncate text-[var(--text-primary,var(--color-text,#18181b))] dark:text-zinc-100">
          {name}
        </span>
      )}
    </div>
  );
});
SidebarProfile.displayName = 'SidebarProfile';

export const Sidebar = Object.assign(SidebarRoot, {
  Header: SidebarHeader,
  Brand: SidebarBrand,
  Collapse: SidebarCollapse,
  Toggle: SidebarToggle,
  Search: SidebarSearch,
  Nav: SidebarNav,
  Item: SidebarItem,
  Group: SidebarGroup,
  Spacer: SidebarSpacer,
  Profile: SidebarProfile,
});
