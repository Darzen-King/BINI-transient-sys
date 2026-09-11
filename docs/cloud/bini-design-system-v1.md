# BINI Design System v1 — Foundation 與核心元件

**服務產品：** BINI Blooms PMS Firebase v4 Web／PWA
**範圍：** 產品介面、設計 Tokens、核心 React 元件、響應式與基本可及性
**方向：** 演進現有 BINI 粉色品牌，不重新命名或另造視覺品牌
**工具：** React 18、TypeScript、CSS custom properties、Vitest／Testing Library
**版本日期：** 2026-09-11

## 整體健康度

| 面向 | 分數（1–5） | 狀態 | 目前證據 |
|---|---:|---|---|
| 元件覆蓋 | 3 | 🟡 | Button、Badge、SectionCard、Field、Notice、ResponsiveDialog 已落地；DataGrid、DateTime、Toast 尚缺 |
| Token 一致性 | 4 | 🟢 | primitive + semantic 雙層色票、字級、4px 間距、圓角、陰影、動態、z-index 已集中管理 |
| 文件品質 | 3 | 🟡 | 本文件提供 API 與使用規則；尚無 Storybook／視覺回歸範例 |
| 可及性 | 3 | 🟡 | 44px target、focus-visible、Field 關聯、Dialog Escape／focus trap 已實作；尚待全站 axe 與對比實測 |
| 採用程度 | 3 | 🟡 | App、Auth、帳號管理與首次匯入開始採用；既有 product CSS 仍有過渡 alias |
| 貢獻流程 | 2 | 🟡 | 有命名與驗收規則，尚未建立獨立版本及元件變更審查機制 |
| **整體** | **3.0** | **🟡** | **基礎可擴充，需跟隨各 PMS domain 持續收斂** |

摘要：既有介面的品牌辨識清楚，手機卡片與桌機資訊密度也已有方向；主要風險是過去所有樣式集中於單一 `styles.css`，硬編碼色彩、圓角與互動狀態容易在 17 個模組擴張時漂移。v1 已建立設計系統邊界並讓現有核心流程開始實際使用，不是只產出靜態規格。

## 1. 設計基礎

### 品牌演進

- 保留 BINI berry pink 作為主操作色，新增 50–900 階 primitive palette。
- 正式產品元件不得直接使用 `berry-500` 等 primitive token；應使用 `action-primary`、`feedback-danger` 等 semantic token。
- 房態顏色是營運語意，不等同品牌色；桌機卡與手機詳細面板共用同一組 room-state token。
- 白色卡面、淡粉 canvas 與低彩度中性色延續原單機版的輕量、親和感，但提高文字與焦點狀態的辨識度。

### Token 層級

```text
Primitive
  berry / neutral / green / amber / red / blue / purple
        ↓
Semantic
  canvas / surface / text / border / action / feedback / room-state
        ↓
Component
  Button / Badge / Field / Notice / Dialog / product modules
```

Token 來源：`cloud/packages/web/src/design-system/tokens.css`。

| 類型 | 規格 |
|---|---|
| Typography | 10–30px type scale；Inter → Noto Sans TC → Microsoft JhengHei fallback |
| Spacing | 4px 基準：4／8／12／16／20／24／32／40／48 |
| Radius | 7／10／12／15／18／24／full |
| Elevation | sm／md／lg 三階，僅用於可互動層級與浮層 |
| Motion | 120ms／200ms；尊重 `prefers-reduced-motion` |
| Touch | 所有主要互動元件最低 44×44px |
| Breakpoints | mobile-first；768px tablet；1100px v3 desktop parity |

## 2. 核心元件

| 元件 | 變體／狀態 | 使用位置 | v1 品質 |
|---|---|---|---|
| `Button` | primary、secondary、outline、ghost、danger；sm/md/lg/icon；loading、disabled、block | 快捷操作、登入、帳號、匯入 | ✅ |
| `Badge` | neutral、brand、success、warning、danger、info | 房態、預約、MFA、帳號狀態 | ✅ |
| `SectionCard` | title、hint、actions | 今日房態、預約、更多、匯入 | ✅ |
| `Field` | label、hint、error；自動建立 aria 關聯 | 登入、MFA、搜尋、帳號表單 | ✅ |
| `Notice` | info、success、warning、danger | DEV 狀態、安全提醒、錯誤與成功 | ✅ |
| `ResponsiveDialog` | 手機 bottom sheet、平板／桌機置中 dialog；Escape、focus trap、還原焦點 | 房間詳細、操作骨架、帳號編輯 | ✅ |
| `LanguageSwitcher` | 中文／English、`aria-pressed`、localStorage 記憶 | 登入、手機頂部、桌機右上 | ✅ |

核心元件來源：`cloud/packages/web/src/design-system/components.tsx`；樣式使用 `bds-*` 前綴，避免與 domain class 衝突。

### 使用規則

