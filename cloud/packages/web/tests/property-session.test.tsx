// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { choosePropertyId, listMemberships } from '../src/auth/property-session.js';
import type { StaffSession } from '../src/auth/session.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('property memberships', () => {
  it('keeps only valid roles and ignores malformed property keys', () => {
    expect(listMemberships({ 'property-main': 'admin', 'property-north': 'front_desk', 'bad/path': 'admin', 'property-x': 'owner', 'property-y': 3 })).toEqual([
      { propertyId: 'property-main', role: 'admin' },
      { propertyId: 'property-north', role: 'front_desk' },
    ]);
    expect(listMemberships(null)).toEqual([]);
  });

  it('prefers the remembered property, then the deployment default, then the first grant', () => {
    const memberships = listMemberships({ 'property-main': 'admin', 'property-north': 'manager' });
    expect(choosePropertyId(memberships, 'property-north', 'property-main')).toBe('property-north');
    expect(choosePropertyId(memberships, 'property-revoked', 'property-main')).toBe('property-main');
    expect(choosePropertyId(listMemberships({ 'property-north': 'manager' }), null, 'property-main')).toBe('property-north');
    expect(choosePropertyId([], 'property-main', 'property-main')).toBeNull();
  });
});

describe('property switcher', () => {
  const base: StaffSession = { uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', propertyId: 'property-main', role: 'admin', allowedPages: ['rooms'] };

  it('is hidden for a single-property account', () => {
    render(<App onSwitchProperty={vi.fn()} session={{ ...base, memberships: [{ propertyId: 'property-main', role: 'admin' }] }} />);
    expect(screen.queryByLabelText('切換館別')).not.toBeInTheDocument();
  });

  it('lists named properties and asks to switch', async () => {
    const onSwitchProperty = vi.fn();
    const propertyNameGateway = { load: vi.fn().mockResolvedValue({ 'property-main': 'BINI Blooms 總館', 'property-north': '北館' }) };
    render(<App onSwitchProperty={onSwitchProperty} propertyNameGateway={propertyNameGateway} session={{ ...base, memberships: [{ propertyId: 'property-main', role: 'admin' }, { propertyId: 'property-north', role: 'admin' }] }} />);
    const [desktop] = screen.getAllByLabelText('切換館別');
    await waitFor(() => expect(desktop).toHaveTextContent('北館'));
    expect(desktop).toHaveValue('property-main');
    fireEvent.change(desktop!, { target: { value: 'property-north' } });
    expect(onSwitchProperty).toHaveBeenCalledWith('property-north');
  });
});
