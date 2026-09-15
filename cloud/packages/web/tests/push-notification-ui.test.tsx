// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushNotificationPanel, PushNotificationPrompt } from '../src/notifications/PushNotificationPanel.js';
import type { PushGateway, PushState } from '../src/notifications/push.js';

// Node 22+ shadows jsdom's localStorage with an unconfigured global, so tests supply an in-memory one.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fakeGateway(initial: PushState): PushGateway & { current: PushState } {
  const gateway = {
    current: initial,
    state: () => gateway.current,
    enable: vi.fn(async () => { gateway.current = 'on'; }),
    disable: vi.fn(async () => { gateway.current = 'off'; }),
    sendTest: vi.fn(async () => ({ sentCount: 2, failedCount: 0 })),
    refresh: vi.fn(async () => undefined),
  };
  return gateway;
}

describe('phone notification settings', () => {
  it('turns notifications on, sends a test, and turns them off again', async () => {
    const gateway = fakeGateway('off');
    render(<PushNotificationPanel gateway={gateway} />);
    fireEvent.click(screen.getByRole('button', { name: '開啟此裝置的通知' }));
    expect(await screen.findByText('此裝置已開啟通知。')).toBeInTheDocument();
    expect(screen.getByText('✓ 此裝置已開啟通知')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '傳送測試通知' }));
    expect(await screen.findByText('已送出測試通知到 2 個裝置。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
    expect(await screen.findByText('此裝置已關閉通知。')).toBeInTheDocument();
    expect(gateway.disable).toHaveBeenCalledTimes(1);
  });

  it('explains the iPhone home-screen requirement and blocked permission instead of offering a dead button', () => {
    const { unmount } = render(<PushNotificationPanel gateway={fakeGateway('ios-home-screen')} />);
    expect(screen.getByText('iPhone 請先加入主畫面')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '開啟此裝置的通知' })).not.toBeInTheDocument();
    unmount();
    render(<PushNotificationPanel gateway={fakeGateway('denied')} />);
    expect(screen.getByText('通知已被封鎖')).toBeInTheDocument();
  });

  it('shows the enable error returned by the device', async () => {
    const gateway = fakeGateway('off');
    gateway.enable.mockRejectedValueOnce(new Error('尚未允許通知。'));
    render(<PushNotificationPanel gateway={gateway} />);
    fireEvent.click(screen.getByRole('button', { name: '開啟此裝置的通知' }));
    expect(await screen.findByText('尚未允許通知。')).toBeInTheDocument();
  });

  it('nudges until notifications are on, refreshes the token, and remembers "later"', () => {
    const gateway = fakeGateway('off');
    const onOpenSettings = vi.fn();
    const { unmount } = render(<PushNotificationPrompt gateway={gateway} onOpenSettings={onOpenSettings} />);
    expect(gateway.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '前往設定' }));
    expect(onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '稍後' }));
    expect(screen.queryByRole('button', { name: '前往設定' })).not.toBeInTheDocument();
    unmount();
    render(<PushNotificationPrompt gateway={gateway} onOpenSettings={onOpenSettings} />);
    expect(screen.queryByRole('button', { name: '前往設定' })).not.toBeInTheDocument();
  });

  it('stays quiet once this device is already on', () => {
    render(<PushNotificationPrompt gateway={fakeGateway('on')} onOpenSettings={vi.fn()} />);
    expect(screen.queryByText(/開啟手機通知/)).not.toBeInTheDocument();
  });
});
