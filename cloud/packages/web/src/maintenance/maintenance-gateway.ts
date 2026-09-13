import {
  buildMaintenanceRoomItems,
  buildMaintenanceScheduleItems,
  maintenanceRoomUpdateInputSchema,
  maintenanceRoomUpdateResultSchema,
  maintenanceScheduleActionInputSchema,
  maintenanceScheduleActionResultSchema,
  maintenanceScheduleCreateInputSchema,
  maintenanceScheduleCreateResultSchema,
  type MaintenanceRoomItem,
  type MaintenanceRoomUpdateInput,
  type MaintenanceRoomUpdateResult,
  type MaintenanceScheduleActionInput,
  type MaintenanceScheduleActionResult,
  type MaintenanceScheduleCreateInput,
  type MaintenanceScheduleCreateResult,
  type MaintenanceScheduleItem,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';

export interface MaintenanceGateway {
  subscribe(propertyId: string, onValue: (items: MaintenanceScheduleItem[]) => void, onError: (error: Error) => void): () => void;
  subscribeRooms(propertyId: string, onValue: (items: MaintenanceRoomItem[]) => void, onError: (error: Error) => void): () => void;
  create(input: MaintenanceScheduleCreateInput): Promise<MaintenanceScheduleCreateResult>;
  action(input: MaintenanceScheduleActionInput): Promise<MaintenanceScheduleActionResult>;
  roomUpdate(input: MaintenanceRoomUpdateInput): Promise<MaintenanceRoomUpdateResult>;
}

/** Asia/Taipei calendar day, matching the v3 `date.today()` comparison for overdue due dates. */
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const asError = (error: unknown, fallback: string) => (error instanceof Error ? error : new Error(fallback));

export function createMaintenanceGateway(database: Firestore, functions: Functions): MaintenanceGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(
        collection(database, `properties/${propertyId}/maintenanceSchedules`),
        (snapshot) => {
          try {
            onValue(buildMaintenanceScheduleItems(snapshot.docs.map((document) => ({ id: document.id, data: document.data() }))));
          } catch (error) {
            onError(asError(error, '維修排程資料格式不正確。'));
          }
        },
        onError,
      );
    },
    subscribeRooms(propertyId, onValue, onError) {
      return onSnapshot(
        collection(database, `properties/${propertyId}/rooms`),
        (snapshot) => {
          try {
            onValue(buildMaintenanceRoomItems(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })), taipeiToday()));
          } catch (error) {
            onError(asError(error, '房間資料格式不正確。'));
          }
        },
        onError,
      );
    },
    async create(input) {
      const call = httpsCallable<MaintenanceScheduleCreateInput, unknown>(functions, 'maintenanceScheduleCreate');
      return maintenanceScheduleCreateResultSchema.parse((await call(maintenanceScheduleCreateInputSchema.parse(input))).data);
    },
    async action(input) {
      const call = httpsCallable<MaintenanceScheduleActionInput, unknown>(functions, 'maintenanceScheduleAction');
      return maintenanceScheduleActionResultSchema.parse((await call(maintenanceScheduleActionInputSchema.parse(input))).data);
    },
    async roomUpdate(input) {
      const call = httpsCallable<MaintenanceRoomUpdateInput, unknown>(functions, 'maintenanceRoomUpdate');
      return maintenanceRoomUpdateResultSchema.parse((await call(maintenanceRoomUpdateInputSchema.parse(input))).data);
    },
  };
}
