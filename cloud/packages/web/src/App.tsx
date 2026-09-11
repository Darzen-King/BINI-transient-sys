import { useState, type ReactNode } from 'react';
import {
  CLOUD_PAGE_MANIFEST,
  ROLE_DEFAULT_PAGES,
  pagesAllowedForNavigation,
  type CloudPageId,
} from '@bini/cloud-shared';

import { AccountManagement } from './accounts/AccountManagement.js';
import type { AccountAdminGateway } from './accounts/account-admin.js';
import type { StaffSession } from './auth/session.js';
import { Badge, Button, Field, Notice, ResponsiveDialog, SectionCard } from './design-system/index.js';
import { LanguageSwitcher, useLocale, type AppLocale } from './i18n/locale.js';
import { InitialDataImport } from './migration/InitialDataImport.js';
import type { DataImportGateway } from './migration/data-import.js';

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
type RoomState = 'monthly' | 'occupied' | 'vacant' | 'arrival' | 'cleaning' | 'maintenance';

interface RoomViewModel {
  number: string;
  state: RoomState;
  tone: RoomTone;
  guest?: string;
  checkin?: string;
  checkout?: string;
  totalDue?: number;
  totalPaid?: number;
  depositPaid?: number;
  balanceDue?: number;
  maintenanceTitle?: string;
  maintenanceEnd?: string;
  nextBooking?: string;
  note?: string;
  actions: Array<'checkin' | 'extend' | 'payment' | 'checkout'>;
}

const rooms: RoomViewModel[] = [
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
  vacant: ['可入住', 'Vacant'],
  arrival: ['待入住', 'Arrival'],
  cleaning: ['待清潔', 'Cleaning'],
  maintenance: ['維修中', 'Maintenance'],
};

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

