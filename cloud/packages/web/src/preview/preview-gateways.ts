/**
 * Local visual-QA data for `ui-preview.html` only (never imported by the production entry).
 * Documents are fictional and shaped like Firestore rows, and every gateway runs the same shared
 * builders as production so layouts are exercised with realistic, current-relative data.
 */
import {
  CLOUD_PAGE_IDS,
  buildActiveBookingList,
  buildActiveStayItems,
  buildAuditList,
  buildBookingRoomOptions,
  buildBookingSoonList,
  buildCostListItems,
  buildHolidayCalendar,
  buildHolidayList,
  buildHousekeepingItems,
  buildMaintenanceRoomItems,
  buildMaintenanceScheduleItems,
  buildPaymentListItems,
  buildReportProjection,
  buildRoomManagementItems,
  buildRoomOverviewProjection,
  buildRoomTimeline,
  type CashierSessionStatus,
} from '@bini/cloud-shared';

import type { AccountAdminGateway } from '../accounts/account-admin.js';
import type { AuditGateway } from '../audit/audit-gateway.js';
import type { PropertyNameGateway } from '../auth/property-session.js';
import type { StaffSession } from '../auth/session.js';
import type { BookingCancelGateway } from '../bookings/booking-cancel.js';
import type { BookingCreateGateway } from '../bookings/booking-create.js';
import type { BookingListGateway } from '../bookings/booking-list.js';
import type { BookingMultiCreateGateway } from '../bookings/booking-multi-create.js';
import type { BookingPreviewGateway } from '../bookings/booking-preview.js';
import type { BookingSoonGateway } from '../bookings/booking-soon.js';
import type { BookingUpdatePreviewGateway } from '../bookings/booking-update-preview.js';
import type { BookingUpdateGateway } from '../bookings/booking-update.js';
import type { CostGateway } from '../costs/cost-gateway.js';
import type { RoomTimelineGateway } from '../gantt/room-timeline-gateway.js';
import type { HolidayGateway } from '../holidays/holiday-gateway.js';
import type { HousekeepingGateway } from '../housekeeping/housekeeping-gateway.js';
import type { MaintenanceGateway } from '../maintenance/maintenance-gateway.js';
import type { PaymentCreateGateway } from '../payments/payment-create.js';
import type { PaymentListGateway } from '../payments/payment-list.js';
import type { PropertyGateway } from '../properties/property-gateway.js';
import type { ReportGateway } from '../reports/report-gateway.js';
import type { RoomManagementGateway } from '../room-management/room-management-gateway.js';
import type { BookingRoomGateway } from '../rooms/booking-room-options.js';
import type { RoomOverviewGateway } from '../rooms/room-overview.js';
import type { ActiveStaysGateway } from '../stays/active-stays.js';
import type { HolidayCalendarGateway } from '../stays/holiday-calendar.js';
import type { StayCheckInGateway } from '../stays/stay-checkin.js';
import type { StayCheckoutGateway } from '../stays/stay-checkout.js';
import type { PushGateway, PushState } from '../notifications/push.js';
import type { StayExtendGateway } from '../stays/stay-extend.js';

type Doc = { id: string; data: Record<string, unknown> };
const P = 'property-main';
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const day = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + offsetDays * 24 * HOUR));

