import type { CloudPageId } from '@bini/cloud-shared';

export type AppIconName = CloudPageId | 'hub' | 'initial_import' | 'more';

/** 24px outline icons drawn with `currentColor`, so they follow text colour in light and active states. */
const PATHS: Record<AppIconName, readonly string[]> = {
  hub: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  rooms: ['M3 11.5 12 4l9 7.5', 'M5.5 9.5V20h13V9.5', 'M9.5 20v-5.5h5V20'],
  gantt: ['M4 5h16', 'M4 19h16', 'M6 9h7', 'M9 12.5h9', 'M5 16h6'],
  payments: ['M3 7h18v11H3z', 'M3 10.5h18', 'M7 15h3'],
  bookings: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3.5v4', 'M16 3.5v4', 'M8 14h3', 'M8 17h6'],
  bookings_new: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3.5v4', 'M16 3.5v4', 'M12 12.5v5', 'M9.5 15h5'],
  checkin: ['M14 4h5v16h-5', 'M3 12h11', 'M10 8l4 4-4 4'],
  extend: ['M12 7v5l3 2', 'M20.5 12A8.5 8.5 0 1 1 12 3.5', 'M17 3.5h3.5V7'],
  checkout: ['M10 4H5v16h5', 'M9 12h12', 'M17 8l4 4-4 4'],
  room_management: ['M4 20V8l8-4 8 4v12', 'M9 20v-6h6v6', 'M9 10h.01', 'M15 10h.01'],
  housekeeping: ['M14 3l-6 9', 'M6 13h8l-1 8H7z', 'M17 6.5l1.5-1.5', 'M19 10h2'],
  maintenance: ['M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z'],
  reports: ['M4 20h16', 'M7 16v-5', 'M12 16V7', 'M17 16v-8'],
  audit: ['M7 3.5h8l4 4V20H7z', 'M15 3.5V8h4', 'M10 12h6', 'M10 15.5h6'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5', 'M16 4.5a3.5 3.5 0 0 1 0 6.5', 'M18 14.5c1.8.7 2.8 2.6 3 5.5'],
  properties: ['M4 20V6l6-2v16', 'M10 9l10 3v8', 'M3 20h18', 'M7 9h.01', 'M7 13h.01', 'M14 15h.01', 'M17 15h.01'],
  costs: ['M6 3.5h12V20l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.5z', 'M9 8h6', 'M9 11.5h6', 'M9 15h3'],
  holidays: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3.5v4', 'M16 3.5v4', 'M12 12.2l1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.7 2.4-.4z'],
  initial_import: ['M12 4v11', 'M8 11l4 4 4-4', 'M4 16v4h16v-4'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
};

export function AppIcon({ name, size = 24, className }: { name: AppIconName; size?: number; className?: string }) {
  const strokeWidth = name === 'more' ? 3.2 : 1.8;
  return <svg aria-hidden="true" className={className} fill="none" focusable="false" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width={size}>
    {PATHS[name].map((d) => <path d={d} key={d} />)}
  </svg>;
}
