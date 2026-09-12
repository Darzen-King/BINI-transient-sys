// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomTimelineProjection } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { RoomTimelineGateway } from '../src/gantt/room-timeline-gateway.js';

afterEach(cleanup);
const projection: RoomTimelineProjection = { startAt: '2026-09-12T16:00:00.000Z', endAt: '2026-09-26T16:00:00.000Z', rooms: [{ roomId: '201', events: [{ id: 'RSV-1', roomId: '201', type: 'booking', label: 'Guest', startAt: '2026-09-14T07:00:00.000Z', endAt: '2026-09-15T07:00:00.000Z' }] }] };
describe('room gantt UI', () => { it('shows a live timeline and opens event details', async () => { const gateway: RoomTimelineGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; } }; render(<App roomTimelineGateway={gateway} />); fireEvent.click(screen.getByRole('link', { name: '甘特圖' })); expect(await screen.findByText('201')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '201 預約 Guest' })); expect(screen.getByRole('dialog')).toHaveTextContent('Guest'); }); });
