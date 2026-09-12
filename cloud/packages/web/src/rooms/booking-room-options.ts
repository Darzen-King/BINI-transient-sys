import { buildBookingRoomOptions, type BookingRoomOption } from '@bini/cloud-shared';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';

export interface BookingRoomGateway {
  subscribe(
    propertyId: string,
    onValue: (rooms: BookingRoomOption[]) => void,
    onError: (error: Error) => void,
  ): () => void;
}

export function createBookingRoomGateway(database: Firestore): BookingRoomGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(
        collection(database, `properties/${propertyId}/rooms`),
        (snapshot) => {
          try {
            onValue(buildBookingRoomOptions(snapshot.docs.map((document) => ({ id: document.id, data: document.data() }))));
          } catch (error) {
            onError(error instanceof Error ? error : new Error('房間資料格式不正確。'));
          }
        },
        (error) => onError(error),
      );
    },
  };
}
