# BINI PMS v4 Firebase 架構

狀態：DEV foundation；Identity 與管理員帳號流程已實作，PMS domain 仍為展示資料。完整範圍與逐頁完成定義見 `v3-v4-full-parity-matrix.md`。

## 目標

- 電腦與手機共用同一套雲端權威資料。
- 桌機 PWA 保留 v3.9.14 全部頁面、頂部導覽與操作流程；不是重新設計成目前的側欄 demo shell。
- 手機 PWA 提供同一套完整功能，但依小螢幕改為卡片、全螢幕表單、bottom sheet 與底部導覽，不縮放桌面頁面。
- 用可重試、可稽核、具版本衝突偵測的 operation workflow 寫入資料。
- DEV 與 PROD 使用兩個獨立 Firebase project；實際名稱與 project ID 由專案擁有者定義。
- 店內封閉式帳號：無註冊流程，只有 admin 能建立／停用人員、設定角色／分頁及重設密碼；每位人員必須使用 TOTP MFA。
- Firestore 是網路版即時權威資料源，不移植單機版 Dropbox/WebDAV/FTP/Google Drive 自動備份介面；管理員可手動選取原 Dropbox JSON 做一次性初始導入，憑證不進 v4。

初始導入採 staging → reconcile → promote，不直接覆蓋權威 collection。瀏覽器先解析並顯示筆數，`adminStageV3Backup` 再驗證 MFA/admin、檔案格式與 SHA-256，使用穩定 batch/row ID 寫入 default-deny 的 `migrationImports` 暫存區。只有各 domain schema 與對帳器完成後，獨立 promotion 工具才可把暫存資料升級成正式資料。

## 資料流

```text
PWA（手機／電腦）
  ├─ read ───────────────> Firestore authoritative collections
  └─ create intent ──────> operationRequests/{operationId}
                               │ Firestore trigger
                               v
                         Cloud Functions processor
                         validate / authorize / version check
                               ├─ accepted -> authoritative entity + audit log
                               ├─ conflict -> operation result
                               └─ rejected -> operation result
                                              │
PWA <────────────────── operationResults/{operationId}
```

客戶端不能直接寫入 `bookings`、`stays`、`payments` 等權威 collection。一般操作使用 append-only queue；即時預約建立、取消與修改分別使用受 MFA／頁面權限保護的 `bookingCreate`、`bookingCancel`、`bookingUpdate` callable。三者皆以 UUID 作為 idempotency key，並在 Firestore transaction 中重新檢查資料，避免兩台裝置同時操作造成覆寫、雙重訂房、重複取消或覆蓋修改。

## Monorepo 模組

- `cloud/packages/shared`：Zod operation/staff schema、角色／分頁與欄位白名單。
- `cloud/packages/functions`：純處理器核心、handler registry、Firestore transaction adapter、operation trigger 與 admin-only staff callables。
- `cloud/packages/web`：React/Vite PWA、AuthGate、TOTP enrollment/sign-in；桌機／手機 view 可分開，但共用 domain controller、query 與 operation client。
- `cloud/firestore.rules`：預設拒絕、角色／物業隔離、僅允許 append-only operation requests。

目前唯一 handler 是 `demo.note.upsert`，只用於驗證完整契約；它不是 PMS 業務功能。

## 全功能模組順序

1. Identity：Firebase Auth、TOTP MFA、使用者啟停、物業角色（已實作 DEV 版）。
2. Schema／migration：全部 v3 entities、穩定 migration ID、館別補值、匯入與 reconciliation。
3. Rooms／Gantt：房間總覽、房態、下一筆預約、時間軸只讀投影。
4. Bookings：清單、新增、多時段、修改、取消、No-show、提醒、衝突與計價。
5. Stays：入住、延住、退房、免費取消、超時減免、換房、月租與房態 transaction。
6. Payments：在住房客帶入／手動付款、刪除、押金／退款、日結、匯出與審計。
7. Operations：清潔、維修與排程。
8. Administration：報表、成本、假日、館別、審計、使用者與個人分頁權限。
9. Offline queue：IndexedDB、重送、衝突處理與待同步中心。
10. Full parity UI：逐頁完成桌機 v3 對照，以及同功能手機 adaptive views。

每個 domain handler 都必須先有 contract test、processor test、Rules test，再允許接入 DEV。

此順序只是降低風險的實作切片，**不是縮減產品範圍**；最終驗收必須涵蓋完整對照矩陣。
