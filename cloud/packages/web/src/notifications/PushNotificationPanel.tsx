import { useEffect, useState } from 'react';

import { Button, Notice } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import type { PushGateway, PushState } from './push.js';

const DISMISS_KEY = 'bini.push.promptDismissed';

function useSettledState(gateway: PushGateway): [PushState, () => void] {
  const [state, setState] = useState<PushState>(() => gateway.state());
  return [state, () => setState(gateway.state())];
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** Device notification settings: enable, test, or turn off background reminders on this phone or computer. */
export function PushNotificationPanel({ gateway }: { gateway: PushGateway }) {
  const { text } = useLocale();
  const [state, sync] = useSettledState(gateway);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const run = async (action: () => Promise<string>, fallback: string) => {
    setBusy(true);
    setMessage(null);
    try { setMessage({ tone: 'success', text: await action() }); } catch (error) { setMessage({ tone: 'danger', text: errorText(error, fallback) }); } finally { setBusy(false); sync(); }
  };
  return <div className="push-panel">
    <strong>{text('手機通知', 'Phone notifications')}</strong>
    <p>{text('開啟後，即使 App 關閉或在背景，即將入住與即將退房（15 分鐘內）也會收到系統通知。每支手機或電腦需各自開啟一次。', 'When on, arrivals and check-outs due within 15 minutes notify this device even when the app is closed. Turn it on once on each phone or computer.')}</p>
    {state === 'unsupported' ? <Notice tone="warning" title={text('此瀏覽器不支援推播通知', 'This browser does not support push notifications')}>{text('請改用 iPhone（iOS 16.4 以上，加入主畫面）、Android Chrome 或電腦版 Chrome／Edge。', 'Use an iPhone (iOS 16.4+, added to the home screen), Android Chrome, or desktop Chrome/Edge.')}</Notice> : null}
    {state === 'ios-home-screen' ? <Notice tone="info" title={text('iPhone 請先加入主畫面', 'On iPhone, add the app to your home screen first')}>{text('用 Safari 開啟本網站 → 點下方「分享」→「加入主畫面」，再從主畫面的 BINI PMS 圖示開啟並登入，回到這裡開啟通知。', 'Open this site in Safari → Share → Add to Home Screen, then open BINI PMS from the home screen, sign in, and come back here.')}</Notice> : null}
    {state === 'denied' ? <Notice tone="warning" title={text('通知已被封鎖', 'Notifications are blocked')}>{text('請到裝置的「設定 → 通知」（iPhone）或瀏覽器網站設定，允許 BINI PMS 的通知後重新開啟 App。', 'Allow notifications for BINI PMS in device Settings → Notifications (iPhone) or the browser site settings, then reopen the app.')}</Notice> : null}
    {state === 'off' ? <Button disabled={busy} loading={busy} onClick={() => void run(async () => { await gateway.enable(); return text('此裝置已開啟通知。', 'Notifications are on for this device.'); }, text('無法開啟通知，請稍後再試。', 'Could not turn on notifications. Try again shortly.'))}>{text('開啟此裝置的通知', 'Turn on notifications for this device')}</Button> : null}
    {state === 'on' ? <>
      <p className="push-panel__on">{text('✓ 此裝置已開啟通知', '✓ Notifications are on for this device')}</p>
      <div className="push-panel__actions">
        <Button disabled={busy} onClick={() => void run(async () => { const result = await gateway.sendTest(); return text(`已送出測試通知到 ${result.sentCount} 個裝置。`, `Test sent to ${result.sentCount} device(s).`); }, text('測試通知傳送失敗。', 'The test notification failed.'))} variant="outline">{text('傳送測試通知', 'Send a test notification')}</Button>
        <Button disabled={busy} onClick={() => void run(async () => { await gateway.disable(); return text('此裝置已關閉通知。', 'Notifications are off for this device.'); }, text('無法關閉通知，請稍後再試。', 'Could not turn off notifications.'))} variant="ghost">{text('關閉通知', 'Turn off')}</Button>
      </div>
    </> : null}
    {message ? <Notice role={message.tone === 'danger' ? 'alert' : 'status'} tone={message.tone} title={message.text} /> : null}
  </div>;
}

/** A one-time nudge on the main screen until the device turns notifications on (or the staff member dismisses it). */
export function PushNotificationPrompt({ gateway, onOpenSettings }: { gateway: PushGateway; onOpenSettings: () => void }) {
  const { text } = useLocale();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  const state = gateway.state();
  useEffect(() => { void gateway.refresh().catch(() => undefined); }, [gateway]);
  if (dismissed || (state !== 'off' && state !== 'ios-home-screen')) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* optional */ } setDismissed(true); };
  return <Notice className="push-prompt" tone="info" title={text('開啟手機通知，App 關閉時也能收到入住／退房提醒', 'Turn on phone notifications to get arrival and check-out reminders even when the app is closed')}>
    <div className="push-panel__actions"><Button onClick={onOpenSettings} size="sm">{text('前往設定', 'Set up')}</Button><Button onClick={dismiss} size="sm" variant="ghost">{text('稍後', 'Later')}</Button></div>
  </Notice>;
}
