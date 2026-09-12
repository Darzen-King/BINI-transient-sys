import { stayCheckoutInputSchema, stayCheckoutResultSchema, type StayCheckoutInput, type StayCheckoutResult } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';
export interface StayCheckoutGateway { checkout(input: StayCheckoutInput): Promise<StayCheckoutResult>; }
export function createStayCheckoutGateway(functions: Functions): StayCheckoutGateway { return { async checkout(input) { const call = httpsCallable<StayCheckoutInput, unknown>(functions, 'stayCheckout'); return stayCheckoutResultSchema.parse((await call(stayCheckoutInputSchema.parse(input))).data); } }; }
