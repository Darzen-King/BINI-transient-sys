import { useEffect, useState } from 'react';
import type { BookingSoonItem } from '@bini/cloud-shared';

import { playChime, useChimeForNewIds } from '../alerts/chime.js';
import { Badge, Button, Notice, ResponsiveDialog, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { BookingCancelGateway } from './booking-cancel.js';
import type { BookingSoonGateway } from './booking-soon.js';

const DISMISSED_STORAGE_KEY = 'bini.booking-soon.dismissed';

function initialDismissed(): Set<string> {
  try {
    const saved = sessionStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function rememberDismissed(next: Set<string>) {
  try { sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...next])); } catch { /* session storage is optional */ }
}

export function BookingSoonBanner({
  propertyId,
  gateway,
  cancelGateway,
  chime = playChime,
}: {
  propertyId: string;
  gateway: BookingSoonGateway | undefined;
  cancelGateway: BookingCancelGateway | undefined;
  chime?: () => void;
}) {
  const { text } = useLocale();
  const [bookings, setBookings] = useState<BookingSoonItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(initialDismissed);
  const [selected, setSelected] = useState<BookingSoonItem | null>(null);
  const [operationIds, setOperationIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!gateway) return undefined;
    return gateway.subscribe(propertyId, setBookings, () => setBookings([]));
  }, [gateway, propertyId]);

  const visible = bookings.filter((booking) => !dismissed.has(booking.bookingId));
  useChimeForNewIds(visible.map((booking) => booking.bookingId), 'bini.booking-soon.alerted', chime);
  const dismiss = (bookingId: string) => {
    setDismissed((current) => {
      const next = new Set(current).add(bookingId);
      rememberDismissed(next);
      return next;
    });
  };

  const markNoShow = async () => {
    if (!selected || !cancelGateway || busy) return;
    const operationId = operationIds[selected.bookingId] ?? crypto.randomUUID();
    if (!operationIds[selected.bookingId]) setOperationIds((current) => ({ ...current, [selected.bookingId]: operationId }));
    setBusy(true);
    setError('');
    try {
      await cancelGateway.cancel({
        propertyId,
        bookingId: selected.bookingId,
        operationId,
        cancellationReason: 'no_show',
      });
      dismiss(selected.bookingId);
      setNotice(text(`已標記 ${selected.roomId} 為 No-show。`, `${selected.roomId} was marked as no-show.`));
      setSelected(null);
    } catch {
      setError(text('標記 No-show 失敗；預約可能已由其他裝置處理，請重新確認。', 'No-show marking failed. The booking may have been processed on another device; confirm again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!gateway || (visible.length === 0 && !notice)) return null;
  return (
    <section className="booking-soon-banner" aria-live="polite">
      {notice ? <Notice tone="success" title={text('預約提醒已處理', 'Arrival reminder handled')}>{notice}</Notice> : null}
      {visible.length > 0 ? <SectionCard hint={text('未來 15 分鐘', 'Next 15 minutes')} title={text('即將入住', 'Arrivals soon')}>
        <div className="booking-soon-list">
          {visible.map((booking) => <article key={booking.bookingId}>
            <span><Badge tone="warning">{text(`${booking.minutesUntil} 分鐘後`, `in ${booking.minutesUntil} min`)}</Badge><strong>{booking.roomId} · {booking.guestName}</strong></span>
            <div><Button onClick={() => dismiss(booking.bookingId)} size="sm" variant="outline">{text('保留預約', 'Keep booking')}</Button>{cancelGateway ? <Button onClick={() => { setSelected(booking); setError(''); }} size="sm" variant="danger">{text('標記 No-show', 'Mark no-show')}</Button> : null}</div>
          </article>)}
        </div>
      </SectionCard> : null}
      {selected ? <ResponsiveDialog description={text('這會取消預約並留下 No-show 稽核來源。', 'This cancels the booking and records a no-show audit reason.')} onClose={() => { if (!busy) setSelected(null); }} title={text(`確認標記 No-show：${selected.roomId} · ${selected.guestName}`, `Confirm no-show: ${selected.roomId} · ${selected.guestName}`)}>
        {error ? <Notice tone="danger" title={text('處理未完成', 'Action was not completed')}>{error}</Notice> : null}
        <div className="booking-detail-actions"><Button loading={busy} onClick={() => void markNoShow()} variant="danger">{text('確認標記 No-show', 'Confirm no-show')}</Button><Button disabled={busy} onClick={() => setSelected(null)} variant="outline">{text('返回', 'Back')}</Button></div>
      </ResponsiveDialog> : null}
    </section>
  );
}
