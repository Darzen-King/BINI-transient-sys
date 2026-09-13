// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomTimelineProjection } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { RoomTimelineGateway } from '../src/gantt/room-timeline-gateway.js';

afterEach(cleanup);
const projection: RoomTimelineProjection = { startAt: '2026-09-12T16:00:00.000Z', endAt: '2026-09-26T16:00:00.000Z', rooms: [{ roomId: '201', events: [{ id: 'RSV-1', roomId: '201', type: 'booking', label: 'Guest', startAt: '2026-09-14T07:00:00.000Z', endAt: '2026-09-15T07:00:00.000Z' }] }, { roomId: '202', events: [] }] };
describe('room gantt UI', () => { it('shows a live timeline, filters rooms, returns to now, and opens event details', async () => { const scrollTo = vi.fn(); Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo }); const gateway: RoomTimelineGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; } }; render(<App roomTimelineGateway={gateway} />); fireEvent.click(screen.getByRole('link', { name: '甘特圖' })); expect(await screen.findByText('201', { selector: 'strong' })).toBeInTheDocument(); expect(screen.getByText('202', { selector: 'strong' })).toBeInTheDocument(); fireEvent.change(screen.getByRole('combobox', { name: '房間篩選' }), { target: { value: '201' } }); expect(screen.getByText('201', { selector: 'strong' })).toBeInTheDocument(); expect(screen.queryByText('202', { selector: 'strong' })).not.toBeInTheDocument(); const goToNow = screen.getByRole('button', { name: '定位現在' }); expect(goToNow).toBeEnabled(); fireEvent.click(goToNow); expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })); fireEvent.click(screen.getByRole('button', { name: '201 預約 Guest' })); expect(screen.getByRole('dialog')).toHaveTextContent('Guest'); }); });

describe('hourly gantt scale', () => {
  it('places events on a 36px-per-hour grid with 4-hour labels and midnight dates, like v3', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
    const gateway: RoomTimelineGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; } };
    render(<App roomTimelineGateway={gateway} />);
    fireEvent.click(screen.getByRole('link', { name: '甘特圖' }));
    const event = await screen.findByRole('button', { name: '201 預約 Guest' });
    // Range starts 09-13 00:00 Taipei; the booking starts 09-14 15:00 Taipei (39h later) and lasts 24h.
    expect(event).toHaveStyle({ left: `${39 * 36}px`, width: `${24 * 36}px` });
    expect(screen.getAllByText('04:00').length).toBe(14);
    expect(screen.getAllByText('20:00').length).toBe(14);
    expect(document.querySelectorAll('.timeline-hour--day')).toHaveLength(14);
  });
});