function fixture() {
  const rooms: Doc[] = [
    { id: '201', data: { roomId: '201', propertyId: P, status: '使用中', guestName: 'Maria Eloisa Dela Cruz-Santos', checkInAt: iso(-20 * HOUR), checkOutAt: iso(4 * HOUR), note: '面海雙人房', version: 3 } },
    { id: '202', data: { roomId: '202', propertyId: P, status: '即將退房', guestName: '陳小明', checkInAt: iso(-23.8 * HOUR), checkOutAt: iso(10 * 60_000), note: null, version: 5 } },
    { id: '203', data: { roomId: '203', propertyId: P, status: '可入住', guestName: null, checkInAt: null, checkOutAt: null, note: '近電梯', version: 2 } },
    { id: '205', data: { roomId: '205', propertyId: P, status: '維修中', guestName: null, checkInAt: null, checkOutAt: null, note: null, maintenanceNote: '冷氣漏水，等待零件', maintenanceDueDate: day(-1), version: 7 } },
    { id: '206', data: { roomId: '206', propertyId: P, status: '月租套房', guestName: 'Edong', checkInAt: null, checkOutAt: null, note: '長租', version: 4 } },
    { id: '207', data: { roomId: '207', propertyId: P, status: '待清潔', guestName: null, checkInAt: null, checkOutAt: null, note: null, version: 9 } },
  ];
  const booking = (id: string, roomId: string, guestName: string, startOffset: number, hours: number, status: string, amountNts: number, rateType = '非假日') => ({ id, data: { bookingId: id, propertyId: P, roomId, guestName, phone: '0912-345-678', checkInAt: iso(startOffset), checkOutAt: iso(startOffset + hours * HOUR), plan: hours === 12 ? '12hrs' : '24hrs', amountNts, discountNts: 0, status, rateType, pricingMode: 'automatic', version: 1 } });
  const bookings: Doc[] = [
    booking('RSV-260914-A1B2', '203', 'Juvy Arriving Soon', 12 * 60_000, 24, '已預約', 1_000),
    booking('RSV-260915-C3D4', '207', '林大華', 26 * HOUR, 12, '已預約', 800),
    booking('RSV-260916-E5F6', '201', 'Christopher Longname Traveller', 50 * HOUR, 48, '已預約', 2_400, '假日'),
    booking('RSV-260912-G7H8', '203', '王美麗', -40 * HOUR, 24, '已取消', 1_000),
    booking('RSV-260911-J9K0', '207', 'No Show Guest', -60 * HOUR, 12, 'No-show', 800),
    booking('RSV-260913-L1M2', '201', 'Maria Eloisa Dela Cruz-Santos', -20 * HOUR, 24, '已入住', 1_200, '假日'),
  ];
  const stay = (id: string, roomId: string, guestName: string, inOffset: number, outOffset: number, baseRentNts: number, extensionFeeNts: number) => ({ id, data: { stayId: id, propertyId: P, roomId, guestName, phone: null, plan: '24hrs', checkInAt: iso(inOffset), checkOutAt: iso(outOffset), originalCheckOutAt: iso(outOffset - (extensionFeeNts ? 2 * HOUR : 0)), baseRentNts, extensionFeeNts, extraFeeNts: 0, totalDueNts: baseRentNts + extensionFeeNts, bookingId: null, createdAt: iso(inOffset), version: 2 } });
  const stays: Doc[] = [
    stay('STY-201', '201', 'Maria Eloisa Dela Cruz-Santos', -20 * HOUR, 4 * HOUR, 1_200, 400),
    stay('STY-202', '202', '陳小明', -23.8 * HOUR, 10 * 60_000, 1_000, 0),
  ];
  const stayLogs: Doc[] = Array.from({ length: 9 }, (_, index) => ({ id: `STL-${index}`, data: { roomId: ['201', '202', '203', '207'][index % 4], guestName: `Past Guest ${index}`, plan: index % 3 === 0 ? '12hrs' : '24hrs', checkInAt: iso(-(index + 2) * 26 * HOUR), checkOutAt: iso(-(index + 2) * 26 * HOUR + 24 * HOUR), baseRentNts: 1_000, extensionFeeNts: index % 4 === 0 ? 200 : 0, extraFeeNts: 0, totalChargedNts: 1_000 + (index % 4 === 0 ? 200 : 0), freeCancel: false, transferred: false } }));
  const payment = (id: string, roomId: string | null, guestName: string, amountNts: number, offset: number, extra: Record<string, unknown> = {}) => ({ id, data: { propertyId: P, roomId, guestName, bookingId: null, paymentType: 'cash', amountNts, deposit: false, refund: false, status: 'paid', note: null, createdAt: iso(offset), ...extra } });
  const payments: Doc[] = [
    payment('PAY-1', '201', 'Maria Eloisa Dela Cruz-Santos', 1_000, -19 * HOUR, { deposit: true, note: '入住押金' }),
    payment('PAY-2', '202', '陳小明', 1_000, -2 * HOUR, { paymentType: 'card' }),
    payment('PAY-3', '202', '陳小明', 200, -HOUR, { refund: true, status: 'refunded', note: '房客提前結束行程，退還部分款項' }),
    payment('PAY-4', '206', 'Edong', 16_000, -3 * HOUR, { paymentType: 'transfer', note: '月租租金' }),
    payment('PAY-5', null, 'Walk-in 例外收款', 500, -4 * HOUR, { paymentType: 'other', note: '補登櫃檯現金收款' }),
    payment('PAY-6', '203', '王美麗', 800, -40 * HOUR, { status: 'voided', note: '重複登錄' }),
    payment('PAY-7', '207', 'Pending Guest', 900, -30 * HOUR, { status: 'pending' }),
  ];
  const maintenanceSchedules: Doc[] = [
    { id: 'MNT-1', data: { roomId: '205', title: '更換冷氣壓縮機', startAt: iso(-6 * HOUR), endAt: iso(30 * HOUR), note: '廠商下午到場', status: 'in_progress' } },
    { id: 'MNT-2', data: { roomId: '207', title: '浴室矽利康重新施作', startAt: iso(72 * HOUR), endAt: iso(80 * HOUR), note: null, status: 'scheduled' } },
  ];
  const monthlyRentals: Doc[] = [
    { id: 'MR-1', data: { roomId: '206', tenantName: 'Edong', tenantPhone: '0987-654-321', startDate: day(-20), endDate: day(10), depositNts: 16_000, rentNts: 16_000, status: 'active', paymentType: 'transfer', note: '每月 5 日前繳租', createdAt: iso(-20 * 24 * HOUR) } },
  ];
  const costEntries: Doc[] = [
    { id: 'COST-1', data: { propertyId: P, costDate: day(-2), category: 'utilities', subcategory: '電費', amountNts: 5_320, paymentMethod: 'transfer', vendor: '台灣電力公司', description: '8 月電費', note: null, recurring: true, receiptNo: 'TP-2026-0812', status: 'active', version: 1, createdAt: iso(-48 * HOUR), updatedAt: iso(-48 * HOUR) } },
    { id: 'COST-2', data: { propertyId: P, costDate: day(-1), category: 'cleaning_supplies', subcategory: null, amountNts: 860, paymentMethod: 'cash', vendor: '全聯', description: '清潔劑、垃圾袋', note: null, recurring: false, receiptNo: null, status: 'active', version: 1, createdAt: iso(-24 * HOUR), updatedAt: iso(-24 * HOUR) } },
    { id: 'COST-3', data: { propertyId: P, costDate: day(0), category: 'maintenance', subcategory: '冷氣', amountNts: 3_500, paymentMethod: 'cash', vendor: '大同冷氣行', description: '205 房冷氣檢修', note: '含零件', recurring: false, receiptNo: null, status: 'active', version: 1, createdAt: iso(-HOUR), updatedAt: iso(-HOUR) } },
  ];
  const year = Number(day(0).slice(0, 4));
  const holidays: Doc[] = [`${year}-01-01`, `${year}-02-17`, `${year}-04-04`, `${year}-05-01`, `${year}-06-19`, `${year}-09-25`, `${year}-10-10`, `${year}-12-25`].map((date) => ({ id: date, data: { date, year, holiday: true, manual: date.endsWith('12-25'), source: date.endsWith('12-25') ? 'manual' : 'api', description: '國定假日' } }));
  const auditLogs: Doc[] = [
    { id: 'a1', data: { createdAt: iso(-HOUR), action: 'payment.refund', targetId: 'PAY-3', targetType: 'payment', actorUid: 'front-desk-01', details: { amountNts: 200, note: '房客提前結束行程' } } },
    { id: 'a2', data: { createdAt: iso(-3 * HOUR), action: 'booking.create', targetId: 'RSV-260915-C3D4', targetType: 'booking', actorUid: 'front-desk-01', details: { roomId: '207', guestName: '林大華' } } },
    { id: 'a3', data: { createdAt: '2026-05-16T09:20:29+08:00', action: 'checkin', targetId: '201', targetType: 'room', actorLegacyId: 'admin', description: 'Check-in: Carlos', originalValue: { status: '可入住' }, newValue: { status: '使用中' } } },
  ];
  const cashierSessions = new Map<string, CashierSessionStatus>([[day(-1), 'closed']]);
  return { rooms, bookings, stays, stayLogs, payments, maintenanceSchedules, monthlyRentals, costEntries, holidays, auditLogs, cashierSessions };
}

