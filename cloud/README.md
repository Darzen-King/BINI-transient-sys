# BINI Blooms PMS v4 cloud foundation

這個目錄是 Firebase 雲端版的獨立基礎工程，不會改寫或啟動既有 v3 桌面版資料庫。

## 目前狀態

- 已完成：共享 operation contract、Cloud Functions 處理器骨架、Firestore 預設拒絕規則、Rules Emulator 測試、手機優先 PWA 介面、封閉式 Firebase Auth／TOTP MFA 與管理員帳號介面；DEV Rules、Functions 與 Hosting 均已部署。
- 已確認 Firebase 專案：DEV `bini-transient-dev`、PROD `bini-transient`（顯示名稱 `BINI-Transient`）。
- DEV 已建立 Web App `BINI Transient DEV Web`；本機實際 Firebase 設定保存在 Git 忽略的 `.env.local` 與 `.firebaserc`。
- 尚未完成：PMS 預約／入住／退房／款項 handlers、IndexedDB 離線佇列、資料移轉與正式環境部署。
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
npm run deploy:dev:firestore
npm run deploy:dev:functions
```

`deploy:dev:hosting` 會先執行 fail-closed 專案檢查，再建置並檢查 bundle 確實包含完整 DEV Firebase 設定，最後以明確 project ID 部署 **Hosting only** 到 `bini-transient-dev`。若 `.firebaserc` 缺失、格式錯誤、alias 指向 PROD、`.env.local` 未被 Vite 讀取或實際值未進 bundle，部署會直接中止；repo 不提供 PROD 部署指令。

`deploy:dev:firestore` 會先執行同一個 DEV guard 與完整 Rules Emulator 測試，全部通過後才部署 Firestore Rules 與 indexes 到 `bini-transient-dev`。

`deploy:dev:functions` 會依序執行 DEV guard、單元測試、typecheck 與 build，通過後才部署 Functions。所有管理員帳號 callable 都要求已驗證 email、TOTP MFA 與該館別 admin 角色。

`bootstrap:dev-admin` 是一次性首位管理員工具，硬性限制 `bini-transient-dev` 與已確認信箱；它使用目前的 `gcloud` owner 身分建立／核對 Auth 與 Firestore profile，並寄出密碼設定信。非必要不要重跑，以免重寄郵件。

第一次設定時，複製 `.env.example` 為 `.env.local`、`.firebaserc.example` 為 `.firebaserc`，再填入已確認的 Firebase 專案資料。這兩個實際設定檔均被 Git 忽略，禁止提交憑證。

DEV Firestore `(default)` 已建立於 `asia-east1`，使用 Native mode / Standard edition 並啟用 delete protection。網路版不使用單機版 Dropbox/WebDAV/FTP/Google Drive 自動備份頁；Firestore 為即時權威資料源。

架構、手機 UI、資安與移轉細節見 `../docs/cloud/`。
