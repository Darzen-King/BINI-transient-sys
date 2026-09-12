import { buildBookingSoonList, type BookingSoonItem } from '@bini/cloud-shared';
import {
  collection,
  onSnapshot,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

export interface BookingSoonGateway {
  subscribe(
    propertyId: string,
    onValue: (bookings: BookingSoonItem[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

function sourceDocuments(snapshot: QuerySnapshot<DocumentData>) {
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

export function createBookingSoonGateway(database: Firestore): BookingSoonGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      if (!propertyId || propertyId.includes('/')) throw new Error('invalid property id');
      let documents: ReturnType<typeof sourceDocuments> = [];
      const emit = () => {
        try {
          onValue(buildBookingSoonList(documents));
        } catch (error) {
          onError(error instanceof Error ? error : new Error('booking-soon projection failed'));
        }
      };
      const unsubscribe = onSnapshot(
        collection(database, `properties/${propertyId}/bookings`),
        (snapshot) => {
          documents = sourceDocuments(snapshot);
          emit();
        },
        onError,
      );
      const interval = window.setInterval(emit, 60_000);
      return () => {
        window.clearInterval(interval);
        unsubscribe();
      };
    },
  };
}
