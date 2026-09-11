# Firebase 安全模型

## 信任邊界

- Firebase Auth 只證明身分；`users/{uid}.active` 與 `roles.{propertyId}` 才決定資料權限。
- Web/PWA 是不受信任客戶端，不持有 Admin SDK 憑證。
- Cloud Functions 使用 Admin SDK，是唯一可寫權威業務資料、operation results 與 audit logs 的元件。
- Firestore Rules 採 default deny；未明確列出的 collection 全部拒絕。
- `migrationImports` 暫存區不對任何 Web client 開放，包含 admin；只能由通過 email verification、TOTP MFA 與館別 admin 複驗的 callable 使用 Admin SDK 建立。

## 已實作規則

- Identity Platform 關閉一般使用者註冊與自助刪除；帳號只能由已完成 MFA 的館別 admin 透過 callable 建立。
- 所有 PMS 資料存取要求 email 已驗證，且目前 ID token 含 TOTP second-factor claim。
- 未登入者不能讀取物業資料，也不能建立 operation request。
- 停權帳號不能讀取物業、歷史 request/result 或建立新操作。
- 使用者只能讀自己的 profile、request 與 result。
- 使用者只能讀自己所屬物業；audit logs 僅該物業 admin 可讀。
- 使用者與 admin 都不能直接寫 rooms、guests、bookings、stays、payments、demoNotes。
- operation request 必須欄位完整、型別正確、operationId 符合 UUID 且等於文件 ID、uid 等於登入者，且不可修改或刪除。
- operation result 必須保存 `uid`，讓 Rules 可以驗證擁有者；共享 schema 與處理器都有回歸測試。
- 管理員可建立、啟停、修改角色／分頁及重設密碼；密碼只送 Firebase Auth，不寫 Firestore 或 audit log，管理員也不可停用或移除自己的 admin 身分。

## 上線前必要項目

- [完成] 專案擁有者建立並命名 DEV／PROD Firebase projects。
- [完成] 首位 DEV admin 的一次性 server-side bootstrap；不得由前端自行升權。
- 設定 App Check、預算警示、Functions/Firestore 日誌保留與告警。
- 完成離職停權、遺失驗證器與帳號恢復演練。
- 對每個正式 PMS operation 加 payload schema、角色矩陣、正反向 Emulator 測試。
- 任何 `.env.local`、`.firebaserc`、service account 或 token 都不得提交 Git。

## 已知相依風險

2026-09-09 本機 `npm audit --omit=dev` 回報 11 項中度轉遞套件風險，沒有 high/critical；來源集中於 Firebase Admin/Functions 的 Google Cloud 依賴。官方新版 Admin/Functions 已確認存在，但本次安裝網路逾時，未採用可能破壞相容性的 `npm audit fix --force`。正式 DEV 部署前必須另開相依升級工作，升級後重跑全部 gates。
