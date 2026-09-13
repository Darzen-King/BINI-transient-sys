import type { CloudRole, COST_CATEGORIES, PaymentListItem } from '@bini/cloud-shared';

type CostCategory = (typeof COST_CATEGORIES)[number];

/** Shared zh-TW / en labels for stored codes, so no page shows raw values like `paid` or `utilities`. */
export type LabelPair = readonly [string, string];

export const ROLE_LABELS: Record<CloudRole, LabelPair> = {
  admin: ['系統管理員', 'Administrator'],
  manager: ['主管', 'Manager'],
  front_desk: ['前台', 'Front Desk'],
  housekeeping: ['房務', 'Housekeeping'],
  maintenance: ['維修', 'Maintenance'],
};

export const COST_CATEGORY_LABELS: Record<CostCategory, LabelPair> = {
  utilities: ['水電瓦斯', 'Utilities'],
  cleaning_supplies: ['清潔用品', 'Cleaning supplies'],
  laundry: ['洗滌費', 'Laundry'],
  maintenance: ['維修費', 'Maintenance'],
  consumables: ['備品耗材', 'Consumables'],
  staff: ['人事費', 'Staff'],
  rent: ['租金', 'Rent'],
  internet_software: ['網路／軟體', 'Internet / software'],
  marketing: ['行銷費', 'Marketing'],
  misc: ['其他', 'Miscellaneous'],
};

/** v3 `status.*` room-state translations. */
export const ROOM_STATUS_LABELS: Record<'可入住' | '使用中' | '即將退房' | '待清潔' | '清潔中' | '維修中' | '月租套房', LabelPair> = {
  可入住: ['可入住', 'Vacant'],
  使用中: ['使用中', 'Occupied'],
  即將退房: ['即將退房', 'Departing'],
  待清潔: ['待清潔', 'Needs cleaning'],
  清潔中: ['清潔中', 'Cleaning'],
  維修中: ['維修中', 'Maintenance'],
  月租套房: ['月租套房', 'Monthly rental'],
};

/** v3 `booking_status.*` translations. */
export const BOOKING_STATUS_LABELS: Record<'已預約' | '已取消' | 'No-show' | '已入住', LabelPair> = {
  已預約: ['已預約', 'Booked'],
  已取消: ['已取消', 'Cancelled'],
  'No-show': ['No-show', 'No-show'],
  已入住: ['已入住', 'Checked in'],
};

/** v3 `payment.status.*` translations. */
export const PAYMENT_STATUS_LABELS: Record<PaymentListItem['status'], LabelPair> = {
  paid: ['已付', 'Paid'],
  pending: ['待付', 'Pending'],
  partial: ['部分付款', 'Partial'],
  refunded: ['已退款', 'Refunded'],
  voided: ['已作廢', 'Voided'],
};

/** v3 `maintenance.status_*` translations. */
export const MAINTENANCE_STATUS_LABELS: Record<'scheduled' | 'in_progress' | 'done', LabelPair> = {
  scheduled: ['待執行', 'Scheduled'],
  in_progress: ['執行中', 'In progress'],
  done: ['已完成', 'Done'],
};

/** Looks up a label for a code that may come from older data; unknown codes are shown as-is. */
export function labelFor<T extends string>(labels: Record<T, LabelPair>, code: string, text: (zhTw: string, en: string) => string): string {
  const pair = (labels as Record<string, LabelPair | undefined>)[code];
  return pair ? text(pair[0], pair[1]) : code;
}
