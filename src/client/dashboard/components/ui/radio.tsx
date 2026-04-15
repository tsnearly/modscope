import { Icon } from './icon';
import { Field } from './field';
import { cn } from '../../utils/cn';
import React, { createContext, useContext } from 'react';

interface RadioGroupContextType {
  value: string;
  name?: string | undefined;
  onChange: (value: string) => void;
  variant?: 'default' | 'cards' | 'segmented' | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
}

const RadioGroupContext = createContext<RadioGroupContextType | undefined>(
  undefined
);

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  name?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'cards' | 'segmented';
  invalid?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function RadioGroup({
  value,
  defaultValue,
  name,
  label,
  description,
  variant = 'default',
  invalid,
  disabled,
  onChange,
  children,
  className = '',
}: RadioGroupProps) {
  const handleChange = (newValue: string) => {
    if (disabled) {
      return;
    }
    onChange?.(newValue);
  };

  const groupContent = (
    <RadioGroupContext.Provider
      value={{
        value: value || defaultValue || '',
        name,
        onChange: handleChange,
        variant,
        invalid,
        disabled,
      }}
    >
      <div
        className={cn(
          variant === 'cards'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
            : 'space-y-2',
          variant === 'segmented'
            ? 'flex bg-muted p-1 rounded-lg self-start'
            : '',
          className
        )}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );

  if (label || description) {
    return (
      <Field label={label} description={description} error={invalid}>
        {groupContent}
      </Field>
    );
  }

  return groupContent;
}

export interface RadioGroupItemProps {
  value: string;
  id?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  icon?: string;
  disabled?: boolean;
  className?: string;
}

export function RadioItem({
  value,
  id,
  label,
  description,
  icon,
  disabled: ownDisabled,
  className = '',
}: RadioGroupItemProps) {
  const context = useContext(RadioGroupContext);
  if (!context) {
    throw new Error('RadioItem must be used within RadioGroup');
  }

  const isChecked = context.value === value;
  const inputId =
    id || `radio-${value}-${Math.random().toString(36).substr(2, 9)}`;
  const { variant } = context;
  // Merge own disabled with group-level disabled from context
  const disabled = ownDisabled ?? context.disabled;

  if (variant === 'cards') {
    return (
      <label
        htmlFor={inputId}
        className={cn(
          'relative flex cursor-pointer rounded-lg border bg-white p-6 shadow-sm focus:outline-none transition-all',
          isChecked
            ? 'border-primary ring-1 ring-primary bg-primary/10'
            : 'border-gray-200 hover:border-gray-300',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <div className="flex w-full items-start justify-between">
          <div className="flex items-start gap-4">
            {icon && (
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                  isChecked
                    ? 'bg-primary text-white border-primary'
                    : 'bg-gray-50 border-gray-100 text-gray-400'
                )}
              >
                <Icon name={icon} size={24} />
              </div>
            )}
            <div>
              <span
                className={cn(
                  'block text-sm font-bold',
                  isChecked ? 'text-primary' : 'text-gray-900'
                )}
              >
                {label}
              </span>
              {description && (
                <span className="mt-1 block text-xs text-gray-500 leading-relaxed">
                  {description}
                </span>
              )}
            </div>
          </div>
          <div
            className={cn(
              'h-5 w-5 shrink-0 rounded-full border flex items-center justify-center transition-colors mt-0.5',
              isChecked
                ? 'bg-primary border-primary'
                : 'bg-white border-gray-300'
            )}
          >
            {isChecked && <div className="h-2 w-2 rounded-full bg-white" />}
          </div>
        </div>
        <input
          type="radio"
          id={inputId}
          name={context.name}
          value={value}
          checked={isChecked}
          onChange={() => context.onChange(value)}
          disabled={disabled}
          className="sr-only"
        />
      </label>
    );
  }

  if (variant === 'segmented') {
    return (
      <label
        htmlFor={inputId}
        className={cn(
          'flex-1 px-4 py-1.5 text-sm font-medium rounded-md cursor-pointer transition-all text-center whitespace-nowrap',
          isChecked
            ? 'bg-white text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {label}
        <input
          type="radio"
          id={inputId}
          name={context.name}
          value={value}
          checked={isChecked}
          onChange={() => context.onChange(value)}
          disabled={disabled}
          className="sr-only"
        />
      </label>
    );
  }

  return (
    <label
      className={cn(
        'flex items-start gap-3 cursor-pointer group',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <div className="flex h-5 items-center">
        <input
          type="radio"
          id={inputId}
          name={context.name}
          value={value}
          checked={isChecked}
          onChange={() => context.onChange(value)}
          disabled={disabled}
          className="h-4 w-4 border-gray-300 text-primary focus:ring-primary cursor-pointer"
        />
      </div>
      <div className="text-sm">
        <span
          className={cn(
            'font-medium transition-colors',
            isChecked
              ? 'text-foreground'
              : 'text-gray-700 group-hover:text-foreground'
          )}
        >
          {label}
        </span>
        {description && (
          <p className="text-gray-500 mt-0.5 text-xs">{description}</p>
        )}
      </div>
    </label>
  );
}

// Support legacy naming
export const RadioGroupItem = RadioItem;
