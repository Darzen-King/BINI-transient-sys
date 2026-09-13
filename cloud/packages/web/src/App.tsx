import { useEffect, useState, type ReactNode } from 'react';
import {
  CLOUD_PAGE_MANIFEST,
  ROLE_DEFAULT_PAGES,
  pagesAllowedForNavigation,
  type BookingListItem,
  type CloudPageId,
  type CloudRoomStatus,
  type RoomOverviewProjection,
  type RoomOverviewRoom,
} from '@bini/cloud-shared';

import { AccountManagement } from './accounts/AccountManagement.js';
import type { AccountAdminGateway } from './accounts/account-admin.js';
import type { StaffSession } from './auth/session.js';
import { Badge, Button, Field, Notice, ResponsiveDialog, SectionCard } from './design-system/index.js';
import { LanguageSwitcher, useLocale, type AppLocale } from './i18n/locale.js';
import { InitialDataImport } from './migration/InitialDataImport.js';
import type { DataImportGateway } from './migration/data-import.js';
import type { BookingListGateway } from './bookings/booking-list.js';
import type { BookingCancelGateway } from './bookings/booking-cancel.js';
import { BookingSoonBanner } from './bookings/BookingSoonBanner.js';
import type { BookingSoonGateway } from './bookings/booking-soon.js';
import type { BookingUpdateGateway } from './bookings/booking-update.js';
import { BookingCreatePage } from './bookings/BookingCreatePage.js';
import { BookingEditPage } from './bookings/BookingEditPage.js';
import type { BookingCreateGateway } from './bookings/booking-create.js';
import type { BookingPreviewGateway } from './bookings/booking-preview.js';
import type { RoomOverviewGateway } from './rooms/room-overview.js';
import type { BookingRoomGateway } from './rooms/booking-room-options.js';
import { StayCheckInPage } from './stays/StayCheckInPage.js';
import type { StayCheckInGateway } from './stays/stay-checkin.js';
import { StayExtendPage } from './stays/StayExtendPage.js';
import type { StayExtendGateway } from './stays/stay-extend.js';
import type { ActiveStaysGateway } from './stays/active-stays.js';
import type { HolidayCalendarGateway } from './stays/holiday-calendar.js';
import { HolidayManagementPage } from './holidays/HolidayManagementPage.js';
import type { HolidayGateway } from './holidays/holiday-gateway.js';
import { PropertyManagementPage } from './properties/PropertyManagementPage.js';
import type { PropertyGateway } from './properties/property-gateway.js';
import { StayCheckoutPage } from './stays/StayCheckoutPage.js';
import type { StayCheckoutGateway } from './stays/stay-checkout.js';
import { PaymentsPage } from './payments/PaymentsPage.js';
import type { PaymentCreateGateway } from './payments/payment-create.js';
import type { PaymentListGateway } from './payments/payment-list.js';
import { CostManagementPage } from './costs/CostManagementPage.js';
import type { CostGateway } from './costs/cost-gateway.js';
import { ReportsPage } from './reports/ReportsPage.js';
import type { ReportGateway } from './reports/report-gateway.js';
import { AuditTrailPage } from './audit/AuditTrailPage.js';
import type { AuditGateway } from './audit/audit-gateway.js';
import { HousekeepingPage } from './housekeeping/HousekeepingPage.js';
import type { HousekeepingGateway } from './housekeeping/housekeeping-gateway.js';
import { MaintenancePage } from './maintenance/MaintenancePage.js';
import type { MaintenanceGateway } from './maintenance/maintenance-gateway.js';
import { RoomManagementPage } from './room-management/RoomManagementPage.js';
import type { RoomManagementGateway } from './room-management/room-management-gateway.js';
import { RoomTimelinePage } from './gantt/RoomTimelinePage.js';
import type { RoomTimelineGateway } from './gantt/room-timeline-gateway.js';

type UtilityViewId = 'hub' | 'initial_import';
type ViewId = 'today' | 'more' | 'accounts' | UtilityViewId | CloudPageId;

interface NavItem {
  id: ViewId;
  labelZhTw: string;
  labelEn: string;
  icon: string;
  requiredPage?: CloudPageId;
}

const mobileNavigation: NavItem[] = [
  { id: 'today', labelZhTw: '今日', labelEn: 'Today', icon: '⌂', requiredPage: 'rooms' },
  { id: 'bookings', labelZhTw: '預約', labelEn: 'Bookings', icon: '▣', requiredPage: 'bookings' },
  { id: 'housekeeping', labelZhTw: '房務', labelEn: 'Housekeep', icon: '✓', requiredPage: 'housekeeping' },
  { id: 'payments', labelZhTw: '款項', labelEn: 'Payments', icon: '$', requiredPage: 'payments' },
  { id: 'more', labelZhTw: '更多', labelEn: 'More', icon: '•••' },
];

const mobileViewForPage = (pageId: CloudPageId): ViewId => {
  if (pageId === 'rooms') return 'today';
  if (pageId === 'users') return 'accounts';
  return pageId;
};

const activeDesktopPage = (view: ViewId): CloudPageId | null => {
  if (view === 'today') return 'rooms';
  if (view === 'accounts') return 'users';
  if (view === 'more' || view === 'hub' || view === 'initial_import') return null;
  return view;
};

function titleForView(view: ViewId, locale: AppLocale, text: (zhTw: string, en: string) => string) {
  if (view === 'today') return text('今日營運', "Today's Operations");
  if (view === 'accounts') return text('使用者管理', 'User Management');
  if (view === 'hub') return 'Prototype Hub';
  if (view === 'initial_import') return text('初始資料導入', 'Initial Data Import');
  const page = CLOUD_PAGE_MANIFEST.find((candidate) => candidate.id === view);
  if (page) return locale === 'zh-TW' ? page.labelZhTw : page.labelEn;
  const mobileItem = mobileNavigation.find((item) => item.id === view);
  return mobileItem ? (locale === 'zh-TW' ? mobileItem.labelZhTw : mobileItem.labelEn) : '';
}

const previewSession: StaffSession = {
  uid: 'preview-admin',
  email: 'admin@example.com',
  displayName: '管理員',
  propertyId: 'property-main',
  role: 'admin',
  allowedPages: [...ROLE_DEFAULT_PAGES.admin],
};

const weekdayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function formatLocalDate(locale: AppLocale, date = new Date()) {
  if (locale === 'en') {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${weekdayLabels[date.getDay()]}`;
}

type RoomTone = 'occupied' | 'arrival' | 'cleaning' | 'vacant' | 'maintenance' | 'monthly';
type RoomState = 'monthly' | 'occupied' | 'departing' | 'vacant' | 'arrival' | 'cleaning' | 'cleaningInProgress' | 'maintenance';

interface RoomViewModel {
  number: string;
  state: RoomState;
  tone: RoomTone;
  guest?: string | undefined;
  checkin?: string | undefined;
  checkout?: string | undefined;
  totalDue?: number | undefined;
  totalPaid?: number | undefined;
  depositPaid?: number | undefined;
  balanceDue?: number | undefined;
  maintenanceTitle?: string | undefined;
  maintenanceEnd?: string | undefined;
  nextBooking?: string | undefined;
  note?: string | undefined;
  actions: Array<'checkin' | 'extend' | 'payment' | 'checkout'>;
}

const previewRooms: RoomViewModel[] = [
  {
    number: '201', state: 'monthly', tone: 'monthly', guest: 'Carlos',
    checkin: '2026-06-01', checkout: '2026-10-01', note: 'Monthly Rent', actions: [],
  },
  {
    number: '202', state: 'occupied', tone: 'occupied', guest: 'Joshua',
    checkin: '2026-09-05 16:00', checkout: '2026-09-13 16:00',
    totalDue: 6400, totalPaid: 0, depositPaid: 0, balanceDue: 6400,
    nextBooking: '2026-09-19 11:00', actions: ['extend', 'payment', 'checkout'],
  },
  {
    number: '203', state: 'vacant', tone: 'vacant', nextBooking: '2026-09-11 21:00',
    actions: ['checkin'],
  },
  {
    number: '205', state: 'vacant', tone: 'vacant', nextBooking: '2026-09-12 21:00',
    actions: ['checkin'],
  },
  {
    number: '206', state: 'monthly', tone: 'monthly', guest: 'Edong',
    checkin: '2026-07-10', checkout: '2026-09-10', note: 'Monthly Rent', actions: [],
  },
  {
    number: '207', state: 'monthly', tone: 'monthly', guest: 'Tangkad',
    checkin: '2026-07-10', checkout: '2026-09-10', note: 'Monthly Rent', actions: [],
  },
];

const roomStateLabels: Record<RoomState, readonly [string, string]> = {
  monthly: ['月租套房', 'Monthly'],
  occupied: ['使用中', 'Occupied'],
  departing: ['即將退房', 'Departing'],
  vacant: ['可入住', 'Vacant'],
  arrival: ['待入住', 'Arrival'],
  cleaning: ['待清潔', 'Needs cleaning'],
  cleaningInProgress: ['清潔中', 'Cleaning'],
  maintenance: ['維修中', 'Maintenance'],
};

const roomStatusPresentation: Record<CloudRoomStatus, { state: RoomState; tone: RoomTone }> = {
  可入住: { state: 'vacant', tone: 'vacant' },
  使用中: { state: 'occupied', tone: 'occupied' },
  即將退房: { state: 'departing', tone: 'occupied' },
  待清潔: { state: 'cleaning', tone: 'cleaning' },
  清潔中: { state: 'cleaningInProgress', tone: 'cleaning' },
  維修中: { state: 'maintenance', tone: 'maintenance' },
  月租套房: { state: 'monthly', tone: 'monthly' },
};

function formatTaipeiDateTime(value: string | null, locale: AppLocale): string | undefined {
  if (!value) return undefined;
  const formatted = new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : 'zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatTaipeiTime(value: string, locale: AppLocale): string {
  return formatTaipeiDateTime(value, locale)?.slice(11) ?? '';
}

function toRoomViewModel(room: RoomOverviewRoom, locale: AppLocale): RoomViewModel {
  const presentation = roomStatusPresentation[room.status];
  return {
    number: room.roomId,
    state: presentation.state,
    tone: presentation.tone,
    guest: room.guestName ?? undefined,
    checkin: formatTaipeiDateTime(room.checkInAt, locale),
    checkout: formatTaipeiDateTime(room.checkOutAt, locale),
    totalDue: room.totalDueNts ?? undefined,
    totalPaid: room.totalPaidNts ?? undefined,
    depositPaid: room.depositPaidNts ?? undefined,
    balanceDue: room.balanceDueNts ?? undefined,
    maintenanceTitle: room.maintenanceTitle ?? undefined,
    maintenanceEnd: formatTaipeiDateTime(room.maintenanceEndAt, locale),
    nextBooking: formatTaipeiDateTime(room.nextBookingAt, locale),
    note: room.note ?? undefined,
    actions: [...room.actions],
  };
}

const actionLabels = {
  checkin: ['辦理入住', 'Check in'],
  extend: ['延住處理', 'Extend stay'],
  payment: ['付款', 'Payment'],
  checkout: ['退房辦理', 'Check out'],
} as const;

function RoomDetails({ room }: { room: RoomViewModel }) {
  const { text } = useLocale();
  const hasPaymentSummary = room.totalDue !== undefined;
  return (
    <div className="room-card-details">
      <dl className="room-detail-list">
        {room.guest ? <div><dt>{text('目前旅客', 'Current guest')}</dt><dd><strong>{room.guest}</strong></dd></div> : null}
        {room.checkin ? <div><dt>{text('入住時間', 'Check-in')}</dt><dd>{room.checkin}</dd></div> : null}
        {room.checkout ? <div><dt>{text('退房時間', 'Check-out')}</dt><dd>{room.checkout}</dd></div> : null}
        {room.maintenanceTitle ? <div><dt>{text('維修項目', 'Maintenance')}</dt><dd className="danger-text">{room.maintenanceTitle}</dd></div> : null}
        {room.maintenanceEnd ? <div><dt>{text('預計完成', 'Expected finish')}</dt><dd className="danger-text">{room.maintenanceEnd}</dd></div> : null}
        {room.nextBooking ? <div><dt>{text('下一筆預約', 'Next booking')}</dt><dd className="info-text">{room.nextBooking}</dd></div> : null}
        {room.note ? <div><dt>{text('備註', 'Notes')}</dt><dd>{room.note}</dd></div> : null}
      </dl>
      {hasPaymentSummary ? (
        <div className="room-payment-summary" aria-label={text(`${room.number} 房款項摘要`, `Room ${room.number} payment summary`)}>
          <div><span>💰 {text('應付總額', 'Total due')}</span><strong>NT$ {room.totalDue?.toLocaleString()}</strong></div>
          <div><span>💳 {text('已收款', 'Paid')}</span><strong className="success-text">NT$ {(room.totalPaid ?? 0).toLocaleString()}</strong></div>
          {(room.depositPaid ?? 0) > 0 ? <div className="deposit-row"><span>↳ {text('含押金', 'Deposit included')}</span><span>NT$ {room.depositPaid?.toLocaleString()}</span></div> : null}
          <div className="balance-row"><strong>{text('餘額應收', 'Balance due')}</strong><strong>NT$ {(room.balanceDue ?? 0).toLocaleString()}{(room.balanceDue ?? 0) <= 0 ? ' ✅' : ''}</strong></div>
        </div>
      ) : null}
    </div>
  );
}

function RoomActions({ room, onAction, onOpenCheckIn, onOpenExtend, onOpenCheckout }: { room: RoomViewModel; onAction: (action: string) => void; onOpenCheckIn?: (() => void) | undefined; onOpenExtend?: (() => void) | undefined; onOpenCheckout?: (() => void) | undefined }) {
  const { locale } = useLocale();
  if (room.actions.length === 0) return null;
  return (
    <div className="room-card-actions">
      {room.actions.map((action) => (
        <Button
          className={`room-action room-action--${action}`}
          key={action}
          onClick={() => action === 'checkin' && onOpenCheckIn ? onOpenCheckIn() : action === 'extend' && onOpenExtend ? onOpenExtend() : action === 'checkout' && onOpenCheckout ? onOpenCheckout() : onAction(`${room.number} · ${actionLabels[action][locale === 'zh-TW' ? 0 : 1]}`)}
          size="sm"
          variant={action === 'checkin' ? 'primary' : 'outline'}
        >{action === 'payment' ? '💵 ' : ''}{actionLabels[action][locale === 'zh-TW' ? 0 : 1]}</Button>
      ))}
    </div>
  );
}

function ShellSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <SectionCard hint={hint} title={title}>{children}</SectionCard>;
}

function TodayView({ canCreate, canCheckIn, canExtend, canCheckout, canImport, onAction, onOpenBookingCreate, onOpenCheckIn, onOpenExtend, onOpenCheckout, onOpenInitialImport, propertyId, roomOverviewGateway }: {
  canCreate: boolean;
  canCheckIn: boolean;
  canExtend: boolean;
  canCheckout: boolean;
  canImport: boolean;
  onAction: (action: string) => void;
  onOpenBookingCreate: () => void;
  onOpenCheckIn: () => void;
  onOpenExtend: () => void;
  onOpenCheckout: () => void;
  onOpenInitialImport: () => void;
  propertyId: string;
  roomOverviewGateway: RoomOverviewGateway | undefined;
}) {
  const { locale, text } = useLocale();
  const [projection, setProjection] = useState<RoomOverviewProjection | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState<RoomState | 'all'>('all');
  const stateLabel = (state: RoomState) => roomStateLabels[state][locale === 'zh-TW' ? 0 : 1];
  const roomViewModels = roomOverviewGateway
    ? (projection?.rooms.map((room) => toRoomViewModel(room, locale)) ?? [])
    : previewRooms;
  const summary = roomOverviewGateway
    ? (projection?.summary ?? { arrivalsToday: 0, departuresToday: 0, cleaningPending: 0 })
    : { arrivalsToday: 3, departuresToday: 2, cleaningPending: 1 };
  const visibleRoomViewModels = roomFilter === 'all' ? roomViewModels : roomViewModels.filter((room) => room.state === roomFilter);
  const selectedRoom = roomViewModels.find((room) => room.number === selectedRoomNumber) ?? null;

  useEffect(() => {
    if (!roomOverviewGateway) return undefined;
    setProjection(null);
    setLoadError(false);
    return roomOverviewGateway.subscribe(
      propertyId,
      (nextProjection) => {
        setProjection(nextProjection);
        setLoadError(false);
      },
      () => {
        setProjection(null);
        setLoadError(true);
      },
    );
  }, [propertyId, roomOverviewGateway]);

  return (
    <>
      <section className="summary-strip" aria-label={text('今日營運摘要', "Today's operations summary")}>
        <article><strong>{summary.arrivalsToday}</strong><span>{text('今日入住', 'Arrivals')}</span></article>
        <article><strong>{summary.departuresToday}</strong><span>{text('今日退房', 'Departures')}</span></article>
        <article><strong>{summary.cleaningPending}</strong><span>{text('清潔待辦', 'To clean')}</span></article>
      </section>

      <section className="quick-actions" aria-label={text('櫃檯快捷操作', 'Front desk quick actions')}>
        {canCreate ? <Button aria-label={text('新增預約', 'New booking')} className="primary-action" onClick={onOpenBookingCreate}>＋<span>{text('新增預約', 'New booking')}</span></Button> : null}
        {canCheckIn ? <Button aria-label={text('辦理入住', 'Check in')} onClick={onOpenCheckIn} variant="outline">↘<span>{text('辦理入住', 'Check in')}</span></Button> : null}
        <Button aria-label={text('辦理退房', 'Check out')} onClick={() => onAction(text('辦理退房', 'Check out'))} variant="outline">↗<span>{text('辦理退房', 'Check out')}</span></Button>
      </section>

      <ShellSection title={text('今日房態', "Today's rooms")} hint={text(`${visibleRoomViewModels.length}/${roomViewModels.length} 間`, `${visibleRoomViewModels.length}/${roomViewModels.length} rooms`)} >
        {loadError ? <Notice tone="danger" title={text('無法載入即時房態', 'Unable to load live room status')}>{text('資料格式或連線異常，請重新整理；系統不會改用展示資料。', 'Refresh the page. The system will not substitute preview data for live data.')}</Notice> : null}
        {roomOverviewGateway && !projection && !loadError ? <div className="empty-card">{text('正在載入即時房態…', 'Loading live room status…')}</div> : null}
        {projection && projection.rooms.length === 0 ? <div className="empty-card"><p>{text('此館別尚無房間資料；請先完成初始資料導入。', 'This property has no room data. Complete the initial data import first.')}</p>{canImport ? <Button onClick={onOpenInitialImport} size="sm">{text('開啟初始資料導入', 'Open initial data import')}</Button> : null}</div> : null}
        <div aria-label={text('房態篩選', 'Room status filter')} className="room-status-filters" role="group">
          {(['all', ...Object.keys(roomStateLabels)] as Array<RoomState | 'all'>).map((filter) => {
            const count = filter === 'all' ? roomViewModels.length : roomViewModels.filter((room) => room.state === filter).length;
            const label = filter === 'all' ? text('全部房間', 'All rooms') : `${stateLabel(filter)} ${text('房態', 'status')}`;
            return <button aria-pressed={roomFilter === filter} className={roomFilter === filter ? 'is-active' : ''} key={filter} onClick={() => setRoomFilter(filter)} type="button"><span>{label}</span><strong>{count}</strong></button>;
          })}
        </div>
        <div className="room-grid" role="region" aria-label={text('今日房態', "Today's rooms")}>
          {visibleRoomViewModels.map((room) => (
            <article className={`room-card room-card--${room.tone}`} key={room.number}>
              <button
                aria-label={text(`查看 ${room.number} 房詳細資料`, `View room ${room.number} details`)}
                className="room-card-summary"
                onClick={() => setSelectedRoomNumber(room.number)}
                type="button"
              >
                <span className="room-number">{room.number}</span>
                <Badge className="status-pill">{stateLabel(room.state)}</Badge>
                <strong>{room.guest ?? '—'}</strong>
                <small>{room.nextBooking ? `${text('下一筆', 'Next')} ${room.nextBooking}` : room.note ?? text('點擊查看完整資料', 'Tap for full details')}</small>
                <span className="mobile-detail-affordance" aria-hidden="true">{text('查看詳細資料', 'View details')} ›</span>
              </button>
              <RoomDetails room={room} />
              <RoomActions room={room} onAction={onAction} onOpenCheckIn={canCheckIn ? onOpenCheckIn : undefined} onOpenExtend={canExtend ? onOpenExtend : undefined} onOpenCheckout={canCheckout ? onOpenCheckout : undefined} />
            </article>
          ))}
        </div>
        {roomViewModels.length > 0 && visibleRoomViewModels.length === 0 ? <div className="empty-card">{text('此房態目前沒有房間。', 'No rooms match this status.')}</div> : null}
      </ShellSection>

      <ShellSection title={text('接下來要處理', 'Up next')} hint={text('依時間排序', 'By time')}>
        <div className="task-list">
          {roomOverviewGateway ? projection?.upNext.map((item) => (
            <button key={item.bookingId} onClick={() => onAction(`${item.roomId} · ${item.guestName}`)}>
              <span className="time">{formatTaipeiTime(item.checkInAt, locale)}</span>
              <span><strong>{item.roomId} · {item.guestName}</strong><small>{item.paidNts > 0 ? text('預約入住 · 已有收款', 'Arrival · Payment received') : text('預約入住 · 尚未收款', 'Arrival · Payment due')}</small></span><span>›</span>
            </button>
          )) : <>
            <button><span className="time">14:30</span><span><strong>202 · Juvy</strong><small>{text('預約入住 · 已付押金', 'Arrival · Deposit paid')}</small></span><span>›</span></button>
            <button><span className="time">17:00</span><span><strong>203 · Chris</strong><small>{text('預計入住 · 尚未收款', 'Expected arrival · Payment due')}</small></span><span>›</span></button>
          </>}
          {roomOverviewGateway && projection?.upNext.length === 0 ? <div className="empty-card">{text('目前沒有未來有效預約。', 'There are no active future bookings.')}</div> : null}
        </div>
      </ShellSection>

      {selectedRoom ? (
        <ResponsiveDialog
          className={`room-detail-sheet room-card--${selectedRoom.tone}`}
          onClose={() => setSelectedRoomNumber(null)}
          title={text(`${selectedRoom.number} 房詳細資料`, `Room ${selectedRoom.number} details`)}
        >
            <Badge className="status-pill">{stateLabel(selectedRoom.state)}</Badge>
            <RoomDetails room={selectedRoom} />
            <RoomActions room={selectedRoom} onAction={(action) => { setSelectedRoomNumber(null); onAction(action); }} onOpenCheckIn={canCheckIn ? () => { setSelectedRoomNumber(null); onOpenCheckIn(); } : undefined} onOpenExtend={canExtend ? () => { setSelectedRoomNumber(null); onOpenExtend(); } : undefined} onOpenCheckout={canCheckout ? () => { setSelectedRoomNumber(null); onOpenCheckout(); } : undefined} />
        </ResponsiveDialog>
      ) : null}
    </>
  );
}

const previewBookings: BookingListItem[] = [
  { bookingId: 'RSV-preview-202', roomId: '202', guestName: 'Juvy', phone: null, checkInAt: '2026-09-12T14:30:00+08:00', checkOutAt: '2026-09-13T14:30:00+08:00', plan: '24hrs', amountNts: 1_200, discountNts: 0, rateType: '非假日', status: '已預約' },
  { bookingId: 'RSV-preview-203', roomId: '203', guestName: 'Chris', phone: null, checkInAt: '2026-09-13T17:00:00+08:00', checkOutAt: '2026-09-14T17:00:00+08:00', plan: '24hrs', amountNts: 1_200, discountNts: 0, rateType: '非假日', status: '已預約' },
  { bookingId: 'RSV-preview-205', roomId: '205', guestName: 'Michael', phone: null, checkInAt: '2026-09-14T13:00:00+08:00', checkOutAt: '2026-09-15T13:00:00+08:00', plan: '12hrs', amountNts: 800, discountNts: 0, rateType: '非假日', status: '已預約' },
];

function BookingsView({ canCreate, canCancel, onOpenBookingCreate, propertyId, gateway, bookingCancelGateway, bookingUpdateGateway, roomGateway, session }: {
  canCreate: boolean;
  canCancel: boolean;
  onOpenBookingCreate: () => void;
  propertyId: string;
  gateway: BookingListGateway | undefined;
  bookingCancelGateway: BookingCancelGateway | undefined;
  bookingUpdateGateway: BookingUpdateGateway | undefined;
  roomGateway: BookingRoomGateway | undefined;
  session: StaffSession;
}) {
  const { locale, text } = useLocale();
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingListItem | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingListItem | null>(null);
  const visibleBookings = gateway
    ? (bookings ?? []).filter((booking) => [booking.bookingId, booking.roomId, booking.guestName, booking.phone ?? ''].some((value) => value.toLocaleLowerCase('zh-TW').includes(query.trim().toLocaleLowerCase('zh-TW'))))
    : previewBookings.filter((booking) => [booking.bookingId, booking.roomId, booking.guestName, booking.phone ?? ''].some((value) => value.toLocaleLowerCase('zh-TW').includes(query.trim().toLocaleLowerCase('zh-TW'))));

  useEffect(() => {
    if (!gateway) return undefined;
    setBookings(null);
    setLoadError(false);
    return gateway.subscribe(
      propertyId,
      (nextBookings) => {
        setBookings(nextBookings);
        setLoadError(false);
      },
      () => {
        setBookings(null);
        setLoadError(true);
      },
    );
  }, [gateway, propertyId]);

  const closeDetails = () => {
    setSelectedBooking(null);
    setPendingOperationId(null);
    setCancelBusy(false);
    setCancelError('');
    setCancelledAt(null);
    setConfirmCancel(false);
  };

  const cancelBooking = async () => {
    if (!selectedBooking || !bookingCancelGateway || cancelBusy || cancelledAt) return;
    const operationId = pendingOperationId ?? crypto.randomUUID();
    setPendingOperationId(operationId);
    setCancelBusy(true);
    setCancelError('');
    try {
      const result = await bookingCancelGateway.cancel({
        propertyId,
        bookingId: selectedBooking.bookingId,
        operationId,
      });
      setCancelledAt(result.cancelledAt);
      setPendingOperationId(null);
    } catch {
      setCancelError(text('取消失敗；預約可能已由其他裝置處理，請重新載入後確認。', 'Cancellation failed. The booking may have been processed on another device; reload and confirm.'));
    } finally {
      setCancelBusy(false);
    }
  };

  if (editingBooking) {
    return <BookingEditPage booking={editingBooking} gateway={bookingUpdateGateway} onBack={() => setEditingBooking(null)} roomGateway={roomGateway} session={session} />;
  }

  return (
    <ShellSection title={text('預約', 'Bookings')} hint={text(`${visibleBookings.length} 筆有效預約`, `${visibleBookings.length} active bookings`)}>
      {canCreate ? <Button block onClick={onOpenBookingCreate} size="lg">＋ {text('新增預約', 'New booking')}</Button> : null}
      <Field className="search-field" label={text('搜尋', 'Search')}><input aria-label={text('搜尋預約', 'Search bookings')} onChange={(event) => setQuery(event.target.value)} placeholder={text('房號、姓名、預約編號', 'Room, guest or booking ID')} type="search" value={query} /></Field>
      {loadError ? <Notice tone="danger" title={text('無法載入即時預約', 'Unable to load live bookings')}>{text('資料格式或連線異常，系統不會顯示展示預約。', 'The system will not substitute preview bookings after a data or connection error.')}</Notice> : null}
      {gateway && bookings === null && !loadError ? <div className="empty-card">{text('正在載入即時預約…', 'Loading live bookings…')}</div> : null}
      <div className="booking-list">
        {visibleBookings.map((booking) => (
          <button key={booking.bookingId} onClick={() => setSelectedBooking(booking)}><span><strong>{booking.roomId} · {booking.guestName}</strong><small>{formatTaipeiDateTime(booking.checkInAt, locale)} · {booking.plan} · NT$ {booking.amountNts.toLocaleString()}</small></span><Badge tone="success">{text('已預約', 'Booked')}</Badge></button>
        ))}
        {bookings !== null && visibleBookings.length === 0 ? <div className="empty-card">{query ? text('找不到符合的有效預約。', 'No matching active bookings.') : text('目前沒有有效預約。', 'There are no active bookings.')}</div> : null}
      </div>
      {selectedBooking ? (
        <ResponsiveDialog
          className="booking-details-dialog"
          description={text('預約完整資料與可用操作。', 'Booking details and available actions.')}
          onClose={closeDetails}
          title={`${selectedBooking.roomId} · ${selectedBooking.guestName}`}
        >
          <dl className="booking-detail-list">
            <div><dt>{text('預約編號', 'Booking ID')}</dt><dd>{selectedBooking.bookingId}</dd></div>
            <div><dt>{text('入住', 'Check-in')}</dt><dd>{formatTaipeiDateTime(selectedBooking.checkInAt, locale)}</dd></div>
            <div><dt>{text('退房', 'Check-out')}</dt><dd>{formatTaipeiDateTime(selectedBooking.checkOutAt, locale)}</dd></div>
            <div><dt>{text('方案／金額', 'Plan / amount')}</dt><dd>{selectedBooking.plan} · NT$ {selectedBooking.amountNts.toLocaleString()}</dd></div>
            <div><dt>{text('折扣', 'Discount')}</dt><dd>NT$ {selectedBooking.discountNts.toLocaleString()}</dd></div>
            <div><dt>{text('電話', 'Phone')}</dt><dd>{selectedBooking.phone ?? '—'}</dd></div>
          </dl>
          {cancelledAt ? <Notice tone="success" title={text('預約已取消', 'Booking cancelled')}>{text(`已於 ${formatTaipeiDateTime(cancelledAt, locale)} 寫入稽核紀錄。`, `The audit record was written at ${formatTaipeiDateTime(cancelledAt, locale)}.`)}</Notice> : null}
          {cancelError ? <Notice tone="danger" title={text('取消未完成', 'Cancellation was not completed')}>{cancelError}</Notice> : null}
          {!bookingCancelGateway ? <Notice tone="warning" title={text('預覽模式', 'Preview mode')}>{text('預覽不會寫入預約資料。', 'Preview mode does not write booking data.')}</Notice> : null}
          {confirmCancel && !cancelledAt ? <Notice tone="warning" title={text('確認取消預約？', 'Confirm cancellation?')}>{text('取消後會立即釋放此時段，且會寫入稽核紀錄。', 'This immediately releases the time slot and writes an audit record.')}</Notice> : null}
          <div className="booking-detail-actions">
            {canCancel && bookingUpdateGateway && !cancelledAt ? <Button onClick={() => { const next = selectedBooking; closeDetails(); setEditingBooking(next); }} variant="secondary">{text('修改預約', 'Edit booking')}</Button> : null}
            {canCancel && bookingCancelGateway && !cancelledAt && !confirmCancel ? <Button onClick={() => setConfirmCancel(true)} variant="danger">{text('取消預約', 'Cancel booking')}</Button> : null}
            {canCancel && bookingCancelGateway && !cancelledAt && confirmCancel ? <Button loading={cancelBusy} onClick={() => void cancelBooking()} variant="danger">{text('確認取消', 'Confirm cancellation')}</Button> : null}
            {confirmCancel && !cancelledAt ? <Button disabled={cancelBusy} onClick={() => setConfirmCancel(false)} variant="ghost">{text('返回', 'Back')}</Button> : null}
            <Button onClick={closeDetails} variant="outline">{text('關閉', 'Close')}</Button>
          </div>
        </ResponsiveDialog>
      ) : null}
    </ShellSection>
  );
}

function MoreView({ isAdmin, allowedPages, onOpenPage, onLogout }: {
  isAdmin: boolean;
  allowedPages: CloudPageId[];
  onOpenPage: (pageId: CloudPageId | UtilityViewId) => void;
  onLogout: () => void;
}) {
  const { locale, text } = useLocale();
  const primaryPages = new Set<CloudPageId>(['rooms', 'bookings', 'housekeeping', 'payments']);
  const visibleItems = pagesAllowedForNavigation(allowedPages).filter(
    (page) => !primaryPages.has(page.id) && (page.id !== 'users' || isAdmin),
  );
  return (
    <ShellSection title={text('更多功能', 'More')}>
      <div className="more-grid">
        <button onClick={() => onOpenPage('hub')}>Prototype Hub<span>›</span></button>
        {isAdmin ? <button onClick={() => onOpenPage('initial_import')}>{text('初始資料導入', 'Initial data import')}<span>›</span></button> : null}
        {visibleItems.map((item) => (
          <button key={item.id} onClick={() => onOpenPage(item.id)}>{locale === 'zh-TW' ? item.labelZhTw : item.labelEn}<span>›</span></button>
        ))}
        <button onClick={onLogout}>{text('登出', 'Sign out')}<span>›</span></button>
      </div>
    </ShellSection>
  );
}

function FoundationPage({ pageId, isAdmin, allowedPages, onOpenInitialImport, onOpenPage }: {
  pageId: CloudPageId | 'hub';
  isAdmin: boolean;
  allowedPages: readonly CloudPageId[];
  onOpenInitialImport: () => void;
  onOpenPage: (pageId: CloudPageId) => void;
}) {
  const { locale, text } = useLocale();
  const page = pageId === 'hub' ? null : CLOUD_PAGE_MANIFEST.find((candidate) => candidate.id === pageId);
  const title = pageId === 'hub' ? 'Prototype Hub' : (locale === 'zh-TW' ? page?.labelZhTw : page?.labelEn) ?? pageId;
  return (
    <ShellSection title={title} hint={text('全功能搬移中', 'Full migration in progress')}>
      {pageId === 'hub' ? <div className="hub-grid">{pagesAllowedForNavigation(allowedPages).map((item) => <button key={item.id} onClick={() => onOpenPage(item.id)} type="button"><strong>{locale === 'zh-TW' ? item.labelZhTw : item.labelEn}</strong><small>{text('開啟模組', 'Open module')} ›</small></button>)}{isAdmin ? <button onClick={onOpenInitialImport} type="button"><strong>{text('初始資料導入', 'Initial data import')}</strong><small>{text('僅管理員', 'Admin only')} ›</small></button> : null}</div> : <div className="foundation-page">
        <strong>{text('此模組已列入 Firebase v4 完整搬移範圍', 'This module is included in the full Firebase v4 migration')}</strong>
        <p>{text('目前 foundation 尚未接入真實 PMS 資料與 operation handler，因此不標示為完成功能。', 'The foundation is not yet connected to live PMS data or operation handlers, so this module is not marked complete.')}</p>
      </div>}
    </ShellSection>
  );
}

function ActiveView({ view, onAction, session, accountGateway, dataImportGateway, bookingListGateway, bookingCancelGateway, bookingUpdateGateway, bookingCreateGateway, bookingPreviewGateway, bookingRoomGateway, roomOverviewGateway, roomTimelineGateway, stayCheckInGateway, stayExtendGateway, stayCheckoutGateway, paymentCreateGateway, paymentListGateway, costGateway, reportGateway, auditGateway, housekeepingGateway, maintenanceGateway, roomManagementGateway, activeStaysGateway, holidayCalendarGateway, holidayGateway, propertyGateway, onOpenBookingCreate, onOpenPage, onLogout }: {
  view: ViewId;
  onAction: (action: string) => void;
  session: StaffSession;
  accountGateway: AccountAdminGateway | undefined;
  dataImportGateway: DataImportGateway | undefined;
  bookingListGateway: BookingListGateway | undefined;
  bookingCancelGateway: BookingCancelGateway | undefined;
  bookingUpdateGateway: BookingUpdateGateway | undefined;
  bookingCreateGateway: BookingCreateGateway | undefined;
  bookingPreviewGateway: BookingPreviewGateway | undefined;
  bookingRoomGateway: BookingRoomGateway | undefined;
  roomOverviewGateway: RoomOverviewGateway | undefined;
  roomTimelineGateway: RoomTimelineGateway | undefined;
  stayCheckInGateway: StayCheckInGateway | undefined;
  stayExtendGateway: StayExtendGateway | undefined;
  stayCheckoutGateway: StayCheckoutGateway | undefined;
  paymentCreateGateway: PaymentCreateGateway | undefined;
  paymentListGateway: PaymentListGateway | undefined;
  costGateway: CostGateway | undefined;
  reportGateway: ReportGateway | undefined;
  auditGateway: AuditGateway | undefined;
  housekeepingGateway: HousekeepingGateway | undefined;
  maintenanceGateway: MaintenanceGateway | undefined;
  roomManagementGateway: RoomManagementGateway | undefined;
  activeStaysGateway: ActiveStaysGateway | undefined;
  holidayCalendarGateway: HolidayCalendarGateway | undefined;
  holidayGateway: HolidayGateway | undefined;
  propertyGateway: PropertyGateway | undefined;
  onOpenBookingCreate: () => void;
  onOpenPage: (pageId: CloudPageId | UtilityViewId) => void;
  onLogout: () => void;
}) {
  if (view === 'bookings') return <BookingsView bookingCancelGateway={bookingCancelGateway} bookingUpdateGateway={bookingUpdateGateway} canCancel={session.allowedPages.includes('bookings')} canCreate={session.allowedPages.includes('bookings_new')} gateway={bookingListGateway} onOpenBookingCreate={onOpenBookingCreate} propertyId={session.propertyId} roomGateway={bookingRoomGateway} session={session} />;
  if (view === 'bookings_new') return <BookingCreatePage gateway={bookingCreateGateway} onViewBookings={() => onOpenPage('bookings')} previewGateway={bookingPreviewGateway} roomGateway={bookingRoomGateway} session={session} />;
  if (view === 'checkin') return <StayCheckInPage bookingGateway={bookingListGateway} gateway={stayCheckInGateway} onBack={() => onOpenPage('rooms')} roomGateway={bookingRoomGateway} session={session} />;
  if (view === 'extend') return <StayExtendPage gateway={stayExtendGateway} holidayGateway={holidayCalendarGateway} onBack={() => onOpenPage('rooms')} session={session} staysGateway={activeStaysGateway} />;
  if (view === 'checkout') return <StayCheckoutPage gateway={stayCheckoutGateway} onBack={() => onOpenPage('rooms')} session={session} staysGateway={activeStaysGateway} />;
  if (view === 'housekeeping') return <HousekeepingPage gateway={housekeepingGateway} session={session} />;
  if (view === 'maintenance') return <MaintenancePage gateway={maintenanceGateway} session={session} />;
  if (view === 'room_management') return <RoomManagementPage gateway={roomManagementGateway} session={session} />;
  if (view === 'gantt') return <RoomTimelinePage gateway={roomTimelineGateway} session={session} />;
  if (view === 'payments') return <PaymentsPage createGateway={paymentCreateGateway} listGateway={paymentListGateway} session={session} staysGateway={activeStaysGateway} />;
  if (view === 'costs') return <CostManagementPage gateway={costGateway} session={session} />;
  if (view === 'reports') return <ReportsPage gateway={reportGateway} session={session} />;
  if (view === 'audit') return <AuditTrailPage gateway={auditGateway} session={session} />;
  if (view === 'holidays') return <HolidayManagementPage gateway={holidayGateway} session={session} />;
  if (view === 'properties') return <PropertyManagementPage gateway={propertyGateway} session={session} />;
  if (view === 'accounts' || view === 'users') return <AccountManagement session={session} gateway={accountGateway} />;
  if (view === 'initial_import') return <InitialDataImport session={session} gateway={dataImportGateway} />;
  if (view === 'more') return <MoreView isAdmin={session.role === 'admin'} allowedPages={session.allowedPages} onOpenPage={onOpenPage} onLogout={onLogout} />;
  if (view === 'today' || view === 'rooms') return <TodayView canCheckIn={session.allowedPages.includes('checkin')} canCreate={session.allowedPages.includes('bookings_new')} canCheckout={session.allowedPages.includes('checkout')} canExtend={session.allowedPages.includes('extend')} canImport={session.role === 'admin'} onAction={onAction} onOpenBookingCreate={onOpenBookingCreate} onOpenCheckIn={() => onOpenPage('checkin')} onOpenCheckout={() => onOpenPage('checkout')} onOpenExtend={() => onOpenPage('extend')} onOpenInitialImport={() => onOpenPage('initial_import')} propertyId={session.propertyId} roomOverviewGateway={roomOverviewGateway} />;
  return <FoundationPage allowedPages={session.allowedPages} isAdmin={session.role === 'admin'} onOpenInitialImport={() => onOpenPage('initial_import')} onOpenPage={onOpenPage} pageId={view} />;
}

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { text } = useLocale();
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => { event.preventDefault(); onLogin(); }}>
        <img className="brand-wordmark" src="/bini-blooms-logo.png" alt="BINI Blooms" />
        <h1>{text('員工登入', 'Staff sign in')}</h1>
        <p>{text('僅限已核准的 BINI PMS 帳號', 'Approved BINI PMS accounts only')}</p>
        <Field label={text('電子郵件', 'Email')}><input required type="email" autoComplete="username" /></Field>
        <Field label={text('密碼', 'Password')}><input required type="password" autoComplete="current-password" /></Field>
        <Button block size="lg" type="submit">{text('安全登入', 'Secure sign in')}</Button>
      </form>
    </main>
  );
}

export function App({
  initialAuthenticated = true,
  session = previewSession,
  accountGateway,
  dataImportGateway,
  bookingListGateway,
  bookingCancelGateway,
  bookingSoonGateway,
  bookingUpdateGateway,
  bookingCreateGateway,
  bookingPreviewGateway,
  bookingRoomGateway,
  roomOverviewGateway,
  roomTimelineGateway,
  stayCheckInGateway,
  stayExtendGateway,
  stayCheckoutGateway,
  paymentCreateGateway,
  paymentListGateway,
  costGateway,
  reportGateway,
  auditGateway,
  housekeepingGateway,
  maintenanceGateway,
  roomManagementGateway,
  activeStaysGateway,
  holidayCalendarGateway,
  holidayGateway,
  propertyGateway,
  onLogout,
}: {
  initialAuthenticated?: boolean;
  session?: StaffSession;
  accountGateway?: AccountAdminGateway;
  dataImportGateway?: DataImportGateway;
  bookingListGateway?: BookingListGateway;
  bookingCancelGateway?: BookingCancelGateway;
  bookingSoonGateway?: BookingSoonGateway;
  bookingUpdateGateway?: BookingUpdateGateway;
  bookingCreateGateway?: BookingCreateGateway;
  bookingPreviewGateway?: BookingPreviewGateway;
  bookingRoomGateway?: BookingRoomGateway;
  roomOverviewGateway?: RoomOverviewGateway;
  roomTimelineGateway?: RoomTimelineGateway;
  stayCheckInGateway?: StayCheckInGateway;
  stayExtendGateway?: StayExtendGateway;
  stayCheckoutGateway?: StayCheckoutGateway;
  paymentCreateGateway?: PaymentCreateGateway;
  paymentListGateway?: PaymentListGateway;
  costGateway?: CostGateway;
  reportGateway?: ReportGateway;
  auditGateway?: AuditGateway;
  housekeepingGateway?: HousekeepingGateway;
  maintenanceGateway?: MaintenanceGateway;
  roomManagementGateway?: RoomManagementGateway;
  activeStaysGateway?: ActiveStaysGateway;
  holidayCalendarGateway?: HolidayCalendarGateway;
  holidayGateway?: HolidayGateway;
  propertyGateway?: PropertyGateway;
  onLogout?: () => void | Promise<void>;
}) {
  const { locale, text } = useLocale();
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [view, setView] = useState<ViewId>('today');
  const [sheetAction, setSheetAction] = useState<string | null>(null);
  const visibleMobileNavigation = mobileNavigation.filter((item) => !item.requiredPage || session.allowedPages.includes(item.requiredPage));
  const visibleDesktopPages = pagesAllowedForNavigation(session.allowedPages).filter(
    (page) => page.id !== 'users' || session.role === 'admin',
  );
  const selectedDesktopPage = activeDesktopPage(view);

  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;

  const logout = () => {
    if (onLogout) void onLogout();
    else setAuthenticated(false);
  };

  return (
    <div className="app-shell">
      <header className="desktop-topnav">
        <a aria-label="BINI Blooms PMS" className="desktop-brand" href="#hub" onClick={(event) => { event.preventDefault(); setView('hub'); }}>
          <img src="/bini-blooms-logo.png" alt="" />
        </a>
        <nav aria-label={text('桌面主導覽', 'Desktop navigation')}>
          <a className={view === 'hub' ? 'active' : ''} href="#hub" onClick={(event) => { event.preventDefault(); setView('hub'); }}>Prototype Hub</a>
          {visibleDesktopPages.map((page) => (
            <a
              className={selectedDesktopPage === page.id ? 'active' : ''}
              href={`#${page.id}`}
              key={page.id}
              onClick={(event) => { event.preventDefault(); setView(mobileViewForPage(page.id)); }}
            >{locale === 'zh-TW' ? page.labelZhTw : page.labelEn}</a>
          ))}
        </nav>
        <div className="desktop-account">
          <span className="environment-state">DEV</span>
          <strong>{session.displayName}</strong>
          <LanguageSwitcher className="desktop-language-switch" />
          <button type="button" aria-label={text('登出', 'Sign out')} onClick={logout}>⏻</button>
        </div>
      </header>

      <div className="page-column">
        <header className="topbar">
          <div><small>{formatLocalDate(locale)}</small><h1>{titleForView(view, locale, text)}</h1></div>
          <div className="topbar-controls"><LanguageSwitcher className="mobile-language-switch" /><button className="avatar" aria-label={text('帳號選單', 'Account menu')}>{session.displayName.slice(0, 1) || text('管', 'A')}</button></div>
        </header>

        <Notice className="foundation-banner" title={text('DEV 開發中 · 尚不可作為正式營運系統', 'DEV in progress · Not for live operations')}>
          <small>{text('登入與帳號管理已接 Firebase；其餘 PMS 模組將依全功能對照矩陣逐項接入。', 'Authentication and account management use Firebase; remaining PMS modules are being connected against the parity matrix.')}</small>
        </Notice>

        {session.allowedPages.includes('bookings') ? <BookingSoonBanner cancelGateway={bookingCancelGateway} gateway={bookingSoonGateway} propertyId={session.propertyId} /> : null}

        <main className="page-content"><ActiveView
          view={view}
          onAction={setSheetAction}
          session={session}
          accountGateway={accountGateway}
          dataImportGateway={dataImportGateway}
          bookingListGateway={bookingListGateway}
          bookingCancelGateway={bookingCancelGateway}
          bookingUpdateGateway={bookingUpdateGateway}
          bookingCreateGateway={bookingCreateGateway}
          bookingPreviewGateway={bookingPreviewGateway}
          bookingRoomGateway={bookingRoomGateway}
          roomOverviewGateway={roomOverviewGateway}
          roomTimelineGateway={roomTimelineGateway}
          stayCheckInGateway={stayCheckInGateway}
          stayExtendGateway={stayExtendGateway}
          stayCheckoutGateway={stayCheckoutGateway}
          paymentCreateGateway={paymentCreateGateway}
          paymentListGateway={paymentListGateway}
          costGateway={costGateway}
          reportGateway={reportGateway}
          auditGateway={auditGateway}
          housekeepingGateway={housekeepingGateway}
          maintenanceGateway={maintenanceGateway}
          roomManagementGateway={roomManagementGateway}
          activeStaysGateway={activeStaysGateway}
          holidayCalendarGateway={holidayCalendarGateway}
          holidayGateway={holidayGateway}
          propertyGateway={propertyGateway}
          onOpenBookingCreate={() => setView('bookings_new')}
          onOpenPage={(pageId) => setView(pageId === 'users' ? 'accounts' : pageId)}
          onLogout={logout}
        /></main>
      </div>

      <nav className="mobile-nav" aria-label={text('手機主導覽', 'Mobile navigation')}>
        {visibleMobileNavigation.map((item) => (
          <button className={view === item.id ? 'active' : ''} key={item.id} aria-label={locale === 'zh-TW' ? item.labelZhTw : item.labelEn} onClick={() => setView(item.id)}>
            <span>{item.icon}</span><small>{locale === 'zh-TW' ? item.labelZhTw : item.labelEn}</small>
          </button>
        ))}
      </nav>

      {sheetAction ? (
        <ResponsiveDialog className="action-sheet" onClose={() => setSheetAction(null)} title={sheetAction}>
            <p className="foundation-notice">{text('這是手機流程骨架；正式欄位與 Firebase 寫入會在下一個 domain milestone 接入。', 'This is the mobile workflow foundation. Live fields and Firebase writes will arrive with the next domain milestone.')}</p>
            <Button block onClick={() => setSheetAction(null)} size="lg">{text('完成介面預覽', 'Close preview')}</Button>
        </ResponsiveDialog>
      ) : null}
    </div>
  );
}
