# BINI Blooms PMS v4 cloud foundation

這個目錄是 Firebase 雲端版的獨立基礎工程，不會改寫或啟動既有 v3 桌面版資料庫。

## 目前狀態

- 已完成：共享 operation contract、Cloud Functions 處理器骨架、Firestore 預設拒絕規則、Rules Emulator 測試、手機優先 PWA 介面。
- 已確認 Firebase 專案：DEV `bini-transient-dev`、PROD `bini-transient`（顯示名稱 `BINI-Transient`）。
- DEV 已建立 Web App `BINI Transient DEV Web`；本機實際 Firebase 設定保存在 Git 忽略的 `.env.local` 與 `.firebaserc`。
- 尚未完成：真實 Firebase Auth、PMS 預約／入住／退房／款項 handlers、IndexedDB 離線佇列、資料移轉、Firestore 建立與正式環境部署。
- DEV Hosting 預覽只展示目前的手機優先 UI shell，不代表 PMS 業務流程已可在雲端操作。

## 本機指令

需求：Node.js 22、Java（供 Firestore Emulator 使用）。

```powershell
cd cloud
npm ci
npm test
npm run test:rules
npm run typecheck
npm run lint
npm run build
npm run dev --workspace @bini/cloud-web
npm run deploy:dev:hosting
```

`deploy:dev:hosting` 會先執行 fail-closed 專案檢查，再建置並以明確 project ID 部署 **Hosting only** 到 `bini-transient-dev`。若 `.firebaserc` 缺失、格式錯誤、alias 指向 PROD 或其他專案，部署會直接中止；repo 不提供 PROD 部署指令。

第一次設定時，複製 `.env.example` 為 `.env.local`、`.firebaserc.example` 為 `.firebaserc`，再填入已確認的 Firebase 專案資料。這兩個實際設定檔均被 Git 忽略，禁止提交憑證。

Firestore 建立地區尚待專案擁有者確認。地區建立後不可變更；確認前不得部署 Firestore Rules 或 Functions。

架構、手機 UI、資安與移轉細節見 `../docs/cloud/`。
