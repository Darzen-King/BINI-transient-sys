import {
  bookingUpdateInputSchema,
  bookingUpdateResultSchema,
  type BookingUpdateInput,
  type BookingUpdateResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingUpdateGateway {
  update(input: BookingUpdateInput): Promise<BookingUpdateResult>;
}

export function createBookingUpdateGateway(functions: Functions): BookingUpdateGateway {
  return {
    async update(input) {
      const safeInput = bookingUpdateInputSchema.parse(input);
      const call = httpsCallable<BookingUpdateInput, unknown>(functions, 'bookingUpdate');
      const result = await call(safeInput);
      return bookingUpdateResultSchema.parse(result.data);
    },
  };
}
