import { z } from 'zod';

import { CLOUD_ROOM_STATUSES, type CloudRoomStatus } from './room-overview.js';

export interface BookingRoomOptionSourceDocument {
  id: string;
  data: unknown;
}

export interface BookingRoomOption {
  roomId: string;
  status: CloudRoomStatus;
}

const roomSchema = z.object({
  roomId: z.string().trim().min(1).max(128),
  status: z.enum(CLOUD_ROOM_STATUSES),
}).passthrough();

/** Validated, property-scoped room choices for the booking form. */
export function buildBookingRoomOptions(
  documents: readonly BookingRoomOptionSourceDocument[],
): BookingRoomOption[] {
  return documents.map((document) => {
    const parsed = roomSchema.safeParse(document.data);
    if (!parsed.success || parsed.data.roomId !== document.id) {
      throw new Error(`rooms/${document.id} does not match the booking room schema`);
    }
    return { roomId: parsed.data.roomId, status: parsed.data.status };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId, undefined, { numeric: true }));
}
