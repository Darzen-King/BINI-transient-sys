import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RoomTimelineEvent, RoomTimelineEventType, RoomTimelineProjection } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Badge, Button, Field, Notice, ResponsiveDialog, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { RoomTimelineGateway } from './room-timeline-gateway.js';

/** v3 gantt scale: 36px per hour, a line every hour, a date at midnight and a time label every four hours. */
export const HOUR_PX = 36;
const HOUR_MS = 3_600_000;
const ROOM_COLUMN_PX = 72;

const typeLabel: Record<RoomTimelineEventType, readonly [string, string]> = { stay: ['入住中', 'Occupied'], booking: ['預約', 'Booking'], maintenance: ['維修', 'Maintenance'], monthly: ['月租套房', 'Monthly'] };
const errorMessage = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const dayLabel = (value: number, locale: 'zh-TW' | 'en') => new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', weekday: 'short' }).format(new Date(value));
const dateTime = (value: string, locale: 'zh-TW' | 'en') => new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const taipeiHour = (value: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(new Date(value)));

export function RoomTimelinePage({ session, gateway }: { session: StaffSession; gateway: RoomTimelineGateway | undefined }) {
  const { locale, text } = useLocale();
  const [projection, setProjection] = useState<RoomTimelineProjection | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RoomTimelineEvent | null>(null);
  const [roomFilter, setRoomFilter] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrolled = useRef(false);
  useEffect(() => gateway?.subscribe(session.propertyId, (next) => { setProjection(next); setError(''); }, (failure) => { setProjection(null); setError(errorMessage(failure, text('無法載入甘特圖資料。', 'Unable to load timeline data.'))); }), [gateway, session.propertyId, text]);
  useEffect(() => { if (roomFilter && !projection?.rooms.some((room) => room.roomId === roomFilter)) setRoomFilter(''); }, [projection, roomFilter]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(interval); }, []);

  const rangeStart = projection ? Date.parse(projection.startAt) : 0;
  const rangeEnd = projection ? Date.parse(projection.endAt) : 0;
  const totalHours = Math.max(0, Math.round((rangeEnd - rangeStart) / HOUR_MS));
  const trackWidth = totalHours * HOUR_PX;
  const hours = useMemo(() => Array.from({ length: totalHours }, (_, index) => rangeStart + index * HOUR_MS), [rangeStart, totalHours]);
  const visibleRooms = projection?.rooms.filter((room) => !roomFilter || room.roomId === roomFilter) ?? [];
  const toX = (millis: number) => ((millis - rangeStart) / HOUR_MS) * HOUR_PX;
  const styleFor = (event: RoomTimelineEvent): CSSProperties => {
    const start = Math.max(rangeStart, Date.parse(event.startAt));
    const end = Math.min(rangeEnd, Date.parse(event.endAt));
    return { left: `${toX(start)}px`, width: `${Math.max(8, toX(end) - toX(start))}px` };
  };
  const nowInRange = projection !== null && now >= rangeStart && now <= rangeEnd;
  const scrollToNow = (behavior: ScrollBehavior = 'smooth') => {
    const element = scrollRef.current;
    if (!element || !projection) return;
    element.scrollTo({ left: Math.max(0, ROOM_COLUMN_PX + toX(Math.min(Math.max(now, rangeStart), rangeEnd)) - element.clientWidth / 2), behavior });
  };
  // Like v3, open the chart at the current time rather than at midnight.
  useEffect(() => { if (projection && !autoScrolled.current) { autoScrolled.current = true; scrollToNow('auto'); } });

  const canvasStyle = { '--timeline-hour': `${HOUR_PX}px`, width: `${ROOM_COLUMN_PX + trackWidth}px` } as CSSProperties;
  return <SectionCard actions={<div className="timeline-controls"><Field label={text('房間篩選', 'Room filter')}><select aria-label={text('房間篩選', 'Room filter')} disabled={!projection} onChange={(event) => setRoomFilter(event.target.value)} value={roomFilter}><option value="">{text('全部房間', 'All rooms')}</option>{projection?.rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.roomId}</option>)}</select></Field><Button disabled={!projection} onClick={() => scrollToNow()} size="sm" variant="outline">{text('定位現在', 'Go to now')}</Button></div>} title={text('房間甘特圖', 'Room Gantt')}>
    <p className="timeline-hint">{text('未來 14 天 · 以小時為單位 · 即時資料；時間軸從今日 00:00 開始，開啟時自動定位到現在。', 'Next 14 days · hourly scale · live data; starts at 00:00 today and opens at the current time.')}</p>
    <div className="timeline-legend" aria-label={text('甘特圖圖例', 'Timeline legend')}>{(Object.keys(typeLabel) as RoomTimelineEventType[]).map((type) => <span className={`timeline-legend--${type}`} key={type}>■ {typeLabel[type][locale === 'zh-TW' ? 0 : 1]}</span>)}<span className="timeline-legend--now">│ {text('現在', 'Now')}</span></div>
    {error ? <Notice tone="danger" title={text('甘特圖載入失敗', 'Timeline loading failed')}>{error}</Notice> : null}
    {!gateway ? <Notice tone="warning" title={text('尚未連接 Firebase 甘特圖資料。', 'Firebase timeline is not connected.')} /> : null}
    {gateway && !projection && !error ? <div className="empty-card">{text('正在載入即時時間軸…', 'Loading live timeline…')}</div> : null}
    {projection ? <div className="timeline-scroll" ref={scrollRef}>
      <div className="timeline-canvas timeline-canvas--hourly" style={canvasStyle}>
        <div className="timeline-header">
          <span>{text('房號', 'Room')}</span>
          <div className="timeline-hours" style={{ width: `${trackWidth}px` }}>
            {hours.map((hour) => { const clock = taipeiHour(hour); return clock === 0
              ? <small className="timeline-hour timeline-hour--day" key={hour} style={{ left: `${toX(hour)}px` }}>{dayLabel(hour, locale)}</small>
              : clock % 4 === 0 ? <small className="timeline-hour" key={hour} style={{ left: `${toX(hour)}px` }}>{`${String(clock).padStart(2, '0')}:00`}</small> : null; })}
            {nowInRange ? <i aria-hidden="true" className="timeline-now" style={{ left: `${toX(now)}px` }} /> : null}
          </div>
        </div>
        {visibleRooms.map((room) => <div className="timeline-row" key={room.roomId}>
          <strong>{room.roomId}</strong>
          <div className="timeline-track" style={{ width: `${trackWidth}px` }}>
            {nowInRange ? <i aria-hidden="true" className="timeline-now" style={{ left: `${toX(now)}px` }} /> : null}
            {room.events.map((event) => <button aria-label={`${room.roomId} ${typeLabel[event.type][locale === 'zh-TW' ? 0 : 1]} ${event.label}`} className={`timeline-event timeline-event--${event.type}`} key={`${event.type}-${event.id}`} onClick={() => setSelected(event)} style={styleFor(event)} title={`${event.label} · ${dateTime(event.startAt, locale)} → ${dateTime(event.endAt, locale)}`} type="button"><span>{event.label}</span></button>)}
          </div>
        </div>)}
      </div>
    </div> : null}
    {projection?.rooms.length === 0 ? <div className="empty-card">{text('此館別尚無房間資料。', 'This property has no rooms.')}</div> : null}
    {selected ? <ResponsiveDialog onClose={() => setSelected(null)} title={text('時間軸詳細資料', 'Timeline details')}><dl className="room-detail-list"><div><dt>{text('類型', 'Type')}</dt><dd><Badge>{typeLabel[selected.type][locale === 'zh-TW' ? 0 : 1]}</Badge></dd></div><div><dt>{text('項目', 'Item')}</dt><dd>{selected.label}</dd></div><div><dt>{text('開始', 'Start')}</dt><dd>{dateTime(selected.startAt, locale)}</dd></div><div><dt>{text('結束', 'End')}</dt><dd>{dateTime(selected.endAt, locale)}</dd></div></dl></ResponsiveDialog> : null}
  </SectionCard>;
}
