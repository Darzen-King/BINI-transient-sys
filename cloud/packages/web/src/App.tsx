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
import { InitialDataImport } from './migration/InitialDataImport.js';
import type { DataImportGateway } from './migration/data-import.js';

type UtilityViewId = 'hub' | 'initial_import';
type ViewId = 'today' | 'more' | 'accounts' | UtilityViewId | CloudPageId;

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  requiredPage?: CloudPageId;
}

const mobileNavigation: NavItem[] = [
  { id: 'today', label: '今日', icon: '⌂', requiredPage: 'rooms' },
  { id: 'bookings', label: '預約', icon: '▣', requiredPage: 'bookings' },
  { id: 'housekeeping', label: '房務', icon: '✓', requiredPage: 'housekeeping' },
  { id: 'payments', label: '款項', icon: '$', requiredPage: 'payments' },
  { id: 'more', label: '更多', icon: '•••' },
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

const previewSession: StaffSession = {
  uid: 'preview-admin',
  email: 'admin@example.com',
  displayName: '管理員',
  propertyId: 'property-main',
  role: 'admin',
  allowedPages: [...ROLE_DEFAULT_PAGES.admin],
};

const weekdayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${weekdayLabels[date.getDay()]}`;
}

type RoomTone = 'occupied' | 'arrival' | 'cleaning' | 'vacant' | 'maintenance' | 'monthly';

interface RoomViewModel {
  number: string;
  state: string;
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
    number: '201', state: '月租套房', tone: 'monthly', guest: 'Carlos',
    checkin: '2026-06-01', checkout: '2026-10-01', note: 'Monthly Rent', actions: [],
  },
  {
    number: '202', state: '使用中', tone: 'occupied', guest: 'Joshua',
    checkin: '2026-09-05 16:00', checkout: '2026-09-13 16:00',
    totalDue: 6400, totalPaid: 0, depositPaid: 0, balanceDue: 6400,
    nextBooking: '2026-09-19 11:00', actions: ['extend', 'payment', 'checkout'],
  },
  {
    number: '203', state: '可入住', tone: 'vacant', nextBooking: '2026-09-11 21:00',
    actions: ['checkin'],
  },
  {
    number: '205', state: '可入住', tone: 'vacant', nextBooking: '2026-09-12 21:00',
    actions: ['checkin'],
  },
  {
    number: '206', state: '月租套房', tone: 'monthly', guest: 'Edong',
    checkin: '2026-07-10', checkout: '2026-09-10', note: 'Monthly Rent', actions: [],
  },
  {
    number: '207', state: '月租套房', tone: 'monthly', guest: 'Tangkad',
    checkin: '2026-07-10', checkout: '2026-09-10', note: 'Monthly Rent', actions: [],
  },
];

const actionLabels = {
  checkin: '辦理入住',
  extend: '延住處理',
  payment: '付款',
  checkout: '退房辦理',
} as const;

function RoomDetails({ room }: { room: RoomViewModel }) {
  const hasPaymentSummary = room.totalDue !== undefined;
  return (
    <div className="room-card-details">
      <dl className="room-detail-list">
        {room.guest ? <div><dt>目前旅客</dt><dd><strong>{room.guest}</strong></dd></div> : null}
        {room.checkin ? <div><dt>入住時間</dt><dd>{room.checkin}</dd></div> : null}
        {room.checkout ? <div><dt>退房時間</dt><dd>{room.checkout}</dd></div> : null}
        {room.maintenanceTitle ? <div><dt>維修項目</dt><dd className="danger-text">{room.maintenanceTitle}</dd></div> : null}
        {room.maintenanceEnd ? <div><dt>預計完成</dt><dd className="danger-text">{room.maintenanceEnd}</dd></div> : null}
        {room.nextBooking ? <div><dt>下一筆預約</dt><dd className="info-text">{room.nextBooking}</dd></div> : null}
        {room.note ? <div><dt>備註</dt><dd>{room.note}</dd></div> : null}
      </dl>
      {hasPaymentSummary ? (
        <div className="room-payment-summary" aria-label={`${room.number} 房款項摘要`}>
          <div><span>💰 應付總額</span><strong>NT$ {room.totalDue?.toLocaleString()}</strong></div>
          <div><span>💳 已收款</span><strong className="success-text">NT$ {(room.totalPaid ?? 0).toLocaleString()}</strong></div>
          {(room.depositPaid ?? 0) > 0 ? <div className="deposit-row"><span>↳ 含押金</span><span>NT$ {room.depositPaid?.toLocaleString()}</span></div> : null}
          <div className="balance-row"><strong>餘額應收</strong><strong>NT$ {(room.balanceDue ?? 0).toLocaleString()}{(room.balanceDue ?? 0) <= 0 ? ' ✅' : ''}</strong></div>
        </div>
      ) : null}
    </div>
  );
}

function RoomActions({ room, onAction }: { room: RoomViewModel; onAction: (action: string) => void }) {
  if (room.actions.length === 0) return null;
  return (
    <div className="room-card-actions">
      {room.actions.map((action) => (
        <button
          className={`room-action room-action--${action}`}
          key={action}
          onClick={() => onAction(`${room.number} · ${actionLabels[action]}`)}
          type="button"
        >{action === 'payment' ? '💵 ' : ''}{actionLabels[action]}</button>
      ))}
    </div>
  );
}

function ShellSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section-card">
      <div className="section-heading">
        <h2>{title}</h2>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function TodayView({ onAction }: { onAction: (action: string) => void }) {
  const [selectedRoom, setSelectedRoom] = useState<RoomViewModel | null>(null);

  return (
    <>
      <section className="summary-strip" aria-label="今日營運摘要">
        <article><strong>3</strong><span>今日入住</span></article>
        <article><strong>2</strong><span>今日退房</span></article>
        <article><strong>1</strong><span>清潔待辦</span></article>
      </section>

      <section className="quick-actions" aria-label="櫃檯快捷操作">
        <button aria-label="新增預約" className="primary-action" onClick={() => onAction('新增預約')}>＋<span>新增預約</span></button>
        <button aria-label="辦理入住" onClick={() => onAction('辦理入住')}>↘<span>辦理入住</span></button>
        <button aria-label="辦理退房" onClick={() => onAction('辦理退房')}>↗<span>辦理退房</span></button>
      </section>

      <ShellSection title="今日房態" hint={`${rooms.length} 間`} >
        <div className="room-grid" role="region" aria-label="今日房態">
          {rooms.map((room) => (
            <article className={`room-card room-card--${room.tone}`} key={room.number}>
              <button
                aria-label={`查看 ${room.number} 房詳細資料`}
                className="room-card-summary"
                onClick={() => setSelectedRoom(room)}
                type="button"
              >
                <span className="room-number">{room.number}</span>
                <span className="status-pill">{room.state}</span>
                <strong>{room.guest ?? '—'}</strong>
                <small>{room.nextBooking ? `下一筆 ${room.nextBooking}` : room.note ?? '點擊查看完整資料'}</small>
                <span className="mobile-detail-affordance" aria-hidden="true">查看詳細資料 ›</span>
              </button>
              <RoomDetails room={room} />
              <RoomActions room={room} onAction={onAction} />
            </article>
          ))}
        </div>
      </ShellSection>

      <ShellSection title="接下來要處理" hint="依時間排序">
        <div className="task-list">
          <button><span className="time">14:30</span><span><strong>202 · Juvy</strong><small>預約入住 · 已付押金</small></span><span>›</span></button>
          <button><span className="time">17:00</span><span><strong>203 · Chris</strong><small>預計入住 · 尚未收款</small></span><span>›</span></button>
        </div>
      </ShellSection>

      {selectedRoom ? (
        <div className="modal-backdrop room-detail-backdrop" onClick={() => setSelectedRoom(null)}>
          <section
            aria-label={`${selectedRoom.number} 房詳細資料`}
            aria-modal="true"
            className={`bottom-sheet room-detail-sheet room-card--${selectedRoom.tone}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="sheet-handle" />
            <div className="sheet-title room-detail-title">
              <div><h2>{selectedRoom.number} 房</h2><span className="status-pill">{selectedRoom.state}</span></div>
              <button aria-label="關閉房間詳細資料" onClick={() => setSelectedRoom(null)}>×</button>
            </div>
            <RoomDetails room={selectedRoom} />
            <RoomActions room={selectedRoom} onAction={(action) => { setSelectedRoom(null); onAction(action); }} />
          </section>
        </div>
      ) : null}
    </>
  );
}

