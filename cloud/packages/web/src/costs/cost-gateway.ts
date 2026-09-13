import {
  buildCostListItems,
  costArchiveInputSchema,
  costOperationResultSchema,
  costCreateInputSchema,
  costUpdateInputSchema,
  type CostArchiveInput,
  type CostCreateInput,
  type CostListItem,
  type CostOperationResult,
  type CostUpdateInput,
} from "@bini/cloud-shared";
import { collection, onSnapshot, type Firestore } from "firebase/firestore";
import { httpsCallable, type Functions } from "firebase/functions";

export interface CostGateway {
  subscribe(
    propertyId: string,
    onValue: (items: CostListItem[]) => void,
    onError: (error: Error) => void,
  ): () => void;
  create(input: CostCreateInput): Promise<CostOperationResult>;
  update(input: CostUpdateInput): Promise<CostOperationResult>;
  archive(input: CostArchiveInput): Promise<CostOperationResult>;
}

export function createCostGateway(
  database: Firestore,
  functions: Functions,
): CostGateway {
  return {
    subscribe(propertyId, onValue, onError) {
      return onSnapshot(
        collection(database, `properties/${propertyId}/costEntries`),
        (snapshot) => {
          try {
            onValue(
              buildCostListItems(
                snapshot.docs.map((document) => ({
                  id: document.id,
                  data: document.data(),
                })),
              ),
            );
          } catch (error) {
            onError(
              error instanceof Error
                ? error
                : new Error("成本資料格式不正確。"),
            );
          }
        },
        onError,
      );
    },
    async create(input) {
      const call = httpsCallable<CostCreateInput, unknown>(
        functions,
        "costCreate",
      );
      return costOperationResultSchema.parse(
        (await call(costCreateInputSchema.parse(input))).data,
      );
    },
    async update(input) {
      const call = httpsCallable<CostUpdateInput, unknown>(
        functions,
        "costUpdate",
      );
      return costOperationResultSchema.parse(
        (await call(costUpdateInputSchema.parse(input))).data,
      );
    },
    async archive(input) {
      const call = httpsCallable<CostArchiveInput, unknown>(
        functions,
        "costArchive",
      );
      return costOperationResultSchema.parse(
        (await call(costArchiveInputSchema.parse(input))).data,
      );
    },
  };
}
