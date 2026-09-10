import { useState, type ReactNode } from 'react';

type ViewId = 'today' | 'bookings' | 'housekeeping' | 'payments' | 'more';

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
}

const navigation: NavItem[] = [
  { id: 'today', label: '今日', icon: '⌂' },
  { id: 'bookings', label: '預約', icon: '▣' },
  { id: 'housekeeping', label: '房務', icon: '✓' },
  { id: 'payments', label: '款項', icon: '$' },
  { id: 'more', label: '更多', icon: '•••' },
];

const weekdayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${weekdayLabels[date.getDay()]}`;
}

const rooms = [
  { number: '201', guest: 'Carlos', state: '住宿中', tone: 'occupied', note: '今日 21:00 退房' },
  { number: '202', guest: 'Juvy', state: '待入住', tone: 'arrival', note: '15:00 後可入住' },
  { number: '203', guest: '—', state: '待清潔', tone: 'cleaning', note: '優先清潔' },
  { number: '205', guest: '—', state: '空房', tone: 'vacant', note: '可立即入住' },
  { number: '207', guest: '—', state: '維修中', tone: 'maintenance', note: '浴室檢查' },
];

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

      <ShellSection title="今日房態" hint="5 間" >
        <div className="room-grid" role="region" aria-label="今日房態">
          {rooms.map((room) => (
            <button className={`room-card room-card--${room.tone}`} key={room.number} onClick={() => onAction(`${room.number} 房間`)}>
              <span className="room-number">{room.number}</span>
              <span className="status-pill">{room.state}</span>
              <strong>{room.guest}</strong>
              <small>{room.note}</small>
            </button>
          ))}
        </div>
      </ShellSection>

      <ShellSection title="接下來要處理" hint="依時間排序">
        <div className="task-list">
          <button><span className="time">14:30</span><span><strong>202 · Juvy</strong><small>預約入住 · 已付押金</small></span><span>›</span></button>
          <button><span className="time">17:00</span><span><strong>203 · Chris</strong><small>預計入住 · 尚未收款</small></span><span>›</span></button>
        </div>
      </ShellSection>
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

function MoreView() {
  return (
    <ShellSection title="更多功能">
      <div className="more-grid">
        {['房間管理', '維修管理', '成本紀錄', '統計報表', '雲端備份', '裝置與帳號'].map((item) => <button key={item}>{item}<span>›</span></button>)}
      </div>
    </ShellSection>
  );
}

function ActiveView({ view, onAction }: { view: ViewId; onAction: (action: string) => void }) {
  if (view === 'bookings') return <BookingsView onAction={onAction} />;
  if (view === 'housekeeping') return <HousekeepingView />;
  if (view === 'payments') return <PaymentsView onAction={onAction} />;
  if (view === 'more') return <MoreView />;
  return <TodayView onAction={onAction} />;
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

export function App({ initialAuthenticated = true }: { initialAuthenticated?: boolean }) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [view, setView] = useState<ViewId>('today');
  const [syncOpen, setSyncOpen] = useState(false);
  const [sheetAction, setSheetAction] = useState<string | null>(null);

  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar" aria-label="桌面主導覽">
        <div className="brand"><img src="/bini-mark.svg" alt="" /><span>BINI PMS<small>雲端版基礎介面</small></span></div>
        {navigation.map((item) => <a className={view === item.id ? 'active' : ''} href={`#${item.id}`} key={item.id} onClick={(event) => { event.preventDefault(); setView(item.id); }}><span>{item.icon}</span>{item.label}</a>)}
        <button className="logout" onClick={() => setAuthenticated(false)}>登出</button>
      </aside>

      <div className="page-column">
        <header className="topbar">
          <div><small>{formatLocalDate()}</small><h1>{view === 'today' ? '今日營運' : navigation.find((item) => item.id === view)?.label}</h1></div>
          <button className="avatar" aria-label="帳號選單">管</button>
        </header>

        <button className="sync-banner" onClick={() => setSyncOpen(true)} aria-label="2 筆待同步，開啟待同步中心">
          <span className="sync-dot" />
          <span><strong>離線模式 · 2 筆待同步</strong><small>操作尚未完成，連線後將自動送出</small></span>
          <span>查看 ›</span>
        </button>

        <main className="page-content"><ActiveView view={view} onAction={setSheetAction} /></main>
      </div>

      <nav className="mobile-nav" aria-label="手機主導覽">
        {navigation.map((item) => (
          <button className={view === item.id ? 'active' : ''} key={item.id} aria-label={item.label} onClick={() => setView(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {syncOpen ? (
        <div className="modal-backdrop" onClick={() => setSyncOpen(false)}>
          <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label="待同步中心" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" /><div className="sheet-title"><div><h2>待同步中心</h2><p>等待網路恢復後由伺服器確認</p></div><button aria-label="關閉待同步中心" onClick={() => setSyncOpen(false)}>×</button></div>
            <p className="sync-warning">尚未完成</p>
            <article className="pending-item"><span>新增預約</span><strong>202 · Juvy</strong><small>等待同步</small></article>
            <article className="pending-item"><span>房務更新</span><strong>203 · 開始清潔</strong><small>等待同步</small></article>
          </section>
        </div>
      ) : null}

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
