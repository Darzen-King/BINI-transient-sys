import {
  stayCheckInInputSchema,
  stayCheckInResultSchema,
  type StayCheckInInput,
  type StayCheckInResult,
} from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface StayCheckInGateway {
  checkIn(input: StayCheckInInput): Promise<StayCheckInResult>;
}

export function createStayCheckInGateway(functions: Functions): StayCheckInGateway {
  return {
    async checkIn(input) {
      const safeInput = stayCheckInInputSchema.parse(input);
      const call = httpsCallable<StayCheckInInput, unknown>(functions, 'stayCheckIn');
      return stayCheckInResultSchema.parse((await call(safeInput)).data);
    },
  };
}
