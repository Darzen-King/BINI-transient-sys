# v3 桌面版到 v4 Firebase 移轉 Runbook

## 不變原則

- v3 SQLite 與 v4 Firebase 在切換前互不改寫；Phase 1 不碰既有營運資料。
- DEV 與 PROD 為兩個不同 project；DEV 為 `bini-transient-dev`，PROD 為 `bini-transient`，測試電腦只允許 DEV。
- 同一時刻只能有一個權威寫入來源，不採長期雙寫，避免付款與房態分歧。
- 每一階段都要有可驗證輸出與回復路徑。

## TODO Tree

```text
Phase 1 foundation（本次）
├─ shared operation contract
├─ server-only processor skeleton
├─ Firestore Rules + Emulator tests
└─ mobile-first PWA shell

Phase 2 domain implementation
├─ schema mapping and migration IDs
├─ bookings / stays / payments handlers
├─ pricing parity tests against v3
└─ offline queue and conflict UX

Phase 3 DEV provision（進行中）
├─ [完成] 確認 DEV / PROD project 與建立 DEV Web App
├─ [完成] DEV Hosting 預覽與 fail-closed 部署防呆
├─ [待確認] Firestore immutable location 與 budget alerts
├─ [待辦] Auth / Firestore / Functions
├─ bootstrap admin
└─ deploy DEV through reviewed workflow

Phase 4 pilot
├─ export sanitized v3 snapshot
├─ import into DEV and reconcile counts/totals
├─ test PC + mobile scenario suite
└─ security / restore / concurrency drills

Phase 5 production cutover
├─ create named PROD project
├─ freeze v3 writes and final backup
├─ final import + reconciliation sign-off
├─ enable v4 writes
└─ monitor and retain v3 read-only rollback copy
```

## 驗收門檻

- 筆數：rooms、guests、bookings、stays、payments 與來源一致。
- 金額：每日／每月付款與成本加總一致；抽樣訂單計價一致。
- 狀態：房態、入住、退房、取消、no-show 對照一致。
- 並行：兩裝置修改同一實體時，一筆成功、另一筆明確 conflict，不可靜默覆蓋。
- 權限：跨物業、停權、未登入、前端直寫皆被 Emulator 拒絕。
- 回復：在演練環境完成 Firebase 匯出／還原與 v3 read-only 回復流程。

## 尚需專案擁有者決定

1. Firestore 建立地區（建議 `asia-east1` 台灣；建立後不可變更）。
2. 首位 admin 的登入信箱，以及是否第一版就啟用 MFA。
3. 預計試營運日期與可接受的正式切換停機窗口。

## 已確認 Firebase 資源（2026-09-10）

- DEV project ID：`bini-transient-dev`；DEV Web App：`BINI Transient DEV Web`。
- DEV Hosting 預覽站：`https://bini-transient-dev.web.app`。
- PROD project ID：`bini-transient`；僅確認存在，未部署、未修改。
- Firestore 尚未建立；不得在未確認地區前建立資料庫。
- 本機部署命令只允許 Hosting 到明確 DEV project；不存在 PROD 部署 script。
