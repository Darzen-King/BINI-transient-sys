import { isV3Holiday, type BOOKING_RATE_TYPES, type BookingHolidayCalendar } from '@bini/cloud-shared';
import { useEffect, useState } from 'react';

import { Field } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { HolidayCalendarGateway } from '../stays/holiday-calendar.js';

export type BookingRateType = (typeof BOOKING_RATE_TYPES)[number];

const EMPTY_CALENDAR: BookingHolidayCalendar = { days: new Map(), coveredYears: new Set() };

/**
 * v3 "manual-first" rate type: detected from the check-in date until staff pick a label,
 * and re-detected whenever the check-in date changes. Only a manual pick is sent to the server.
 */
export function useBookingRateType(holidayGateway: HolidayCalendarGateway | undefined, propertyId: string, initial: { checkInLocal?: string; manual?: BookingRateType | null } = {}) {
  const [calendar, setCalendar] = useState<BookingHolidayCalendar | null>(null);
  const [checkInLocal, setCheckInLocal] = useState(initial.checkInLocal ?? '');
  const [manual, setManual] = useState<BookingRateType | null>(initial.manual ?? null);
  useEffect(() => holidayGateway?.subscribe(propertyId, setCalendar, () => setCalendar(null)), [holidayGateway, propertyId]);
  const detected: BookingRateType = /^\d{4}-\d{2}-\d{2}/u.test(checkInLocal) && isV3Holiday(checkInLocal.slice(0, 10), calendar ?? EMPTY_CALENDAR) ? '假日' : '非假日';
  return {
    value: manual ?? detected,
    manual,
    onCheckInChange: (value: string) => { setCheckInLocal(value); setManual(null); },
    choose: (value: BookingRateType) => setManual(value),
    reset: () => { setCheckInLocal(''); setManual(null); },
  };
}

export function RateTypeField({ disabled, rate }: { disabled: boolean; rate: ReturnType<typeof useBookingRateType> }) {
  const { text } = useLocale();
  return <Field label={text('費率類型', 'Rate type')}>
    <select disabled={disabled} onChange={(event) => rate.choose(event.target.value === '假日' ? '假日' : '非假日')} value={rate.value}>
      <option value="非假日">{text('非假日', 'Weekday')}</option>
      <option value="假日">{text('假日（週五至週日／國定假日）', 'Weekend / holiday')}</option>
    </select>
  </Field>;
}

/** The v3 booking-page rate card; the server quote remains authoritative. */
export function RateReference() {
  const { text } = useLocale();
  return <div className="rate-reference">
    <strong>{text('費率參考', 'Rate reference')}</strong>
    <table>
      <thead><tr><th scope="col" /><th scope="col">{text('非假日（週一至週四）', 'Weekday (Mon–Thu)')}</th><th scope="col">{text('假日（週五至週日）', 'Holiday (Fri–Sun)')}</th></tr></thead>
      <tbody>
        <tr><th scope="row">12hrs</th><td>NT$800</td><td>NT$1,000</td></tr>
        <tr><th scope="row">24hrs</th><td>NT$1,000</td><td>NT$1,200</td></tr>
      </tbody>
    </table>
    <small>{text('國定假日及其前一天也適用假日費率；實際金額以伺服器報價為準。', 'National holidays and their eves also use holiday rates; the server quote is final.')}</small>
  </div>;
}
