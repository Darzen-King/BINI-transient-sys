import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_database: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));

const { createPropertyProfileGateway, invalidatePropertyProfile } = await import('../src/properties/property-profile.js');

const snapshot = (data: unknown) => ({ data: () => data });
const database = {} as never;

beforeEach(() => { getDoc.mockReset(); invalidatePropertyProfile(); });

describe('property profile for printed documents', () => {
  it('reads the store name, address and phone from the property document', async () => {
    getDoc.mockResolvedValue(snapshot({ name: 'BINI Blooms', address: ' 台北市中山區示範路 1 號 ', phone: '02-1234-5678' }));

    await expect(createPropertyProfileGateway(database).load('property-main')).resolves.toEqual({
      name: 'BINI Blooms',
      address: '台北市中山區示範路 1 號',
      phone: '02-1234-5678',
    });
    expect(getDoc).toHaveBeenCalledWith('properties/property-main');
  });

  it('falls back to the v3 import block for a migrated property', async () => {
    getDoc.mockResolvedValue(snapshot({ legacyV3Import: { name: 'BINI Blooms 總館', address: '台中市中區示範路 2 號', phone: '04-2222-3333' } }));

    await expect(createPropertyProfileGateway(database).load('P001')).resolves.toEqual({
      name: 'BINI Blooms 總館',
      address: '台中市中區示範路 2 號',
      phone: '04-2222-3333',
    });
  });

  it('treats a blank address or phone as missing rather than printing an empty line', async () => {
    getDoc.mockResolvedValue(snapshot({ name: 'BINI Blooms', address: '   ', phone: null }));

    await expect(createPropertyProfileGateway(database).load('P001')).resolves.toEqual({
      name: 'BINI Blooms',
      address: null,
      phone: null,
    });
  });

  it('reads once and serves later certificates from the cache, so printing does not wait', async () => {
    getDoc.mockResolvedValue(snapshot({ name: 'BINI Blooms', address: '台北市', phone: '02' }));
    const gateway = createPropertyProfileGateway(database);

    await gateway.load('property-main');
    await gateway.load('property-main');
    await createPropertyProfileGateway(database).load('property-main');

    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('reads again once the details are edited on this device', async () => {
    getDoc.mockResolvedValue(snapshot({ name: 'BINI Blooms', address: '台北市', phone: '02' }));
    const gateway = createPropertyProfileGateway(database);

    await gateway.load('property-main');
    invalidatePropertyProfile('property-main');
    await gateway.load('property-main');

    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('never caches a failed read, so a retry really retries', async () => {
    getDoc.mockRejectedValueOnce(new Error('denied')).mockResolvedValue(snapshot({ name: 'BINI Blooms', address: null, phone: null }));
    const gateway = createPropertyProfileGateway(database);

    await expect(gateway.load('property-main')).rejects.toThrow('denied');
    await expect(gateway.load('property-main')).resolves.toMatchObject({ name: 'BINI Blooms' });
    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('refuses a property id that could reach another collection', async () => {
    await expect(createPropertyProfileGateway(database).load('properties/x')).rejects.toThrow('invalid property id');
    expect(getDoc).not.toHaveBeenCalled();
  });
});
