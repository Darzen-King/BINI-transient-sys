import { buildCheckoutSoonList, type ActiveStayItem } from '@bini/cloud-shared';
import { useEffect, useMemo, useState } from 'react';

import { playChime, useChimeForNewIds } from '../alerts/chime.js';
import { Badge, Button, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { ActiveStaysGateway } from './active-stays.js';

const DISMISSED_STORAGE_KEY = 'bini.checkout-soon.dismissed';
const ALERTED_STORAGE_KEY = 'bini.checkout-soon.alerted';

function initialDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

/** v3 global "checkout within 15 minutes" reminder with the same tone; staff can dismiss each stay for this session. */
export function CheckoutSoonBanner({ propertyId, gateway, onOpenRooms, chime = playChime }: { propertyId: string; gateway: ActiveStaysGateway | undefined; onOpenRooms: () => void; chime?: () => void }) {
  const { text } = useLocale();
  const [stays, setStays] = useState<ActiveStayItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(initialDismissed);
  useEffect(() => gateway?.subscribe(propertyId, setStays, () => setStays([])), [gateway, propertyId]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(interval); }, []);
  const visible = useMemo(() => buildCheckoutSoonList(stays, now).filter((item) => !dismissed.has(`${item.stayId}@${item.checkOutAt}`)), [dismissed, now, stays]);
  // Keyed by checkout time too, so an extended stay that comes due again reminds again.
  useChimeForNewIds(visible.map((item) => `${item.stayId}@${item.checkOutAt}`), ALERTED_STORAGE_KEY, chime);
  if (!gateway || visible.length === 0) return null;
  const dismiss = (key: string) => setDismissed((current) => {
    const next = new Set(current).add(key);
    try { sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...next])); } catch { /* optional */ }
    return next;
  });
  return <section aria-live="polite" className="booking-soon-banner checkout-soon-banner">
    <SectionCard actions={<Button onClick={onOpenRooms} size="sm" variant="outline">{text('房間總覽', 'Room overview')}</Button>} hint={text('未來 15 分鐘', 'Next 15 minutes')} title={text('即將退房', 'Check-outs soon')}>
      <div className="booking-soon-list">
        {visible.map((item) => { const key = `${item.stayId}@${item.checkOutAt}`; return <article key={key}>
          <span><Badge tone="danger">{text(`還有 ${item.minutesLeft} 分鐘`, `${item.minutesLeft} min left`)}</Badge><strong>{item.roomId} · {item.guestName}</strong></span>
          <div><Button onClick={() => dismiss(key)} size="sm" variant="ghost">{text('知道了', 'Dismiss')}</Button></div>
        </article>; })}
      </div>
    </SectionCard>
  </section>;
}
