# BINI Blooms PMS v3.7.0
> 房務管理系統 | Property Management System
> FastAPI + Jinja2 + SQLite | Python 3.12

---

## 安裝說明

### 需求
- Windows 10 / 11
- Python **3.12**（不支援 3.13/3.14）— 安裝時勾選 "Add Python to PATH"
- 網路連線（安裝時下載套件）

### 安裝步驟
1. 解壓縮 zip 到任意位置
2. **雙擊** `install.bat`（若失敗請右鍵「以系統管理員身分執行」）
3. 選擇安裝路徑（C槽 / D槽 / 自訂）
4. 等待安裝完成
5. **雙擊** `start.bat` 啟動系統
6. 瀏覽器自動開啟 **http://127.0.0.1:8000**

---

## 預設帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| admin | admin1234 | 系統管理員（全部功能）|
| manager | mgr1234 | 主管（報表/備份/日結）|
| front | front1234 | 前台（訂房/入住/退房）|
| housekeeping | hk1234 | 房務（清潔管理）|
| maintenance | mt1234 | 維修（維修管理）|

> ⚠️ 請於首次使用後立即修改密碼

---

## 功能說明

### 甘特圖（/gantt）— v3.4.0 新增
- 顯示**今天起 7 天**的所有房間使用狀況
- 橫軸：日期小時 | 縱軸：房號
- 🟢 入住中 | 🟡 預約 | 🔴 維修 | □ 空房
- 游標移到色條顯示詳情，自動捲動到現在時刻

### 新增預約（多段預約）
- 主表單填入第一筆，點「**+ 新增時段**」追加更多房間與時段
- 每段完整欄位：房號 / 入住退房時間 / 住宿方案 / 房價類型 / 金額
- 選入住時間後**退房時間自動帶出**（依方案計算）
- 金額加總即時顯示
- 送出時每段獨立檢查衝突，有衝突的跳過，其餘建立

### 預約管理
- 僅顯示**有效預約**（已取消不顯示）
- 點欄位標題**排序**（房號/旅客/入住時間/金額等）
- ✏️ 按鈕可修改預約（更換房間/時段，自動檢查衝突）

### 房間總覽
- 「下一筆預約」只顯示**未取消**的預約
- 即時房態：可入住 / 使用中 / 待清潔 / 清潔中 / 維修中

### 維修管理
- 可為房間建立**維修排程**（時間窗口 + 標題 + 備註）
- 新增預約時自動確認不與維修排程衝突

### 費率說明

| 日期類型 | 費率 |
|---------|------|
| 週五、週六、週日 | **假日費率** |
| 台灣國定假日當天 | **假日費率** |
| 國定假日前一天 | **假日費率** |
| 補班日（週六）| **假日費率** |
| 其餘 Mon~Thu | 平日費率 |

| 方案 | 平日 | 假日 |
|------|------|------|
| 12小時 | NT$800 | NT$1,000 |
| 24小時 | NT$1,000 | NT$1,200 |

---

## 常見問題

| 問題 | 解法 |
|------|------|
| install.bat 閃退 | 右鍵「以系統管理員身分執行」|
| pydantic-core 錯誤 | 確認 Python 版本是 **3.12** |
| 忘記 admin 密碼 | `python tools\reset_admin.py` |
| 清除所有資料 | 停止伺服器，刪除 `bini_blooms.db`，重啟 |
| 瀏覽器未自動開啟 | 手動輸入 http://127.0.0.1:8000 |

---

## 資料位置

```
<安裝路徑>\bini_blooms.db          ← 資料庫
<安裝路徑>\BINI_Blooms_Data\backup\  ← 本機備份
```

---

## 版本

```
v3.4.0 | FastAPI 0.111.0 | SQLite 3 | Python 3.12
```


---

## Dropbox OAuth2 設定說明（推薦）

### 為什麼需要 OAuth2？
Dropbox 的短效 Access Token 每 **4 小時**過期，需手動更新。OAuth2 模式使用 Refresh Token，系統自動更新，永不中斷。

### 取得 OAuth2 憑證步驟

**Step 1：建立 Dropbox App**
1. 前往 https://www.dropbox.com/developers/apps
2. 點「Create App」
3. 選擇：`Scoped Access` → `Full Dropbox`
4. 輸入 App 名稱（例如 `BiniBloomsBackup`）
5. 建立完成後，記下 **App Key** 和 **App Secret**

**Step 2：開啟必要權限**
在 App 的 Permissions 頁面，勾選：
- `files.content.write`
- `files.content.read`

**Step 3：取得 Refresh Token（一次性操作）**

在瀏覽器輸入以下 URL（替換 YOUR_APP_KEY）：
```
https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&token_access_type=offline&response_type=code
```
授權後會得到一個 **Authorization Code**（只能用一次）。

用 curl 或 PowerShell 換取 Refresh Token：
```powershell
# PowerShell
$body = "code=YOUR_AUTH_CODE&grant_type=authorization_code&client_id=YOUR_APP_KEY&client_secret=YOUR_APP_SECRET"
Invoke-RestMethod -Uri "https://api.dropboxapi.com/oauth2/token" -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"
```
回應中的 `refresh_token` 就是要填入系統的值。

**Step 4：填入系統**
1. 前往 BINI Blooms PMS → 雲端備份
2. 選擇「OAuth2（推薦，自動更新）」Tab
3. 填入 App Key、App Secret、Refresh Token
4. 填入遠端路徑（例如 `/BiniBloomsData`）
5. 點「儲存設定」→「測試連線」


---

## 延住計費規則（v3.5.0 修正）

退房超時的延住費用與「延住處理」分頁完全相同：

| 區間 | 時間 | 費率 | 最高上限 |
|------|------|------|---------|
| 第1段 | 0–12小時 | NT$200/hr | 平日 NT$800 / 假日 NT$1,000 |
| 第2段 | 12–24小時 | NT$200/hr | 平日 NT$200 / 假日 NT$200 |

---

## 超時退房流程（v3.5.0）

1. 服務人員點「確認退房」
2. 若有超時 → 彈出確認視窗：
   - 顯示超時分鐘數與系統計算費用
   - 可手動調整金額
   - 選「忘了退房」→ 費用歸零
   - 選「確認延住」→ 套用費用完成退房

---

## 退房提醒（v3.5.0）

- 退房時間前 **15 分鐘**，系統自動在頁面頂部顯示**紅色警告橫幅**
- 發出聲音提示
- 每 60 秒自動檢查
- 顯示房號、旅客姓名、剩餘時間

