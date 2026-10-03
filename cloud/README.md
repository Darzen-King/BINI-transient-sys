# BINI Blooms PMS v4 cloud foundation

> **狀態請看 [`CLAUDE.md`](../CLAUDE.md)**：雲端版 v4（`bini-transient`）自 2026-09-20 起為正式營運系統；單機版 v3 為備援。本檔保留歷史脈絡，狀態以 `CLAUDE.md` 為準。

這個目錄是 Firebase 雲端版的獨立基礎工程，不會改寫或啟動既有 v3 桌面版資料庫。

## 目前狀態

- **正式環境 `bini-transient` 自 2026-09-20 起營運中**：17 個分頁、Functions、Hosting、Firestore Rules
  與備份皆已部署；資料由單機版備份匯入後，所有異動都發生在雲端。
- `bini-transient-dev` 為驗收環境，資料為測試資料；兩邊程式相同，部署指令不同（見 `CLAUDE.md`）。
- 本機 Firebase 設定保存在 Git 忽略的 `.env.local`（DEV）、`.env.prod.local`（正式）與 `.firebaserc`。
- 詳細狀態、環境、備份、App Check 與部署方式一律以根目錄 `CLAUDE.md` 為準。

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
