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
import { Badge, Button, Field, Notice, ResponsiveDialog } from '../design-system/index.js';
import { ROLE_LABELS } from '../i18n/labels.js';
import { useLocale, type AppLocale } from '../i18n/locale.js';


const PAGE_LABELS: Record<CloudPageId, readonly [string, string]> = {
  rooms: ['房間總覽', 'Rooms'],
  gantt: ['甘特圖', 'Gantt'],
  payments: ['付款管理', 'Payments'],
  bookings: ['預約管理', 'Bookings'],
  bookings_new: ['新增預約', 'New Booking'],
  checkin: ['入住登記', 'Check-in'],
  extend: ['延住處理', 'Extend Stay'],
  checkout: ['退房辦理', 'Check-out'],
  room_management: ['房間管理', 'Room Management'],
  housekeeping: ['清潔管理', 'Housekeeping'],
  maintenance: ['維修管理', 'Maintenance'],
  reports: ['統計報表', 'Reports'],
  audit: ['審計軌跡', 'Audit Trail'],
  users: ['使用者', 'Users'],
  properties: ['館別管理', 'Properties'],
  costs: ['成本紀錄', 'Costs'],
  holidays: ['假日管理', 'Holidays'],
};

const localized = (labels: readonly [string, string], locale: AppLocale) => labels[locale === 'zh-TW' ? 0 : 1];

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

function messageFrom(error: unknown, text: (zhTw: string, en: string) => string): string {
  return error instanceof Error ? error.message : text('操作失敗，請稍後再試。', 'The action failed. Try again later.');
}

function formatLastLogin(value: string | null, locale: AppLocale): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(parsed);
}

function PagePicker({ value, onChange }: {
  value: CloudPageId[];
  onChange: (pages: CloudPageId[]) => void;
}) {
  const { locale, text } = useLocale();
  return (
    <fieldset className="permission-picker">
      <legend>{text('可使用功能', 'Available features')}</legend>
      <div className="permission-actions">
        <Button onClick={() => onChange([])} size="sm" variant="ghost">{text('清除', 'Clear')}</Button>
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
            {localized(PAGE_LABELS[page], locale)}
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
  const { locale, text } = useLocale();
  return (
    <Field label={text('角色', 'Role')}><select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as CloudRole)}>
      {Object.entries(ROLE_LABELS).map(([role, labels]) => <option value={role} key={role}>{localized(labels, locale)}</option>)}
    </select></Field>
  );
}

