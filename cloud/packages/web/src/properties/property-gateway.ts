import { propertyCreateInputSchema, propertyCreateResultSchema, propertyDirectoryItemSchema, type PropertyCreateInput, type PropertyCreateResult, type PropertyDirectoryItem } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface PropertyGateway { list(sourcePropertyId: string): Promise<PropertyDirectoryItem[]>; create(input: PropertyCreateInput): Promise<PropertyCreateResult>; }
export function createPropertyGateway(functions: Functions): PropertyGateway { return {
  async list(sourcePropertyId) { const call = httpsCallable<{ sourcePropertyId: string }, { properties: unknown }>(functions, 'propertyList'); return propertyDirectoryItemSchema.array().parse((await call({ sourcePropertyId })).data.properties); },
  async create(input) { const call = httpsCallable<PropertyCreateInput, unknown>(functions, 'propertyCreate'); return propertyCreateResultSchema.parse((await call(propertyCreateInputSchema.parse(input))).data); },
}; }