const data = fixture();
const emit = <T>(onValue: (value: T) => void, build: () => T) => { queueMicrotask(() => onValue(build())); return () => undefined; };
const previewOnly = async (): Promise<never> => { throw new Error('UI 預覽模式不會寫入資料。'); };

export const previewSession: StaffSession = {
  uid: 'preview-admin', email: 'preview@example.com', displayName: 'Preview Admin', propertyId: P, role: 'admin',
  allowedPages: [...CLOUD_PAGE_IDS],
  memberships: [{ propertyId: P, role: 'admin' }, { propertyId: 'property-north', role: 'manager' }],
};

const rooms: BookingRoomGateway = { subscribe: (_p, onValue) => emit(onValue, () => buildBookingRoomOptions(data.rooms)) };
const activeStays: ActiveStaysGateway = { subscribe: (_p, onValue) => emit(onValue, () => buildActiveStayItems(data.stays)) };
const holidayCalendar: HolidayCalendarGateway = { subscribe: (_p, onValue) => emit(onValue, () => buildHolidayCalendar(data.holidays)) };

// Local visual QA only: pretends the device can receive push and toggles state in memory.
let previewPushState: PushState = 'off';
const previewPush: PushGateway = {
  state: () => previewPushState,
  enable: async () => { previewPushState = 'on'; },
  disable: async () => { previewPushState = 'off'; },
  sendTest: async () => ({ sentCount: 1, failedCount: 0 }),
  refresh: async () => undefined,
};

