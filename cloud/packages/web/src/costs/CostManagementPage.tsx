import {
  COST_CATEGORIES,
  type CostListItem,
  summarizeCosts,
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
import { COST_CATEGORY_LABELS } from "../i18n/labels.js";
import { useLocale } from "../i18n/locale.js";
import type { CostGateway } from "./cost-gateway.js";

type CostCategory = (typeof COST_CATEGORIES)[number];
type PaymentMethod = "cash" | "transfer" | "card" | "other";

interface CostFormValue {
  costDate: string;
  category: CostCategory;
  subcategory: string;
  amountNts: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  description: string;
  note: string;
  recurring: boolean;
  receiptNo: string;
}

const categoryLabels = COST_CATEGORY_LABELS;
const paymentLabels: Record<PaymentMethod, readonly [string, string]> = {
  cash: ["現金", "Cash"],
  transfer: ["轉帳", "Transfer"],
  card: ["刷卡", "Card"],
  other: ["其他", "Other"],
};
function taipeiDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function taipeiMonth(): string {
  return taipeiDay().slice(0, 7);
}
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
function emptyForm(): CostFormValue {
  return {
    costDate: taipeiDay(),
    category: "utilities",
    subcategory: "",
    amountNts: 0,
    paymentMethod: "cash",
    vendor: "",
    description: "",
    note: "",
    recurring: false,
    receiptNo: "",
  };
}
function itemForm(item: CostListItem): CostFormValue {
  return {
    costDate: item.costDate,
    category: item.category,
    subcategory: item.subcategory ?? "",
    amountNts: item.amountNts,
    paymentMethod: item.paymentMethod,
    vendor: item.vendor ?? "",
    description: item.description ?? "",
    note: item.note ?? "",
    recurring: item.recurring,
    receiptNo: item.receiptNo ?? "",
  };
}

function CostFields({
  value,
  disabled,
  onChange,
  text,
}: {
  value: CostFormValue;
  disabled: boolean;
  onChange: (next: CostFormValue) => void;
  text: (zhTw: string, en: string) => string;
}) {
  const set = <K extends keyof CostFormValue>(key: K, next: CostFormValue[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="booking-create-grid">
      <Field label={text("成本日期", "Cost date")}>
        <input
          disabled={disabled}
          onChange={(event) => set("costDate", event.target.value)}
          required
          type="date"
          value={value.costDate}
        />
      </Field>
      <Field label={text("分類", "Category")}>
        <select
          disabled={disabled}
          onChange={(event) =>
            set("category", event.target.value as CostCategory)
          }
          value={value.category}
        >
          {COST_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {text(...categoryLabels[category])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={text("金額（NT$）", "Amount (NT$)")}>
        <input
          disabled={disabled}
          min="0"
          onChange={(event) =>
            set("amountNts", Number(event.target.value) || 0)
          }
          required
          type="number"
          value={value.amountNts || ""}
        />
      </Field>
      <Field label={text("付款方式", "Payment method")}>
        <select
          disabled={disabled}
          onChange={(event) =>
            set("paymentMethod", event.target.value as PaymentMethod)
          }
          value={value.paymentMethod}
        >
          {(Object.keys(paymentLabels) as PaymentMethod[]).map((method) => (
            <option key={method} value={method}>
              {text(...paymentLabels[method])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={text("供應商（選填）", "Vendor (optional)")}>
        <input
          disabled={disabled}
          maxLength={300}
          onChange={(event) => set("vendor", event.target.value)}
          value={value.vendor}
        />
      </Field>
      <Field label={text("子分類（選填）", "Subcategory (optional)")}>
        <input
          disabled={disabled}
          maxLength={100}
          onChange={(event) => set("subcategory", event.target.value)}
          value={value.subcategory}
        />
      </Field>
      <Field label={text("說明（選填）", "Description (optional)")}>
        <input
          disabled={disabled}
          maxLength={2000}
          onChange={(event) => set("description", event.target.value)}
          value={value.description}
        />
      </Field>
      <Field label={text("收據號碼（選填）", "Receipt no. (optional)")}>
        <input
          disabled={disabled}
          maxLength={200}
          onChange={(event) => set("receiptNo", event.target.value)}
          value={value.receiptNo}
        />
      </Field>
      <Field label={text("備註（選填）", "Note (optional)")}>
        <input
          disabled={disabled}
          maxLength={2000}
          onChange={(event) => set("note", event.target.value)}
          value={value.note}
        />
      </Field>
      <label className="cost-recurring">
        <input
          checked={value.recurring}
          disabled={disabled}
          onChange={(event) => set("recurring", event.target.checked)}
          type="checkbox"
        />
        {text("固定週期成本", "Recurring cost")}
      </label>
    </div>
  );
}

export function CostManagementPage({
  session,
  gateway,
}: {
  session: StaffSession;
  gateway: CostGateway | undefined;
}) {
  const { text } = useLocale();
  const [items, setItems] = useState<CostListItem[] | null>(null);
  const [month, setMonth] = useState(taipeiMonth());
  const [category, setCategory] = useState<CostCategory | "all">("all");
  const [form, setForm] = useState<CostFormValue>(emptyForm);
  const [editing, setEditing] = useState<CostListItem | null>(null);
  const [editForm, setEditForm] = useState<CostFormValue>(emptyForm);
  const [archiveTarget, setArchiveTarget] = useState<CostListItem | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const isAdmin = session.role === "admin";
  useEffect(
    () =>
      gateway?.subscribe(
        session.propertyId,
        (value) => {
          setItems(value);
          setLoadError(false);
        },
        () => {
          setItems(null);
          setLoadError(true);
        },
      ),
    [gateway, session.propertyId],
  );
  const activeItems = useMemo(
    () => (items ?? []).filter((item) => item.status === "active"),
    [items],
  );
  const summary = useMemo(
    () => summarizeCosts(activeItems, month),
    [activeItems, month],
  );
  const filtered = useMemo(
    () =>
      activeItems.filter(
        (item) =>
          item.costDate.startsWith(month) &&
          (category === "all" || item.category === category),
      ),
    [activeItems, category, month],
  );
  const ready = Boolean(gateway && items && !loadError);
  const input = (value: CostFormValue) => ({
    costDate: value.costDate,
    category: value.category,
    subcategory: value.subcategory.trim() || null,
    amountNts: value.amountNts,
    paymentMethod: value.paymentMethod,
    vendor: value.vendor.trim() || null,
    description: value.description.trim() || null,
    note: value.note.trim() || null,
    recurring: value.recurring,
    receiptNo: value.receiptNo.trim() || null,
  });
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway || !isAdmin || form.amountNts < 0) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await gateway.create({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        ...input(form),
      });
      setForm(emptyForm());
      setSuccess(
        text(
          "成本紀錄已建立，所有裝置會立即同步。",
          "Cost entry created and synced to all devices.",
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text("無法建立成本紀錄。", "Unable to create the cost entry."),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway || !editing) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await gateway.update({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        costId: editing.costId,
        baseVersion: editing.version,
        ...input(editForm),
      });
      setEditing(null);
      setSuccess(text("成本紀錄已更新。", "Cost entry updated."));
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "更新失敗，可能已被其他裝置變更。",
            "Update failed; another device may have changed this entry.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const archive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gateway || !archiveTarget || !archiveReason.trim()) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await gateway.archive({
        propertyId: session.propertyId,
        operationId: crypto.randomUUID(),
        costId: archiveTarget.costId,
        baseVersion: archiveTarget.version,
        reason: archiveReason.trim(),
      });
      setArchiveTarget(null);
      setArchiveReason("");
      setSuccess(
        text(
          "成本紀錄已封存，原始資料與稽核軌跡均已保留。",
          "Cost entry archived; the original data and audit trail are retained.",
        ),
      );
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          text(
            "封存失敗，請重新整理後再試。",
            "Archive failed. Refresh and try again.",
          ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SectionCard
      hint={text("即時成本資料", "Live cost data")}
      title={text("成本紀錄", "Cost records")}
    >
      <p className="booking-create-intro">
        {text(
          "成本資料由 Cloud Functions 寫入並建立稽核紀錄；封存不會刪除歷史資料。",
          "Cost data is written through Cloud Functions with an audit trail; archiving never deletes history.",
        )}
      </p>
      {!ready ? (
        <Notice
          tone={loadError ? "danger" : "warning"}
          title={text("成本資料尚未就緒", "Cost data is not ready")}
        >
          {text(
            "請等待即時資料讀取完成。",
            "Wait for live data to finish loading.",
          )}
        </Notice>
      ) : null}
      {!isAdmin ? (
        <Notice tone="warning" title={text("唯讀模式", "Read-only mode")}>
          {text(
            "只有管理員可以新增、修改或封存成本紀錄。",
            "Only administrators can create, edit, or archive cost records.",
          )}
        </Notice>
      ) : null}
      <div className="cost-summary">
        <div>
          <small>{text("本月成本", "Monthly costs")}</small>
          <strong>NT$ {summary.totalNts.toLocaleString()}</strong>
        </div>
        <div>
          <small>{text("本月筆數", "Entries")}</small>
          <strong>{summary.count}</strong>
        </div>
        {Object.entries(summary.byCategory)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 2)
          .map(([key, amount]) => (
            <div key={key}>
              <small>{text(...categoryLabels[key as CostCategory])}</small>
              <strong>NT$ {amount.toLocaleString()}</strong>
            </div>
          ))}
      </div>
      <div className="cost-filters">
        <Field label={text("月份", "Month")}>
          <input
            onChange={(event) => setMonth(event.target.value)}
            type="month"
            value={month}
          />
        </Field>
        <Field label={text("分類篩選", "Category filter")}>
          <select
            onChange={(event) =>
              setCategory(event.target.value as CostCategory | "all")
            }
            value={category}
          >
            <option value="all">{text("全部分類", "All categories")}</option>
            {COST_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {text(...categoryLabels[value])}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isAdmin ? (
        <form
          className="booking-create-form"
          onSubmit={(event) => void create(event)}
        >
          <fieldset className="booking-deposit">
            <legend>{text("新增成本", "New cost")}</legend>
            <CostFields
              disabled={!ready || busy}
              onChange={setForm}
              text={text}
              value={form}
            />
            <div className="booking-create-actions">
              <Button
                disabled={!ready || form.amountNts < 0}
                loading={busy}
                type="submit"
              >
                {text("儲存成本", "Save cost")}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
      {success ? (
        <Notice
          tone="success"
          title={text("成本資料已同步", "Cost data synced")}
        >
          {success}
        </Notice>
      ) : null}
      {error ? (
        <Notice
          tone="danger"
          title={text("成本操作失敗", "Cost operation failed")}
        >
          {error}
        </Notice>
      ) : null}
      <section className="cost-history">
        <div className="payment-history-heading">
          <strong>{text("成本明細", "Cost entries")}</strong>
          <small>
            {text(`${filtered.length} 筆`, `${filtered.length} entries`)}
          </small>
        </div>
        {filtered.length === 0 ? (
          <p className="empty-card">
            {text(
              "此月份沒有符合篩選的成本紀錄。",
              "No cost entries match this month and filter.",
            )}
          </p>
        ) : (
          <div className="cost-history-list">
            {filtered.map((item) => (
              <article key={item.costId}>
                <div>
                  <strong>
                    {text(...categoryLabels[item.category])} · NT${" "}
                    {item.amountNts.toLocaleString()}
                  </strong>
                  <small>
                    {item.costDate} ·{" "}
                    {text(...paymentLabels[item.paymentMethod])}
                    {item.vendor ? ` · ${item.vendor}` : ""}
                  </small>
                  {item.description ? <small>{item.description}</small> : null}
                </div>
                <div className="cost-entry-actions">
                  {item.recurring ? (
                    <Badge tone="info">{text("週期", "Recurring")}</Badge>
                  ) : null}
                  {isAdmin ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setEditing(item);
                          setEditForm(itemForm(item));
                          setError("");
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {text("修改", "Edit")}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setArchiveTarget(item);
                          setArchiveReason("");
                          setError("");
                        }}
                        size="sm"
                        variant="danger"
                      >
                        {text("封存", "Archive")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {editing ? (
        <ResponsiveDialog
          description={text(
            "儲存前會驗證版本，避免覆蓋其他裝置的修改。",
            "The version is checked before saving to avoid overwriting another device.",
          )}
          onClose={() => !busy && setEditing(null)}
          title={text("修改成本紀錄", "Edit cost entry")}
        >
          <form
            className="cost-dialog-form"
            onSubmit={(event) => void update(event)}
          >
            <CostFields
              disabled={busy}
              onChange={setEditForm}
              text={text}
              value={editForm}
            />
            <div className="booking-create-actions">
              <Button
                disabled={busy}
                onClick={() => setEditing(null)}
                type="button"
                variant="outline"
              >
                {text("取消", "Cancel")}
              </Button>
              <Button loading={busy} type="submit">
                {text("儲存變更", "Save changes")}
              </Button>
            </div>
          </form>
        </ResponsiveDialog>
      ) : null}
      {archiveTarget ? (
        <ResponsiveDialog
          description={text(
            "封存後不會出現在日常成本清單，但保留於稽核資料中。",
            "Archived entries leave the daily list but remain in audit data.",
          )}
          onClose={() => !busy && setArchiveTarget(null)}
          title={text("封存成本紀錄", "Archive cost entry")}
        >
          <form
            className="cost-dialog-form"
            onSubmit={(event) => void archive(event)}
          >
            <Notice
              tone="warning"
              title={text(
                `將封存 ${archiveTarget.costDate} 的 NT$ ${archiveTarget.amountNts.toLocaleString()} 成本。`,
                `This archives the NT$ ${archiveTarget.amountNts.toLocaleString()} entry from ${archiveTarget.costDate}.`,
              )}
            />
            <Field label={text("封存原因", "Archive reason")}>
              <input
                autoFocus
                disabled={busy}
                maxLength={2000}
                onChange={(event) => setArchiveReason(event.target.value)}
                required
                value={archiveReason}
              />
            </Field>
            <div className="booking-create-actions">
              <Button
                disabled={busy}
                onClick={() => setArchiveTarget(null)}
                type="button"
                variant="outline"
              >
                {text("取消", "Cancel")}
              </Button>
              <Button
                disabled={!archiveReason.trim()}
                loading={busy}
                type="submit"
                variant="danger"
              >
                {text("確認封存", "Confirm archive")}
              </Button>
            </div>
          </form>
        </ResponsiveDialog>
      ) : null}
    </SectionCard>
  );
}
