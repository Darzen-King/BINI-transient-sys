import type { CloudPageId } from '../contracts/staff.js';

export const MOBILE_PRIMARY_TABS = ['today', 'bookings', 'housekeeping', 'payments', 'more'] as const;
export type MobilePrimaryTab = (typeof MOBILE_PRIMARY_TABS)[number];

export interface CloudPageManifestEntry {
  readonly id: CloudPageId;
  readonly desktopPath: string;
  readonly labelZhTw: string;
  readonly labelEn: string;
  readonly mobileTab: MobilePrimaryTab;
  readonly desktopOrder: number;
}

/**
 * Canonical navigation inventory for both responsive shells.
 *
 * Desktop renders these entries in the v3 top-navigation order. Mobile groups
 * the same authorized pages under five primary tabs without dropping a page.
 * The external-backup page is intentionally absent from the cloud product.
 */
export const CLOUD_PAGE_MANIFEST = [
  { id: 'rooms', desktopPath: '/rooms', labelZhTw: '房間總覽', labelEn: 'Rooms', mobileTab: 'today', desktopOrder: 10 },
  { id: 'gantt', desktopPath: '/gantt', labelZhTw: '甘特圖', labelEn: 'Gantt', mobileTab: 'more', desktopOrder: 20 },
  { id: 'payments', desktopPath: '/payments', labelZhTw: '付款管理', labelEn: 'Payments', mobileTab: 'payments', desktopOrder: 30 },
  { id: 'bookings', desktopPath: '/bookings', labelZhTw: '預約管理', labelEn: 'Bookings', mobileTab: 'bookings', desktopOrder: 40 },
  { id: 'bookings_new', desktopPath: '/bookings/new', labelZhTw: '新增預約', labelEn: 'New Booking', mobileTab: 'bookings', desktopOrder: 50 },
  { id: 'checkin', desktopPath: '/checkin', labelZhTw: '入住登記', labelEn: 'Check-in', mobileTab: 'today', desktopOrder: 60 },
  { id: 'extend', desktopPath: '/extend', labelZhTw: '延住處理', labelEn: 'Extend Stay', mobileTab: 'today', desktopOrder: 70 },
  { id: 'checkout', desktopPath: '/checkout', labelZhTw: '退房辦理', labelEn: 'Check-out', mobileTab: 'today', desktopOrder: 80 },
  { id: 'room_management', desktopPath: '/room-management', labelZhTw: '房間管理', labelEn: 'Room Management', mobileTab: 'housekeeping', desktopOrder: 90 },
  { id: 'housekeeping', desktopPath: '/housekeeping', labelZhTw: '清潔管理', labelEn: 'Housekeeping', mobileTab: 'housekeeping', desktopOrder: 100 },
  { id: 'maintenance', desktopPath: '/maintenance', labelZhTw: '維修管理', labelEn: 'Maintenance', mobileTab: 'housekeeping', desktopOrder: 110 },
  { id: 'reports', desktopPath: '/reports', labelZhTw: '統計報表', labelEn: 'Reports', mobileTab: 'more', desktopOrder: 120 },
  { id: 'audit', desktopPath: '/admin/audit', labelZhTw: '審計軌跡', labelEn: 'Audit Trail', mobileTab: 'more', desktopOrder: 130 },
  { id: 'users', desktopPath: '/admin/users', labelZhTw: '使用者', labelEn: 'Users', mobileTab: 'more', desktopOrder: 140 },
  { id: 'properties', desktopPath: '/properties', labelZhTw: '館別管理', labelEn: 'Properties', mobileTab: 'more', desktopOrder: 150 },
  { id: 'costs', desktopPath: '/costs', labelZhTw: '成本紀錄', labelEn: 'Costs', mobileTab: 'more', desktopOrder: 160 },
  { id: 'holidays', desktopPath: '/admin/holidays', labelZhTw: '假日管理', labelEn: 'Holidays', mobileTab: 'more', desktopOrder: 170 },
] as const satisfies readonly CloudPageManifestEntry[];

export function pagesAllowedForNavigation(allowedPages: readonly CloudPageId[]): readonly CloudPageManifestEntry[] {
  const allowed = new Set<CloudPageId>(allowedPages);
  return CLOUD_PAGE_MANIFEST.filter((page) => allowed.has(page.id));
}

export function pagesForMobileTab(
  allowedPages: readonly CloudPageId[],
  tab: MobilePrimaryTab,
): readonly CloudPageManifestEntry[] {
  return pagesAllowedForNavigation(allowedPages).filter((page) => page.mobileTab === tab);
}
