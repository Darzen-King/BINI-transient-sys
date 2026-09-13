import {
  bookingPreviewResultSchema,
  bookingUpdatePreviewInputSchema,
  type BookingPreviewResult,
  type BookingUpdatePreviewInput,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface BookingUpdatePreviewGateway {
  preview(input: BookingUpdatePreviewInput): Promise<BookingPreviewResult>;
}

export function createBookingUpdatePreviewGateway(functions: Functions): BookingUpdatePreviewGateway {
  return {
    async preview(input) {
      const safeInput = bookingUpdatePreviewInputSchema.parse(input);
      const call = httpsCallable<BookingUpdatePreviewInput, unknown>(functions, 'bookingUpdatePreview');
      const result = await call(safeInput);
      return bookingPreviewResultSchema.parse(result.data);
    },
  };
}
