import { v3BackupStageInputSchema, type V3BackupStageInput } from '@bini/cloud-shared';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface V3BackupStageResult {
  batchId: string;
  status: 'complete';
  rowCount: number;
  duplicate: boolean;
}

export interface DataImportGateway {
  stage(input: V3BackupStageInput): Promise<V3BackupStageResult>;
}

export function createDataImportGateway(functions: Functions): DataImportGateway {
  return {
    async stage(input) {
      const safeInput = v3BackupStageInputSchema.parse(input);
      const call = httpsCallable<V3BackupStageInput, V3BackupStageResult>(functions, 'adminStageV3Backup');
      const result = await call(safeInput);
      return result.data;
    },
  };
}

export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
