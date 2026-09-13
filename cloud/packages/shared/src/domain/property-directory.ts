import { propertyDirectoryItemSchema, type PropertyDirectoryItem } from '../contracts/property-operations.js';

export function sortPropertyDirectory(items: readonly PropertyDirectoryItem[]): PropertyDirectoryItem[] {
  return items.map((item) => propertyDirectoryItemSchema.parse(item)).sort((left, right) => left.propertyId.localeCompare(right.propertyId));
}
