import type { BookingHolidayCalendar } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';

export interface HolidayCalendarGateway {
  subscribe(propertyId: string, onValue: (calendar: BookingHolidayCalendar) => void, onError: (error: Error) => void): () => void;
}

export function createHolidayCalendarGateway(database: Firestore): HolidayCalendarGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(collection(database, `properties/${propertyId}/holidays`), (snapshot) => {
        try {
          const days = new Map<string, boolean>();
          const countByYear = new Map<number, number>();
          for (const document of snapshot.docs) {
            const data = document.data();
            if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || typeof data.holiday !== 'boolean' || !Number.isSafeInteger(data.year) || String(data.year) !== data.date.slice(0, 4) || days.has(data.date)) throw new Error('假日資料格式不正確。');
            days.set(data.date, data.holiday);
            countByYear.set(data.year, (countByYear.get(data.year) ?? 0) + 1);
          }
          onValue({ days, coveredYears: new Set([...countByYear].filter(([, count]) => count > 3).map(([year]) => year)) });
        } catch (error) {
          onError(error instanceof Error ? error : new Error('假日資料格式不正確。'));
        }
      }, onError);
    },
  };
}