function BookingsView({ onAction }: { onAction: (action: string) => void }) {
  return (
    <ShellSection title="預約" hint="今天 3 筆">
      <button className="wide-primary" onClick={() => onAction('新增預約')}>＋ 新增預約</button>
      <label className="search-field"><span>搜尋</span><input type="search" placeholder="房號、姓名、預約編號" /></label>
      <div className="booking-list">
        {['202 · Juvy', '203 · Chris', '205 · Michael'].map((booking, index) => (
          <button key={booking}><span><strong>{booking}</strong><small>{index === 0 ? '今天 14:30 入住' : '明天入住'}</small></span><span className="status-pill">已預約</span></button>
        ))}
      </div>
    </ShellSection>
  );
}

function HousekeepingView() {
  return (
    <ShellSection title="房務工作" hint="1 項待處理">
      <div className="priority-card">
        <span className="status-pill">優先清潔</span><strong>203 房</strong><p>下一組客人預計 17:00 入住</p>
        <button>開始清潔</button>
      </div>
      <div className="empty-card">目前沒有其他待清潔房間</div>
    </ShellSection>
  );
}

function PaymentsView({ onAction }: { onAction: (action: string) => void }) {
  return (
    <ShellSection title="款項" hint="今日">
      <div className="money-summary"><span>今日實收</span><strong>NT$ 4,800</strong><small>另有 1 筆待同步，不計入正式總額</small></div>
      <button className="wide-primary" onClick={() => onAction('新增收款')}>＋ 新增收款</button>
    </ShellSection>
  );
}

