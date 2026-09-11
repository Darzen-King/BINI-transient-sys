import {
  buildRoomOverviewProjection,
  type RoomOverviewProjection,
  type RoomOverviewSource,
  type RoomOverviewSourceDocument,
} from '@bini/cloud-shared';
import {
  collection,
  onSnapshot,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

export interface RoomOverviewGateway {
  subscribe(
    propertyId: string,
    onValue: (projection: RoomOverviewProjection) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

type RoomOverviewCollection = keyof RoomOverviewSource;

const COLLECTIONS: ReadonlyArray<readonly [RoomOverviewCollection, string]> = [
  ['rooms', 'rooms'],
  ['bookings', 'bookings'],
  ['stays', 'stays'],
  ['payments', 'payments'],
  ['maintenanceSchedules', 'maintenanceSchedules'],
];

function sourceDocuments(snapshot: QuerySnapshot<DocumentData>): RoomOverviewSourceDocument[] {
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

export function createRoomOverviewGateway(database: Firestore): RoomOverviewGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      if (!propertyId || propertyId.includes('/')) throw new Error('invalid property id');
      const source: Partial<RoomOverviewSource> = {};
      const ready = new Set<RoomOverviewCollection>();
      let stopped = false;
      let failed = false;

      const emit = () => {
        if (stopped || failed || ready.size !== COLLECTIONS.length) return;
        try {
          onValue(buildRoomOverviewProjection(source as RoomOverviewSource, new Date()));
        } catch (error) {
          failed = true;
          onError(error instanceof Error ? error : new Error('room overview projection failed'));
        }
      };

      const unsubscribers = COLLECTIONS.map(([key, collectionName]) => onSnapshot(
        collection(database, `properties/${propertyId}/${collectionName}`),
        (snapshot) => {
          source[key] = sourceDocuments(snapshot);
          ready.add(key);
          emit();
        },
        (error) => {
          failed = true;
          onError(error);
        },
      ));
      const minuteTimer = window.setInterval(emit, 60_000);

      return () => {
        stopped = true;
        window.clearInterval(minuteTimer);
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}
