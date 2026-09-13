import {
  bookingMultiCreateInputSchema,
  bookingMultiCreateResultSchema,
  type BookingMultiCreateInput,
  type BookingMultiCreateResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingMultiCreateGateway {
  create(input: BookingMultiCreateInput): Promise<BookingMultiCreateResult>;
}

export function createBookingMultiCreateGateway(functions: Functions): BookingMultiCreateGateway {
  return {
    async create(input) {
      const safeInput = bookingMultiCreateInputSchema.parse(input);
      const call = httpsCallable<BookingMultiCreateInput, unknown>(functions, 'bookingMultiCreate');
      return bookingMultiCreateResultSchema.parse((await call(safeInput)).data);
    },
  };
}
