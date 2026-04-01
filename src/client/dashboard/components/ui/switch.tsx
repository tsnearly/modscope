import React, { InputHTMLAttributes, useId } from 'react';

interface SwitchProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'align' | 'onChange'
  > {
  label?: string;
  description?: string;
  align?: 'right' | 'start' | 'end';
  disabled?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function Switch({
  label,
  description,
  align = 'right',
  disabled = false,
  checked,
  className = '',
  onCheckedChange,
  onChange,
  ...props
}: SwitchProps) {
  const id = useId();
  const descId = useId();

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onCheckedChange?.(e.target.checked);
    onChange?.(e);
  };

  const hasField = label || description;

  const toggleGraphic = (
    <div className="relative inline-flex shrink-0" data-flux-switch>
      <div
        data-checked={checked ? '' : undefined}
        className={[
          'w-9 h-5 rounded-full transition-colors relative flex items-center',
          checked
            ? 'bg-[var(--btn-primary-bg,var(--color-primary))]'
            : 'bg-gray-200',
          'focus-within:ring-2 focus-within:ring-offset-1 focus-within:ring-[var(--btn-primary-bg,var(--color-primary))]',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div
          className="absolute left-[2px] bg-white border border-gray-300 rounded-full h-4 w-4 transition-transform shadow-sm"
          style={{
            transform: checked ? 'translateX(16px)' : 'translateX(0px)',
          }}
        />
      </div>
    </div>
  );

  // Standalone — no label or description
  if (!hasField) {
    return (
      <label
        htmlFor={id}
        className={[
          'inline-flex cursor-pointer relative',
          disabled ? 'pointer-events-none opacity-50' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <input
          {...props}
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-checked={checked}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0 p-0"
          onChange={handleToggle}
        />
        {toggleGraphic}
      </label>
    );
  }

  // With flux:field wrapper — label + optional description
  const labelEl = (
    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
      {label && (
        <span
          className={[
            'text-sm font-medium leading-snug select-none',
            disabled ? 'text-gray-400' : 'text-gray-700',
          ].join(' ')}
        >
          {label}
        </span>
      )}
      {description && (
        <p
          id={descId}
          className={[
            'text-xs leading-snug',
            disabled ? 'text-gray-300' : 'text-gray-500',
          ].join(' ')}
        >
          {description}
        </p>
      )}
    </div>
  );

  // align='right' (default) — label left, switch right
  // align='start'           — switch left, label right
  // align='end'             — switch right, label left (same as right)
  const switchRight = align === 'right' || align === 'end';

  return (
    <label
      htmlFor={id}
      data-flux-switch
      className={[
        'flex items-center gap-3 relative',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        {...props}
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0 p-0"
        onChange={handleToggle}
      />
      {!switchRight && toggleGraphic}
      {labelEl}
      {switchRight && toggleGraphic}
    </label>
  );
}
