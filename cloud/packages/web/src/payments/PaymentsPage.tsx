import {
  summarizePayments,
  type ActiveStayItem,
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
import { useLocale } from "../i18n/locale.js";
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

export function PaymentsPage({
  session,
  createGateway,
  listGateway,
  staysGateway,
}: {
  session: StaffSession;
  createGateway: PaymentCreateGateway | undefined;
  listGateway: PaymentListGateway | undefined;
  staysGateway: ActiveStaysGateway | undefined;
}) {
  const { locale, text } = useLocale();
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [stays, setStays] = useState<ActiveStayItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [stayId, setStayId] = useState("");
  const [amountNts, setAmountNts] = useState(0);
  const [paymentType, setPaymentType] = useState<
    "cash" | "transfer" | "card" | "other"
  >("cash");
  const [note, setNote] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [refundPayment, setRefundPayment] = useState<PaymentListItem | null>(
    null,
  );
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundNote, setRefundNote] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualGuestName, setManualGuestName] = useState("");
  const [manualRoomId, setManualRoomId] = useState("");
  const [manualAmountNts, setManualAmountNts] = useState(0);
  const [manualPaymentType, setManualPaymentType] = useState<
    "cash" | "transfer" | "card" | "other"
  >("cash");
  const [manualDeposit, setManualDeposit] = useState(false);
  const [manualNote, setManualNote] = useState("");
  const [cashierOpen, setCashierOpen] = useState(false);
  const [cashierNote, setCashierNote] = useState("");
  useEffect(
    () =>
      listGateway?.subscribe(
        session.propertyId,
        (value) => {
          setPayments(value);
          setLoadError(false);
        },
        () => {
          setPayments(null);
          setLoadError(true);
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
          setLoadError(false);
        },
        () => {
          setStays(null);
          setLoadError(true);
        },
      ),
    [session.propertyId, staysGateway],
  );
  const selectedStay = useMemo(
    () => stays?.find((item) => item.stayId === stayId) ?? null,
    [stays, stayId],
  );
  const ready = Boolean(
    createGateway &&
    listGateway &&
    staysGateway &&
    payments &&
    stays &&
    !loadError,
  );
  const day = taipeiDay();
  const summary = useMemo(
    () => summarizePayments(payments ?? [], day),
    [day, payments],
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createGateway || !selectedStay || amountNts < 1) return;
    const id = operationId ?? crypto.randomUUID();
    if (!operationId) setOperationId(id);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createGateway.create({
        propertyId: session.propertyId,
        operationId: id,
        stayId: selectedStay.stayId,
        amountNts,
        paymentType,
        note: note.trim() || null,
      });
      setOperationId(null);
      setAmountNts(0);
      setNote("");
      setSuccess(
        text(
          `已記錄 ${result.roomId} 房 NT$ ${result.amountNts.toLocaleString()} 收款。`,
          `Recorded NT$ ${result.amountNts.toLocaleString()} for room ${result.roomId}.`,
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "收款未完成，請重新確認在住房與金額。",
            "Payment did not complete. Confirm the active stay and amount.",
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
  const manualCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !createGateway?.manualCreate ||
      manualAmountNts < 1 ||
      !manualGuestName.trim() ||
      !manualNote.trim()
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createGateway.manualCreate({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        bookingId: null,
        roomId: manualRoomId.trim() || null,
        guestName: manualGuestName.trim(),
        amountNts: manualAmountNts,
        paymentType: manualPaymentType,
        deposit: manualDeposit,
        note: manualNote.trim(),
      });
      setManualOpen(false);
      setManualGuestName("");
      setManualRoomId("");
      setManualAmountNts(0);
      setManualPaymentType("cash");
      setManualDeposit(false);
      setManualNote("");
      setSuccess(
        text(
          `已建立 NT$ ${result.amountNts.toLocaleString()} 手動收款。`,
          `Created an NT$ ${result.amountNts.toLocaleString()} manual payment.`,
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "手動收款未完成，請確認房間與資料後重試。",
            "Manual payment was not completed. Confirm the room and details.",
          ),
        ),
      );
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
  return (
    <SectionCard
      hint={text("即時帳務資料", "Live payment data")}
      title={text("付款管理", "Payments")}
    >
      <p className="booking-create-intro">
        {text(
          "收款由伺服器驗證在住房與操作權限後建立，完成後立即更新所有已登入裝置。",
          "The server verifies the active stay and permission before recording a payment; all signed-in devices update immediately.",
        )}
      </p>
      {!ready ? (
        <Notice
          tone={loadError ? "danger" : "warning"}
          title={text("付款資料尚未就緒", "Payment data is not ready")}
        >
          {text(
            "在住房或付款紀錄尚未載入完成前，無法送出收款。",
            "Payment submission is disabled until stays and records load.",
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
      {createGateway?.manualCreate ? (
        <div className="booking-create-actions">
          <Button
            onClick={() => {
              setManualOpen(true);
              setError("");
              setSuccess("");
            }}
            type="button"
            variant="outline"
          >
            {text("手動例外收款", "Manual exception payment")}
          </Button>
        </div>
      ) : null}
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
            <Field label={text("選擇在住房", "Select active stay")}>
              <select
                disabled={!ready}
                onChange={(event) => {
                  setStayId(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                required
                value={stayId}
              >
                <option value="">
                  {text("選擇房間與旅客", "Select room and guest")}
                </option>
                {(stays ?? []).map((stay) => (
                  <option key={stay.stayId} value={stay.stayId}>
                    {stay.roomId} · {stay.guestName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={text("收款金額（NT$）", "Amount (NT$)")}>
              <input
                disabled={!ready || !selectedStay}
                min="1"
                onChange={(event) =>
                  setAmountNts(Number(event.target.value) || 0)
                }
                required
                type="number"
                value={amountNts || ""}
              />
            </Field>
            <Field label={text("付款方式", "Payment method")}>
              <select
                disabled={!ready || !selectedStay}
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
            <Field label={text("備註（選填）", "Note (optional)")}>
              <input
                disabled={!ready || !selectedStay}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </Field>
          </div>
          {selectedStay ? (
            <div className="stay-extension-preview">
              <strong>{text("本次收款對象", "Payment target")}</strong>
              <div>
                <span>{text("房間／旅客", "Room / guest")}</span>
                <b>
                  {selectedStay.roomId} · {selectedStay.guestName}
                </b>
              </div>
              <div>
                <span>{text("目前應收", "Current due")}</span>
                <b>NT$ {selectedStay.totalDueNts.toLocaleString()}</b>
              </div>
            </div>
          ) : null}
          <div className="booking-create-actions">
            <Button
              disabled={!ready || !selectedStay || amountNts < 1}
              loading={busy}
              size="lg"
              type="submit"
            >
              {text("確認收款", "Record payment")}
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
                      payment.refund
                        ? "danger"
                        : payment.status === "paid"
                          ? "success"
                          : "warning"
                    }
                  >
                    {payment.refund
                      ? text("退款", "Refund")
                      : payment.deposit
                        ? text("訂金", "Deposit")
                        : payment.status}
                  </Badge>
                  <strong
                    className={
                      payment.refund
                        ? "payment-amount refund"
                        : "payment-amount"
                    }
                  >
                    {payment.refund ? "−" : ""}NT${" "}
                    {payment.amountNts.toLocaleString()}
                  </strong>
                  {!payment.refund && createGateway?.refund ? (
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
      {manualOpen ? (
        <ResponsiveDialog
          onClose={() => {
            if (!busy) setManualOpen(false);
          }}
          title={text("手動例外收款", "Manual exception payment")}
        >
          <form
            className="booking-create-form"
            onSubmit={(event) => void manualCreate(event)}
          >
            <Notice
              tone="warning"
              title={text(
                "僅供無法使用在住房收款的例外。",
                "Use only when an active-stay payment cannot be used.",
              )}
            >
              {text(
                "不會直接修改既有帳務；會新增可稽核的付款紀錄。房號可留空，填寫時由伺服器確認存在。",
                "This never edits existing accounting. It creates an auditable payment record. Room is optional; when supplied, the server verifies it exists.",
              )}
            </Notice>
            <div className="booking-create-grid">
              <Field label={text("旅客／對象", "Guest / recipient")}>
                <input
                  maxLength={300}
                  onChange={(event) => setManualGuestName(event.target.value)}
                  required
                  value={manualGuestName}
                />
              </Field>
              <Field label={text("房號（選填）", "Room (optional)")}>
                <input
                  maxLength={128}
                  onChange={(event) => setManualRoomId(event.target.value)}
                  value={manualRoomId}
                />
              </Field>
              <Field label={text("收款金額（NT$）", "Amount (NT$)")}>
                <input
                  min="1"
                  onChange={(event) =>
                    setManualAmountNts(Number(event.target.value) || 0)
                  }
                  required
                  type="number"
                  value={manualAmountNts || ""}
                />
              </Field>
              <Field label={text("付款方式", "Payment method")}>
                <select
                  onChange={(event) =>
                    setManualPaymentType(
                      event.target.value as typeof manualPaymentType,
                    )
                  }
                  value={manualPaymentType}
                >
                  <option value="cash">{text("現金", "Cash")}</option>
                  <option value="transfer">{text("轉帳", "Transfer")}</option>
                  <option value="card">{text("刷卡", "Card")}</option>
                  <option value="other">{text("其他", "Other")}</option>
                </select>
              </Field>
              <Field label={text("帳務類型", "Record type")}>
                <label>
                  <input
                    checked={manualDeposit}
                    onChange={(event) => setManualDeposit(event.target.checked)}
                    type="checkbox"
                  />{" "}
                  {text("記為訂金", "Record as deposit")}
                </label>
              </Field>
              <Field label={text("原因／備註", "Reason / note")}>
                <input
                  maxLength={2000}
                  onChange={(event) => setManualNote(event.target.value)}
                  required
                  value={manualNote}
                />
              </Field>
            </div>
            <div className="booking-create-actions">
              <Button
                disabled={
                  manualAmountNts < 1 ||
                  !manualGuestName.trim() ||
                  !manualNote.trim()
                }
                loading={busy}
                type="submit"
              >
                {text("確認建立收款", "Create payment")}
              </Button>
            </div>
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
      <Notice
        tone="warning"
        title={text("後續帳務項目", "Next accounting items")}
      >
        {text(
          "訂金調整與刪除紀錄仍會以獨立交易切片接入；目前不會用前端直接修改帳務資料。",
          "Deposit adjustments and deletion will be delivered as separate transactions; this screen never edits accounting data directly from the browser.",
        )}
      </Notice>
    </SectionCard>
  );
}
