import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils/cn';
import { Icon } from './icon';
import { Tooltip } from './tooltip';

const buttonVariants = cva(
  'inline-flex items-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]',
        secondary:
          'bg-[var(--btn-secondary-bg)] text-[var(--btn-secondary-text)] hover:bg-[var(--btn-secondary-hover)]',
        outline:
          'border border-[var(--border-default)] bg-transparent hover:bg-gray-100 text-[var(--text-primary)]',
        ghost: 'hover:bg-gray-100 text-[var(--text-primary)]',
        subtle:
          'bg-blue-50/50 text-blue-700 hover:bg-blue-50 active:bg-blue-100/50',
        link: 'text-[var(--text-primary)] underline-offset-4 hover:underline',
        danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        xs: 'h-7 px-2 text-[10px] rounded-sm',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
      align: {
        start: 'justify-start text-left',
        center: 'justify-center text-center',
        end: 'justify-end text-right',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      align: 'center',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  icon?: string;
  iconVariant?: 'outline' | 'solid' | 'mini' | 'micro';
  iconSize?: number;
  iconTrailing?: string;
  square?: boolean;
  loading?: boolean;
  tooltip?: React.ReactNode;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  tooltipBd?: string;
  kbd?: string;
  inset?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      align,
      asChild = false,
      icon,
      iconVariant = 'micro',
      iconSize,
      iconTrailing,
      square,
      loading,
      tooltip,
      tooltipPosition = 'top',
      tooltipBd,
      kbd,
      inset,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    // Determine icon size based on iconVariant
    const getIconSize = () => {
      if (iconSize) {
        return iconSize;
      }
      if (size === 'icon') {
        return 22;
      }
      if (size === 'xs') {
        return 12;
      }
      switch (iconVariant) {
        case 'outline':
          return 20;
        case 'solid':
          return 18;
        case 'mini':
          return 16;
        case 'micro':
          return 14;
        default:
          return 14;
      }
    };

    const finalIconSize = getIconSize();

    // Apply square styling if needed
    const squareClass = square ? 'aspect-square p-0' : '';
    const insetClass = inset ? 'shadow-inner bg-black/5' : '';

    const buttonContent = (
      <Comp
        className={cn(
          buttonVariants({ variant, size, align, className }),
          squareClass,
          insetClass,
        )}
        ref={ref}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-4 w-4 flex-shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {children && <span className="mx-1">{children}</span>}
          </>
        ) : (
          <>
            {icon && (
              <Icon
                name={icon}
                size={finalIconSize}
                className="flex-shrink-0"
              />
            )}
            {children && (
              <span
                className={cn(
                  'flex items-center gap-1.5',
                  icon || iconTrailing ? 'mx-1' : '',
                )}
              >
                {children}
                {kbd && (
                  <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 ml-1">
                    {kbd}
                  </kbd>
                )}
              </span>
            )}
            {iconTrailing && (
              <Icon
                name={iconTrailing}
                size={finalIconSize}
                className="flex-shrink-0"
              />
            )}
          </>
        )}
      </Comp>
    );

    if (tooltip) {
      return (
        <Tooltip
          content={tooltip}
          side={tooltipPosition}
          className={tooltipBd ? `bg-${tooltipBd}` : ''}
        >
          {buttonContent}
        </Tooltip>
      );
    }

    return buttonContent;
  },
);
Button.displayName = 'Button';

export interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
  vertical?: boolean;
}

const ButtonGroup = ({
  children,
  className,
  vertical = false,
}: ButtonGroupProps) => {
  return (
    <div
      className={cn(
        'inline-flex',
        vertical ? 'flex-col -space-y-px' : '-space-x-px',
        className,
      )}
    >
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) {
          return child;
        }
        const isFirst = index === 0;
        const isLast = index === React.Children.count(children) - 1;

        const childElement = child as React.ReactElement<any>;
        return React.cloneElement(childElement, {
          className: cn(
            childElement.props.className,
            !vertical
              ? cn(!isFirst && 'rounded-l-none', !isLast && 'rounded-r-none')
              : cn(!isFirst && 'rounded-t-none', !isLast && 'rounded-b-none'),
          ),
        });
      })}
    </div>
  );
};

export { Button, ButtonGroup, buttonVariants };
