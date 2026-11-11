import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: '',
      muted: 'text-muted-foreground',
      subtle: 'text-muted-foreground/80',
      destructive: 'text-destructive',
      caption: 'text-xs text-muted-foreground',
      code: 'font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border/50',
    },
    size: {
      default: 'text-sm',
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
    },
    weight: {
      default: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },
    mono: {
      true: 'font-mono',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
    weight: 'default',
    mono: false,
  },
});

export interface TextProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof textVariants> {
  as?: 'p' | 'span' | 'div' | 'label' | 'small' | 'code';
}

const Text = React.forwardRef<HTMLElement, TextProps>(
  ({ className, variant, size, weight, mono, as: Component = 'p', ...props }, ref) => {
    return (
      <Component
        ref={ref as any}
        className={cn(textVariants({ variant, size, weight, mono }), className)}
        {...(props as any)}
      />
    );
  }
);
Text.displayName = 'Text';

export { Text, textVariants };
