import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Dropbox v3 backup switch', () => {
  it('runs on DEV only until PROD is given the Dropbox secrets', async () => {
    const { dropboxBackupEnabled } = await import('../src/backup/dropbox-backup.js');
    expect(dropboxBackupEnabled('bini-transient-dev')).toBe(true);
    expect(dropboxBackupEnabled('bini-transient')).toBe(false);
    expect(dropboxBackupEnabled(undefined)).toBe(false);
  });

  it('is not registered (and declares no secrets) for a project that is not enabled', async () => {
    vi.stubEnv('GCLOUD_PROJECT', 'bini-transient');
    const { dropboxV3Backup } = await import('../src/backup/dropbox-backup.js');
    expect(dropboxV3Backup).toBeUndefined();
  });

  it('registers the hourly schedule with its secrets for an enabled project', async () => {
    // The Firebase CLI sets GCLOUD_PROJECT while analysing the source, so this is what a DEV deploy sees.
    vi.stubEnv('GCLOUD_PROJECT', 'bini-transient-dev');
    const { dropboxV3Backup } = await import('../src/backup/dropbox-backup.js');
    const endpoint = (dropboxV3Backup as unknown as { __endpoint: { scheduleTrigger: { schedule: string }; secretEnvironmentVariables: Array<{ key: string }> } }).__endpoint;
    expect(endpoint.scheduleTrigger.schedule).toBe('5 * * * *');
    expect(endpoint.secretEnvironmentVariables.map((item) => item.key).sort()).toEqual(['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN']);
  });
});
