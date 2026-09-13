import {
  bookingPreviewInputSchema,
  bookingPreviewResultSchema,
  type BookingPreviewInput,
  type BookingPreviewResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingPreviewGateway {
  preview(input: BookingPreviewInput): Promise<BookingPreviewResult>;
}

export function createBookingPreviewGateway(functions: Functions): BookingPreviewGateway {
  return {
    async preview(input) {
      const safeInput = bookingPreviewInputSchema.parse(input);
      const call = httpsCallable<BookingPreviewInput, unknown>(functions, 'bookingPreview');
      const result = await call(safeInput);
      return bookingPreviewResultSchema.parse(result.data);
    },
  };
}
