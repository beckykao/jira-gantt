# Jira 甘特圖管理工具

Jira 整合甘特圖管理工具，以 Cloudflare Pages + Pages Functions + D1 建置。前端純
JavaScript（ES Modules，無需打包工具），後端以 TypeScript 撰寫的 Pages Functions
呼叫 Jira REST API，所有 Jira 憑證只存在伺服器端環境變數，永不傳到前端。

---

## 目錄

1. [技術架構](#技術架構)
2. [快速開始（本機開發）](#快速開始本機開發)
3. [環境變數設定](#環境變數設定)
4. [D1 Migration 執行方式](#d1-migration-執行方式)
5. [Cloudflare 部署步驟](#cloudflare-部署步驟)
6. [Jira 串接設定](#jira-串接設定)
7. [資料模型與同步邏輯說明](#資料模型與同步邏輯說明)
8. [功能對照表](#功能對照表)
9. [實際建立的檔案](#實際建立的檔案)
10. [完整使用方式](#完整使用方式)
11. [已知限制與建議強化事項](#已知限制與建議強化事項)

---

## 技術架構

| 項目 | 說明 |
|---|---|
| 前端 | 純 Vanilla JavaScript（ES Modules）＋ HTML/CSS，靜態檔案由 Cloudflare Pages 提供，不需要建置工具 |
| 後端 API | Cloudflare Pages Functions（`functions/api/**`），TypeScript，檔案路徑即路由 |
| 資料庫 | Cloudflare D1（SQLite），schema 見 `migrations/0001_init.sql` |
| Jira 串接 | 後端專用的 `functions/lib/jira.ts`，以 Basic Auth（email + API Token）呼叫 Jira Cloud REST API v3，前端完全不接觸憑證 |
| PNG 匯出 | 前端使用 html2canvas（CDN）直接擷取甘特圖 DOM |
| Excel 匯出 | 前端使用 SheetJS / xlsx（CDN）由 `/api/boards/:id/export-data` 取得的資料組成 .xlsx |
| 分享頁 | `public/share.html` + 公開只讀 API `GET /api/share/:token`，不需登入、不含任何 Jira 憑證 |

**為什麼資料不會只存在 localStorage？** 所有甘特圖排程、Jira 快取資料、休假日、分享連結皆
寫入 D1；`localStorage` 只用來記住「上次選擇的專案」這種 UI 偏好，重新整理或換裝置後，實際
資料一律從 `/api/boards/:id` 重新取回。

---

## 快速開始（本機開發）

```bash
cd jira-gantt
npm install

# 1) 建立本機 D1 schema（僅需執行一次；之後有新的 migration 檔案時重跑即可）
npm run db:migrate:local

# 2) 啟動本機開發伺服器（讀取 wrangler.toml 的 D1 binding，網址預設 http://localhost:8788）
npm run dev
```

本機開發時，Jira 帳密請放在專案根目錄新增的 `.dev.vars`（已加入 `.gitignore`，不會被提交）：

```bash
cp .env.example .dev.vars
# 編輯 .dev.vars 填入你的 Jira 網址 / email / API token
```

> 已於本機驗證：`npm run db:migrate:local` 可成功建立 17 個 SQL 物件（含 68 筆政府假日種子
> 資料），`npm run dev` 可成功編譯並啟動，並以 curl 實際打過 `建立專案 → 加入手動項目 →
> 新增休假日並驗證工作日重算 → 建立/停用分享連結 → 匯出資料 → 刪除項目/專案` 全流程，
> 皆回傳預期結果，`tsc --noEmit` 對整個 `functions/` 後端型別檢查零錯誤。

---

## 環境變數設定

| 名稱 | 是否機密 | 說明 | 設定位置 |
|---|---|---|---|
| `JIRA_BASE_URL` | 否 | 你的 Jira Cloud 網址，例如 `https://your-domain.atlassian.net`（不要有結尾斜線） | `wrangler.toml` 的 `[vars]`（可直接提交，因為前端只會拿到這個值來組「開啟 Jira」連結） |
| `JIRA_EMAIL` | **是** | 用來產生 API Token 的 Atlassian 帳號 email | `wrangler pages secret put JIRA_EMAIL` |
| `JIRA_API_TOKEN` | **是** | Jira API Token（見下方「Jira 串接設定」） | `wrangler pages secret put JIRA_API_TOKEN` |

正式環境設定機密值：

```bash
npx wrangler pages secret put JIRA_EMAIL --project-name=jira-gantt
npx wrangler pages secret put JIRA_API_TOKEN --project-name=jira-gantt
```

本機開發則使用 `.dev.vars`（見上方「快速開始」）。`JIRA_EMAIL` / `JIRA_API_TOKEN` 只會在
Pages Functions（伺服器端）被讀取，`functions/api/config.ts` 是唯一回傳設定值給前端的
API，且只回傳 `JIRA_BASE_URL`。

---

## D1 Migration 執行方式

1. 建立正式的 D1 資料庫（僅需一次）：

   ```bash
   npm run db:create
   # 或：npx wrangler d1 create jira_gantt_db
   ```

   指令會印出一組 `database_id`，請貼到 `wrangler.toml` 的
   `[[d1_databases]] database_id = "..."` 欄位取代 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

2. 套用 migration 到本機模擬資料庫（開發用）：

   ```bash
   npm run db:migrate:local
   ```

3. 套用 migration 到正式（remote）資料庫：

   ```bash
   npm run db:migrate:remote
   ```

之後若新增欄位或資料表，請在 `migrations/` 新增一個新編號的檔案（例如
`0002_xxx.sql`），再重新執行上面兩個 migrate 指令即可；Wrangler 會自動只套用尚未執行過的
migration，不會重複執行。

---

## Cloudflare 部署步驟

1. 登入 Wrangler（僅需一次）：

   ```bash
   npx wrangler login
   ```

2. 建立 Pages 專案並完成第一次部署：

   ```bash
   npm run deploy
   # 等同於：wrangler pages deploy public --project-name=jira-gantt
   ```

   第一次執行時 Wrangler 會詢問是否要建立新的 Pages 專案，選擇建立即可。

3. 在 Cloudflare Dashboard（Pages 專案 → Settings → Functions → D1 database bindings，或
   直接在 `wrangler.toml` 設定後重新部署）綁定第 4 節建立的 D1 資料庫到 binding 名稱 `DB`。

4. 設定機密環境變數（見上一節「環境變數設定」）。

5. 對正式資料庫套用 migration：`npm run db:migrate:remote`。

6. 之後每次更新程式碼，重跑 `npm run deploy` 即可（Pages 會建立新的部署並自動切換）。

**建議的正式環境強化**：本專案本身的管理後台（建立/編輯甘特圖）沒有內建登入系統 —— 只有
「分享頁」被設計為完全公開唯讀。若要限制誰能使用管理介面，建議在 Cloudflare Zero Trust /
Access 為這個 Pages 網域加上一個 Access 原則（例如僅允許公司 Google Workspace 帳號登入），
不需要修改任何程式碼即可完成，且不會影響 `/share` 的公開分享頁（可把 `/share*` 路徑排除在
Access 原則之外）。

---

## Jira 串接設定

1. 前往 <https://id.atlassian.com/manage-profile/security/api-tokens>，建立一個新的 API
   Token（用登入 Jira 的同一個 Atlassian 帳號）。
2. 記下：
   - Jira 站台網址（例如 `https://your-domain.atlassian.net`）→ 設成 `JIRA_BASE_URL`
   - 該帳號的 email → 設成 `JIRA_EMAIL`
   - 剛剛建立的 API Token → 設成 `JIRA_API_TOKEN`
3. 確認這個帳號對要同步的 Jira 專案至少有「瀏覽專案（Browse Projects）」權限。
4. 依上方「環境變數設定」章節，把三個值分別設定好（`JIRA_BASE_URL` 在 `wrangler.toml`，
   另外兩個用 `wrangler pages secret put`／`.dev.vars`）。
5. 部署或重啟本機開發伺服器後，於畫面上方「Project」下拉選單即會列出這個帳號可見的 Jira 專案。

若 Token 失效或帳密錯誤，畫面會顯示「Jira 帳號或 API Token 無效，請確認後重新設定。」，而不是
原始的 401 錯誤內容。

---

## 資料模型與同步邏輯說明

### 資料表（`migrations/0001_init.sql`）

- `boards`：一個「甘特圖專案」，可選擇性綁定一個 Jira 專案。`track_presets` 欄位存放這個
  專案的分工清單（JSON，例如 `[{"name":"前端","color":"#3355EE"}, ...]`），可在畫面上
  新增／改名／刪除／排序／換色。
- `jira_issues`：Jira 資料快取，**以 `issue_key` 為唯一識別**（非 Summary），欄位包含
  `summary / status / assignee / issue_type / version_id / version_name /
  jira_updated_at / last_synced_at / sync_state（active｜removed）/
  moved_to_version_id / moved_to_version_name`。
- `gantt_items`：甘特圖排程資料，與 `jira_issues` 完全分離，欄位包含
  `issue_key（可為 null）/ source（jira｜manual）/ track（分工）/ owner（分工負責人）/
  start_date / work_days / end_date / note / color / sort_order`。**同步 Jira 只會寫入
  `jira_issues`，絕對不會更動 `gantt_items` 裡使用者自訂的排程欄位。**
  一張 Jira 需求可以有多列 `gantt_items`，以 `track` 區分（例如前端／中台／PM測試各一列，
  各自有開始日、工作天數與負責人）；同一張需求的同一個分工不會重複建立。
- `holidays`：`board_id IS NULL` 為全域政府假日（已預先匯入 2026 / 2027 中華民國政府行政
  機關辦公日曆表假日，共 68 筆），`board_id` 有值則為該專案的自訂休假日。
- `sync_logs`：每次同步的新增／更新／移出／無變更統計與狀態，供「同步摘要」與錯誤追蹤使用。
- `share_links`：分享（唯讀）連結的 token 清單，可個別停用。

### 同步演算法（`functions/lib/sync.ts`）

每次按下「同步 Jira」：

1. 以 JQL `project = "<key>" AND fixVersion = <versionId>` 向 Jira 取得目前這個 Version
   底下所有 issue（自動分頁）。
2. 與 D1 中「這個專案上一次同步後仍是 active 的 `jira_issues`」逐一比對（**不是整批刪除重
   建**）：
   - Jira 有、D1 也有 → 若任何欄位（Summary/Status/Assignee/Type/Version/更新時間）不同即
     `UPDATE`，否則只更新 `last_synced_at`（視為無變更）。這個階段**完全不觸碰**
     `gantt_items`，因此已排入甘特圖的項目其開始日期／工作天數／備註／顏色／排序全部保留。
   - Jira 有、D1 沒有 → `INSERT` 一筆新的 `jira_issues`（`sync_state='active'`），**不會**
     自動出現在正式甘特圖，而是進入「待排程需求」讓使用者手動或批次加入。
   - D1 有（active）、但這次 Jira 抓不到 → 個別用 `GET /issue/{key}` 二次確認：
     - 查不到（已刪除或無權限）→ 標記 `sync_state='removed'`。
     - 查得到但 fixVersions 已經是別的 Version → 標記 `sync_state='removed'` 並記錄
       `moved_to_version_name`，畫面上會顯示「此需求已移至 Version XXX」並提供
       移至新 Version／保留／從甘特圖移除三個選項。
     - 這兩種情況都**只更新 `jira_issues.sync_state`**，`gantt_items` 裡對應的排程列不會被
       刪除，畫面會顯示 ⚠ 警告 banner，由使用者決定保留或移除。
3. 寫入一筆 `sync_logs`（新增/更新/移出/無變更 各項計數），畫面上方的「同步摘要」直接呈現這
   筆紀錄。
4. 若同步過程中 Jira API 呼叫失敗（例如 Token 失效、Version 被刪除），會記錄一筆
   `status='failed'` 的 `sync_logs` 並回傳可讀的錯誤訊息給使用者，**不會**留下部分寫入卻沒
   有紀錄可查的狀態。

第一次同步時，即使該 Version 有 30 張 issue，也全部只會進入「待排程需求（30）」，不會自動
產生 30 條甘特圖排程 —— 必須由使用者手動「加入甘特圖」或「批次加入甘特圖」，加入當下才會要
求輸入開始日期／工作天數／備註。

---

## 功能對照表

| 需求 | 對應實作 |
|---|---|
| 建立甘特圖專案 / 手動新增工作項目 | 上方「＋ 新增專案」、面板內「＋ 新增項目」 |
| 開始日期 / 工作天數 / 自動計算結束日期 | `functions/lib/workdays.ts`（後端權威計算）＋ `public/assets/js/workdays.js`（前端即時預覽） |
| 政府公告休假日 + 自訂休假日 | `holidays` 資料表，2026/2027 已預先匯入，可於「📅 休假日」自行增刪自訂假日 |
| 甘特圖時間軸 / 拖曳調整排程 | `public/assets/js/gantt.js`：拖曳整條 bar 改開始日、拖右緣把手改工作天數（同時提供表單編輯，觸控裝置也可用） |
| 一張需求拆多個分工（前端／中台／PM測試） | `gantt_items.track`＋`owner`；甘特圖以「需求母列＋分工子列」呈現，母列顯示整體起訖的摘要條，子列各自有可拖曳的色塊 |
| 分工可自行增減 | 「🏷️ 分工設定」可新增／改名／刪除／排序／換色；改名會一併更新已排好的項目，換色會重刷該分工所有色塊；臨時用的分工也可在加入時直接手打 |
| 同一分工使用一致色系 | 顏色依分工別統一（前端一色、中台一色…），不在清單內的分工會依名稱得到固定的顏色；個別項目仍可單獨微調 |
| 備註 / 排序 | 表單「備註」欄位；清單可拖曳排序（HTML5 DnD），手機亦可透過編輯表單調整 |
| PNG 匯出 / Excel 匯出 | `public/assets/js/export.js`（html2canvas / SheetJS，皆在瀏覽器端執行） |
| 純預覽分享頁（不可編輯、不需登入） | `public/share.html` + `GET /api/share/:token`（`readOnly` 模式關閉所有互動與編輯按鈕） |
| Project → Version → 同步 Jira | 上方工具列，`functions/api/jira/*`、`functions/api/boards/[id]/sync.ts` |
| issue_key 唯一識別（非 Summary） | `jira_issues` 以 `(board_id, issue_key)` UNIQUE，改名只會 UPDATE 既有列 |
| Jira／甘特圖資料分離 | `jira_issues` vs `gantt_items` 兩張獨立資料表，只透過 `issue_key` 關聯 |
| 差異比對同步（非整批砍掉重建） | 見上方「同步演算法」 |
| 新增 issue → 進入待排程需求 | `listBacklog()`：active 且尚未有對應 `gantt_items` 的 issue |
| 移出 Version → 標記 removed，不刪除排程 | `markJiraIssueRemoved()`，畫面顯示 ⚠ 警告 + 保留／移除操作 |
| Summary 改名只更新名稱 | `updateJiraIssueFields()` 只寫 `jira_issues`，排程欄位不受影響 |
| Version 改變可選移至新 Version | `POST /api/boards/:id/issues/:issueKey/resolve`（`move`/`keep`/`remove`） |
| 待排程需求搜尋 / 篩選 / 單筆／批次加入 | `backlog-section` 面板：issue key／Summary 搜尋、Status／Assignee 篩選、checkbox 多選 |
| `[JIRA] KEY 標題`，issue key 可點擊開新分頁 | `gantt.js` 的 `itemDisplayTitle` / issue-key-pill 連結 |
| 錯誤處理（人類看得懂的訊息） | `functions/lib/http.ts` 的 `errorResponse()` 統一轉換為中文訊息，原始錯誤只寫入伺服器 log |

---

## 實際建立的檔案

```
jira-gantt/
├── README.md
├── package.json               # npm scripts：dev / deploy / typecheck / db:*
├── wrangler.toml               # Pages + D1 binding + JIRA_BASE_URL 設定
├── tsconfig.json
├── .gitignore
├── .env.example                 # 本機 .dev.vars 範本
├── migrations/
│   └── 0001_init.sql            # 全部資料表 + 2026/2027 政府假日種子資料
├── functions/                   # Pages Functions（後端 API，TypeScript）
│   ├── lib/
│   │   ├── types.ts             # 共用型別 / Env / AppError
│   │   ├── http.ts               # 回應／錯誤訊息輔助函式
│   │   ├── db.ts                  # 所有 D1 查詢（boards / jira_issues / gantt_items / holidays / sync_logs / share_links）
│   │   ├── jira.ts                # Jira REST API v3 client（專案/版本/搜尋/單筆查詢）
│   │   └── workdays.ts            # 工作日 / 結束日期計算（權威版本）
│   └── api/
│       ├── config.ts                          GET  /api/config
│       ├── jira/projects.ts                   GET  /api/jira/projects
│       ├── jira/[projectKey]/versions.ts       GET  /api/jira/:projectKey/versions
│       ├── boards/index.ts                     GET/POST /api/boards
│       ├── boards/[id]/index.ts                GET/PUT/DELETE /api/boards/:id
│       ├── boards/[id]/sync.ts                 GET/POST /api/boards/:id/sync
│       ├── boards/[id]/backlog.ts              GET  /api/boards/:id/backlog
│       ├── boards/[id]/items.ts                GET/POST /api/boards/:id/items
│       ├── boards/[id]/export-data.ts          GET  /api/boards/:id/export-data
│       ├── boards/[id]/holidays.ts             GET/POST /api/boards/:id/holidays
│       ├── boards/[id]/holidays/[holidayId].ts DELETE /api/boards/:id/holidays/:holidayId
│       ├── boards/[id]/issues/[issueKey]/resolve.ts POST /api/boards/:id/issues/:issueKey/resolve
│       ├── boards/[id]/share/index.ts          GET/POST /api/boards/:id/share
│       ├── boards/[id]/share/[linkId].ts       DELETE /api/boards/:id/share/:linkId
│       ├── items/[id].ts                       PUT/DELETE /api/items/:id
│       ├── items/reorder.ts                    POST /api/items/reorder
│       └── share/[token].ts                    GET  /api/share/:token（公開唯讀）
└── public/                       # Cloudflare Pages 靜態前端（無需 build）
    ├── index.html                # 管理後台主頁
    ├── share.html                # 公開唯讀分享頁
    └── assets/
        ├── css/style.css
        └── js/
            ├── api.js             # fetch 包裝
            ├── workdays.js        # 前端工作日計算（即時預覽用）
            ├── toast.js           # 提示訊息
            ├── gantt.js            # 甘特圖清單＋時間軸渲染、拖曳/縮放/排序
            ├── modals.js           # 新增專案／編輯項目／批次加入／休假日／分享 等對話框
            ├── export.js           # PNG / Excel 匯出
            ├── app.js               # 主應用程式邏輯（狀態管理、事件綁定、API 串接）
            └── share.js             # 分享頁邏輯
```

---

## 完整使用方式

1. **建立第一個甘特圖專案**：開啟網站 → 上方「＋ 新增專案」→ 輸入名稱。
2. **串接 Jira**：在「Project」選單選擇 Jira 專案 → 「Version」選單選擇版本 →
   按「🔄 同步 Jira」。第一次同步後，所有 issue 會出現在「待排程需求」，不會自動排入甘特圖。
3. **設定分工**：按「🏷️ 分工設定」調整這個專案會用到的分工（預設為前端／中台／PM測試），
   可以新增、改名、刪除、調整順序與顏色。之後隨時可以再改，改名時已排好的項目會跟著更新。
4. **排入甘特圖**：在待排程需求表格按單筆的「排程」（或勾選多筆後按「批次加入甘特圖」）→
   在對話框中勾選這張需求需要哪些分工，各自填開始日期、工作天數、負責人 → 確認。
   勾選第二個以後的分工時，開始日期會自動接在上一個分工結束的下一個工作日，可自行改。
5. **調整排程**：在甘特圖時間軸直接拖曳分工色塊改開始日，拖右緣改工作天數；或點該列的 ✏️
   開啟表單編輯（分工、負責人、日期、顏色、備註）。需求母列的「＋」可再補上新的分工，
   🗑️ 則會刪掉這張需求底下所有分工。點母列左側的三角形可收合／展開分工，需求多時很有用。
   清單列可拖曳（⠿ 圖示）調整排序：拖母列會整張需求一起搬動，拖子列則是調整分工順序。
6. **再次同步**：之後每次按「同步 Jira」，畫面上方「同步摘要」會顯示這次新增／更新／移出
   Version／無變更的筆數；若有需求被移出 Version 或改到別的 Version，該需求母列會出現 ⚠
   標記，點下去可選擇保留、移至新 Version 或從甘特圖移除 —— 已排定的日期、分工、負責人、
   備註、顏色永遠不會被同步覆蓋。
7. **休假日設定**：「📅 休假日」可檢視政府公告假日（唯讀）並新增/刪除該專案的自訂休假日；
   工作天數計算會自動排除週六日、政府假日與自訂假日。
8. **分享**：「🔗 分享」建立一個唯讀連結（`/share?token=...`），可直接傳給不需要登入
   Jira 帳號的人檢視；可隨時停用連結。
9. **匯出**：「匯出 PNG」直接擷取目前甘特圖畫面；「匯出 Excel」輸出 issue key / Summary /
   分工 / 負責人 / 來源 / Status / Assignee / 開始日期 / 結束日期 / 工作天數 / 備註 欄位。

---

## 已知限制與建議強化事項

- 管理後台目前沒有內建登入系統（分享頁本來就設計成不需登入）；正式環境建議用 Cloudflare
  Access 保護整個網域（見「Cloudflare 部署步驟」）。
- Jira 搜尋使用 `fixVersion = <versionId>`，若同一個 issue 掛了多個 fixVersion，仍以「是否
  包含這次同步選擇的 Version」判斷去留。
- 2026 / 2027 政府假日資料是依公開行事曆彙整後手動輸入，正式上線前建議對照
  <https://www.dgpa.gov.tw> 公告的最新辦公日曆表核對一次；日後年度的假日可直接在畫面上
  以「自訂休假日」補齊，或再新增一個 migration 檔案批次匯入。
- 拖曳排序（HTML5 Drag & Drop）在手機瀏覽器支援度較弱，因此手機上另外保留了以表單編輯
  日期／天數／備註的方式，確保基本操作在手機上一定可用。
