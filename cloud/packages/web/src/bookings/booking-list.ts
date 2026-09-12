import {
  buildActiveBookingList,
  type BookingListItem,
} from '@bini/cloud-shared';
import {
  collection,
  onSnapshot,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

export interface BookingListGateway {
  subscribe(
    propertyId: string,
    onValue: (bookings: BookingListItem[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

function sourceDocuments(snapshot: QuerySnapshot<DocumentData>) {
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

export function createBookingListGateway(database: Firestore): BookingListGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      if (!propertyId || propertyId.includes('/')) throw new Error('invalid property id');
      return onSnapshot(
        collection(database, `properties/${propertyId}/bookings`),
        (snapshot) => {
          try {
            onValue(buildActiveBookingList(sourceDocuments(snapshot)));
          } catch (error) {
            onError(error instanceof Error ? error : new Error('booking list projection failed'));
          }
        },
        onError,
      );
    },
  };
}
