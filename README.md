# Jira 甘特圖管理工具

Jira 整合甘特圖管理工具，以 Cloudflare Pages + Pages Functions + D1 建置。前端純
JavaScript（ES Modules，無需打包工具），後端以 TypeScript 撰寫的 Pages Functions
呼叫 Jira REST API。每位使用者在畫面上設定自己的 Jira 連線，Token 加密後存於 D1，永不傳回前端；
身分驗證交給 Cloudflare Access，甘特圖專案有擁有者與編輯者權限。

---

## 目錄

1. [技術架構](#技術架構)
2. [快速開始（本機開發）](#快速開始本機開發)
3. [環境變數設定](#環境變數設定)
4. [多人使用與權限](#多人使用與權限)
5. [D1 Migration 執行方式](#d1-migration-執行方式)
6. [Cloudflare 部署步驟](#cloudflare-部署步驟)
7. [Jira 連線設定](#jira-連線設定)
8. [休假日日曆匯入](#休假日日曆匯入)
9. [資料模型與同步邏輯說明](#資料模型與同步邏輯說明)
10. [功能對照表](#功能對照表)
11. [實際建立的檔案](#實際建立的檔案)
12. [完整使用方式](#完整使用方式)
13. [已知限制與建議強化事項](#已知限制與建議強化事項)

---

## 技術架構

| 項目 | 說明 |
|---|---|
| 前端 | 純 Vanilla JavaScript（ES Modules）＋ HTML/CSS，靜態檔案由 Cloudflare Pages 提供，不需要建置工具 |
| 後端 API | Cloudflare Pages Functions（`functions/api/**`），TypeScript，檔案路徑即路由 |
| 資料庫 | Cloudflare D1（SQLite），schema 見 `migrations/0001_init.sql` |
| 身分驗證 | Cloudflare Access（Zero Trust）。後端驗證 Access 簽發的 JWT 簽章與 `aud` 後才採信使用者 email，見 `functions/lib/auth.ts` |
| Jira 串接 | 後端專用的 `functions/lib/jira.ts`，以每位使用者自己的 email + API Token 走 Basic Auth 呼叫 Jira Cloud REST API v3（`/rest/api/3/search/jql`），前端完全不接觸憑證 |
| 憑證保護 | Jira Token 以 AES-GCM 加密後存入 D1（`functions/lib/crypto.ts`），金鑰放在 `ENCRYPTION_KEY` 環境變數 |
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

本機開發時，環境變數放在專案根目錄的 `.dev.vars`（已加入 `.gitignore`，不會被提交）：

```bash
cp .env.example .dev.vars
# 至少要填 ENCRYPTION_KEY；DEV_USER_EMAIL 決定本機要以哪個身分登入
```

Jira 帳密不寫在檔案裡 —— 開起網站後點右上角「🔌 Jira 連線」輸入即可。

> 已於本機驗證：`npm run db:migrate:local` 可成功建立 17 個 SQL 物件（含 68 筆政府假日種子
> 資料），`npm run dev` 可成功編譯並啟動，並以 curl 實際打過 `建立專案 → 加入手動項目 →
> 新增休假日並驗證工作日重算 → 建立/停用分享連結 → 匯出資料 → 刪除項目/專案` 全流程，
> 皆回傳預期結果，`tsc --noEmit` 對整個 `functions/` 後端型別檢查零錯誤。

---

## 環境變數設定

| 名稱 | 是否機密 | 必填 | 說明 |
|---|---|---|---|
| `ENCRYPTION_KEY` | **是** | 是 | 用來加密每位使用者的 Jira API Token（base64，32 bytes）。產生方式：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。**更換這個值會讓所有已儲存的 Token 失效**，所有人都得重新輸入一次。 |
| `CF_ACCESS_TEAM_DOMAIN` | 否 | 正式環境建議 | Cloudflare Zero Trust 團隊網域，例如 `yourteam.cloudflareaccess.com`。 |
| `CF_ACCESS_AUD` | 否 | 正式環境建議 | Access 應用程式的 Application Audience (AUD) 標籤。與上一項同時設定後，系統才會驗證登入身分。 |
| `DEV_USER_EMAIL` | 否 | 僅本機 | 沒有 Access 時要假裝成誰，只在本機開發用。 |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | 部分機密 | 否 | 選用的「共用備援連線」。只有還沒在畫面上設定自己 Jira 連線的人會用到；若希望每個人都自己連，就不要設定。 |

**Jira 帳密不再寫在程式或環境變數裡。** 每個人第一次使用時，點右上角「🔌 Jira 連線」填入自己的 Jira 網址、登入 email 與 API Token。Token 會以 AES-GCM 加密後存進 D1，API 永遠只回傳遮罩後的狀態，畫面上與資料庫裡都看不到原文。

正式環境設定：

```bash
npx wrangler pages secret put ENCRYPTION_KEY --project-name=jira-gantt
```

`CF_ACCESS_TEAM_DOMAIN` 與 `CF_ACCESS_AUD` 可以直接寫在 `wrangler.toml` 的 `[vars]`（它們不是機密）。本機開發則全部放在 `.dev.vars`（見 `.env.example`）。

---

## 多人使用與權限

**登入**：使用 Cloudflare Access（Zero Trust），不需要在程式裡寫任何登入邏輯。Access 會在每個請求帶上一組簽章過的 JWT，後端會向 Cloudflare 取公鑰驗證簽章、檢查 `aud` 與有效期限後才採信裡面的 email —— 只看 `Cf-Access-Authenticated-User-Email` 標頭是不安全的，任何直接打到來源站的人都能偽造。

設定步驟：

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted。
2. 網域填你的 Pages 網址，Policy 設定成只允許公司的 email 網域（或 Google Workspace / SSO）。
3. **重要**：再新增一個 Bypass 政策，Path 設為 `/share*` 與 `/api/share/*`，這樣分享連結才能給沒有帳號的人看。
4. 把應用程式的 Application Audience (AUD) 與團隊網域填進 `wrangler.toml` 的 `[vars]`，重新部署。

設定完成前，畫面上方會持續顯示黃色警告提醒你網站尚未受保護。

**權限規則**：

| 角色 | 誰 | 可以做什麼 |
|---|---|---|
| 擁有者 | 建立該甘特圖專案的人 | 全部操作，包含管理成員、刪除專案 |
| 編輯者 | 被擁有者加入的人 | 同步、排程、編輯分工、匯出、建立分享連結 |
| 檢視者 | 其他已登入的同事 | 只能檢視，所有編輯按鈕會停用 |

專案清單只會列出你擁有或被加入的專案。要共用時，擁有者點上方「👥 共用」輸入同事的公司 email 即可。升級前就存在、還沒有擁有者的舊專案，任何登入者都能編輯，第一個建立者可視需要再認領。

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

4. 設定加密金鑰（**必要**，沒有它無法儲存任何人的 Jira Token）：

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   npx wrangler pages secret put ENCRYPTION_KEY --project-name=jira-gantt
   ```

5. 對正式資料庫套用 migration：`npm run db:migrate:remote`。

6. 設定 Cloudflare Access 保護網站，並把 AUD 與團隊網域填進 `wrangler.toml`
   （步驟見「多人使用與權限」），然後重新 `npm run deploy`。**在這步完成前，任何知道網址的人
   都能開啟並修改資料**，畫面上方會持續顯示警告。

7. 之後每次更新程式碼，重跑 `npm run deploy` 即可（Pages 會建立新的部署並自動切換）。

---

## Jira 連線設定

每個人各自連自己的 Jira 帳號，不需要管理員代為設定：

1. 前往 <https://id.atlassian.com/manage-profile/security/api-tokens>，點 **Create API token**
   （不是 "with scopes" 那種），建立後立刻複製 —— 它只會顯示一次。
2. 回到本系統，點右上角「🔌 Jira 連線」，填入三個欄位：
   - **Jira 網址**：只到 `https://your-domain.atlassian.net` 為止，結尾不要斜線或路徑
   - **Jira 登入 Email**：產生 Token 的那個 Atlassian 帳號
   - **API Token**：剛剛複製的字串
3. 按「測試連線」確認成功（會顯示 Jira 回報的帳號名稱），再按「儲存」。
4. 之後畫面上方的 Project 下拉選單就會列出你有權限看到的 Jira 專案。

Token 儲存後就無法再從畫面讀回原文，只會顯示「已加密儲存」。要更換時直接輸入新的 Token 覆蓋，
或按「清除連線」移除。若你的 Jira 權限與同事不同，各自看到的專案清單也會不同 —— 這是刻意的設計，
同步動作永遠以執行者自己的 Jira 權限進行。

---

## 休假日日曆匯入

工作天數計算的規則，依優先順序：

1. 標記為**補班日**的日期一律算工作天（即使是週六、週日）
2. 週六、週日不算工作天
3. 休假日（政府公告或自訂）不算工作天

點「📅 休假日」可以上傳 CSV 批次匯入，支援兩種格式：

- **政府資料開放平臺「政府行政機關辦公日曆表」**（推薦）：欄位為 `西元日期,星期,是否放假,備註`，
  其中「是否放假」2 代表放假、0 代表上班。系統會自動把有名稱的放假日匯入為休假日、把落在週末
  但標記為上班的日期匯入為**補班日**；一般上班日與沒有名稱的普通週末會自動略過，不會灌爆資料表。
- **自製兩欄格式**：`日期,名稱`，例如 `2026-01-01,元旦`，全部視為休假日。

選好檔案後會先顯示預覽（新增幾筆、更新幾筆、其中幾天是補班日、略過幾筆），確認後再套用。
政府日曆是全站共用的，畫面上會顯示最後一次是誰、什麼時候匯入的。個別專案的特殊休假（例如公司
自己的活動日）則用下方「手動新增單一日期」，只影響該專案。

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
- `holidays`：`board_id IS NULL` 為全站共用的政府假日（已預先匯入 2026 / 2027 中華民國政府
  行政機關辦公日曆表假日，共 68 筆，可再用 CSV 覆蓋更新），`board_id` 有值則為該專案的自訂
  項目。`is_workday = 1` 代表**補班日**，該日即使落在週末也算工作天。
- `users`：每位使用者一列，以 Cloudflare Access 回報的 email 為主鍵，存放各自的 Jira 網址、
  登入 email 與**加密後**的 API Token（`jira_token_enc`），以及最後一次連線測試結果。
- `board_members`：專案的共同編輯者。擁有者記在 `boards.owner_email`。
- `holiday_imports`：政府日曆 CSV 的匯入紀錄（誰、什麼時候、新增與更新幾筆）。
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
| Jira 帳密不寫在原始碼 | 畫面上的「🔌 Jira 連線」設定頁，Token 以 AES-GCM 加密存入 `users.jira_token_enc`，API 只回傳遮罩狀態 |
| 多人使用 | Cloudflare Access 驗證身分（`functions/lib/auth.ts` 驗 JWT 簽章），專案分擁有者／編輯者／檢視者三種角色（`functions/lib/permissions.ts`） |
| 國定假日 CSV 上傳 | 「📅 休假日」的上傳區，支援政府辦公日曆表與兩欄格式，先預覽再套用（`functions/lib/holidayCsv.ts`） |
| 補班日 | `holidays.is_workday`，週末標記為上班的日期照樣計入工作天 |
| 假日不計入工時，色條斷開 | 色條依實際工作日切成多段，假日與週末留空並以細線連接（`workingRuns()` + `.bar-seg`） |
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
│   │   ├── types.ts             # 共用型別 / Env / AppError / 分工預設值
│   │   ├── auth.ts               # Cloudflare Access JWT 驗證（本機自動退回開發身分）
│   │   ├── crypto.ts              # Jira Token 的 AES-GCM 加解密
│   │   ├── permissions.ts         # 擁有者／編輯者／檢視者判定
│   │   ├── guard.ts               # 路由用的身分＋權限守衛
│   │   ├── jiraCreds.ts           # 解析「這次請求該用誰的 Jira 憑證」
│   │   ├── holidayCsv.ts          # 政府辦公日曆表 CSV 解析（含補班日）
│   │   ├── http.ts               # 回應／錯誤訊息輔助函式
│   │   ├── db.ts                  # 所有 D1 查詢（boards / jira_issues / gantt_items / holidays / sync_logs / share_links）
│   │   ├── jira.ts                # Jira REST API v3 client（專案/版本/搜尋/單筆查詢）
│   │   └── workdays.ts            # 工作日 / 結束日期計算（權威版本）
│   └── api/
│       ├── me.ts                               GET  /api/me（我是誰、是否受保護、Jira 是否已連線）
│       ├── settings/jira.ts                    GET/PUT/POST/DELETE /api/settings/jira（個人 Jira 連線、測試連線）
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
│       ├── boards/[id]/holidays/import.ts      POST /api/boards/:id/holidays/import（CSV 預覽／匯入）
│       ├── boards/[id]/members.ts              GET/POST/DELETE /api/boards/:id/members
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
            ├── tracks.js          # 分工顏色與排序輔助
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

1. **設定你的 Jira 連線**（每人第一次使用時做一次）：右上角「🔌 Jira 連線」→ 填 Jira 網址／
   登入 email／API Token →「測試連線」→「儲存」。詳見上方「Jira 連線設定」。
2. **建立甘特圖專案**：上方「＋ 新增專案」→ 輸入名稱。建立者即為擁有者。
3. **邀請同事**：點「👥 共用」輸入同事的公司 email 加為編輯者。沒有被加入的同事開啟時只能檢視，
   所有編輯按鈕會停用，名稱旁會標示「檢視者（唯讀）」。
4. **設定分工**：按「🏷️ 分工設定」調整這個專案會用到的分工（預設為前端／中台／PM測試），
   可新增、改名、刪除、調整順序與顏色。改名時已排好的項目會跟著更新，換色時該分工所有色條一起換。
5. **匯入國定假日**：按「📅 休假日」上傳政府辦公日曆表 CSV（可先預覽再套用），或手動新增
   單一休假日與補班日。詳見上方「休假日日曆匯入」。
6. **同步 Jira**：在「Project」選單選擇 Jira 專案 →「Version」選單選擇版本 → 按「同步 Jira」。
   第一次同步後，所有 issue 會進入「待排程需求」，不會自動排入甘特圖。
7. **排入甘特圖**：在待排程需求按單筆的「排程」（或勾選多筆後按「批次加入甘特圖」）→ 在對話框
   中勾選這張需求需要哪些分工，各自填開始日期、工作天數、負責人 → 確認。勾選第二個以後的分工時，
   開始日期會自動接在上一個分工結束的下一個工作日，可自行修改。
8. **調整排程**：直接拖曳時間軸上的分工色條改開始日，拖右緣改工作天數；或點該列的 ✏️ 開啟表單
   編輯（分工、負責人、日期、顏色、備註）。需求母列的「＋」可再補分工，🗑️ 會刪掉該需求底下所有
   分工。點母列左側的三角形可收合／展開。清單列可拖曳（⠿）排序：拖母列整張需求一起搬動，
   拖子列則調整分工順序。色條會在假日與週末處自動斷開，中間以細線連接，所以跨連假的項目一眼就
   看得出實際工作區間。
9. **再次同步**：「同步摘要」會顯示新增／更新／移出 Version／無變更的筆數。若有需求被移出或改到
   別的 Version，該需求母列會出現 ⚠ 標記，點下去可選擇保留、移至新 Version 或從甘特圖移除 ——
   已排定的日期、分工、負責人、備註、顏色永遠不會被同步覆蓋。
10. **分享**：「🔗 分享」建立唯讀連結（`/share?token=...`），對方不需要 Jira 帳號也不需要登入。
    記得在 Cloudflare Access 把 `/share*` 與 `/api/share/*` 設為 Bypass，否則外部人會被擋在登入頁。
11. **匯出**：「匯出 PNG」擷取目前甘特圖畫面；「匯出 Excel」輸出 issue key / Summary / 分工 /
    負責人 / 來源 / Status / Assignee / 開始日期 / 結束日期 / 工作天數 / 備註。

---

## 已知限制與建議強化事項

- **部署後務必設定 Cloudflare Access**。在 `CF_ACCESS_TEAM_DOMAIN` 與 `CF_ACCESS_AUD` 設定完成
  之前，系統會以單一開發身分運作，任何知道網址的人都能開啟並修改資料，畫面上方會持續顯示警告。
- `ENCRYPTION_KEY` 一旦更換，所有已儲存的 Jira Token 都會無法解密，每個人需要重新輸入一次。
  請把它當成正式密鑰保管，不要隨意輪替。
- Jira 搜尋使用 `fixVersion = <versionId>`；若同一張 issue 掛了多個 fixVersion，仍以「是否包含
  這次同步選擇的 Version」判斷去留。
- 專案內建 2026／2027 的政府假日種子資料，但正式上線前建議直接到政府資料開放平臺下載最新的
  辦公日曆表 CSV 匯入一次，之後每年更新也用同一個方式，不需要改程式。
- 拖曳排序（HTML5 Drag & Drop）在手機瀏覽器支援度較弱，因此手機上另外保留以表單編輯日期／
  天數／分工／負責人的方式，確保基本操作在手機上一定可用。
- 目前沒有變更歷程（誰在什麼時候改了哪一條排程）。系統已經知道每個請求是誰發出的，若之後需要，
  加一張 audit log 資料表即可。
