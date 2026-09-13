import {
  buildHolidayList,
  holidayDeleteInputSchema,
  holidayManualUpsertInputSchema,
  holidayOperationResultSchema,
  holidayResyncInputSchema,
  type HolidayDeleteInput,
  type HolidayListItem,
  type HolidayManualUpsertInput,
  type HolidayOperationResult,
  type HolidayResyncInput,
} from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface HolidayGateway {
  subscribe(propertyId: string, onValue: (items: HolidayListItem[]) => void, onError: (error: Error) => void): () => void;
  upsertManual(input: HolidayManualUpsertInput): Promise<HolidayOperationResult>;
  delete(input: HolidayDeleteInput): Promise<HolidayOperationResult>;
  resync(input: HolidayResyncInput): Promise<HolidayOperationResult>;
}

export function createHolidayGateway(database: Firestore, functions: Functions): HolidayGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(collection(database, `properties/${propertyId}/holidays`), (snapshot) => {
        try { onValue(buildHolidayList(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })))); }
        catch (error) { onError(error instanceof Error ? error : new Error('假日資料格式不正確。')); }
      }, onError);
    },
    async upsertManual(input) {
      const call = httpsCallable<HolidayManualUpsertInput, unknown>(functions, 'holidayManualUpsert');
      return holidayOperationResultSchema.parse((await call(holidayManualUpsertInputSchema.parse(input))).data);
    },
    async delete(input) {
      const call = httpsCallable<HolidayDeleteInput, unknown>(functions, 'holidayDelete');
      return holidayOperationResultSchema.parse((await call(holidayDeleteInputSchema.parse(input))).data);
    },
    async resync(input) {
      const call = httpsCallable<HolidayResyncInput, unknown>(functions, 'holidayResync');
      return holidayOperationResultSchema.parse((await call(holidayResyncInputSchema.parse(input))).data);
    },
  };
}
