/**
 * Checkbox & CheckboxGroup
 * FluxUI-style reusable components
 *
 * Props — Checkbox:
 *   label        {string}                      – rendered <label> text
 *   description  {string}                      – helper text below label
 *   disabled     {boolean}
 *   invalid      {boolean}
 *   variant      {'default'|'card'|'pill'|'button'}
 *   value        {string}                      – for use inside CheckboxGroup
 *   checked      {boolean}                     – controlled
 *   defaultChecked {boolean}                   – uncontrolled
 *   onChange     {(checked: boolean) => void}
 *   className    {string}
 *
 * Props — CheckboxGroup:
 *   label        {string}
 *   description  {string}
 *   disabled     {boolean}
 *   invalid      {boolean}
 *   variant      {'default'|'card'|'pill'|'button'}
 *   value        {string[]}                    – controlled selected values
 *   defaultValue {string[]}                    – uncontrolled initial values
 *   onChange     {(values: string[]) => void}
 *   orientation  {'horizontal'|'vertical'}
 *   children     {ReactNode}                   – <Checkbox> elements
 *   className    {string}
 */

import { useState, useId, createContext, useContext, ReactNode } from 'react';

type Variant = 'default' | 'card' | 'pill' | 'button';

interface GroupContextValue {
  value: string[];
  onChange: (itemValue: string, checked: boolean) => void;
  disabled: boolean;
  invalid: boolean;
  variant: Variant;
}

