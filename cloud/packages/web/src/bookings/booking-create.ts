import {
  bookingCreateInputSchema,
  bookingCreateResultSchema,
  type BookingCreateInput,
  type BookingCreateResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingCreateGateway {
  create(input: BookingCreateInput): Promise<BookingCreateResult>;
}

export function createBookingCreateGateway(functions: Functions): BookingCreateGateway {
  return {
    async create(input) {
      const safeInput = bookingCreateInputSchema.parse(input);
      const call = httpsCallable<BookingCreateInput, unknown>(functions, 'bookingCreate');
      const result = await call(safeInput);
      return bookingCreateResultSchema.parse(result.data);
    },
  };
}
