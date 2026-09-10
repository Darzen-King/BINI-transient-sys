# 手機執行介面規格

## 設計原則

- Mobile-first：核心寬度從 320px 起可用，不把桌面表格等比例縮小。
- 常用操作在拇指可及區：底部五分頁為「今日、預約、房務、款項、更多」。
- 所有主要觸控目標至少 44px，支援 safe-area、reduced motion 與窄螢幕無水平捲動。
- 房態同時用文字、色彩與左側色條辨識，避免只依賴顏色。
- 離線或送出未完成時，必須顯示待同步數量、狀態與可開啟的 bottom sheet。

## 資訊架構

- 今日：入住／退房／清潔摘要、三個快捷操作、房態卡、時間排序待辦。
- 預約：新增預約、搜尋、預約卡片；詳細編輯使用全螢幕流程，不使用寬表格。
- 房務：優先房間、清潔狀態、維修提醒。
- 款項：今日收款、待收款警示、新增款項。
- 更多：房間、維修、報表、設定、使用者等低頻功能；不出現單機版「雲端備份」。
- 裝置與帳號：admin 專用；以手機卡片／bottom sheet 取代桌面寬表格，可新增、啟停、選角色、勾選功能與重設密碼。
- 登入：沒有註冊連結；首次使用依序完成 email 驗證與 TOTP MFA 設定。

## 響應式行為

- `< 768px`：兩欄房態卡、固定底部導覽、bottom sheet。
- `768–1099px`：內容置中、三欄房態卡。
- `>= 1100px`：桌面側欄、四欄房態卡；沿用同一 view state 與元件，不複製業務邏輯。

## 目前完成與限制

- 已完成 React UI shell、真實 Firebase 登入／TOTP MFA 流程、admin 帳號設定、PWA manifest/service worker、響應式 CSS 與基本可及性標籤。
- 已以實際窄螢幕瀏覽器檢查；document scroll width 等於 viewport，無水平溢位。
- 營運畫面資料目前仍是明確的展示資料，快捷操作只開啟 foundation 提示；Identity 已接 Auth/Firestore/Functions，但 PMS domain 與 IndexedDB 尚未接入。
- 真實表單必須在各 domain operation contract 完成後逐一接入，禁止先讓手機直接寫權威 collection。
