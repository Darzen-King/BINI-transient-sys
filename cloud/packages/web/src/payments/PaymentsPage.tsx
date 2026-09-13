import {
  summarizePayments,
  type ActiveStayItem,
  type BookingListItem,
  type BookingRoomOption,
  type PaymentListItem,
} from "@bini/cloud-shared";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { StaffSession } from "../auth/session.js";
import {
  Badge,
  Button,
  Field,
  Notice,
  ResponsiveDialog,
  SectionCard,
} from "../design-system/index.js";
import type { BookingListGateway } from "../bookings/booking-list.js";
import { useLocale } from "../i18n/locale.js";
import type { BookingRoomGateway } from "../rooms/booking-room-options.js";
import type { ActiveStaysGateway } from "../stays/active-stays.js";
import type { PaymentCreateGateway } from "./payment-create.js";
import type { PaymentListGateway } from "./payment-list.js";

function taipeiDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
const displayDate = (value: string, locale: "zh-TW" | "en") =>
  new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-CA", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
const monthStart = (day: string) => `${day.slice(0, 8)}01`;
function download(filename: string, csv: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** One add-payment form, like v3: pick an active stay or an unarrived booking to fill room and guest, or record an audited exception. */
type PaymentTarget =
  | { kind: "stay"; stay: ActiveStayItem }
  | { kind: "booking"; booking: BookingListItem }
  | { kind: "other" };
const OTHER_TARGET = "other";

export function PaymentsPage({
  session,
  bookingGateway,
  createGateway,
  initialRoomId,
  listGateway,
  onInitialRoomHandled,
  roomGateway,
  staysGateway,
}: {
  session: StaffSession;
  bookingGateway?: BookingListGateway | undefined;
  createGateway: PaymentCreateGateway | undefined;
  initialRoomId?: string | null;
  listGateway: PaymentListGateway | undefined;
  onInitialRoomHandled?: () => void;
  roomGateway?: BookingRoomGateway | undefined;
  staysGateway: ActiveStaysGateway | undefined;
}) {
  const { locale, text } = useLocale();
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [stays, setStays] = useState<ActiveStayItem[] | null>(null);
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null);
  const [rooms, setRooms] = useState<BookingRoomOption[] | null>(null);
  // Each live source reports its own failure so one healthy listener can never hide another's error.
  const [paymentsError, setPaymentsError] = useState("");
  const [staysError, setStaysError] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [otherRoomId, setOtherRoomId] = useState("");
  const [otherGuestName, setOtherGuestName] = useState("");
  const [amountNts, setAmountNts] = useState(0);
  const [paymentType, setPaymentType] = useState<
    "cash" | "transfer" | "card" | "other"
  >("cash");
  const [note, setNote] = useState("");
  const [deposit, setDeposit] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [refundPayment, setRefundPayment] = useState<PaymentListItem | null>(
    null,
  );
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundNote, setRefundNote] = useState("");
  const [voidPayment, setVoidPayment] = useState<PaymentListItem | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [cashierOpen, setCashierOpen] = useState(false);
  const [cashierNote, setCashierNote] = useState("");
  const [exportRange, setExportRange] = useState(() => {
    const today = taipeiDay();
    return { dateFrom: monthStart(today), dateTo: today };
  });
  const [exporting, setExporting] = useState(false);
  useEffect(
    () =>
      listGateway?.subscribe(
        session.propertyId,
        (value) => {
          setPayments(value);
          setPaymentsError("");
        },
        (failure) => {
          setPayments(null);
          setPaymentsError(failure.message);
        },
      ),
    [listGateway, session.propertyId],
  );
  useEffect(
    () =>
      staysGateway?.subscribe(
        session.propertyId,
        (value) => {
          setStays(value);
          setStaysError("");
        },
        (failure) => {
          setStays(null);
          setStaysError(failure.message);
        },
      ),
    [session.propertyId, staysGateway],
  );
  const canManual = Boolean(createGateway?.manualCreate);
  // Bookings and rooms only enrich the picker; stay payments keep working without them.
  useEffect(
    () =>
      canManual
        ? bookingGateway?.subscribe(session.propertyId, setBookings, () => setBookings(null))
        : undefined,
    [bookingGateway, canManual, session.propertyId],
  );
  useEffect(
    () =>
      canManual
        ? roomGateway?.subscribe(session.propertyId, setRooms, () => setRooms(null))
        : undefined,
    [canManual, roomGateway, session.propertyId],
  );
  useEffect(() => {
    if (!initialRoomId || stays === null) return;
    const matchingStay = stays.find((stay) => stay.roomId === initialRoomId);
    if (matchingStay) setTargetKey(`stay:${matchingStay.stayId}`);
    onInitialRoomHandled?.();
  }, [initialRoomId, onInitialRoomHandled, stays]);
  const target = useMemo<PaymentTarget | null>(() => {
    if (targetKey === OTHER_TARGET) return canManual ? { kind: "other" } : null;
    const separator = targetKey.indexOf(":");
    const kind = targetKey.slice(0, separator);
    const id = targetKey.slice(separator + 1);
    if (kind === "stay") {
      const stay = stays?.find((item) => item.stayId === id);
      return stay ? { kind: "stay", stay } : null;
    }
    if (kind === "booking" && canManual) {
      const booking = bookings?.find((item) => item.bookingId === id);
      return booking ? { kind: "booking", booking } : null;
    }
    return null;
  }, [bookings, canManual, stays, targetKey]);
  const ready = Boolean(createGateway && staysGateway && stays && !staysError);
  const roomChoices = useMemo(() => {
    const ids = rooms
      ? rooms.map((room) => room.roomId)
      : [...(stays ?? []).map((stay) => stay.roomId), ...(bookings ?? []).map((booking) => booking.roomId)];
    return [...new Set(ids)].sort((left, right) => left.localeCompare(right, "zh-Hant", { numeric: true }));
  }, [bookings, rooms, stays]);
  // Names already known for the chosen room (or every room), so staff pick a guest instead of retyping it.
  const guestChoices = useMemo(() => {
    const matchesRoom = (roomId: string | null) => !otherRoomId || roomId === otherRoomId;
    const names = [
      ...(stays ?? []).filter((stay) => matchesRoom(stay.roomId)).map((stay) => stay.guestName),
      ...(bookings ?? []).filter((booking) => matchesRoom(booking.roomId)).map((booking) => booking.guestName),
      ...(payments ?? []).filter((payment) => matchesRoom(payment.roomId)).map((payment) => payment.guestName),
    ];
    return [...new Set(names.filter((name): name is string => Boolean(name?.trim())))].slice(0, 50);
  }, [bookings, otherRoomId, payments, stays]);
  const noteRequired = target?.kind === "other";
  const canSubmit = Boolean(
    ready &&
      target &&
      amountNts >= 1 &&
      (target.kind !== "other" || (otherGuestName.trim() && note.trim())),
  );
  const day = taipeiDay();
  const summary = useMemo(
    () => summarizePayments(payments ?? [], day),
    [day, payments],
  );
  const exportCsv = async () => {
    if (!createGateway?.exportCsv) return;
    setExporting(true);
    setError("");
    try {
      const result = await createGateway.exportCsv({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        ...exportRange,
      });
      download(result.filename, result.csv);
      setSuccess(text(`已匯出 ${exportRange.dateFrom} 至 ${exportRange.dateTo} 的付款帳本。`, `Exported the payment ledger for ${exportRange.dateFrom} through ${exportRange.dateTo}.`));
    } catch (failure) {
      setError(errorMessage(failure, text("無法匯出付款 CSV。", "Payment CSV export could not be completed.")));
    } finally {
      setExporting(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createGateway || !target || !canSubmit) return;
    const id = operationId ?? crypto.randomUUID();
    if (!operationId) setOperationId(id);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      let roomId: string | null;
      let recordedNts: number;
      if (target.kind === "stay") {
        const result = await createGateway.create({
          propertyId: session.propertyId,
          operationId: id,
          stayId: target.stay.stayId,
          amountNts,
          paymentType,
          note: note.trim() || null,
          ...(deposit ? { deposit: true } : {}),
        });
        roomId = result.roomId;
        recordedNts = result.amountNts;
      } else {
        if (!createGateway.manualCreate) return;
        const booking = target.kind === "booking" ? target.booking : null;
        const result = await createGateway.manualCreate({
          propertyId: session.propertyId,
          operationId: id,
          bookingId: booking?.bookingId ?? null,
          roomId: booking ? booking.roomId : otherRoomId || null,
          guestName: booking ? booking.guestName : otherGuestName.trim(),
          amountNts,
          paymentType,
          deposit,
          note:
            note.trim() ||
            text(`預約 ${booking?.bookingId ?? ""} 收款`, `Payment for booking ${booking?.bookingId ?? ""}`),
        });
        roomId = result.roomId;
        recordedNts = result.amountNts;
      }
      const amount = recordedNts.toLocaleString();
      setSuccess(
        roomId
          ? deposit
            ? text(`已記錄 ${roomId} 房 NT$ ${amount} 訂金。`, `Recorded an NT$ ${amount} deposit for room ${roomId}.`)
            : text(`已記錄 ${roomId} 房 NT$ ${amount} 收款。`, `Recorded NT$ ${amount} for room ${roomId}.`)
          : deposit
            ? text(`已記錄 NT$ ${amount} 訂金。`, `Recorded an NT$ ${amount} deposit.`)
            : text(`已記錄 NT$ ${amount} 收款。`, `Recorded NT$ ${amount}.`),
      );
      setOperationId(null);
      setAmountNts(0);
      setNote("");
      setDeposit(false);
      setOtherRoomId("");
      setOtherGuestName("");
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "收款未完成，請重新確認收款對象與金額。",
            "Payment did not complete. Confirm the payment target and amount.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const refund = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !createGateway?.refund ||
      !refundPayment ||
      refundAmount < 1 ||
      !refundNote.trim()
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createGateway.refund({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        paymentId: refundPayment.paymentId,
        amountNts: refundAmount,
        paymentType,
        note: refundNote.trim(),
      });
      setRefundPayment(null);
      setRefundAmount(0);
      setRefundNote("");
      setSuccess(
        text(
          `已建立 NT$ ${result.amountNts.toLocaleString()} 退款；原付款紀錄已保留。`,
          `Created an NT$ ${result.amountNts.toLocaleString()} refund; the original payment was retained.`,
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "退款未完成，請確認退款金額後重試。",
            "Refund was not completed. Confirm the amount and try again.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const voidPaymentRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createGateway?.void || !voidPayment || !voidReason.trim()) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createGateway.void({ propertyId: session.propertyId, operationId: crypto.randomUUID(), paymentId: voidPayment.paymentId, reason: voidReason.trim() });
      setVoidPayment(null);
      setVoidReason("");
      setSuccess(text(`已作廢付款 ${result.paymentId}；原始帳務紀錄與作廢原因已保留。`, `Voided ${result.paymentId}; the original ledger entry and reason were retained.`));
    } catch (failure) {
      setError(errorMessage(failure, text("付款作廢未完成，請確認尚未退款且該營業日未日結。", "Payment void did not complete. Confirm it has no refund and its cashier day is still open.")));
    } finally {
      setBusy(false);
    }
  };
  const closeCashier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createGateway?.cashierClose) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createGateway.cashierClose({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        note: cashierNote.trim() || null,
      });
      setCashierOpen(false);
      setCashierNote("");
      setSuccess(
        text(
          `已完成 ${result.sessionDate} 日結：淨額 NT$ ${result.netNts.toLocaleString()}。`,
          `Closed ${result.sessionDate}: net NT$ ${result.netNts.toLocaleString()}.`,
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "日結未完成，請重新確認今日狀態。",
            "Cashier close was not completed. Confirm today's status.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const canCloseCashier =
    (session.role === "admin" || session.role === "manager") &&
    Boolean(createGateway?.cashierClose);
  const canVoidPayments = session.role === "admin" && Boolean(createGateway?.void);
  return (
    <SectionCard
      actions={<Button disabled={!createGateway?.exportCsv} loading={exporting} onClick={() => void exportCsv()} size="sm" variant="outline">{text("匯出 CSV", "Export CSV")}</Button>}
      hint={text("即時帳務資料", "Live payment data")}
      title={text("付款管理", "Payments")}
    >
      <p className="booking-create-intro">
        {text(
          "收款由伺服器驗證在住房與操作權限後建立，完成後立即更新所有已登入裝置。",
          "The server verifies the active stay and permission before recording a payment; all signed-in devices update immediately.",
        )}
      </p>
      {staysError || paymentsError ? (
        <Notice
          tone="danger"
          title={text("付款資料載入失敗", "Payment data failed to load")}
        >
          {[
            staysError ? text(`在住房：${staysError}`, `Active stays: ${staysError}`) : "",
            paymentsError ? text(`付款紀錄：${paymentsError}`, `Payment history: ${paymentsError}`) : "",
          ].filter(Boolean).join(text("；", "; "))}
        </Notice>
      ) : !ready || payments === null ? (
        <Notice
          tone="warning"
          title={text("付款資料載入中", "Loading payment data")}
        >
          {text(
            "在住房與付款紀錄載入完成後即可收款。",
            "Payments can be recorded once stays and history finish loading.",
          )}
        </Notice>
      ) : null}
      <div className="payment-summary-grid">
        <div>
          <small>{text("今日實收", "Collected today")}</small>
          <strong>NT$ {summary.receivedNts.toLocaleString()}</strong>
        </div>
        <div>
          <small>{text("今日退款", "Refunds today")}</small>
          <strong>NT$ {summary.refundsNts.toLocaleString()}</strong>
        </div>
        <div>
          <small>{text("今日淨額", "Net today")}</small>
          <strong>NT$ {summary.netNts.toLocaleString()}</strong>
        </div>
        <div>
          <small>{text("待收款", "Outstanding")}</small>
          <strong>NT$ {summary.outstandingNts.toLocaleString()}</strong>
        </div>
      </div>
      <div className="payment-type-summary">
        {(["cash", "transfer", "card", "other"] as const).map((type) => (
          <span key={type}>
            {text(
              { cash: "現金", transfer: "轉帳", card: "刷卡", other: "其他" }[
                type
              ],
              {
                cash: "Cash",
                transfer: "Transfer",
                card: "Card",
                other: "Other",
              }[type],
            )}
            <b>NT$ {summary.byType[type].toLocaleString()}</b>
          </span>
        ))}
      </div>
      {canCloseCashier ? (
        <div className="booking-create-actions">
          <Button
            onClick={() => {
              setCashierOpen(true);
              setError("");
              setSuccess("");
            }}
            type="button"
            variant="danger"
          >
            {text("執行今日日結", "Close today's cashier")}
          </Button>
        </div>
      ) : null}
      <form
        className="booking-create-form"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset className="booking-deposit">
          <legend>{text("新增收款", "New payment")}</legend>
          <div className="booking-create-grid">
            <Field label={text("收款對象", "Payment target")}>
              <select
                disabled={!ready}
                onChange={(event) => {
                  setTargetKey(event.target.value);
                  setOperationId(null);
                  setOtherRoomId("");
                  setOtherGuestName("");
                  setError("");
                  setSuccess("");
                }}
                required
                value={targetKey}
              >
                <option value="">
                  {text("選擇房間與旅客", "Select room and guest")}
                </option>
                {(stays ?? []).length > 0 ? (
                  <optgroup label={text("在住房", "Active stays")}>
                    {(stays ?? []).map((stay) => (
                      <option key={stay.stayId} value={`stay:${stay.stayId}`}>
                        {stay.roomId} · {stay.guestName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {canManual && (bookings ?? []).length > 0 ? (
                  <optgroup label={text("已預約（未入住）", "Booked (not checked in)")}>
                    {(bookings ?? []).map((booking) => (
                      <option key={booking.bookingId} value={`booking:${booking.bookingId}`}>
                        {booking.roomId} · {booking.guestName} · {displayDate(booking.checkInAt, locale)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {canManual ? (
                  <option value={OTHER_TARGET}>
                    {text("其他例外收款（無在住或預約）", "Other exception (no stay or booking)")}
                  </option>
                ) : null}
              </select>
            </Field>
            <Field label={text("收款金額（NT$）", "Amount (NT$)")}>
              <input
                disabled={!ready || !target}
                min="1"
                onChange={(event) =>
                  setAmountNts(Number(event.target.value) || 0)
                }
                required
                type="number"
                value={amountNts || ""}
              />
            </Field>
            {target?.kind === "other" ? (
              <>
                <Field label={text("房號（選填）", "Room (optional)")}>
                  <select
                    onChange={(event) => setOtherRoomId(event.target.value)}
                    value={otherRoomId}
                  >
                    <option value="">{text("不指定房間", "No room")}</option>
                    {roomChoices.map((roomId) => (
                      <option key={roomId} value={roomId}>
                        {roomId}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={text("旅客／對象", "Guest / recipient")}>
                  <input
                    list="payment-guest-choices"
                    maxLength={300}
                    onChange={(event) => setOtherGuestName(event.target.value)}
                    placeholder={text("可從清單選取", "Pick from the list or type")}
                    required
                    value={otherGuestName}
                  />
                </Field>
                <datalist id="payment-guest-choices">
                  {guestChoices.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            ) : null}
            <Field label={text("付款方式", "Payment method")}>
              <select
                disabled={!ready || !target}
                onChange={(event) =>
                  setPaymentType(event.target.value as typeof paymentType)
                }
                value={paymentType}
              >
                <option value="cash">{text("現金", "Cash")}</option>
                <option value="transfer">{text("轉帳", "Transfer")}</option>
                <option value="card">{text("刷卡", "Card")}</option>
                <option value="other">{text("其他", "Other")}</option>
              </select>
            </Field>
            <Field
              label={
                noteRequired
                  ? text("原因／備註", "Reason / note")
                  : text("備註（選填）", "Note (optional)")
              }
            >
              <input
                disabled={!ready || !target}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                required={noteRequired}
                value={note}
              />
            </Field>
            <Field label={text("帳務類型", "Record type")}>
              <label>
                <input
                  checked={deposit}
                  disabled={!ready || !target}
                  onChange={(event) => setDeposit(event.target.checked)}
                  type="checkbox"
                />{" "}
                {text("記為訂金", "Record as deposit")}
              </label>
            </Field>
          </div>
          {target?.kind === "stay" ? (
            <div className="stay-extension-preview">
              <strong>{text("本次收款對象", "Payment target")}</strong>
              <div>
                <span>{text("房間／旅客", "Room / guest")}</span>
                <b>
                  {target.stay.roomId} · {target.stay.guestName}
                </b>
              </div>
              <div>
                <span>{text("目前應收", "Current due")}</span>
                <b>NT$ {target.stay.totalDueNts.toLocaleString()}</b>
              </div>
            </div>
          ) : null}
          {target?.kind === "booking" ? (
            <div className="stay-extension-preview">
              <strong>{text("本次收款對象", "Payment target")}</strong>
              <div>
                <span>{text("房間／旅客", "Room / guest")}</span>
                <b>
                  {target.booking.roomId} · {target.booking.guestName}
                </b>
              </div>
              <div>
                <span>{text("預約入住", "Booked check-in")}</span>
                <b>{displayDate(target.booking.checkInAt, locale)}</b>
              </div>
              <div>
                <span>{text("預約金額", "Booking amount")}</span>
                <b>NT$ {target.booking.amountNts.toLocaleString()}</b>
              </div>
            </div>
          ) : null}
          {target?.kind === "other" ? (
            <Notice
              tone="warning"
              title={text("僅在沒有在住房或預約可選時使用。", "Use only when no stay or booking applies.")}
            >
              {text(
                "會新增一筆可稽核的付款紀錄，不修改既有帳務；原因必填，房號由伺服器確認存在。",
                "Creates an auditable payment without editing existing records. A reason is required and the server verifies the room.",
              )}
            </Notice>
          ) : null}
          <div className="booking-create-actions">
            <Button
              disabled={!canSubmit}
              loading={busy}
              size="lg"
              type="submit"
            >
              {deposit
                ? text("確認收取訂金", "Record deposit")
                : text("確認收款", "Record payment")}
            </Button>
          </div>
        </fieldset>
      </form>
      {success ? (
        <Notice tone="success" title={text("帳務完成", "Payment updated")}>
          {success}
        </Notice>
      ) : null}
      {error ? (
        <Notice
          tone="danger"
          title={text("無法收款", "Payment could not be recorded")}
        >
          {error}
        </Notice>
      ) : null}
      <div className="report-filters">
        <Field label={text("匯出開始日期", "Export from")}><input max={exportRange.dateTo} onChange={(event) => setExportRange((current) => ({ ...current, dateFrom: event.target.value }))} type="date" value={exportRange.dateFrom} /></Field>
        <Field label={text("匯出結束日期", "Export to")}><input min={exportRange.dateFrom} onChange={(event) => setExportRange((current) => ({ ...current, dateTo: event.target.value }))} type="date" value={exportRange.dateTo} /></Field>
      </div>
      <section className="payment-history">
        <div className="payment-history-heading">
          <strong>{text("付款紀錄", "Payment history")}</strong>
          <small>{text("依建立時間排序", "Newest first")}</small>
        </div>
        {(payments ?? []).length === 0 ? (
          <p className="empty-card">
            {text("尚無付款紀錄", "No payment records")}
          </p>
        ) : (
          <div className="payment-history-list">
            {(payments ?? []).slice(0, 100).map((payment) => (
              <article key={payment.paymentId}>
                <div>
                  <strong>
                    {payment.guestName ??
                      text("未指定旅客", "Unassigned guest")}
                  </strong>
                  <small>
                    {payment.roomId ?? "—"} ·{" "}
                    {displayDate(payment.createdAt, locale)}
                  </small>
                  {payment.note ? <small>{payment.note}</small> : null}
                </div>
                <div>
                  <Badge
                    tone={
                      payment.status === "voided"
                        ? "neutral"
                        : payment.refund
                        ? "danger"
                        : payment.status === "paid"
                          ? "success"
                          : "warning"
                    }
                  >
                    {payment.status === "voided"
                      ? text("已作廢", "Voided")
                      : payment.refund
                      ? text("退款", "Refund")
                      : payment.deposit
                        ? text("訂金", "Deposit")
                        : payment.status}
                  </Badge>
                  <strong
                    className={
                      payment.refund || payment.status === "voided"
                        ? "payment-amount refund"
                        : "payment-amount"
                    }
                  >
                    {payment.refund ? "−" : ""}NT${" "}
                    {payment.amountNts.toLocaleString()}
                  </strong>
                  {!payment.refund && payment.status === "paid" && createGateway?.refund ? (
                    <Button
                      onClick={() => {
                        setRefundPayment(payment);
                        setRefundAmount(payment.amountNts);
                        setRefundNote("");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {text("退款", "Refund")}
                    </Button>
                  ) : null}
                  {canVoidPayments && !payment.refund && payment.status === "paid" ? (
                    <Button onClick={() => { setVoidPayment(payment); setVoidReason(""); }} size="sm" variant="danger">{text("作廢", "Void")}</Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {refundPayment ? (
        <ResponsiveDialog
          onClose={() => {
            if (!busy) setRefundPayment(null);
          }}
          title={text("建立退款", "Create refund")}
        >
          <form
            className="booking-create-form"
            onSubmit={(event) => void refund(event)}
          >
            <Notice
              tone="warning"
              title={text(
                `原付款 NT$ ${refundPayment.amountNts.toLocaleString()} 會保留。`,
                `The original NT$ ${refundPayment.amountNts.toLocaleString()} payment will be retained.`,
              )}
            >
              {text(
                "退款必須填寫原因；伺服器會重新檢查尚可退款金額。",
                "A reason is required; the server rechecks the remaining refundable amount.",
              )}
            </Notice>
            <div className="booking-create-grid">
              <Field label={text("退款金額（NT$）", "Refund amount (NT$)")}>
                <input
                  max={refundPayment.amountNts}
                  min="1"
                  onChange={(event) =>
                    setRefundAmount(Number(event.target.value) || 0)
                  }
                  required
                  type="number"
                  value={refundAmount || ""}
                />
              </Field>
              <Field label={text("退款方式", "Refund method")}>
                <select
                  onChange={(event) =>
                    setPaymentType(event.target.value as typeof paymentType)
                  }
                  value={paymentType}
                >
                  <option value="cash">{text("現金", "Cash")}</option>
                  <option value="transfer">{text("轉帳", "Transfer")}</option>
                  <option value="card">{text("刷卡", "Card")}</option>
                  <option value="other">{text("其他", "Other")}</option>
                </select>
              </Field>
              <Field label={text("退款原因", "Refund reason")}>
                <input
                  maxLength={2000}
                  onChange={(event) => setRefundNote(event.target.value)}
                  required
                  value={refundNote}
                />
              </Field>
            </div>
            <div className="booking-create-actions">
              <Button
                disabled={refundAmount < 1 || !refundNote.trim()}
                loading={busy}
                type="submit"
                variant="danger"
              >
                {text("確認退款", "Confirm refund")}
              </Button>
            </div>
          </form>
        </ResponsiveDialog>
      ) : null}
      {voidPayment ? (
        <ResponsiveDialog onClose={() => { if (!busy) setVoidPayment(null); }} title={text("作廢付款", "Void payment")}>
          <form className="booking-create-form" onSubmit={(event) => void voidPaymentRecord(event)}>
            <Notice tone="warning" title={text(`付款 ${voidPayment.paymentId}（NT$ ${voidPayment.amountNts.toLocaleString()}）會從即時摘要與房間餘額排除。`, `Payment ${voidPayment.paymentId} (NT$ ${voidPayment.amountNts.toLocaleString()}) will be excluded from live summaries and room balances.`)}>
              {text("此操作僅限管理員。原始付款不會刪除，系統會保存原因與稽核紀錄；已有退款或已日結的付款不可作廢。", "Admins only. The original payment is retained with its reason and audit trail; refunded or closed-day payments cannot be voided.")}
            </Notice>
            <Field label={text("作廢原因", "Void reason")}><input autoFocus maxLength={2000} onChange={(event) => setVoidReason(event.target.value)} required value={voidReason} /></Field>
            <div className="booking-create-actions"><Button disabled={!voidReason.trim()} loading={busy} type="submit" variant="danger">{text("確認作廢付款", "Confirm void")}</Button></div>
          </form>
        </ResponsiveDialog>
      ) : null}
      {cashierOpen ? (
        <ResponsiveDialog
          onClose={() => {
            if (!busy) setCashierOpen(false);
          }}
          title={text("確認今日日結", "Confirm today's cashier close")}
        >
          <form
            className="booking-create-form"
            onSubmit={(event) => void closeCashier(event)}
          >
            <Notice
              tone="warning"
              title={text(
                `今日淨額預覽：NT$ ${summary.netNts.toLocaleString()}`,
                `Today's net preview: NT$ ${summary.netNts.toLocaleString()}`,
              )}
            >
              {text(
                "日結會以伺服器台北日期重新彙總付款，並鎖定今日 session；付款歷史不會被修改。",
                "The server recalculates Taipei-day payments and closes today's session; payment history is not changed.",
              )}
            </Notice>
            <Field label={text("日結備註（選填）", "Close note (optional)")}>
              <input
                maxLength={2000}
                onChange={(event) => setCashierNote(event.target.value)}
                value={cashierNote}
              />
            </Field>
            <div className="booking-create-actions">
              <Button loading={busy} type="submit" variant="danger">
                {text("確認日結", "Confirm close")}
              </Button>
            </div>
          </form>
        </ResponsiveDialog>
      ) : null}
    </SectionCard>
  );
}
