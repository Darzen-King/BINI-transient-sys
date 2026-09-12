import { stayExtendInputSchema, stayExtendResultSchema, type StayExtendInput, type StayExtendResult } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface StayExtendGateway { extend(input: StayExtendInput): Promise<StayExtendResult>; }

export function createStayExtendGateway(functions: Functions): StayExtendGateway {
  return {
    async extend(input) {
      const safeInput = stayExtendInputSchema.parse(input);
      const call = httpsCallable<StayExtendInput, unknown>(functions, 'stayExtend');
      return stayExtendResultSchema.parse((await call(safeInput)).data);
    },
  };
}
