import { useRef, useState, type ChangeEvent } from 'react';

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

/**
 * Password input with a show/hide toggle so staff can check what they typed. Receives `id`/`className`/
 * `aria-describedby` from `Field`; the toggle is a separate button so the label still names the input.
 */
export function PasswordInput({ id, className, name, value, onChange, required, minLength, autoComplete, disabled, showLabel, hideLabel, 'aria-describedby': describedBy }: {
  id?: string;
  className?: string;
  name?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  showLabel: string;
  hideLabel: string;
  'aria-describedby'?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="bds-password">
    <input aria-describedby={describedBy} autoCapitalize="off" autoComplete={autoComplete} autoCorrect="off" className={className} disabled={disabled} id={id} minLength={minLength} name={name} onChange={onChange} required={required} spellCheck={false} type={visible ? 'text' : 'password'} value={value} />
    <button aria-label={visible ? hideLabel : showLabel} aria-pressed={visible} className="bds-password__toggle" disabled={disabled} onClick={() => setVisible((current) => !current)} type="button">
      <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="3" />
        {visible ? null : <path d="M4 4l16 16" />}
      </svg>
    </button>
  </div>;
}


/**
 * Whole-NT$ amount field. A plain `<input type="number" value={0}>` puts the 0 straight back the moment the field is
 * cleared — typing 1000 then reads "01000" and the leading zero cannot be removed (React skips the DOM update because
 * "01000" == 1000). This keeps exactly what is typed until focus leaves, then shows the parsed number.
 */
export function MoneyInput({ id, className, name, value, onChange, min = 0, max, disabled, required, placeholder, 'aria-describedby': describedBy }: {
  id?: string;
  className?: string;
  name?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const emitted = useRef<number | null>(null);
  // A value changed elsewhere (reset after a submit, a booking filling the form) replaces what was typed.
  if (draft !== null && emitted.current !== value) { setDraft(null); emitted.current = null; }
  return <input
    aria-describedby={describedBy}
    className={className}
    disabled={disabled}
    id={id}
    inputMode="numeric"
    max={max}
    min={min}
    name={name}
    onBlur={() => setDraft(null)}
    onChange={(event) => {
      const raw = event.target.value;
      const parsed = Math.trunc(Number(raw));
      const next = raw.trim() === '' || !Number.isFinite(parsed) ? 0 : Math.max(min, parsed);
      setDraft(raw);
      emitted.current = next;
      onChange(next);
    }}
    placeholder={placeholder}
    required={required}
    step="1"
    type="number"
    value={draft ?? String(value)}
  />;
}
