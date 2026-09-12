import { buildPaymentListItems, type PaymentListItem } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';

export interface PaymentListGateway { subscribe(propertyId: string, onValue: (payments: PaymentListItem[]) => void, onError: (error: Error) => void): () => void; }
export function createPaymentListGateway(database: Firestore): PaymentListGateway {
  return { subscribe(propertyId, onValue, onError) { return onSnapshot(collection(database, `properties/${propertyId}/payments`), (snapshot) => { try { onValue(buildPaymentListItems(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })))); } catch (error) { onError(error instanceof Error ? error : new Error('付款資料格式不正確。')); } }, onError); } };
}
