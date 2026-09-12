import {
  bookingCancelInputSchema,
  bookingCancelResultSchema,
  type BookingCancelInput,
  type BookingCancelResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingCancelGateway {
  cancel(input: BookingCancelInput): Promise<BookingCancelResult>;
}

export function createBookingCancelGateway(functions: Functions): BookingCancelGateway {
  return {
    async cancel(input) {
      const safeInput = bookingCancelInputSchema.parse(input);
      const call = httpsCallable<BookingCancelInput, unknown>(functions, 'bookingCancel');
      const result = await call(safeInput);
      return bookingCancelResultSchema.parse(result.data);
    },
  };
}
