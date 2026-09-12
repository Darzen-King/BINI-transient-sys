import { buildActiveStayItems, type ActiveStayItem } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';

export interface ActiveStaysGateway {
  subscribe(propertyId: string, onValue: (stays: ActiveStayItem[]) => void, onError: (error: Error) => void): () => void;
}

export function createActiveStaysGateway(database: Firestore): ActiveStaysGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(collection(database, `properties/${propertyId}/stays`), (snapshot) => {
        try {
          onValue(buildActiveStayItems(snapshot.docs.map((document) => ({ id: document.id, data: document.data() }))));
        } catch (error) {
          onError(error instanceof Error ? error : new Error('在住房資料格式不正確。'));
        }
      }, onError);
    },
  };
}
