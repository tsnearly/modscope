import * as React from 'react';
import { Label } from './label';
import { cn } from '../../utils/cn';

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode | undefined;
  error?: string | boolean | undefined;
  description?: React.ReactNode | undefined;
  children: React.ReactNode;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, error, description, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('space-y-2', className)} {...props}>
        {label && (
          <Label className={cn(error && 'text-destructive')}>{label}</Label>
        )}
        {children}
        {description && !error && (
          <p className="text-[0.8rem] text-muted-foreground">{description}</p>
        )}
        {error && typeof error === 'string' && (
          <p className="text-[0.8rem] font-medium text-destructive">{error}</p>
        )}
      </div>
    );
  }
);
Field.displayName = 'Field';

export { Field };
