import React, { createContext, useContext, useState } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from './icon';

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
  variant: 'default' | 'segmented' | 'pills';
  size?: 'sm' | 'md' | 'lg';
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

export interface TabsGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'default' | 'segmented' | 'pills';
  size?: 'sm' | 'md' | 'lg';
  scrollable?: boolean;
  children: React.ReactNode;
}

export function TabsGroup({
  value: controlledValue,
  defaultValue,
  onValueChange,
  variant = 'default',
  size = 'md',
  scrollable = false,
  children,
  className = '',
  ...props
}: TabsGroupProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : uncontrolledValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) {
      setUncontrolledValue(newValue);
    }
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider
      value={{
        value: currentValue || '',
        onValueChange: handleValueChange,
        variant,
        size,
      }}
    >
      <div className={cn('flex flex-col w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function TabList({ children, className = '', ...props }: TabListProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('TabList must be used within TabsGroup');
  }

  const variantStyles = {
    default: 'border-b border-[var(--color-border)]',
    segmented: 'bg-muted/50 p-1 rounded-lg inline-flex self-start',
    pills: 'gap-2 flex-wrap',
  };

  return (
    <div
      className={cn(
        'flex items-center',
        variantStyles[context.variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  name?: string;
  icon?: string;
  iconTrailing?: string;
  accent?: string;
}

export function Tab({
  value,
  name,
  icon,
  iconTrailing,
  accent,
  children,
  className = '',
  ...props
}: TabProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tab must be used within TabsGroup');
  }

  const isActive = context.value === value;
  const { variant, size } = context;

  const baseStyles =
    'inline-flex items-center justify-center gap-2 transition-all focus:outline-none disabled:opacity-50 disabled:pointer-events-none';

  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }[size || 'md'];

  const variantStyles = {
    default: cn(
      'border-b-2 font-medium -mb-px',
      isActive
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
    ),
    segmented: cn(
      'rounded-md font-semibold',
      isActive
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:bg-background/40 hover:text-foreground',
    ),
    pills: cn(
      'rounded-full font-medium border',
      isActive
        ? accent
          ? `bg-${accent}-500 text-white border-${accent}-500`
          : 'bg-primary text-primary-foreground border-primary'
        : 'bg-transparent text-muted-foreground border-border hover:bg-muted',
    ),
  }[variant];

  return (
    <button
      onClick={() => context.onValueChange(value)}
      className={cn(baseStyles, sizeStyles, variantStyles, className)}
      {...props}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children || name}
      {iconTrailing && (
        <Icon name={iconTrailing} size={size === 'sm' ? 14 : 16} />
      )}
    </button>
  );
}

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  children: React.ReactNode;
}

export function TabPanel({
  value,
  children,
  className = '',
  ...props
}: TabPanelProps) {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('TabPanel must be used within TabsGroup');
  }

  if (context.value !== value) {
    return null;
  }

  return (
    <div className={cn('mt-4', className)} {...props}>
      {children}
    </div>
  );
}

// Support legacy usage
export const Tabs = TabsGroup;
export const TabsList = TabList;
export const TabsTrigger = Tab;
export const TabsContent = TabPanel;
