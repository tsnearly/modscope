import React, { useState, createContext, useContext } from 'react';
import { Icon } from './icon';
import { cn } from '../../utils/cn';

interface AccordionContextType {
  variant?: 'default' | 'reverse';
  exclusive?: boolean;
  expandedItems: string[];
  toggleItem: (id: string) => void;
  /** When true, item headers use bg-muted/50 like a CardHeader. Default false (transparent). */
  cardStyle?: boolean;
}

const AccordionContext = createContext<AccordionContextType | undefined>(
  undefined
);

export interface AccordionRootProps {
  children: React.ReactNode;
  variant?: 'default' | 'reverse';
  exclusive?: boolean;
  transition?: boolean;
  className?: string;
  defaultExpanded?: string[];
  expanded?: string[];
  onExpandedChange?: (items: string[]) => void;
  /** When true, item headers get bg-muted/50 styling to match CardHeader. */
  cardStyle?: boolean;
}

export function AccordionRoot({
  children,
  variant = 'default',
  exclusive = false,
  className,
  defaultExpanded = [],
  expanded,
  onExpandedChange,
  cardStyle = false,
}: AccordionRootProps) {
  const [internalExpanded, setInternalExpanded] =
    useState<string[]>(defaultExpanded);
  const isControlled = expanded !== undefined;
  const currentExpanded = isControlled ? expanded : internalExpanded;

  const handleToggle = (id: string) => {
    const isOpen = currentExpanded.includes(id);
    let next: string[];
    if (exclusive) {
      next = isOpen ? [] : [id];
    } else {
      next = isOpen
        ? currentExpanded.filter((item) => item !== id)
        : [...currentExpanded, id];
    }
    if (!isControlled) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };

  return (
    <AccordionContext.Provider
      value={{
        variant,
        exclusive,
        expandedItems: currentExpanded,
        toggleItem: handleToggle,
        cardStyle,
      }}
    >
      <div className={cn('flex flex-col gap-2', className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  id: string;
  heading: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function AccordionItem({
  id,
  heading,
  children,
  disabled,
  className,
}: AccordionItemProps) {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error('AccordionItem must be used within AccordionRoot');
  }

  const isOpen = context.expandedItems.includes(id);
  const isReverse = context.variant === 'reverse';
  const cardStyle = context.cardStyle ?? false;

  return (
    <div
      className={cn(
        'border border-border rounded-lg bg-background overflow-hidden',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      <button
        data-accordion-trigger
        className={cn(
          'w-full flex items-center justify-between p-4 text-sm font-bold text-foreground transition-all cursor-pointer',
          cardStyle
            ? 'bg-muted/50 hover:bg-muted/70'
            : 'bg-transparent hover:bg-muted/20',
          isOpen && 'border-b border-border'
        )}
        onClick={() => context.toggleItem(id)}
      >
        {isReverse ? (
          <div className="flex items-center gap-3 w-full">
            <Icon
              name="lucide:chevron-down"
              size={16}
              className={cn(
                'flex-shrink-0 transition-transform duration-200',
                isOpen ? 'rotate-180 text-primary' : 'text-muted-foreground'
              )}
            />
            <span className="flex-1 text-left">{heading}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <span className="flex-1 text-left">{heading}</span>
            <Icon
              name="lucide:chevron-down"
              size={16}
              className={cn(
                'flex-shrink-0 transition-transform duration-200',
                isOpen ? 'rotate-180 text-primary' : 'text-muted-foreground'
              )}
            />
          </div>
        )}
      </button>
      <div
        className={cn(
          'transition-all duration-300 ease-in-out overflow-hidden',
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div
          data-accordion-content
          className="p-6 bg-card text-foreground leading-relaxed"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Support legacy usage — transparent header (About page style)
export function Accordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <AccordionRoot
      defaultExpanded={defaultOpen ? ['legacy'] : []}
      exclusive
      cardStyle={false}
    >
      <AccordionItem id="legacy" heading={title}>
        {children}
      </AccordionItem>
    </AccordionRoot>
  );
}
