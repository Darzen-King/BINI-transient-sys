import { pushTestSendResultSchema, type PushPlatform, type PushTestSendResult } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

/**
 * - unsupported: this browser cannot receive web push
 * - ios-home-screen: iPhone/iPad Safari only delivers web push to an app added to the home screen
 * - denied: the user blocked notifications for this site
 * - off / on: whether this device is registered for reminders
 */
export type PushState = 'unsupported' | 'ios-home-screen' | 'denied' | 'off' | 'on';

export interface PushGateway {
  state(): PushState;
  enable(): Promise<void>;
  disable(): Promise<void>;
  sendTest(): Promise<PushTestSendResult>;
  /** Re-registers the current token on app start; FCM tokens rotate and devices change hands. */
  refresh(): Promise<void>;
}

const TOKEN_KEY = 'bini.push.token';

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (token: string | null) => { try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* optional */ } };

function isAppleMobile(): boolean {
  return /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function detectPlatform(): PushPlatform {
  if (isAppleMobile()) return 'ios';
  if (/Android/u.test(navigator.userAgent)) return 'android';
  return /Windows|Macintosh|Linux|CrOS/u.test(navigator.userAgent) ? 'desktop' : 'other';
}

export function currentPushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!capable) return isAppleMobile() && !isStandalone() ? 'ios-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && readToken() ? 'on' : 'off';
}

async function messagingToken(functions: Functions): Promise<string> {
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) throw new Error('此瀏覽器不支援推播通知。');
  // The app's own service worker (sw.js) receives pushes and shows the notification.
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(functions.app), { serviceWorkerRegistration: registration });
}

export function createPushGateway(functions: Functions): PushGateway {
  const register = async (token: string) => {
    await httpsCallable(functions, 'pushTokenRegister')({ token, platform: detectPlatform() });
    writeToken(token);
  };
  return {
    state: currentPushState,
    async enable() {
      // Must run straight from the tap: iOS only shows the permission prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(permission === 'denied' ? '通知已被封鎖，請到裝置設定允許此網站的通知。' : '尚未允許通知。');
      await register(await messagingToken(functions));
    },
    async disable() {
      const token = readToken();
      writeToken(null);
      if (!token) return;
      try {
        const { deleteToken, getMessaging } = await import('firebase/messaging');
        await deleteToken(getMessaging(functions.app));
      } catch { /* the server copy is still removed below */ }
      await httpsCallable(functions, 'pushTokenUnregister')({ token });
    },
    async sendTest() {
      return pushTestSendResultSchema.parse((await httpsCallable(functions, 'pushTestSend')({})).data);
    },
    async refresh() {
      if (currentPushState() !== 'on') return;
      await register(await messagingToken(functions));
    },
  };
}
