import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';

const cardVariants = cva('rounded-xl transition-colors text-card-foreground', {
  variants: {
    variant: {
      default: 'border border-border bg-card shadow-sm',
      outline: 'border border-border bg-transparent',
      muted: 'border border-border/50 bg-muted/40',
      soft: 'border border-transparent bg-muted/60',
      filled: 'border border-transparent bg-card shadow-none',
    },
    layout: {
      default: '',
      seamless: '[&>div]:p-0',
      flush: 'p-0 overflow-hidden',
      divided: 'divide-y divide-border/60',
      separated: 'space-y-4 bg-transparent border-0 shadow-none',
    },
  },
  defaultVariants: {
    variant: 'default',
    layout: 'default',
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const CardBase = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, layout, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, layout }), className)}
      style={{ backgroundColor: variant === 'default' ? 'var(--card-bg)' : undefined, ...style }}
      {...props}
    />
  )
);
CardBase.displayName = 'Card';

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  actions?: React.ReactNode;
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, actions, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between p-3 pb-2 sm:p-6 sm:pb-4 gap-2 sm:gap-4', className)}
      {...props}
    >
      <div className="space-y-1 flex-1">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
);
CardHeader.displayName = 'CardHeader';

const CardHeading = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-sm sm:text-base md:text-lg font-bold sm:font-semibold leading-snug tracking-tight text-foreground', className)}
    {...props}
  />
));
CardHeading.displayName = 'CardHeading';

const CardTitle = CardHeading;

const CardSubheading = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs sm:text-sm text-muted-foreground', className)}
    {...props}
  />
));
CardSubheading.displayName = 'CardSubheading';

const CardDescription = CardSubheading;

const CardActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center gap-2 shrink-0', className)}
    {...props}
  />
));
CardActions.displayName = 'CardActions';

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  inset?: boolean;
  flush?: boolean;
}

const CardBody = React.forwardRef<HTMLDivElement, CardBodyProps>(
  ({ className, inset, flush, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'p-3 pt-0 sm:p-6 sm:pt-0',
        flush && 'p-0 [&_table]:border-0 [&_table]:rounded-none',
        inset && 'mx-2 mb-2 p-2 sm:mx-6 sm:mb-6 sm:p-4 rounded-lg bg-muted/50 border border-border/60 shadow-inner',
        '[&_table]:w-full [&_table]:text-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
CardBody.displayName = 'CardBody';

const CardContent = CardBody;

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-3 pt-0 sm:p-6 sm:pt-0', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

type CardSubcomponents = {
  Header: typeof CardHeader;
  Heading: typeof CardHeading;
  Subheading: typeof CardSubheading;
  Actions: typeof CardActions;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
  Title: typeof CardTitle;
  Description: typeof CardDescription;
  Content: typeof CardContent;
};

const Card = CardBase as typeof CardBase & CardSubcomponents;
Card.Header = CardHeader;
Card.Heading = CardHeading;
Card.Subheading = CardSubheading;
Card.Actions = CardActions;
Card.Body = CardBody;
Card.Footer = CardFooter;
Card.Title = CardTitle;
Card.Description = CardDescription;
Card.Content = CardContent;

export {
  Card,
  CardHeader,
  CardHeading,
  CardSubheading,
  CardActions,
  CardBody,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
