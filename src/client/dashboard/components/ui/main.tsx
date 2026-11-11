import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';

export interface MainProps extends React.HTMLAttributes<HTMLElement> {
  container?: boolean;
  asChild?: boolean;
}

export const Main = React.forwardRef<HTMLElement, MainProps>(
  (
    { container = false, asChild = false, className, children, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'main';
    return (
      <Comp
        ref={ref}
        className={cn(
          'flex-1 overflow-y-auto p-6 lg:p-8',
          'bg-[var(--color-bg,inherit)] text-[var(--text-primary,inherit)]',
          container && 'max-w-7xl mx-auto w-full',
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
Main.displayName = 'Main';
