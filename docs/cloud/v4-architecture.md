# BINI PMS v4 Firebase 架構

狀態：Phase 1 本機基礎；未部署、未連接正式資料。

## 目標

- 電腦與手機共用同一套雲端權威資料。
- 手機以 PWA 提供櫃檯常用操作，不縮放桌面頁面。
- 用可重試、可稽核、具版本衝突偵測的 operation workflow 寫入資料。
- DEV 與 PROD 使用兩個獨立 Firebase project；實際名稱與 project ID 由專案擁有者定義。

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

客戶端不能直接寫入 `bookings`、`stays`、`payments` 等權威 collection。每個操作以 UUID 作為 idempotency key，並攜帶 `baseVersion` 做 optimistic concurrency control。處理器在 Firestore transaction 中再次檢查版本，避免兩台裝置同時修改時覆蓋資料。

## Monorepo 模組

- `cloud/packages/shared`：Zod operation request/result schema、版本與欄位白名單。
- `cloud/packages/functions`：純處理器核心、handler registry、Firestore transaction adapter、Cloud Function trigger。
- `cloud/packages/web`：React/Vite PWA shell，手機優先並共用桌面路由狀態。
- `cloud/firestore.rules`：預設拒絕、角色／物業隔離、僅允許 append-only operation requests。

目前唯一 handler 是 `demo.note.upsert`，只用於驗證完整契約；它不是 PMS 業務功能。

## 下一階段模組順序

1. Identity：Firebase Auth、使用者啟停、物業角色。
2. Rooms／Guests：只讀投影與查詢。
3. Bookings：建立、修改、取消、衝突檢查與計價契約。
4. Stays：入住、延住、退房與房態 transaction。
5. Payments：收款、刪除、日結與審計。
6. Offline queue：IndexedDB、重送、衝突處理與待同步中心。

每個 domain handler 都必須先有 contract test、processor test、Rules test，再允許接入 DEV。
