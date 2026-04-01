import { Button } from './button';
import { Field } from './field';
import { cn } from '../../utils/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Copy, Eye, EyeOff, LucideIcon, X } from 'lucide-react';
import { Icon as UIIcon } from './icon';
import * as React from 'react';

const inputVariants = cva(
  'flex w-full rounded-md text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
  {
    variants: {
      variant: {
        outline: 'border border-input bg-background',
        filled: 'border border-transparent bg-muted',
      },
      size: {
        default: 'h-10 px-3 py-2',
        sm: 'h-9 px-3 py-1.5 text-sm',
        xs: 'h-8 px-2.5 py-1 text-xs',
      },
      invalid: {
        true: 'border-destructive focus-visible:ring-destructive',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
      invalid: false,
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  descriptionTrailing?: React.ReactNode;
  icon?: LucideIcon | string;
  iconTrailing?: LucideIcon | string;
  kbd?: string;
  clearable?: boolean;
  copyable?: boolean;
  viewable?: boolean;
  mask?: string;
  maskDynamic?: string;
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = 'text',
      variant,
      size,
      invalid,
      label,
      description,
      descriptionTrailing,
      icon: Icon,
      iconTrailing: IconTrailing,
      kbd,
      clearable,
      copyable,
      viewable,
      mask,
      maskDynamic,
      disabled,
      readOnly,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) => {
    const [inputType, setInputType] = React.useState(type);
    const [internalValue, setInternalValue] = React.useState(
      value !== undefined ? value : defaultValue || '',
    );
    const [copied, setCopied] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Sync internal value with controlled value
    React.useEffect(() => {
      if (value !== undefined) {
        setInternalValue(value);
      }
    }, [value]);

    // Merge refs
    React.useImperativeHandle(ref, () => inputRef.current!);

    // Handle keyboard shortcuts
    React.useEffect(() => {
      if (!kbd) {
        return;
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        // Parse kbd string (e.g., "Cmd+K" or "Ctrl+J")
        const keys = kbd.split('+').map((k) => k.trim().toLowerCase());
        const keyPressed = e.key.toLowerCase();

        let matches = false;
        if (keys.includes('cmd') || keys.includes('ctrl')) {
          if ((e.metaKey || e.ctrlKey) && keys.includes(keyPressed)) {
            matches = true;
          }
        } else if (keys.includes('shift')) {
          if (e.shiftKey && keys.includes(keyPressed)) {
            matches = true;
          }
        } else if (keys.includes(keyPressed)) {
          matches = true;
        }

        if (matches) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [kbd]);

    const handleClear = () => {
      const newValue = '';
      setInternalValue(newValue);
      if (onChange) {
        const event = {
          target: { value: newValue },
          currentTarget: { value: newValue },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      }
      inputRef.current?.focus();
    };

    const handleCopy = async () => {
      if (
        typeof internalValue === 'string' ||
        typeof internalValue === 'number'
      ) {
        await navigator.clipboard.writeText(String(internalValue));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const togglePasswordVisibility = () => {
      setInputType(inputType === 'password' ? 'text' : 'password');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInternalValue(newValue);
      if (onChange) {
        onChange(e);
      }
    };

    const hasValue =
      internalValue !== '' &&
      internalValue !== null &&
      internalValue !== undefined;
    const showClearButton = clearable && hasValue && !disabled && !readOnly;
    const showCopyButton =
      copyable && hasValue && !disabled && window.isSecureContext;
    const showViewButton = viewable && type === 'password' && !disabled;

    // Determine if we have any trailing elements
    const hasTrailingElements =
      showClearButton ||
      showCopyButton ||
      showViewButton ||
      IconTrailing ||
      kbd;

    const inputElement = (
      <div className="relative w-full">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {typeof Icon === 'string' ? (
              <UIIcon name={Icon} size={size === 'xs' ? 12 : 14} />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
        )}
        <input
          type={inputType}
          className={cn(
            inputVariants({ variant, size, invalid }),
            Icon && 'pl-9',
            hasTrailingElements && 'pr-24',
            className,
          )}
          ref={inputRef}
          disabled={disabled}
          readOnly={readOnly}
          value={internalValue}
          onChange={handleChange}
          {...(mask && {
            'data-mask': mask,
            'x-mask': mask,
          })}
          {...(maskDynamic && {
            'data-mask-dynamic': maskDynamic,
            'x-mask:dynamic': maskDynamic,
          })}
          {...props}
        />
        {hasTrailingElements && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-1 bg-gradient-to-l from-background via-background to-transparent">
            {kbd && (
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground opacity-100">
                {kbd}
              </kbd>
            )}
            {showClearButton && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                square
                className="h-6 w-6 rounded-sm hover:bg-muted"
                onClick={handleClear}
                tabIndex={-1}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
            {showCopyButton && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                square
                className="h-6 w-6 rounded-sm hover:bg-muted"
                onClick={handleCopy}
                tabIndex={-1}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {showViewButton && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                square
                className="h-6 w-6 rounded-sm hover:bg-muted"
                onClick={togglePasswordVisibility}
                tabIndex={-1}
              >
                {inputType === 'password' ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {IconTrailing &&
              !showClearButton &&
              !showCopyButton &&
              !showViewButton && (
                <div className="text-muted-foreground pointer-events-none px-1">
                  {typeof IconTrailing === 'string' ? (
                    <UIIcon
                      name={IconTrailing}
                      size={size === 'xs' ? 12 : 14}
                    />
                  ) : (
                    <IconTrailing className="h-4 w-4" />
                  )}
                </div>
              )}
          </div>
        )}
      </div>
    );

    // If label or description is provided, wrap in Field component (except for Radio usage which might pass children)
    if (label || description || descriptionTrailing) {
      return (
        <Field
          label={label}
          description={description}
          error={invalid}
          className="w-full"
        >
          {inputElement}
          {descriptionTrailing && (
            <p className="text-[0.7rem] text-muted-foreground mt-1">
              {descriptionTrailing}
            </p>
          )}
        </Field>
      );
    }

    return inputElement;
  },
);
Input.displayName = 'Input';

export { Input, inputVariants };