function MoreView({ isAdmin, allowedPages, onOpenPage, onLogout }: {
  isAdmin: boolean;
  allowedPages: CloudPageId[];
  onOpenPage: (pageId: CloudPageId | UtilityViewId) => void;
  onLogout: () => void;
}) {
  const primaryPages = new Set<CloudPageId>(['rooms', 'bookings', 'housekeeping', 'payments']);
  const visibleItems = pagesAllowedForNavigation(allowedPages).filter(
    (page) => !primaryPages.has(page.id) && (page.id !== 'users' || isAdmin),
  );
  return (
    <ShellSection title="更多功能">
      <div className="more-grid">
        <button onClick={() => onOpenPage('hub')}>Prototype Hub<span>›</span></button>
        {isAdmin ? <button onClick={() => onOpenPage('initial_import')}>初始資料導入<span>›</span></button> : null}
        {visibleItems.map((item) => (
          <button key={item.id} onClick={() => onOpenPage(item.id)}>{item.labelZhTw}<span>›</span></button>
        ))}
        <button onClick={onLogout}>登出<span>›</span></button>
      </div>
    </ShellSection>
  );
}

function FoundationPage({ pageId, isAdmin, onOpenInitialImport }: {
  pageId: CloudPageId | 'hub';
  isAdmin: boolean;
  onOpenInitialImport: () => void;
}) {
  const page = pageId === 'hub' ? null : CLOUD_PAGE_MANIFEST.find((candidate) => candidate.id === pageId);
  const title = pageId === 'hub' ? 'Prototype Hub' : page?.labelZhTw ?? pageId;
  return (
    <ShellSection title={title} hint="全功能搬移中">
      <div className="foundation-page">
        <strong>此模組已列入 Firebase v4 完整搬移範圍</strong>
        <p>目前 foundation 尚未接入真實 PMS 資料與 operation handler，因此不標示為完成功能。</p>
        {pageId === 'hub' && isAdmin ? <button className="compact-primary import-entry" onClick={onOpenInitialImport}>從 Dropbox 備份進行初始資料導入</button> : null}
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
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => { event.preventDefault(); onLogin(); }}>
        <img src="/bini-mark.svg" alt="BINI Blooms" />
        <h1>員工登入</h1>
        <p>僅限已核准的 BINI PMS 帳號</p>
        <label>電子郵件<input required type="email" autoComplete="username" /></label>
        <label>密碼<input required type="password" autoComplete="current-password" /></label>
        <button className="wide-primary" type="submit">安全登入</button>
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
        <a className="desktop-brand" href="#hub" onClick={(event) => { event.preventDefault(); setView('hub'); }}>
          <img src="/bini-mark.svg" alt="" />
          <span>BINI Blooms PMS</span>
        </a>
        <nav aria-label="桌面主導覽">
          <a className={view === 'hub' ? 'active' : ''} href="#hub" onClick={(event) => { event.preventDefault(); setView('hub'); }}>Prototype Hub</a>
          {visibleDesktopPages.map((page) => (
            <a
              className={selectedDesktopPage === page.id ? 'active' : ''}
              href={`#${page.id}`}
              key={page.id}
              onClick={(event) => { event.preventDefault(); setView(mobileViewForPage(page.id)); }}
            >{page.labelZhTw}</a>
          ))}
        </nav>
        <div className="desktop-account">
          <span className="environment-state">DEV</span>
          <strong>{session.displayName}</strong>
          <button disabled title="完整雙語切換尚在搬移中" type="button">中文</button>
          <button disabled title="完整雙語切換尚在搬移中" type="button">EN</button>
          <button type="button" aria-label="登出" onClick={logout}>⏻</button>
        </div>
      </header>

      <div className="page-column">
        <header className="topbar">
          <div><small>{formatLocalDate()}</small><h1>{view === 'today' ? '今日營運' : view === 'accounts' ? '使用者管理' : view === 'hub' ? 'Prototype Hub' : view === 'initial_import' ? '初始資料導入' : CLOUD_PAGE_MANIFEST.find((page) => page.id === view)?.labelZhTw ?? mobileNavigation.find((item) => item.id === view)?.label}</h1></div>
          <button className="avatar" aria-label="帳號選單">{session.displayName.slice(0, 1) || '管'}</button>
        </header>

        <div className="foundation-banner" role="status">
          <span className="foundation-dot" />
          <span><strong>DEV 開發中 · 尚不可作為正式營運系統</strong><small>登入與帳號管理已接 Firebase；其餘 PMS 模組將依全功能對照矩陣逐項接入。</small></span>
        </div>

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

      <nav className="mobile-nav" aria-label="手機主導覽">
        {visibleMobileNavigation.map((item) => (
          <button className={view === item.id ? 'active' : ''} key={item.id} aria-label={item.label} onClick={() => setView(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {sheetAction ? (
        <div className="modal-backdrop" onClick={() => setSheetAction(null)}>
          <section className="bottom-sheet action-sheet" role="dialog" aria-modal="true" aria-label={sheetAction} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" /><div className="sheet-title"><h2>{sheetAction}</h2><button aria-label="關閉操作表單" onClick={() => setSheetAction(null)}>×</button></div>
            <p className="foundation-notice">這是手機流程骨架；正式欄位與 Firebase 寫入會在下一個 domain milestone 接入。</p>
            <button className="wide-primary" onClick={() => setSheetAction(null)}>完成介面預覽</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
