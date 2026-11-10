import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  bookingConfirmationFileName,
  buildBookingConfirmation,
  type BookingConfirmationDocument,
  type BookingConfirmationProperty,
  type BookingListItem,
} from '@bini/cloud-shared';

import { Button, Notice } from '../design-system/index.js';
import { BOOKING_CONFIRMATION_NOTES } from '../i18n/labels.js';
import { useLocale } from '../i18n/locale.js';
import type { PropertyProfileGateway } from '../properties/property-profile.js';

const money = (amount: number) => `NT$ ${amount.toLocaleString()}`;

/**
 * The reservation certificate a guest takes away, laid out for A4 and printed through the
 * browser's own print dialog ("Save as PDF"). Printing rather than building a PDF in the page
 * keeps Traditional Chinese correct without shipping a CJK font to every phone.
 */
export function BookingConfirmationSheet({ booking, propertyId, gateway, depositPaidNts = 0, onClose }: {
  booking: BookingListItem;
  propertyId: string;
  /** Undefined in preview mode, where no property record is read. */
  gateway: PropertyProfileGateway | undefined;
  depositPaidNts?: number;
  onClose: () => void;
}) {
  const { locale, text } = useLocale();
  const [property, setProperty] = useState<BookingConfirmationProperty | null>(
    gateway ? null : { name: propertyId, address: null, phone: null },
  );
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The issue time is fixed when the certificate opens, so a reprint is not silently a different document.
  const [issuedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!gateway) return undefined;
    let active = true;
    setLoadError(false);
    gateway.load(propertyId).then(
      (value) => { if (active) setProperty(value); },
      () => { if (active) { setProperty(null); setLoadError(true); } },
    );
    return () => { active = false; };
  }, [gateway, propertyId, attempt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; };
  }, [onClose]);

  // Browsers name the saved PDF after the document title, so the guest's file is recognisable.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = bookingConfirmationFileName(booking, text('預約證明', 'Reservation'));
    return () => { document.title = previousTitle; };
  }, [booking, text]);

  const certificate = useMemo<BookingConfirmationDocument | null>(() => {
    if (!property) return null;
    try {
      return buildBookingConfirmation({
        booking,
        property,
        depositPaidNts,
        issuedAt,
        notes: BOOKING_CONFIRMATION_NOTES.map(([zhTw, en]) => text(zhTw, en)),
      });
    } catch {
      return null;
    }
  }, [booking, property, depositPaidNts, issuedAt, text]);

  const row = (label: string, value: string) => <div><dt>{label}</dt><dd>{value}</dd></div>;

  return createPortal(
    <div aria-label={text('預約證明', 'Reservation certificate')} aria-modal="true" className="confirmation-overlay" role="dialog">
      <div className="confirmation-toolbar">
        <Button disabled={!certificate} onClick={() => { if (typeof window.print === 'function') window.print(); }}>
          {text('列印／儲存 PDF', 'Print / save as PDF')}
        </Button>
        <Button onClick={onClose} variant="outline">{text('關閉', 'Close')}</Button>
        <small>{text('在列印對話框把印表機選為「儲存為 PDF」，就能存成檔案或傳給客人。', 'In the print dialog choose "Save as PDF" to keep or send the file.')}</small>
      </div>
      {loadError ? (
        <div className="confirmation-status">
          <Notice tone="danger" title={text('無法讀取館別資料', 'Unable to read the property record')}>
            {text('證明上的店名與地址來自館別資料；讀取失敗時不會以空白或代號代替。', 'The store name and address come from the property record; nothing is printed in their place when the read fails.')}
          </Notice>
          <Button onClick={() => setAttempt((value) => value + 1)} variant="secondary">{text('重試', 'Try again')}</Button>
        </div>
      ) : null}
      {!gateway ? (
        <div className="confirmation-status">
          <Notice tone="warning" title={text('預覽模式', 'Preview mode')}>
            {text('預覽不會讀取館別資料，店名與地址只會顯示館別代號。', 'Preview mode does not read the property record, so only the property id is shown.')}
          </Notice>
        </div>
      ) : null}
      {!certificate && !loadError ? <div className="confirmation-status"><div className="empty-card">{text('正在準備預約證明…', 'Preparing the certificate…')}</div></div> : null}
      {certificate ? (
        <article className="confirmation-sheet" lang={locale}>
          <header className="confirmation-sheet__head">
            <div>
              <strong className="confirmation-sheet__store">{certificate.propertyName}</strong>
              {certificate.propertyAddress ? <span>{certificate.propertyAddress}</span> : null}
              {certificate.propertyPhone ? <span>{text('電話', 'Tel')} {certificate.propertyPhone}</span> : null}
            </div>
            <img alt="" className="confirmation-sheet__logo" src="/bini-blooms-logo.png" />
          </header>
          <h1 className="confirmation-sheet__title">{text('預約證明', 'Reservation Certificate')}</h1>
          <dl className="confirmation-sheet__fields">
            {row(text('預約編號', 'Booking ID'), certificate.bookingId)}
            {row(text('預約人', 'Guest'), certificate.guestName)}
            {row(text('聯絡電話', 'Contact phone'), certificate.guestPhone ?? text('未提供', 'Not provided'))}
            {row(text('房號', 'Room'), certificate.roomId)}
            {row(text('住宿方案', 'Plan'), certificate.rateType ? `${certificate.plan}（${certificate.rateType}）` : certificate.plan)}
            {row(text('入住時間', 'Check-in'), certificate.checkInText)}
            {row(text('退房時間', 'Check-out'), certificate.checkOutText)}
            {row(text('預約時數', 'Booked hours'), text(`${certificate.stayHours} 小時`, `${certificate.stayHours} hours`))}
            {certificate.discountNts > 0 ? row(text('原價', 'Before discount'), money(certificate.grossAmountNts)) : null}
            {certificate.discountNts > 0 ? row(text('折扣', 'Discount'), `- ${money(certificate.discountNts)}`) : null}
            {row(text('應付金額', 'Amount payable'), money(certificate.payableNts))}
            {row(text('已收押金', 'Deposit received'), money(certificate.depositPaidNts))}
            {row(text('未付餘額', 'Balance due'), money(certificate.balanceDueNts))}
          </dl>
          {certificate.notes.length > 0 ? (
            <section className="confirmation-sheet__notes">
              <h2>{text('入住注意事項', 'Before you arrive')}</h2>
              <ul>{certificate.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </section>
          ) : null}
          <footer className="confirmation-sheet__foot">
            <span>{text('開立時間', 'Issued')} {certificate.issuedAtText}（{text('台北時間', 'Taipei time')}）</span>
            <span>{certificate.propertyName}</span>
          </footer>
        </article>
      ) : null}
    </div>,
    document.body,
  );
}
