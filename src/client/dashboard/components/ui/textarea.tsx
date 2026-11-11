import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';
import { Field } from './field';

const textareaVariants = cva(
  'flex w-full rounded-md border text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
  {
    variants: {
      variant: {
        outline: 'border-input bg-background',
        filled: 'border-transparent bg-muted',
      },
      size: {
        default: 'px-3 py-2 text-sm',
        sm: 'px-2.5 py-1.5 text-xs',
        lg: 'px-4 py-3 text-base',
      },
      resize: {
        none: 'resize-none',
        vertical: 'resize-y',
        both: 'resize',
      },
      fontMono: {
        true: 'font-mono',
        false: '',
      },
      invalid: {
        true: 'border-destructive focus-visible:ring-destructive',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
      resize: 'vertical',
      fontMono: false,
      invalid: false,
    },
  }
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string | boolean;
  invalid?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      variant,
      size,
      resize,
      fontMono,
      invalid,
      label,
      description,
      error,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const isInvalid = invalid || Boolean(error);
    const textareaElement = (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          textareaVariants({ variant, size, resize, fontMono, invalid: isInvalid }),
          className
        )}
        {...props}
      />
    );

    if (label || description || error) {
      return (
        <Field label={label} description={description} error={error}>
          {textareaElement}
        </Field>
      );
    }

    return textareaElement;
  }
);
Textarea.displayName = 'Textarea';

export { Textarea, textareaVariants };
