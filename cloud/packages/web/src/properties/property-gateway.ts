import { propertyCreateInputSchema, propertyCreateResultSchema, propertyDirectoryItemSchema, propertyUpdateInputSchema, propertyUpdateResultSchema, type PropertyCreateInput, type PropertyCreateResult, type PropertyDirectoryItem, type PropertyUpdateInput, type PropertyUpdateResult } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface PropertyGateway {
  list(sourcePropertyId: string): Promise<PropertyDirectoryItem[]>;
  create(input: PropertyCreateInput): Promise<PropertyCreateResult>;
  update(input: PropertyUpdateInput): Promise<PropertyUpdateResult>;
}
export function createPropertyGateway(functions: Functions): PropertyGateway { return {
  async list(sourcePropertyId) { const call = httpsCallable<{ sourcePropertyId: string }, { properties: unknown }>(functions, 'propertyList'); return propertyDirectoryItemSchema.array().parse((await call({ sourcePropertyId })).data.properties); },
  async create(input) { const call = httpsCallable<PropertyCreateInput, unknown>(functions, 'propertyCreate'); return propertyCreateResultSchema.parse((await call(propertyCreateInputSchema.parse(input))).data); },
  async update(input) { const call = httpsCallable<PropertyUpdateInput, unknown>(functions, 'propertyUpdate'); return propertyUpdateResultSchema.parse((await call(propertyUpdateInputSchema.parse(input))).data); },
}; }