function RoomActions({ room, onAction }: { room: RoomViewModel; onAction: (action: string) => void }) {
  const { locale } = useLocale();
  if (room.actions.length === 0) return null;
  return (
    <div className="room-card-actions">
      {room.actions.map((action) => (
        <Button
          className={`room-action room-action--${action}`}
          key={action}
          onClick={() => onAction(`${room.number} · ${actionLabels[action][locale === 'zh-TW' ? 0 : 1]}`)}
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

function TodayView({ onAction }: { onAction: (action: string) => void }) {
  const { locale, text } = useLocale();
  const [selectedRoom, setSelectedRoom] = useState<RoomViewModel | null>(null);
  const stateLabel = (state: RoomState) => roomStateLabels[state][locale === 'zh-TW' ? 0 : 1];

  return (
    <>
      <section className="summary-strip" aria-label={text('今日營運摘要', "Today's operations summary")}>
        <article><strong>3</strong><span>{text('今日入住', 'Arrivals')}</span></article>
        <article><strong>2</strong><span>{text('今日退房', 'Departures')}</span></article>
        <article><strong>1</strong><span>{text('清潔待辦', 'To clean')}</span></article>
      </section>

      <section className="quick-actions" aria-label={text('櫃檯快捷操作', 'Front desk quick actions')}>
        <Button aria-label={text('新增預約', 'New booking')} className="primary-action" onClick={() => onAction(text('新增預約', 'New booking'))}>＋<span>{text('新增預約', 'New booking')}</span></Button>
        <Button aria-label={text('辦理入住', 'Check in')} onClick={() => onAction(text('辦理入住', 'Check in'))} variant="outline">↘<span>{text('辦理入住', 'Check in')}</span></Button>
        <Button aria-label={text('辦理退房', 'Check out')} onClick={() => onAction(text('辦理退房', 'Check out'))} variant="outline">↗<span>{text('辦理退房', 'Check out')}</span></Button>
      </section>

      <ShellSection title={text('今日房態', "Today's rooms")} hint={text(`${rooms.length} 間`, `${rooms.length} rooms`)} >
        <div className="room-grid" role="region" aria-label={text('今日房態', "Today's rooms")}>
          {rooms.map((room) => (
            <article className={`room-card room-card--${room.tone}`} key={room.number}>
              <button
                aria-label={text(`查看 ${room.number} 房詳細資料`, `View room ${room.number} details`)}
                className="room-card-summary"
                onClick={() => setSelectedRoom(room)}
                type="button"
              >
                <span className="room-number">{room.number}</span>
                <Badge className="status-pill">{stateLabel(room.state)}</Badge>
                <strong>{room.guest ?? '—'}</strong>
                <small>{room.nextBooking ? `${text('下一筆', 'Next')} ${room.nextBooking}` : room.note ?? text('點擊查看完整資料', 'Tap for full details')}</small>
                <span className="mobile-detail-affordance" aria-hidden="true">{text('查看詳細資料', 'View details')} ›</span>
              </button>
              <RoomDetails room={room} />
              <RoomActions room={room} onAction={onAction} />
            </article>
          ))}
        </div>
      </ShellSection>

      <ShellSection title={text('接下來要處理', 'Up next')} hint={text('依時間排序', 'By time')}>
        <div className="task-list">
          <button><span className="time">14:30</span><span><strong>202 · Juvy</strong><small>{text('預約入住 · 已付押金', 'Arrival · Deposit paid')}</small></span><span>›</span></button>
          <button><span className="time">17:00</span><span><strong>203 · Chris</strong><small>{text('預計入住 · 尚未收款', 'Expected arrival · Payment due')}</small></span><span>›</span></button>
        </div>
      </ShellSection>

      {selectedRoom ? (
        <ResponsiveDialog
          className={`room-detail-sheet room-card--${selectedRoom.tone}`}
          onClose={() => setSelectedRoom(null)}
          title={text(`${selectedRoom.number} 房詳細資料`, `Room ${selectedRoom.number} details`)}
        >
            <Badge className="status-pill">{stateLabel(selectedRoom.state)}</Badge>
            <RoomDetails room={selectedRoom} />
            <RoomActions room={selectedRoom} onAction={(action) => { setSelectedRoom(null); onAction(action); }} />
        </ResponsiveDialog>
      ) : null}
    </>
  );
}

function BookingsView({ onAction }: { onAction: (action: string) => void }) {
  const { text } = useLocale();
  return (
    <ShellSection title={text('預約', 'Bookings')} hint={text('今天 3 筆', '3 today')}>
      <Button block onClick={() => onAction(text('新增預約', 'New booking'))} size="lg">＋ {text('新增預約', 'New booking')}</Button>
      <Field className="search-field" label={text('搜尋', 'Search')}><input type="search" placeholder={text('房號、姓名、預約編號', 'Room, guest or booking ID')} /></Field>
      <div className="booking-list">
        {['202 · Juvy', '203 · Chris', '205 · Michael'].map((booking, index) => (
          <button key={booking}><span><strong>{booking}</strong><small>{index === 0 ? text('今天 14:30 入住', 'Arrives today at 14:30') : text('明天入住', 'Arrives tomorrow')}</small></span><Badge tone="success">{text('已預約', 'Booked')}</Badge></button>
        ))}
      </div>
    </ShellSection>
  );
}

function HousekeepingView() {
  const { text } = useLocale();
  return (
    <ShellSection title={text('房務工作', 'Housekeeping')} hint={text('1 項待處理', '1 pending')}>
      <div className="priority-card">
        <Badge tone="warning">{text('優先清潔', 'Priority')}</Badge><strong>{text('203 房', 'Room 203')}</strong><p>{text('下一組客人預計 17:00 入住', 'Next guest arrives at 17:00')}</p>
        <Button block>{text('開始清潔', 'Start cleaning')}</Button>
      </div>
      <div className="empty-card">{text('目前沒有其他待清潔房間', 'No other rooms are waiting for cleaning')}</div>
    </ShellSection>
  );
}

function PaymentsView({ onAction }: { onAction: (action: string) => void }) {
  const { text } = useLocale();
  return (
    <ShellSection title={text('款項', 'Payments')} hint={text('今日', 'Today')}>
      <div className="money-summary"><span>{text('今日實收', 'Collected today')}</span><strong>NT$ 4,800</strong><small>{text('另有 1 筆待同步，不計入正式總額', '1 pending item is excluded from the official total')}</small></div>
      <Button block onClick={() => onAction(text('新增收款', 'New payment'))} size="lg">＋ {text('新增收款', 'New payment')}</Button>
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

function FoundationPage({ pageId, isAdmin, onOpenInitialImport }: {
  pageId: CloudPageId | 'hub';
  isAdmin: boolean;
  onOpenInitialImport: () => void;
}) {
  const { locale, text } = useLocale();
  const page = pageId === 'hub' ? null : CLOUD_PAGE_MANIFEST.find((candidate) => candidate.id === pageId);
  const title = pageId === 'hub' ? 'Prototype Hub' : (locale === 'zh-TW' ? page?.labelZhTw : page?.labelEn) ?? pageId;
  return (
    <ShellSection title={title} hint={text('全功能搬移中', 'Full migration in progress')}>
      <div className="foundation-page">
        <strong>{text('此模組已列入 Firebase v4 完整搬移範圍', 'This module is included in the full Firebase v4 migration')}</strong>
        <p>{text('目前 foundation 尚未接入真實 PMS 資料與 operation handler，因此不標示為完成功能。', 'The foundation is not yet connected to live PMS data or operation handlers, so this module is not marked complete.')}</p>
        {pageId === 'hub' && isAdmin ? <Button className="import-entry" onClick={onOpenInitialImport}>{text('從 Dropbox 備份進行初始資料導入', 'Start initial import from a Dropbox backup')}</Button> : null}
      </div>
    </ShellSection>
  );
}

function ActiveView({ view, onAction, session, accountGateway, dataImportGateway, onOpenPage, onLogout }: {
  view: ViewId;
  onAction: (action: string) => void;
  session: StaffSession;
  accountGateway: AccountAdminGateway | undefined;
  dataImportGateway: DataImportGateway | undefined;
  onOpenPage: (pageId: CloudPageId | UtilityViewId) => void;
  onLogout: () => void;
}) {
  if (view === 'bookings') return <BookingsView onAction={onAction} />;
  if (view === 'housekeeping') return <HousekeepingView />;
  if (view === 'payments') return <PaymentsView onAction={onAction} />;
  if (view === 'accounts' || view === 'users') return <AccountManagement session={session} gateway={accountGateway} />;
  if (view === 'initial_import') return <InitialDataImport session={session} gateway={dataImportGateway} />;
  if (view === 'more') return <MoreView isAdmin={session.role === 'admin'} allowedPages={session.allowedPages} onOpenPage={onOpenPage} onLogout={onLogout} />;
  if (view === 'today' || view === 'rooms') return <TodayView onAction={onAction} />;
  return <FoundationPage pageId={view} isAdmin={session.role === 'admin'} onOpenInitialImport={() => onOpenPage('initial_import')} />;
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
  onLogout,
}: {
  initialAuthenticated?: boolean;
  session?: StaffSession;
  accountGateway?: AccountAdminGateway;
  dataImportGateway?: DataImportGateway;
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

        <main className="page-content"><ActiveView
          view={view}
          onAction={setSheetAction}
          session={session}
          accountGateway={accountGateway}
          dataImportGateway={dataImportGateway}
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
