import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CLOUD_PAGE_IDS,
  ROLE_DEFAULT_PAGES,
  type CloudPageId,
  type CloudRole,
  type StaffDirectoryEntry,
} from '@bini/cloud-shared';

import type { AccountAdminGateway } from './account-admin.js';
import type { StaffSession } from '../auth/session.js';

const ROLE_LABELS: Record<CloudRole, string> = {
  admin: '系統管理員',
  manager: '主管',
  front_desk: '前台',
  housekeeping: '房務',
  maintenance: '維修',
};

const PAGE_LABELS: Record<CloudPageId, string> = {
  rooms: '房間總覽',
  gantt: '甘特圖',
  payments: '付款管理',
  bookings: '預約管理',
  bookings_new: '新增預約',
  checkin: '入住登記',
  extend: '延住處理',
  checkout: '退房辦理',
  room_management: '房間管理',
  housekeeping: '清潔管理',
  maintenance: '維修管理',
  reports: '統計報表',
  audit: '審計軌跡',
  users: '使用者',
  properties: '館別管理',
  costs: '成本紀錄',
  holidays: '假日管理',
};

interface EditorState {
  uid: string;
  email: string;
  displayName: string;
  role: CloudRole;
  active: boolean;
  allowedPages: CloudPageId[];
  password: string;
}

const defaultEditor = (role: CloudRole = 'front_desk'): EditorState => ({
  uid: '',
  email: '',
  displayName: '',
  role,
  active: true,
  allowedPages: [...ROLE_DEFAULT_PAGES[role]],
  password: '',
});

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '操作失敗，請稍後再試。';
}

function PagePicker({ value, onChange }: {
  value: CloudPageId[];
  onChange: (pages: CloudPageId[]) => void;
}) {
  return (
    <fieldset className="permission-picker">
      <legend>可使用功能</legend>
      <div className="permission-actions">
        <button type="button" onClick={() => onChange([])}>清除</button>
      </div>
      <div className="permission-grid">
        {CLOUD_PAGE_IDS.map((page) => (
          <label className={value.includes(page) ? 'selected' : ''} key={page}>
            <input
              checked={value.includes(page)}
              type="checkbox"
              onChange={(event) => onChange(event.target.checked
                ? [...value, page]
                : value.filter((item) => item !== page))}
            />
            {PAGE_LABELS[page]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RoleSelect({ value, onChange, disabled = false }: {
  value: CloudRole;
  onChange: (role: CloudRole) => void;
  disabled?: boolean;
}) {
  return (
    <label>角色
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as CloudRole)}>
        {Object.entries(ROLE_LABELS).map(([role, label]) => <option value={role} key={role}>{label}</option>)}
      </select>
    </label>
  );
}

export function AccountManagement({ session, gateway }: {
  session: StaffSession;
  gateway: AccountAdminGateway | undefined;
}) {
  const [users, setUsers] = useState<StaffDirectoryEntry[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!gateway) return;
    setBusy(true);
    setError('');
    try {
      setUsers(await gateway.list(session.propertyId));
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setBusy(false);
    }
  }, [gateway, session.propertyId]);

  useEffect(() => { void load(); }, [load]);

  const chooseRole = (role: CloudRole) => setEditor((current) => current ? {
    ...current,
    role,
    allowedPages: [...ROLE_DEFAULT_PAGES[role]],
  } : current);

  const openCreate = () => {
    setCreating(true);
    setEditor(defaultEditor());
    setError('');
  };

  const openEdit = (user: StaffDirectoryEntry) => {
    setCreating(false);
    setEditor({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      allowedPages: user.allowedPages.length > 0
        ? [...user.allowedPages]
        : [...ROLE_DEFAULT_PAGES[user.role]],
      password: '',
    });
    setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!gateway || !editor) return;
    setBusy(true);
    setError('');
    try {
      if (creating) {
        await gateway.create({
          propertyId: session.propertyId,
          email: editor.email,
          displayName: editor.displayName,
          password: editor.password,
          role: editor.role,
          allowedPages: editor.allowedPages,
        });
      } else {
        await gateway.update({
          propertyId: session.propertyId,
          uid: editor.uid,
          displayName: editor.displayName,
          role: editor.role,
          active: editor.active,
          allowedPages: editor.allowedPages,
        });
        if (editor.password) {
          await gateway.setPassword({
            propertyId: session.propertyId,
            uid: editor.uid,
            password: editor.password,
          });
        }
      }
      setEditor(null);
      await load();
    } catch (saveError) {
      setError(messageFrom(saveError));
    } finally {
      setBusy(false);
    }
  };

  if (!gateway) return <div className="empty-card">帳號管理服務尚未連線。</div>;

  return (
    <section className="account-management" aria-label="裝置與帳號">
      <div className="account-heading">
        <div><h2>裝置與帳號</h2><p>僅管理員可新增、停用及調整人員權限。</p></div>
        <button className="compact-primary" onClick={openCreate}>＋ 新增人員</button>
      </div>
      <div className="security-note">所有人員均須使用已驗證的電子郵件、密碼與驗證器 MFA；系統不提供自行註冊。</div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {busy && users.length === 0 ? <div className="empty-card">讀取中…</div> : null}
      <div className="staff-list">
        {users.map((user) => (
          <article className={!user.active ? 'disabled' : ''} key={user.uid}>
            <div className="staff-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div>
            <div className="staff-main">
              <strong>{user.displayName || user.email}{user.uid === session.uid ? '（你）' : ''}</strong>
              <small>{user.email}</small>
              <div className="staff-badges">
                <span>{ROLE_LABELS[user.role]}</span>
                <span>{user.active ? '啟用' : '停用'}</span>
                <span>{user.mfaEnrolled ? 'MFA 已設定' : 'MFA 待設定'}</span>
              </div>
            </div>
            <button className="outline-button" onClick={() => openEdit(user)}>編輯</button>
          </article>
        ))}
      </div>

      {editor ? (
        <div className="modal-backdrop" onClick={() => setEditor(null)}>
          <form className="bottom-sheet account-editor" onSubmit={(event) => void save(event)} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title"><h2>{creating ? '新增人員' : '編輯人員'}</h2><button type="button" aria-label="關閉帳號設定" onClick={() => setEditor(null)}>×</button></div>
            <div className="editor-grid">
              <label>顯示名稱<input required maxLength={80} value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} /></label>
              <label>登入電子郵件<input required disabled={!creating} type="email" value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} /></label>
              <label>{creating ? '初始密碼' : '重設密碼（留空不變）'}<input required={creating} minLength={12} type="password" autoComplete="new-password" value={editor.password} onChange={(event) => setEditor({ ...editor, password: event.target.value })} /><small>至少 12 字元，且包含英文字母與數字。</small></label>
              <RoleSelect value={editor.role} disabled={editor.uid === session.uid} onChange={chooseRole} />
            </div>
            {!creating ? <label className="switch-row"><input checked={editor.active} disabled={editor.uid === session.uid} type="checkbox" onChange={(event) => setEditor({ ...editor, active: event.target.checked })} />啟用此帳號</label> : null}
            <PagePicker value={editor.allowedPages} onChange={(allowedPages) => setEditor({ ...editor, allowedPages })} />
            <div className="editor-actions"><button type="button" className="outline-button" onClick={() => setEditor(null)}>取消</button><button className="compact-primary" disabled={busy} type="submit">{busy ? '儲存中…' : '儲存'}</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
