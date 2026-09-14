import { useEffect, useState, type FormEvent } from 'react';
import type { MaintenanceRoomItem, MaintenanceScheduleItem } from '@bini/cloud-shared';

import type { StaffSession } from '../auth/session.js';
import { Badge, Button, DateTimeInput, Field, Notice, ResponsiveDialog, SectionCard } from '../design-system/index.js';
import { labelFor, MAINTENANCE_STATUS_LABELS } from '../i18n/labels.js';
import { useLocale } from '../i18n/locale.js';
import type { MaintenanceGateway } from './maintenance-gateway.js';

const iso = (value: string) => `${value}:00+08:00`;
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

type RoomAction = 'update_note' | 'resolve';

export function MaintenancePage({ session, gateway }: { session: StaffSession; gateway: MaintenanceGateway | undefined }) {
  const { text } = useLocale();
  const [items, setItems] = useState<MaintenanceScheduleItem[] | null>(null);
  const [rooms, setRooms] = useState<MaintenanceRoomItem[] | null>(null);
  const [roomsError, setRoomsError] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolveRoomId, setResolveRoomId] = useState<string | null>(null);
  /** Reused on retry until the call succeeds, so a lost response cannot apply the same action twice. */
  const [pending, setPending] = useState<{ key: string; operationId: string } | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(
    () =>
      gateway?.subscribe(session.propertyId, setItems, () => {
        setItems(null);
        setError(text('無法載入維修排程。', 'Unable to load maintenance schedules.'));
      }),
    [gateway, session.propertyId, text],
  );
  useEffect(
    () =>
      gateway?.subscribeRooms(
        session.propertyId,
        (value) => {
          setRooms(value);
          setRoomsError(false);
        },
        () => {
          setRooms(null);
          setRoomsError(true);
        },
      ),
    [gateway, session.propertyId],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway) return;
    // Capture the form now: React clears `event.currentTarget` once the handler yields at `await`.
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await gateway.create({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        roomId: String(data.get('roomId')),
        title: String(data.get('title')),
        startAt: iso(String(data.get('startAt'))),
        endAt: iso(String(data.get('endAt'))),
        note: String(data.get('note')).trim() || null,
      });
      form.reset();
      setSuccess(text(`已建立 ${result.roomId} 房維修排程。`, `Created a maintenance schedule for room ${result.roomId}.`));
    } catch (failure) {
      setError(message(failure, text('無法建立維修排程。', 'Unable to create maintenance schedule.')));
    } finally {
      setBusy(false);
    }
  };

  const act = async (scheduleId: string, action: 'complete' | 'delete') => {
    if (!gateway) return;
    setBusyId(scheduleId);
    setError('');
    setSuccess('');
    try {
      await gateway.action({ propertyId: session.propertyId, operationId: crypto.randomUUID(), scheduleId, action });
    } catch (failure) {
      setError(message(failure, text('無法更新維修排程。', 'Unable to update maintenance schedule.')));
    } finally {
      setBusyId(null);
    }
  };

  const noteFor = (room: MaintenanceRoomItem) => notes[room.roomId] ?? room.maintenanceNote ?? '';

  const updateRoom = async (room: MaintenanceRoomItem, action: RoomAction) => {
    if (!gateway) return;
    const note = noteFor(room).trim();
    if (action === 'update_note' && !note) return;
    const key = `${room.roomId}:${action}:${action === 'update_note' ? note : ''}`;
    const operationId = pending?.key === key ? pending.operationId : crypto.randomUUID();
    setPending({ key, operationId });
    setBusyId(room.roomId);
    setError('');
    setSuccess('');
    try {
      const result = await gateway.roomUpdate(
        action === 'update_note'
          ? { propertyId: session.propertyId, operationId, roomId: room.roomId, action, maintenanceNote: note }
          : { propertyId: session.propertyId, operationId, roomId: room.roomId, action, maintenanceNote: null },
      );
      setPending(null);
      setResolveRoomId(null);
      setNotes((current) => {
        const next = { ...current };
        delete next[room.roomId];
        return next;
      });
      setSuccess(
        result.action === 'resolve'
          ? text(`${result.roomId} 房已解除維修，回到可入住。`, `Room ${result.roomId} is back in service.`)
          : text(`${result.roomId} 房維修備註已更新。`, `Updated the maintenance note for room ${result.roomId}.`),
      );
    } catch (failure) {
      setError(message(failure, text('無法更新維修房間。', 'Unable to update the maintenance room.')));
    } finally {
      setBusyId(null);
    }
  };

  const ready = Boolean(gateway && items);
  const roomsReady = Boolean(gateway && rooms && !roomsError);
  const resolveRoom = rooms?.find((room) => room.roomId === resolveRoomId) ?? null;

  return (
    <SectionCard hint={text('即時維修排程', 'Live maintenance schedules')} title={text('維修管理', 'Maintenance')}>
      <p className="booking-create-intro">
        {text('建立排程時會由伺服器再次檢查同房有效預約，衝突時不會寫入。', 'The server rechecks active bookings for the room before creating a schedule and refuses conflicts.')}
      </p>
      {error ? <Notice tone="danger" title={text('維修操作失敗', 'Maintenance operation failed')}>{error}</Notice> : null}
      {success ? <Notice tone="success" title={text('維修已更新', 'Maintenance updated')}>{success}</Notice> : null}

      <section className="maintenance-rooms" aria-label={text('維修中房間', 'Rooms under maintenance')}>
        <div className="maintenance-rooms__head">
          <strong>{text('維修中房間', 'Rooms under maintenance')}</strong>
          {roomsReady ? <Badge tone="danger">{text(`維修中 ${(rooms ?? []).length} 間`, `${(rooms ?? []).length} under maintenance`)}</Badge> : null}
        </div>
        {roomsError ? (
          <Notice tone="danger" title={text('無法載入維修中房間。', 'Unable to load rooms under maintenance.')}>
            {text('即時房間資料恢復前不提供維修房間操作。', 'Room actions are disabled until live room data recovers.')}
          </Notice>
        ) : !roomsReady ? null : (rooms ?? []).length === 0 ? (
          <p className="empty-card">{text('目前沒有維修中的房間', 'No rooms under maintenance')}</p>
        ) : (
          <div className="maintenance-rooms__grid">
            {(rooms ?? []).map((room) => {
              const note = noteFor(room);
              return (
                <article aria-label={text(`${room.roomId} 維修中`, `${room.roomId} under maintenance`)} className="maintenance-room" key={room.roomId}>
                  <div className="maintenance-room__title">
                    <strong>{room.roomId}</strong>
                    {room.maintenanceDueDate ? (
                      <small>
                        {text(`預計完成：${room.maintenanceDueDate}`, `Due: ${room.maintenanceDueDate}`)}
                        {room.overdue ? <Badge tone="danger">{text('已逾期', 'Overdue')}</Badge> : null}
                      </small>
                    ) : null}
                  </div>
                  {room.maintenanceNote ? <p className="maintenance-room__note">{room.maintenanceNote}</p> : null}
                  <Field label={text('維修進度備註', 'Maintenance progress note')}>
                    <textarea
                      maxLength={2000}
                      onChange={(event) => setNotes((current) => ({ ...current, [room.roomId]: event.target.value }))}
                      rows={2}
                      value={note}
                    />
                  </Field>
                  <div className="maintenance-room__actions">
                    <Button
                      disabled={busyId !== null || !note.trim()}
                      loading={busyId === room.roomId && resolveRoomId === null}
                      onClick={() => void updateRoom(room, 'update_note')}
                      variant="outline"
                    >
                      {text('更新備註', 'Update note')}
                    </Button>
                    <Button
                      disabled={busyId !== null}
                      onClick={() => {
                        setResolveRoomId(room.roomId);
                        setError('');
                        setSuccess('');
                      }}
                    >
                      {text('標記已解決', 'Mark resolved')}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <form className="booking-create-form" onSubmit={(event) => void submit(event)}>
        <div className="booking-create-grid">
          <Field label={text('房號', 'Room')}><input disabled={!ready} name="roomId" required /></Field>
          <Field label={text('維修項目', 'Title')}><input disabled={!ready} name="title" required /></Field>
          <Field label={text('開始時間', 'Start')}><DateTimeInput disabled={!ready} name="startAt" required /></Field>
          <Field label={text('結束時間', 'End')}><DateTimeInput disabled={!ready} name="endAt" required /></Field>
          <Field label={text('備註', 'Note')}><input disabled={!ready} name="note" /></Field>
        </div>
        <div className="booking-create-actions">
          <Button disabled={!ready} loading={busy} type="submit">{text('建立維修排程', 'Create schedule')}</Button>
        </div>
      </form>
      <div className="maintenance-list">
        {!ready ? (
          <Notice tone="warning" title={text('維修資料尚未就緒', 'Maintenance data is not ready')}>
            {text('讀取完成前不提供排程建立。', 'Schedule creation is disabled until live data loads.')}
          </Notice>
        ) : (items ?? []).length === 0 ? (
          <p className="empty-card">{text('目前沒有維修排程', 'No maintenance schedules')}</p>
        ) : (
          (items ?? []).map((item) => (
            <article key={item.scheduleId}>
              <strong>{item.roomId} · {item.title}</strong>
              <small>{item.startAt} → {item.endAt} · {labelFor(MAINTENANCE_STATUS_LABELS, item.status, text)}</small>
              {item.note ? <small>{item.note}</small> : null}
              {item.status !== 'done' ? (
                <Button loading={busyId === item.scheduleId} onClick={() => void act(item.scheduleId, 'complete')} variant="outline">
                  {text('標記完成', 'Mark done')}
                </Button>
              ) : null}
              <Button disabled={busyId !== null} onClick={() => void act(item.scheduleId, 'delete')} variant="danger">
                {text('刪除', 'Delete')}
              </Button>
            </article>
          ))
        )}
      </div>

      {resolveRoom ? (
        <ResponsiveDialog
          onClose={() => {
            if (busyId === null) setResolveRoomId(null);
          }}
          title={text(`解除 ${resolveRoom.roomId} 房維修`, `Return room ${resolveRoom.roomId} to service`)}
        >
          <Notice tone="warning" title={text('房間會改回「可入住」', 'The room will become available')}>
            {text('維修說明與預計完成日會一併清除，並寫入審計軌跡。', 'The maintenance note and due date are cleared and recorded in the audit trail.')}
          </Notice>
          <div className="booking-create-actions">
            <Button loading={busyId === resolveRoom.roomId} onClick={() => void updateRoom(resolveRoom, 'resolve')}>
              {text('確認解除維修', 'Confirm return to service')}
            </Button>
          </div>
        </ResponsiveDialog>
      ) : null}
    </SectionCard>
  );
}
