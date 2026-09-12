import { buildRoomManagementItems, monthlyRentalCheckoutInputSchema, monthlyRentalOperationResultSchema, monthlyRentalCreateInputSchema, monthlyRentalRenewInputSchema, roomManagementUpdateInputSchema, roomManagementUpdateResultSchema, type MonthlyRentalCheckoutInput, type MonthlyRentalCreateInput, type MonthlyRentalOperationResult, type MonthlyRentalRenewInput, type RoomManagementItem, type RoomManagementUpdateInput, type RoomManagementUpdateResult } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface RoomManagementGateway {
  subscribe(propertyId: string, onValue: (items: RoomManagementItem[]) => void, onError: (error: Error) => void): Unsubscribe;
  update(input: RoomManagementUpdateInput): Promise<RoomManagementUpdateResult>;
  createMonthly(input: MonthlyRentalCreateInput): Promise<MonthlyRentalOperationResult>;
  renewMonthly(input: MonthlyRentalRenewInput): Promise<MonthlyRentalOperationResult>;
  checkoutMonthly(input: MonthlyRentalCheckoutInput): Promise<MonthlyRentalOperationResult>;
}

export function createRoomManagementGateway(database: Firestore, functions: Functions): RoomManagementGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      let rooms: Array<{ id: string; data: unknown }> | null = null;
      let rentals: Array<{ id: string; data: unknown }> | null = null;
      let failed = false;
      const emit = () => { if (failed || !rooms || !rentals) return; try { onValue(buildRoomManagementItems(rooms, rentals)); } catch (error) { failed = true; onError(error instanceof Error ? error : new Error('房間管理資料格式不正確。')); } };
      const stopRooms = onSnapshot(collection(database, `properties/${propertyId}/rooms`), (snapshot) => { rooms = snapshot.docs.map((document) => ({ id: document.id, data: document.data() })); emit(); }, (error) => { failed = true; onError(error); });
      const stopRentals = onSnapshot(collection(database, `properties/${propertyId}/monthlyRentals`), (snapshot) => { rentals = snapshot.docs.map((document) => ({ id: document.id, data: document.data() })); emit(); }, (error) => { failed = true; onError(error); });
      return () => { stopRooms(); stopRentals(); };
    },
    async update(input) { const call = httpsCallable<RoomManagementUpdateInput, unknown>(functions, 'roomManagementUpdate'); return roomManagementUpdateResultSchema.parse((await call(roomManagementUpdateInputSchema.parse(input))).data); },
    async createMonthly(input) { const call = httpsCallable<MonthlyRentalCreateInput, unknown>(functions, 'monthlyRentalCreate'); return monthlyRentalOperationResultSchema.parse((await call(monthlyRentalCreateInputSchema.parse(input))).data); },
    async renewMonthly(input) { const call = httpsCallable<MonthlyRentalRenewInput, unknown>(functions, 'monthlyRentalRenew'); return monthlyRentalOperationResultSchema.parse((await call(monthlyRentalRenewInputSchema.parse(input))).data); },
    async checkoutMonthly(input) { const call = httpsCallable<MonthlyRentalCheckoutInput, unknown>(functions, 'monthlyRentalCheckout'); return monthlyRentalOperationResultSchema.parse((await call(monthlyRentalCheckoutInputSchema.parse(input))).data); },
  };
}
