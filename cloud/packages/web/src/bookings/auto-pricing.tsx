import { quoteBooking, type BookingHolidayCalendar, type BookingQuote } from '@bini/cloud-shared';
import { useEffect, useRef, useState } from 'react';

import { Button, Field } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { HolidayCalendarGateway } from '../stays/holiday-calendar.js';

const EMPTY_CALENDAR: BookingHolidayCalendar = { days: new Map(), coveredYears: new Set() };

export function toTaipeiIso(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return `${normalized}+08:00`;
}

/** Live holiday calendar for client-side quotes; without it the v3 static fallback still prices sensibly. */
export function useHolidayCalendar(gateway: HolidayCalendarGateway | undefined, propertyId: string): BookingHolidayCalendar {
  const [calendar, setCalendar] = useState<BookingHolidayCalendar>(EMPTY_CALENDAR);
  useEffect(() => gateway?.subscribe(propertyId, setCalendar, () => setCalendar(EMPTY_CALENDAR)), [gateway, propertyId]);
  return calendar;
}

/** Same engine the server uses, so staff see the check-out and amount before saving; the server still recalculates. */
export function quoteForForm(checkInLocal: string, plan: '12hrs' | '24hrs', days: number, discountNts: number, calendar: BookingHolidayCalendar): BookingQuote | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(checkInLocal) || !Number.isInteger(days) || days < 1 || days > 366) return null;
  try {
    return quoteBooking({ checkInAt: toTaipeiIso(checkInLocal), plan, days, discountNts: Math.max(0, discountNts || 0), pricingMode: 'automatic' }, calendar);
  } catch {
    return null;
  }
}

/**
 * v3 pricing: the amount is always filled automatically and staff may overwrite it. An untouched (or unchanged)
 * amount is sent as automatic pricing so the server's quote stands; only a real edit is sent as a manual amount.
 */
export function pricingFor(quote: BookingQuote | null, manualAmountNts: number | null): { pricingMode: 'automatic' } | { pricingMode: 'manual'; manualAmountNts: number } {
  if (manualAmountNts === null || (quote && manualAmountNts === quote.amountNts)) return { pricingMode: 'automatic' };
  return { pricingMode: 'manual', manualAmountNts };
}

/** Manual amount that resets to automatic whenever the check-in, plan, days or discount change (v3 `recalc` / `onDiscountChange`). */
export function useManualAmount(structureKey: string, initial: number | null = null) {
  const [manualAmountNts, setManualAmountNts] = useState<number | null>(initial);
  const previousKey = useRef(structureKey);
  useEffect(() => {
    if (previousKey.current === structureKey) return;
    previousKey.current = structureKey;
    setManualAmountNts(null);
  }, [structureKey]);
  return [manualAmountNts, setManualAmountNts] as const;
}

export function formatTaipeiDateTime(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function CheckoutPreviewField({ quote, label }: { quote: BookingQuote | null; label?: string }) {
  const { text } = useLocale();
  return <Field hint={text('系統自動帶出（入住時間 + 天數 × 方案）', 'Filled automatically (check-in + days × plan)')} label={label ?? text('退房時間', 'Check-out')}>
    <input aria-readonly="true" readOnly placeholder={text('輸入入住時間後自動帶出', 'Shown after entering check-in')} tabIndex={-1} value={quote ? formatTaipeiDateTime(quote.checkOutAt) : ''} />
  </Field>;
}

export function AmountField({ quote, manualAmountNts, onChange, disabled, label }: { quote: BookingQuote | null; manualAmountNts: number | null; onChange: (value: number | null) => void; disabled?: boolean; label?: string }) {
  const { text } = useLocale();
  const value = manualAmountNts ?? quote?.amountNts ?? '';
  const edited = manualAmountNts !== null && quote !== null && manualAmountNts !== quote.amountNts;
  const hint = quote
    ? edited
      ? text(`已手動調整（自動計算 NT$ ${quote.amountNts.toLocaleString()}）`, `Adjusted manually (automatic NT$ ${quote.amountNts.toLocaleString()})`)
      : text(`自動計算，可手動調整 · 原價 NT$ ${quote.grossAmountNts.toLocaleString()}${quote.discountNts ? `，折扣 NT$ ${quote.discountNts.toLocaleString()}` : ''} · ${quote.rateType}`, `Calculated automatically; you can adjust it · gross NT$ ${quote.grossAmountNts.toLocaleString()}${quote.discountNts ? `, discount NT$ ${quote.discountNts.toLocaleString()}` : ''}`)
    : text('自動計算，可手動調整', 'Calculated automatically; you can adjust it');
  return <div className="amount-field">
    <Field hint={hint} label={label ?? text('金額（NT$）', 'Amount (NT$)')}>
      <input disabled={disabled} min="0" onChange={(event) => onChange(event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0))} required type="number" value={value} />
    </Field>
    {edited ? <Button onClick={() => onChange(null)} size="sm" type="button" variant="ghost">{text('恢復自動計算', 'Use automatic amount')}</Button> : null}
  </div>;
}
