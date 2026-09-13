import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomTimelineEvent, RoomTimelineEventType, RoomTimelineProjection } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Badge, Button, Field, Notice, ResponsiveDialog, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { RoomTimelineGateway } from './room-timeline-gateway.js';

const typeLabel: Record<RoomTimelineEventType, readonly [string, string]> = { stay: ['入住中', 'Occupied'], booking: ['預約', 'Booking'], maintenance: ['維修', 'Maintenance'], monthly: ['月租套房', 'Monthly'] };
const errorMessage = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const dayLabel = (value: string, locale: 'zh-TW' | 'en') => new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', weekday: 'short' }).format(new Date(value));
const dateTime = (value: string, locale: 'zh-TW' | 'en') => new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

export function RoomTimelinePage({ session, gateway }: { session: StaffSession; gateway: RoomTimelineGateway | undefined }) {
  const { locale, text } = useLocale(); const [projection, setProjection] = useState<RoomTimelineProjection | null>(null); const [error, setError] = useState(''); const [selected, setSelected] = useState<RoomTimelineEvent | null>(null); const [roomFilter, setRoomFilter] = useState(''); const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => gateway?.subscribe(session.propertyId, (next) => { setProjection(next); setError(''); }, (failure) => { setProjection(null); setError(errorMessage(failure, text('無法載入甘特圖資料。', 'Unable to load timeline data.'))); }), [gateway, session.propertyId, text]);
  useEffect(() => { if (roomFilter && !projection?.rooms.some((room) => room.roomId === roomFilter)) setRoomFilter(''); }, [projection, roomFilter]);
  const days = useMemo(() => projection ? Array.from({ length: 14 }, (_, index) => new Date(Date.parse(projection.startAt) + (index * 86_400_000)).toISOString()) : [], [projection]);
  const visibleRooms = projection?.rooms.filter((room) => !roomFilter || room.roomId === roomFilter) ?? [];
  const rangeStart = projection ? Date.parse(projection.startAt) : 0; const rangeEnd = projection ? Date.parse(projection.endAt) : 1; const range = rangeEnd - rangeStart;
  const styleFor = (event: RoomTimelineEvent) => ({ left: `${Math.max(0, ((Date.parse(event.startAt) - rangeStart) / range) * 100)}%`, width: `${Math.max(0.9, ((Math.min(rangeEnd, Date.parse(event.endAt)) - Math.max(rangeStart, Date.parse(event.startAt))) / range) * 100)}%` });
  const scrollToNow = () => { const element = scrollRef.current; if (!element || !projection) return; const position = Math.max(0, Math.min(1, (Date.now() - rangeStart) / range)); const trackWidth = Math.max(0, element.scrollWidth - 72); element.scrollTo({ left: Math.max(0, (trackWidth * position) - (element.clientWidth / 2)), behavior: 'smooth' }); };
  return <SectionCard actions={<div className="timeline-controls"><Field label={text('房間篩選', 'Room filter')}><select aria-label={text('房間篩選', 'Room filter')} disabled={!projection} onChange={(event) => setRoomFilter(event.target.value)} value={roomFilter}><option value="">{text('全部房間', 'All rooms')}</option>{projection?.rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.roomId}</option>)}</select></Field><Button disabled={!projection} onClick={scrollToNow} size="sm" variant="outline">{text('定位現在', 'Go to now')}</Button></div>} title={text('房間甘特圖', 'Room Gantt')}>
    <p className="timeline-hint">{text('未來 14 天 · 即時資料；時間軸固定從今日開始，可隨時定位到現在。', 'Next 14 days · Live data; the timeline begins today and can return to the current time.')}</p>
    <div className="timeline-legend" aria-label={text('甘特圖圖例', 'Timeline legend')}>{(Object.keys(typeLabel) as RoomTimelineEventType[]).map((type) => <span className={`timeline-legend--${type}`} key={type}>■ {typeLabel[type][locale === 'zh-TW' ? 0 : 1]}</span>)}</div>
    {error ? <Notice tone="danger" title={text('甘特圖載入失敗', 'Timeline loading failed')}>{error}</Notice> : null}
    {!gateway ? <Notice tone="warning" title={text('尚未連接 Firebase 甘特圖資料。', 'Firebase timeline is not connected.')} /> : null}
    {gateway && !projection && !error ? <div className="empty-card">{text('正在載入即時時間軸…', 'Loading live timeline…')}</div> : null}
    {projection ? <div className="timeline-scroll" ref={scrollRef}><div className="timeline-canvas"><div className="timeline-header"><span>{text('房號', 'Room')}</span><div>{days.map((day) => <small key={day}>{dayLabel(day, locale)}</small>)}</div></div>{visibleRooms.map((room) => <div className="timeline-row" key={room.roomId}><strong>{room.roomId}</strong><div className="timeline-track">{days.map((day) => <i key={day} />)}{room.events.map((event) => <button aria-label={`${room.roomId} ${typeLabel[event.type][locale === 'zh-TW' ? 0 : 1]} ${event.label}`} className={`timeline-event timeline-event--${event.type}`} key={`${event.type}-${event.id}`} onClick={() => setSelected(event)} style={styleFor(event)} type="button"><span>{event.label}</span></button>)}</div></div>)}</div></div> : null}
    {projection?.rooms.length === 0 ? <div className="empty-card">{text('此館別尚無房間資料。', 'This property has no rooms.')}</div> : null}
    {selected ? <ResponsiveDialog onClose={() => setSelected(null)} title={text('時間軸詳細資料', 'Timeline details')}><dl className="room-detail-list"><div><dt>{text('類型', 'Type')}</dt><dd><Badge>{typeLabel[selected.type][locale === 'zh-TW' ? 0 : 1]}</Badge></dd></div><div><dt>{text('項目', 'Item')}</dt><dd>{selected.label}</dd></div><div><dt>{text('開始', 'Start')}</dt><dd>{dateTime(selected.startAt, locale)}</dd></div><div><dt>{text('結束', 'End')}</dt><dd>{dateTime(selected.endAt, locale)}</dd></div></dl></ResponsiveDialog> : null}
  </SectionCard>;
}
