import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';

export interface BrandLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

const BrandLogo = React.forwardRef<HTMLDivElement, BrandLogoProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(
          'flex items-center justify-center h-6 min-w-6 rounded-sm overflow-hidden shrink-0',
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
BrandLogo.displayName = 'BrandLogo';

export interface BrandProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /**
   * Company or application name to display next to the logo.
   */
  name?: React.ReactNode;
  /**
   * URL to the image to display as logo, or custom ReactNode / slot content.
   */
  logo?: React.ReactNode;
  /**
   * Alternative text for the logo.
   */
  alt?: string;
  /**
   * URL to navigate to when the brand is clicked. Default: '/'.
   */
  href?: string;
  /**
   * Change the default rendered element for the one passed as a child, merging their props and behavior.
   */
  asChild?: boolean;
}

const BrandRoot = React.forwardRef<HTMLAnchorElement, BrandProps>(
  (
    {
      name,
      logo,
      alt,
      href = '/',
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'a';

    const renderLogo = () => {
      if (!logo) return null;
      if (React.isValidElement(logo)) {
        return <BrandLogo asChild>{logo}</BrandLogo>;
      }
      return (
        <BrandLogo>
          {typeof logo === 'string' ? (
            <img
              src={logo}
              alt={alt ?? (typeof name === 'string' ? name : '')}
              className="h-6 w-auto max-h-full object-contain"
            />
          ) : (
            logo
          )}
        </BrandLogo>
      );
    };

    return (
      <Comp
        ref={ref}
        href={asChild ? undefined : href}
        className={cn(
          'h-10 flex items-center me-4 gap-2 text-[var(--text-primary,var(--color-text,currentColor))] text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md transition-colors select-none',
          className
        )}
        {...props}
      >
        {renderLogo()}
        {children}
        {name && (
          <div className="text-sm font-medium truncate text-[var(--text-primary,var(--color-text,currentColor))] text-foreground">
            {name}
          </div>
        )}
      </Comp>
    );
  }
);
BrandRoot.displayName = 'Brand';

export const Brand = Object.assign(BrandRoot, {
  Logo: BrandLogo,
});

export { BrandLogo };
