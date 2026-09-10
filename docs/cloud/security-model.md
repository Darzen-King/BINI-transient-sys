# Firebase 安全模型

## 信任邊界

- Firebase Auth 只證明身分；`users/{uid}.active` 與 `roles.{propertyId}` 才決定資料權限。
- Web/PWA 是不受信任客戶端，不持有 Admin SDK 憑證。
- Cloud Functions 使用 Admin SDK，是唯一可寫權威業務資料、operation results 與 audit logs 的元件。
- Firestore Rules 採 default deny；未明確列出的 collection 全部拒絕。

## 已實作規則

- 未登入者不能讀取物業資料，也不能建立 operation request。
- 停權帳號不能讀取物業、歷史 request/result 或建立新操作。
- 使用者只能讀自己的 profile、request 與 result。
- 使用者只能讀自己所屬物業；audit logs 僅該物業 admin 可讀。
- 使用者與 admin 都不能直接寫 rooms、guests、bookings、stays、payments、demoNotes。
- operation request 必須欄位完整、型別正確、operationId 符合 UUID 且等於文件 ID、uid 等於登入者，且不可修改或刪除。
- operation result 必須保存 `uid`，讓 Rules 可以驗證擁有者；共享 schema 與處理器都有回歸測試。

## 上線前必要項目

- 由專案擁有者建立並命名 DEV／PROD Firebase projects。
- 啟用 Auth provider，建立首位 admin 的 server-side bootstrap 流程；不得由前端自行升權。
- 設定 App Check、預算警示、Functions/Firestore 日誌保留與告警。
- 決定 MFA／登入恢復政策，完成離職停權演練。
- 對每個正式 PMS operation 加 payload schema、角色矩陣、正反向 Emulator 測試。
- 任何 `.env.local`、`.firebaserc`、service account 或 token 都不得提交 Git。

## 已知相依風險

2026-09-09 本機 `npm audit --omit=dev` 回報 11 項中度轉遞套件風險，沒有 high/critical；來源集中於 Firebase Admin/Functions 的 Google Cloud 依賴。官方新版 Admin/Functions 已確認存在，但本次安裝網路逾時，未採用可能破壞相容性的 `npm audit fix --force`。正式 DEV 部署前必須另開相依升級工作，升級後重跑全部 gates。
