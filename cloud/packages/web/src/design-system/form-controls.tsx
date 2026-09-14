import { useState, type ChangeEvent } from 'react';

import { Button } from './components.js';

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

/** `YYYY-MM-DDTHH:mm` → `YYYY-MM-DD HH:mm`, the same text format as the automatic check-out field. */
export function formatLocalDateTime(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value) ? value.slice(0, 16).replace('T', ' ') : '';
}

/**
 * A datetime field that always reads `YYYY-MM-DD HH:mm`, left-aligned, while keeping the platform picker.
 * The native input covers the field invisibly: iOS Safari otherwise renders a wide, centred, localised value
 * that overflows narrow screens. Receives `id`/`className`/`aria-describedby` from `Field` like a plain input.
 */
export function DateTimeInput({ id, className, name, value, defaultValue, onChange, disabled, required, placeholder, 'aria-describedby': describedBy }: {
  id?: string;
  className?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const current = value ?? uncontrolled;
  return <div className={classes('bds-datetime', className, disabled && 'is-disabled')}>
    <span aria-hidden="true" className={classes('bds-datetime__display', !current && 'is-placeholder')}>{formatLocalDateTime(current) || placeholder || 'YYYY-MM-DD HH:mm'}</span>
    <input
      aria-describedby={describedBy}
      className="bds-datetime__native"
      disabled={disabled}
      id={id}
      name={name}
      onChange={(event) => { if (value === undefined) setUncontrolled(event.target.value); onChange?.(event); }}
      // Desktop browsers only open the picker from their small icon; open it from anywhere on the field.
      onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* already open or unsupported */ } }}
      required={required}
      type="datetime-local"
      value={current}
    />
  </div>;
}

/** Whole-number input with −/+ buttons (48px touch targets), clamped to `min`..`max`. */
export function NumberStepper({ id, className, value, onChange, min = 1, max, disabled, name, decrementLabel, incrementLabel, 'aria-describedby': describedBy }: {
  id?: string;
  className?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  name?: string;
  decrementLabel: string;
  incrementLabel: string;
  'aria-describedby'?: string;
}) {
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next));
  const safe = Number.isInteger(value) ? value : min;
  return <div className="hour-stepper">
    <Button aria-label={decrementLabel} disabled={disabled || safe <= min} onClick={() => onChange(clamp(safe - 1))} type="button" variant="outline">−</Button>
    <input aria-describedby={describedBy} className={className} disabled={disabled} id={id} inputMode="numeric" max={max} min={min} name={name} onChange={(event) => onChange(Math.trunc(Number(event.target.value)) || 0)} required step="1" type="number" value={value || ''} />
    <Button aria-label={incrementLabel} disabled={disabled || (max !== undefined && safe >= max)} onClick={() => onChange(clamp(safe + 1))} type="button" variant="outline">＋</Button>
  </div>;
}