export const previewGateways = {
  pushGateway: previewPush,
  accountGateway: { list: async () => [
    { uid: 'preview-admin', email: 'preview@example.com', displayName: 'Preview Admin', role: 'admin', active: true, allowedPages: [...CLOUD_PAGE_IDS], lastLoginAt: iso(-HOUR), mfaEnrolled: true },
    { uid: 'front-desk-01', email: 'frontdesk.with.a.very.long.address@example.com', displayName: '櫃檯 小芳', role: 'front_desk', active: true, allowedPages: ['rooms', 'bookings', 'bookings_new', 'checkin', 'checkout', 'payments'], lastLoginAt: null, mfaEnrolled: false },
  ], create: previewOnly, update: previewOnly, setPassword: previewOnly } satisfies AccountAdminGateway,
  bookingListGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildActiveBookingList(data.bookings)) } satisfies BookingListGateway,
  bookingCancelGateway: { cancel: previewOnly } satisfies BookingCancelGateway,
  bookingSoonGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildBookingSoonList(data.bookings)) } satisfies BookingSoonGateway,
  bookingUpdateGateway: { update: previewOnly } satisfies BookingUpdateGateway,
  bookingUpdatePreviewGateway: { preview: previewOnly } satisfies BookingUpdatePreviewGateway,
  bookingCreateGateway: { create: previewOnly } satisfies BookingCreateGateway,
  bookingMultiCreateGateway: { create: previewOnly } satisfies BookingMultiCreateGateway,
  bookingPreviewGateway: { preview: previewOnly } satisfies BookingPreviewGateway,
  bookingRoomGateway: rooms,
  roomOverviewGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildRoomOverviewProjection({ rooms: data.rooms, bookings: data.bookings, stays: data.stays, payments: data.payments, maintenanceSchedules: data.maintenanceSchedules }, new Date())) } satisfies RoomOverviewGateway,
  roomTimelineGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildRoomTimeline({ rooms: data.rooms, bookings: data.bookings, stays: data.stays, maintenanceSchedules: data.maintenanceSchedules, monthlyRentals: data.monthlyRentals })) } satisfies RoomTimelineGateway,
  stayCheckInGateway: { checkIn: previewOnly } satisfies StayCheckInGateway,
  stayExtendGateway: { extend: previewOnly } satisfies StayExtendGateway,
  stayCheckoutGateway: { checkout: previewOnly } satisfies StayCheckoutGateway,
  paymentCreateGateway: { create: previewOnly, manualCreate: previewOnly, refund: previewOnly, void: previewOnly, cashierClose: previewOnly, exportCsv: previewOnly } satisfies PaymentCreateGateway,
  paymentListGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildPaymentListItems(data.payments)) } satisfies PaymentListGateway,
  costGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildCostListItems(data.costEntries)), create: previewOnly, update: previewOnly, archive: previewOnly } satisfies CostGateway,
  reportGateway: {
    subscribe: (_p, range, onValue) => emit(onValue, () => buildReportProjection({ rooms: data.rooms, bookings: data.bookings, stays: data.stays, stayLogs: data.stayLogs, monthlyRentals: data.monthlyRentals, holidays: data.holidays, ...(range.includeCosts ? { costEntries: data.costEntries } : {}) }, range)),
    exportCsv: previewOnly,
    subscribePaymentLedger: (_p, onValue) => emit(onValue, () => ({ payments: buildPaymentListItems(data.payments), sessions: data.cashierSessions })),
    exportDailySummaryCsv: previewOnly,
  } satisfies ReportGateway,
  auditGateway: { subscribe: (_p, query, onValue) => emit(onValue, () => buildAuditList(data.auditLogs, query)) } satisfies AuditGateway,
  housekeepingGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildHousekeepingItems(data.rooms)), update: previewOnly } satisfies HousekeepingGateway,
  maintenanceGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildMaintenanceScheduleItems(data.maintenanceSchedules)), subscribeRooms: (_p, onValue) => emit(onValue, () => buildMaintenanceRoomItems(data.rooms, day(0))), create: previewOnly, action: previewOnly, roomUpdate: previewOnly } satisfies MaintenanceGateway,
  roomManagementGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildRoomManagementItems(data.rooms, data.monthlyRentals, data.stays)), update: previewOnly, createMonthly: previewOnly, renewMonthly: previewOnly, checkoutMonthly: previewOnly, voidMonthly: previewOnly, transferStay: previewOnly } satisfies RoomManagementGateway,
  activeStaysGateway: activeStays,
  holidayCalendarGateway: holidayCalendar,
  holidayGateway: { subscribe: (_p, onValue) => emit(onValue, () => buildHolidayList(data.holidays)), upsertManual: previewOnly, delete: previewOnly, resync: previewOnly } satisfies HolidayGateway,
  propertyGateway: { list: async () => [
    { propertyId: P, name: 'BINI Blooms 總館', address: '台北市中山區示範路 1 號', phone: '02-1234-5678', note: null, active: true, currency: 'TWD', timezone: 'Asia/Taipei', role: 'admin', allowedPages: [...CLOUD_PAGE_IDS] },
  ], create: previewOnly } satisfies PropertyGateway,
  propertyNameGateway: { load: async (ids) => Object.fromEntries(ids.map((id) => [id, id === P ? 'BINI Blooms 總館' : 'BINI Blooms 北館'])) } satisfies PropertyNameGateway,
};