- 新頁面不得自行建立另一種主要按鈕、狀態 Badge、錯誤框或 Dialog。
- domain class 只負責版面及特定業務語意；顏色、間距、狀態與互動回饋由 design-system token／component 負責。
- 不以顏色單獨表示房態或錯誤；必須同時有文字。
- 手機使用 `ResponsiveDialog` 的 bottom-sheet 形態；桌機自動轉成置中對話框，不維護兩套資料內容。
- 新增文字時必須同時提供 `zh-TW` 與 `en`，語言狀態由 `LocaleProvider` 單一管理。

## 3. 元件覆蓋缺口

| 類別 | 已有 | 下一階段缺口 |
|---|---|---|
| Navigation | desktop top nav、mobile bottom nav、language switch | overflow menu、breadcrumb、active route contract |
| Forms | Field、input/select/checkbox 基礎 | DateTime picker、Money input、Combobox、inline validation summary |
| Feedback | Notice、Dialog、loading button | Toast、progress、skeleton、offline/conflict status |
| Data display | Card、Badge、room detail list | Desktop DataGrid、mobile ListCard、EmptyState、StatCard、Timeline |
| Operations | responsive dialog | Confirm destructive action、operation result、undo/retry |

最具影響力的三個缺口：

1. 可排序／篩選的桌面 DataGrid 與對應 mobile ListCard，幾乎所有 v3 管理頁都會使用。
2. DateTime／Money 輸入元件，關係到預約、入住、延住、退房與款項正確性。
3. Offline／Conflict／Toast 元件，後續 operation queue 上線時是不可缺的操作回饋。

## 4. 可及性基準

| WCAG 2.2 項目 | 狀態 | 說明 |
|---|---|---|
| 1.4.3 文字對比 | ⚠️ | 主文字與狀態色已有 semantic token；仍需以實際畫面執行自動及人工對比檢查 |
| 1.4.11 非文字對比 | ⚠️ | focus 與邊框規格已定義；各 domain 圖表尚未建立 |
| 2.1.1 鍵盤操作 | ✅／⚠️ | 核心按鈕、欄位、Dialog 可操作；後續 DataGrid 需另驗證 |
| 2.4.7 Focus Visible | ✅ | Button、Field、Dialog close 有一致 focus ring |
| 2.5.8 Target Size | ✅ | 全站互動目標最低 44px；小型按鈕僅視覺縮小，命中區仍須保留 |
| 4.1.2 Name, Role, Value | ✅／⚠️ | Field、Notice、Dialog、LanguageSwitcher 已具名稱／狀態；後續自訂選單需測試 |

## 5. 貢獻與驗收 Workflow

```text
Domain 需求
  → 檢查是否已有 BDS 元件
  → 有：組合使用，不複製樣式
  → 無：先提出跨頁重用證據與 component API
  → 加入 keyboard / responsive / locale 測試
  → 視覺 QA：320 / 375 / 768 / 1100px
  → 更新本文件、CHANGELOG、Claude Code 交接
```

- Owner：每一 domain 的實作者負責採用；Codex 做獨立測試與畫面驗收。
- 元件進入 design system 的門檻：至少兩個頁面重用，或屬安全／可及性必須統一的模式。
- Breaking change：不得直接移除 prop／token；先提供 alias 與遷移期，再於單獨版本移除。
- 測試：核心元件 contract 位於 `cloud/packages/web/tests/design-system-components.test.tsx`。

## 6. 優先路線圖

| 優先級 | 工作 | Owner | 影響 | 時程 |
|---|---|---|---|---|
| P1 | DataGrid + mobile ListCard | rooms／bookings domain implementer | 全部列表頁共用 | rooms/gantt milestone |
| P1 | DateTimeField + MoneyField | bookings／payments domain implementer | 避免計價與時間輸入錯誤 | bookings milestone |
| P1 | Toast + OperationStatus + ConflictDialog | operation queue implementer | 真實寫入回饋 | 首個可寫 domain 前 |
| P1 | axe + keyboard + contrast CI | Codex reviewer | 阻止可及性回歸 | 下一個 UI release |
| P2 | Storybook 或獨立受保護 component catalog | design-system owner | 降低元件誤用 | 三個 domain 採用後 |
| P2 | 移除 legacy token alias 與剩餘硬編碼樣式 | 各 domain owner | 完成採用收斂 | v4 pilot 前 |
| P3 | Dark theme token set | product owner 決策後 | 非目前營運必要 | 後續評估 |

## 7. 本版驗收界線

- 本版完成「設計基礎 + 核心元件」，不是完整 17 模組元件庫。
- 不因建立設計系統而宣稱尚未接 Firestore 的 PMS domain 已完成。
- `LocaleProvider` 已覆蓋目前可操作的登入與 foundation 介面；未來新增頁面必須同步補 `zh-TW`／`en`，不得回到單語硬編碼。