export function AccountManagement({ session, gateway }: {
  session: StaffSession;
  gateway: AccountAdminGateway | undefined;
}) {
  const { locale, text } = useLocale();
  const [users, setUsers] = useState<StaffDirectoryEntry[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mfaTarget, setMfaTarget] = useState<StaffDirectoryEntry | null>(null);
  const [mfaReason, setMfaReason] = useState('');

  const load = useCallback(async () => {
    if (!gateway) return;
    setBusy(true);
    setError('');
    try {
      setUsers(await gateway.list(session.propertyId));
    } catch (loadError) {
      setError(messageFrom(loadError, text));
    } finally {
      setBusy(false);
    }
  }, [gateway, session.propertyId, text]);

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
          email: editor.email,
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
      setError(messageFrom(saveError, text));
    } finally {
      setBusy(false);
    }
  };

  const resetMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (!gateway?.resetMfa || !mfaTarget || !mfaReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await gateway.resetMfa({ propertyId: session.propertyId, uid: mfaTarget.uid, reason: mfaReason.trim() });
      setNotice(text(`已重設 ${mfaTarget.displayName || mfaTarget.email} 的兩步驟驗證；對方需以密碼重新登入並設定新的驗證器。`, `Reset two-step verification for ${mfaTarget.displayName || mfaTarget.email}; they must sign in with their password and set up a new authenticator.`));
      setMfaTarget(null);
      setMfaReason('');
      await load();
    } catch (resetError) {
      setError(messageFrom(resetError, text));
    } finally {
      setBusy(false);
    }
  };
  // Recovery depends on another administrator: with a single usable admin, a lost phone locks everyone out of management.
  const usableAdmins = users.filter((user) => user.role === 'admin' && user.active && user.mfaEnrolled).length;
  const canResetMfa = (user: StaffDirectoryEntry) => Boolean(gateway?.resetMfa) && user.uid !== session.uid && user.mfaEnrolled;

  if (!gateway) return <div className="empty-card">{text('帳號管理服務尚未連線。', 'The account service is not connected.')}</div>;

  return (
    <section className="account-management" aria-label="使用者管理">
      <div className="account-heading">
        <div><h2>{text('使用者管理', 'User Management')}</h2><p>{text('僅管理員可新增、停用及調整人員權限。', 'Only administrators can add staff, disable accounts, or change permissions.')}</p></div>
        <Button onClick={openCreate}>＋ {text('新增使用者', 'New user')}</Button>
      </div>
      <Notice tone="info" title={text('封閉式員工系統', 'Closed staff system')}>{text('所有人員均須使用已驗證的電子郵件、密碼與驗證器 MFA；系統不提供自行註冊。', 'Every staff member must use a verified email, password, and authenticator MFA. Self-registration is unavailable.')}</Notice>
      {users.length > 0 && usableAdmins < 2 ? <Notice tone="warning" title={text('建議設定第二位系統管理員', 'Add a second administrator')}>{text('目前只有 1 位可正常登入的系統管理員。若其手機或驗證器遺失，將沒有人能重設兩步驟驗證或管理帳號；請再指定一位信任的人員為系統管理員並完成驗證器設定。', 'Only one administrator can currently sign in. If their phone or authenticator is lost, nobody can reset two-step verification or manage accounts; make another trusted person an administrator and have them set up their authenticator.')}</Notice> : null}
      {notice ? <Notice tone="success" title={text('已完成', 'Done')}>{notice}</Notice> : null}
      {error ? <Notice tone="danger" title={text('操作失敗', 'Action failed')}>{error}</Notice> : null}
      {busy && users.length === 0 ? <div className="empty-card">{text('讀取中…', 'Loading…')}</div> : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead><tr>
            <th>{text('帳號', 'Account')}</th>
            <th>{text('顯示名稱', 'Display name')}</th>
            <th>{text('角色', 'Role')}</th>
            <th>{text('可檢視分頁', 'Page access')}</th>
            <th>{text('最後登入', 'Last login')}</th>
            <th>{text('狀態', 'Status')}</th>
            <th>{text('操作', 'Actions')}</th>
          </tr></thead>
          <tbody>{users.map((user) => (
            <tr className={!user.active ? 'disabled' : ''} key={user.uid}>
              <td><strong className={user.uid === session.uid ? 'current-user' : undefined}>{user.email}</strong>{user.uid === session.uid ? <small className="you-label">{text('你', 'you')}</small> : null}</td>
              <td>{user.displayName || user.email}</td>
              <td><Badge tone="brand">{localized(ROLE_LABELS[user.role], locale)}</Badge></td>
              <td>{user.allowedPages.length > 0 ? <span className="page-access-count" title={user.allowedPages.map((page) => localized(PAGE_LABELS[page], locale)).join(', ')}>{text('自訂', 'Custom')} {user.allowedPages.length} {text('頁', 'pages')}</span> : <span className="muted-cell">{text('角色預設', 'Role default')}</span>}</td>
              <td className="muted-cell">{formatLastLogin(user.lastLoginAt, locale)}</td>
              <td><div className="table-status"><Badge tone={user.active ? 'success' : 'neutral'}>{user.active ? text('啟用', 'Active') : text('停用', 'Disabled')}</Badge><Badge tone={user.mfaEnrolled ? 'success' : 'warning'}>{user.mfaEnrolled ? 'MFA' : text('MFA 待設定', 'MFA pending')}</Badge></div></td>
              <td><div className="table-actions"><Button onClick={() => openEdit(user)} size="sm" variant="outline">✏️ {text('編輯', 'Edit')}</Button>{canResetMfa(user) ? <Button onClick={() => { setMfaTarget(user); setMfaReason(''); setNotice(''); }} size="sm" variant="ghost">{text('重設兩步驟驗證', 'Reset 2-step')}</Button> : null}</div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="staff-list">
        {users.map((user) => (
          <article className={!user.active ? 'disabled' : ''} key={user.uid}>
            <div className="staff-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div>
            <div className="staff-main">
              <strong>{user.displayName || user.email}{user.uid === session.uid ? text('（你）', ' (you)') : ''}</strong>
              <small>{user.email}</small>
              <div className="staff-badges">
                <Badge tone="brand">{localized(ROLE_LABELS[user.role], locale)}</Badge>
                <Badge tone={user.active ? 'success' : 'neutral'}>{user.active ? text('啟用', 'Active') : text('停用', 'Disabled')}</Badge>
                <Badge tone={user.mfaEnrolled ? 'success' : 'warning'}>{user.mfaEnrolled ? text('MFA 已設定', 'MFA ready') : text('MFA 待設定', 'MFA pending')}</Badge>
              </div>
            </div>
            <div className="staff-actions"><Button onClick={() => openEdit(user)} size="sm" variant="outline">{text('編輯', 'Edit')}</Button>{canResetMfa(user) ? <Button onClick={() => { setMfaTarget(user); setMfaReason(''); setNotice(''); }} size="sm" variant="ghost">{text('重設驗證', 'Reset 2-step')}</Button> : null}</div>
          </article>
        ))}
      </div>

      {mfaTarget ? (
        <ResponsiveDialog onClose={() => { if (!busy) setMfaTarget(null); }} title={text('重設兩步驟驗證', 'Reset two-step verification')}>
          <form className="account-editor" onSubmit={(event) => void resetMfa(event)}>
            <Notice tone="warning" title={text(`將清除 ${mfaTarget.displayName || mfaTarget.email} 的驗證器並登出其所有裝置`, `This clears ${mfaTarget.displayName || mfaTarget.email}'s authenticator and signs them out everywhere`)}>{text('僅在對方遺失手機或驗證器時使用。對方下次以密碼登入時，系統會要求重新設定驗證器。此操作會寫入稽核軌跡。', 'Use only when they lost their phone or authenticator. Their next password sign-in will require setting up a new authenticator. This action is recorded in the audit trail.')}</Notice>
            <Field label={text('原因', 'Reason')}><input autoFocus maxLength={500} onChange={(event) => setMfaReason(event.target.value)} placeholder={text('例如：手機遺失', 'e.g. lost phone')} required value={mfaReason} /></Field>
            <div className="editor-actions"><Button onClick={() => setMfaTarget(null)} variant="outline">{text('取消', 'Cancel')}</Button><Button disabled={!mfaReason.trim()} loading={busy} type="submit" variant="danger">{text('確認重設', 'Confirm reset')}</Button></div>
          </form>
        </ResponsiveDialog>
      ) : null}
      {editor ? (
        <ResponsiveDialog onClose={() => setEditor(null)} title={creating ? text('新增人員', 'Add staff') : text('編輯人員', 'Edit staff')}>
          <form className="account-editor" onSubmit={(event) => void save(event)}>
            <div className="editor-grid">
              <Field label={text('顯示名稱', 'Display name')}><input required maxLength={80} value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} /></Field>
              <Field hint={!creating && editor.uid === session.uid ? text('為保護目前管理員帳號，登入電子郵件不可在此變更。', 'Your own sign-in email cannot be changed here.') : undefined} label={text('登入電子郵件', 'Sign-in email')}><input required disabled={!creating && editor.uid === session.uid} type="email" value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} /></Field>
              <Field hint={text('至少 8 字元，且包含英文字母與數字。', 'At least 8 characters with letters and numbers.')} label={creating ? text('初始密碼', 'Initial password') : text('重設密碼（留空不變）', 'Reset password (leave blank to keep)')}><input required={creating} minLength={8} type="password" autoComplete="new-password" value={editor.password} onChange={(event) => setEditor({ ...editor, password: event.target.value })} /></Field>
              <RoleSelect value={editor.role} disabled={editor.uid === session.uid} onChange={chooseRole} />
            </div>
            {!creating ? <label className="switch-row"><input checked={editor.active} disabled={editor.uid === session.uid} type="checkbox" onChange={(event) => setEditor({ ...editor, active: event.target.checked })} />{text('啟用此帳號', 'Enable this account')}</label> : null}
            <PagePicker value={editor.allowedPages} onChange={(allowedPages) => setEditor({ ...editor, allowedPages })} />
            <div className="editor-actions"><Button onClick={() => setEditor(null)} variant="outline">{text('取消', 'Cancel')}</Button><Button loading={busy} type="submit">{text('儲存', 'Save')}</Button></div>
          </form>
        </ResponsiveDialog>
      ) : null}
    </section>
  );
}
