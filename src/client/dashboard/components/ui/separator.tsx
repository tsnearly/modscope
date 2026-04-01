import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils/cn';

const separatorVariants = cva('shrink-0', {
  variants: {
    orientation: {
      horizontal: 'h-[1px] w-full',
      vertical: 'h-full w-[1px]',
    },
    variant: {
      default: 'bg-border',
      subtle: 'bg-border/40',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
    variant: 'default',
  },
});

export interface SeparatorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof separatorVariants> {
  vertical?: boolean;
  text?: string;
  /**
   * Spacing around the separator line. For horizontal: top/bottom margin.
   * For vertical: left/right margin on the line itself.
   * Accepts any CSS length value, e.g. "0.5rem", "8px".
   * Uses inline style to guarantee it survives global CSS resets.
   */
  spacing?: string;
  /**
   * For vertical separators used as column dividers: adds left padding
   * to the separator element's wrapper so the adjacent content isn't
   * flush against the line. Accepts any CSS length value.
   */
  gap?: string;
}

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  (
    {
      className,
      orientation = 'horizontal',
      vertical = false,
      variant,
      text,
      spacing,
      gap,
      style,
      ...props
    },
    ref,
  ) => {
    const finalOrientation = vertical ? 'vertical' : orientation;

    // Build spacing styles via inline style (immune to * { padding/margin: 0 } resets)
    const spacingStyle: React.CSSProperties = {};
    if (spacing) {
      if (finalOrientation === 'horizontal') {
        spacingStyle.marginTop = spacing;
        spacingStyle.marginBottom = spacing;
      } else {
        spacingStyle.marginLeft = spacing;
        spacingStyle.marginRight = spacing;
      }
    }
    if (gap && finalOrientation === 'vertical') {
      spacingStyle.paddingLeft = gap;
    }

    const mergedStyle = { ...spacingStyle, ...style };

    if (text) {
      return (
        <div
          className={cn(
            'flex items-center text-xs text-muted-foreground font-medium',
            finalOrientation === 'horizontal'
              ? 'w-full flex-row'
              : 'h-full flex-col',
            className,
          )}
          ref={ref}
          data-flux-separator=""
          aria-orientation={finalOrientation}
          role="separator"
          style={mergedStyle}
          {...props}
        >
          <div
            className={cn(
              separatorVariants({ orientation: finalOrientation, variant }),
              'flex-grow shrink',
              finalOrientation === 'horizontal' ? 'w-auto' : 'h-auto',
            )}
          />
          <span
            className={cn(finalOrientation === 'horizontal' ? 'px-2' : 'py-2')}
          >
            {text}
          </span>
          <div
            className={cn(
              separatorVariants({ orientation: finalOrientation, variant }),
              'flex-grow shrink',
              finalOrientation === 'horizontal' ? 'w-auto' : 'h-auto',
            )}
          />
        </div>
      );
    }

    return (
      <div
        ref={ref}
        role="separator"
        data-flux-separator=""
        aria-orientation={finalOrientation}
        className={cn(
          separatorVariants({
            orientation: finalOrientation,
            variant,
            className,
          }),
        )}
        style={mergedStyle}
        {...props}
      />
    );
  },
);
Separator.displayName = 'Separator';

export { Separator };