interface CheckboxProps {
  label?: string;
  description?: string;
  disabled?: boolean;
  invalid?: boolean;
  variant?: Variant;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

interface CheckboxGroupProps {
  label?: string;
  description?: string;
  disabled?: boolean;
  invalid?: boolean;
  variant?: Variant;
  value?: string[];
  defaultValue?: string[];
  onChange?: (values: string[]) => void;
  orientation?: 'horizontal' | 'vertical';
  children?: ReactNode;
  className?: string;
  errorMessage?: string;
}

/* ─── Context ──────────────────────────────────────────────────────────────── */

const GroupContext = createContext<GroupContextValue | null>(null);

/* ─── Styles (injected once) ───────────────────────────────────────────────── */

const STYLES = `
  /* ── reset / base ── */
  .fx-checkbox-field {
    display: flex;
    flex-direction: column;
    gap: 0;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  /* ── field wrapper (row for default/card) ── */
  .fx-checkbox-wrapper {
    display: inline-flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    position: relative;
    user-select: none;
  }
  .fx-checkbox-wrapper.is-disabled {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* ── native input (visually hidden, but accessible) ── */
  .fx-checkbox-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  /* ══ DEFAULT variant ════════════════════════════════════════════════════════ */
  .fx-checkbox-box {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    border-radius: 4px;
    border: 2px solid #CBD5E1;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .fx-checkbox-wrapper:not(.is-disabled):hover .fx-checkbox-box {
    border-color: var(--color-primary);
  }
  .fx-checkbox-input:focus-visible ~ .fx-checkbox-box,
  .fx-checkbox-wrapper:focus-within .fx-checkbox-box {
    box-shadow: 0 0 0 3px var(--color-primary);
    outline: none;
  }
  .fx-checkbox-box svg { display: none; }

  /* checked state */
  .fx-checkbox-wrapper.is-checked .fx-checkbox-box {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  .fx-checkbox-wrapper.is-checked .fx-checkbox-box svg { display: block; }

  /* invalid state */
  .fx-checkbox-wrapper.is-invalid .fx-checkbox-box {
    border-color: var(--color-error, #EF4444);
  }
  .fx-checkbox-wrapper.is-invalid.is-checked .fx-checkbox-box {
    background: var(--color-error, #EF4444);
    border-color: var(--color-error, #EF4444);
  }

  /* ── label / description ── */
  .fx-checkbox-content { display: flex; flex-direction: column; gap: 2px; }
  .fx-checkbox-label   { font-size: 14px; font-weight: 500; color: var(--color-text, #1E293B); line-height: 1.4; }
  .fx-checkbox-desc    { font-size: 12px; color: var(--color-text-muted, #64748B); line-height: 1.4; }
  .is-invalid > .fx-checkbox-content .fx-checkbox-label { color: var(--color-error, #EF4444); }

  /* ── error hint below field ── */
  .fx-checkbox-error { font-size: 12px; color: var(--color-error, #EF4444); margin-top: 4px; padding-left: 28px; }

  /* ══ CARD variant ═══════════════════════════════════════════════════════════ */
  .fx-checkbox-wrapper.variant-card {
    border: 1.5px solid var(--color-border, #E2E8F0);
    border-radius: 10px;
    padding: 14px 16px;
    gap: 12px;
    background: var(--color-surface, #fff);
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    align-items: center;
  }
  .fx-checkbox-wrapper.variant-card:not(.is-disabled):hover {
    border-color: var(--color-primary);
    background: var(--color-bg, #F8F9FF);
  }
  .fx-checkbox-wrapper.variant-card.is-checked {
    border-color: var(--color-primary);
    background: var(--color-surface, #F5F3FF);
  }
  .fx-checkbox-wrapper.variant-card.is-invalid {
    border-color: var(--color-error, #FCA5A5);
    background: var(--color-bg, #FFF5F5);
  }
  .fx-checkbox-wrapper.variant-card.is-checked.is-invalid {
    border-color: var(--color-error, #EF4444);
    background: var(--color-surface, #FEF2F2);
  }

  /* ══ PILL variant ════════════════════════════════════════════════════════════ */
  .fx-checkbox-wrapper.variant-pill {
    border: 1.5px solid var(--color-border, #E2E8F0);
    border-radius: 999px;
    padding: 6px 16px;
    gap: 8px;
    background: var(--color-surface, #fff);
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    align-items: center;
  }
  .fx-checkbox-wrapper.variant-pill .fx-checkbox-label { font-size: 13px; }
  .fx-checkbox-wrapper.variant-pill:not(.is-disabled):hover {
    border-color: var(--color-secondary, #A5B4FC);
    background: var(--color-bg, #F8F9FF);
  }
  .fx-checkbox-wrapper.variant-pill.is-checked {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }
  .fx-checkbox-wrapper.variant-pill.is-checked .fx-checkbox-label { color: #fff; }
  .fx-checkbox-wrapper.variant-pill.is-checked .fx-checkbox-box {
    background: rgba(255,255,255,0.25);
    border-color: rgba(255,255,255,0.5);
  }
  .fx-checkbox-wrapper.variant-pill.is-invalid { border-color: var(--color-error, #FCA5A5); }
  .fx-checkbox-wrapper.variant-pill.is-checked.is-invalid {
    background: var(--color-error, #EF4444);
    border-color: var(--color-error, #EF4444);
  }

  /* ══ BUTTON variant ══════════════════════════════════════════════════════════ */
  .fx-checkbox-wrapper.variant-button {
    border: 1.5px solid var(--color-border, #E2E8F0);
    border-radius: 8px;
    padding: 8px 18px;
    gap: 0;
    background: var(--color-surface, #fff);
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    align-items: center;
    justify-content: center;
  }
  .fx-checkbox-wrapper.variant-button .fx-checkbox-box { display: none; }
  .fx-checkbox-wrapper.variant-button .fx-checkbox-label { font-size: 13px; font-weight: 600; }
  .fx-checkbox-wrapper.variant-button:not(.is-disabled):hover {
    border-color: var(--color-primary);
    background: var(--color-bg, #F5F3FF);
    box-shadow: 0 1px 4px rgba(0,0,0,.1);
  }
  .fx-checkbox-wrapper.variant-button.is-checked {
    border-color: var(--color-primary);
    background: var(--color-primary);
    box-shadow: 0 1px 6px rgba(0,0,0,.15);
  }
  .fx-checkbox-wrapper.variant-button.is-checked .fx-checkbox-label { color: #fff; }
  .fx-checkbox-wrapper.variant-button.is-invalid { border-color: var(--color-error, #FCA5A5); }
  .fx-checkbox-wrapper.variant-button.is-checked.is-invalid {
    background: var(--color-error, #EF4444);
    border-color: var(--color-error, #EF4444);
  }

  /* ══ GROUP ═══════════════════════════════════════════════════════════════════ */
  .fx-checkbox-group { display: flex; flex-direction: column; gap: 6px; }
  .fx-checkbox-group-label {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #1E293B;
    letter-spacing: 0.01em;
  }
  .fx-checkbox-group-desc {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 12px;
    color: #64748B;
    margin-top: 1px;
    margin-bottom: 6px;
  }
  .fx-checkbox-group-error {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 12px;
    color: #EF4444;
    margin-top: 4px;
  }
  .fx-checkbox-group-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fx-checkbox-group-items.horizontal {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 10px;
  }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') {
    return;
  }
  const el = document.createElement('style');
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

/* ─── Checkmark SVG ─────────────────────────────────────────────────────────── */
const CheckIcon = () => (
  <svg
    width="11"
    height="9"
    viewBox="0 0 11 9"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1 4L4 7.5L10 1"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ─── Checkbox ──────────────────────────────────────────────────────────────── */
export function Checkbox({
  label,
  description,
  disabled = false,
  invalid = false,
  variant = 'default',
  value,
  checked: controlledChecked,
  defaultChecked = false,
  onChange,
  onCheckedChange,
  className = '',
}: CheckboxProps) {
  injectStyles();

  const group = useContext(GroupContext);
  const id = useId();

  // When inside a group, delegate checked state to group context
  const isInGroup = group !== null;
  const isDisabled = disabled || (isInGroup && group.disabled);
  const isInvalid = invalid || (isInGroup && group.invalid);

  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const resolvedVariant = isInGroup ? group.variant : variant;

  let isChecked;
  if (isInGroup && value !== undefined) {
    isChecked = group.value.includes(value);
  } else if (controlledChecked !== undefined) {
    isChecked = controlledChecked;
  } else {
    isChecked = internalChecked;
  }

  const handleChange = (e) => {
    const next = e.target.checked;
    if (isInGroup && value !== undefined) {
      group.onChange(value, next);
    } else {
      if (controlledChecked === undefined) {
        setInternalChecked(next);
      }
      onChange?.(next);
      onCheckedChange?.(next);
    }
  };

  const wrapperClasses = [
    'fx-checkbox-wrapper',
    `variant-${resolvedVariant}`,
    isChecked ? 'is-checked' : '',
    isDisabled ? 'is-disabled' : '',
    isInvalid ? 'is-invalid' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fx-checkbox-field">
      <label className={wrapperClasses} htmlFor={id}>
        <input
          className="fx-checkbox-input"
          type="checkbox"
          id={id}
          value={value}
          checked={isChecked}
          disabled={isDisabled}
          aria-invalid={isInvalid || undefined}
          onChange={handleChange}
        />
        {resolvedVariant !== 'button' && (
          <span className="fx-checkbox-box" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
        {(label || description) && (
          <span className="fx-checkbox-content">
            {label && <span className="fx-checkbox-label">{label}</span>}
            {description && (
              <span className="fx-checkbox-desc">{description}</span>
            )}
          </span>
        )}
      </label>
    </div>
  );
}

/* ─── CheckboxGroup ─────────────────────────────────────────────────────────── */
export function CheckboxGroup({
  label,
  description,
  disabled = false,
  invalid = false,
  variant = 'default',
  value: controlledValue,
  defaultValue = [],
  onChange,
  orientation = 'vertical',
  children,
  className = '',
  errorMessage,
}: CheckboxGroupProps) {
  injectStyles();

  const [internalValue, setInternalValue] = useState<string[]>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  const handleItemChange = (itemValue: string, checked: boolean) => {
    const next = checked
      ? [...currentValue, itemValue]
      : currentValue.filter((v) => v !== itemValue);
    if (!isControlled) {
      setInternalValue(next);
    }
    onChange?.(next);
  };

  const ctx = {
    value: currentValue,
    onChange: handleItemChange,
    disabled,
    invalid,
    variant,
  };

  const groupClasses = ['fx-checkbox-group', className]
    .filter(Boolean)
    .join(' ');
  const itemsClasses = [
    'fx-checkbox-group-items',
    orientation === 'horizontal' ? 'horizontal' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <GroupContext.Provider value={ctx}>
      <fieldset
        className={groupClasses}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        style={{ border: 'none', margin: 0, padding: 0 }}
      >
        {label && <legend className="fx-checkbox-group-label">{label}</legend>}
        {description && <p className="fx-checkbox-group-desc">{description}</p>}
        <div className={itemsClasses} role="group">
          {children}
        </div>
        {invalid && errorMessage && (
          <p className="fx-checkbox-group-error" role="alert">
            {errorMessage}
          </p>
        )}
      </fieldset>
    </GroupContext.Provider>
  );
}

/* ─── Default export (namespace object) ─────────────────────────────────────── */
Checkbox.Group = CheckboxGroup;
export default Checkbox;
