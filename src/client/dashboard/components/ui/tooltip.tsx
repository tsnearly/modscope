import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../utils/cn';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delayDuration?: number;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
  showArrow?: boolean;
}

export function Tooltip({
  content,
  children,
  delayDuration = 200,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  className,
  showArrow = true,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'z-[9999] overflow-hidden rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] px-2.5 py-1.5 text-[10px] text-[var(--color-text)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 shadow-sm max-w-[280px] break-words leading-relaxed font-semibold',
              className
            )}
          >
            {content}
            {showArrow && (
              <TooltipPrimitive.Arrow className="fill-[var(--color-border)]" />
            )}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// Export the shared tooltip content styles for use with raw Radix primitives
export const tooltipContentClass =
  'z-[9999] overflow-hidden rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] px-2.5 py-1.5 text-[10px] text-[var(--color-text)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 shadow-sm max-w-[280px] break-words leading-relaxed font-semibold';

// Re-export Radix primitives for direct use when the trigger must be a specific element
export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = TooltipPrimitive.Content;
export const TooltipPortal = TooltipPrimitive.Portal;
export const TooltipArrow = TooltipPrimitive.Arrow;
