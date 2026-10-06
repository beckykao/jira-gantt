// 「說明」dialog: how to use the tool + how sign-in works.
// Opened from the ❓ button next to the user name in the top-right corner.

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

function usageHtml() {
  return `
    <section>
      <h4>1. 建立甘特圖專案</h4>
      <ol>
        <li>點左上角「<b>＋ 新增專案</b>」，輸入專案名稱（例如「FTAPP 10月版」）。</li>
        <li>建立的人就是<b>擁有者</b>，之後可以用「👥 共用」邀請同事。</li>
      </ol>
    </section>
    <section>
      <h4>2. 從 Jira 抓需求</h4>
      <ol>
        <li>在第二排選擇 <b>Project</b> 和 <b>Version</b>，按「<b>🔄 同步 Jira</b>」。</li>
        <li>還沒排進甘特圖的需求會出現在「<b>待排程需求</b>」。</li>
        <li>按單筆的「<b>排程</b>」，或勾選多筆後按「<b>批次加入甘特圖</b>」，設定各分工的開始日與工作天數。</li>
        <li>之後再同步，只會更新 Jira 的標題、狀態、負責人，<b>不會動到你排好的日期</b>。</li>
      </ol>
    </section>
    <section>
      <h4>3. 調整甘特圖</h4>
      <ul>
        <li><b>拖曳色條</b>：整段往前或往後移。</li>
        <li><b>拖曳色條右端</b>：增減工作天數。</li>
        <li><b>✏️ 編輯</b>：改負責人、日期、天數、備註；<b>＋</b>：替需求新增分工；<b>🗑️</b>：刪除。</li>
        <li><b>⠿ 拖曳左側把手</b>：調整需求的上下順序；<b>▾</b>：收合／展開分工。</li>
        <li>週末、國定假日和自訂休假日會自動跳過，色條上的空隙就是不上班的日子。</li>
        <li>出現 <b>⚠</b> 表示需求已不在目前的 Jira Version，點它決定要保留、移走或刪除。</li>
      </ul>
    </section>
    <section>
      <h4>4. 設定</h4>
      <ul>
        <li><b>🏷️ 分工設定</b>：新增或改名分工（前端、中台、PM測試…）和顏色。</li>
        <li><b>📅 休假日</b>：匯入政府辦公日曆 CSV、加自訂休假日或補班日。</li>
      </ul>
    </section>
    <section>
      <h4>5. 共用與分享</h4>
      <ul>
        <li><b>👥 共用</b>：擁有者可以把同事加為<b>編輯者</b>（可修改）或<b>檢視者</b>（唯讀）。要交接時，在成員旁按「設為擁有者」。</li>
        <li><b>🔗 分享</b>：產生唯讀網址，對方<b>不用登入</b>就能看，可以隨時停用。</li>
        <li><b>匯出 PNG／Excel</b>：PNG 會輸出完整甘特圖；Excel 含色條甘特圖和明細兩個分頁。</li>
      </ul>
    </section>
    <section>
      <h4>權限一覽</h4>
      <table class="help-table">
        <thead><tr><th></th><th>擁有者</th><th>編輯者</th><th>檢視者</th></tr></thead>
        <tbody>
          <tr><td>看甘特圖、匯出</td><td>✅</td><td>✅</td><td>✅</td></tr>
          <tr><td>排程、同步、設定、分享連結</td><td>✅</td><td>✅</td><td>—</td></tr>
          <tr><td>加減成員、轉移、刪除專案</td><td>✅</td><td>—</td><td>—</td></tr>
        </tbody>
      </table>
    </section>`;
}

function loginHtml(days) {
  return `
    <ul>
      <li>每個人用<b>自己的 Jira email ＋ API Token</b> 登入，系統只用你的 Jira 權限讀取資料，不會用到別人的帳號。</li>
      <li>Token 會<b>加密保存</b>，任何人（包含管理員和你自己）都無法從畫面上看到原文。</li>
      <li>登入有效 <b>${days} 天</b>，到期後重新輸入 Token 即可。按右上角「登出」可以立即登出這台電腦。</li>
      <li>Token 過期或換新時：點「🔌 Jira 連線」貼上新的 Token 再按儲存，不用重新登入。</li>
      <li>要換成別的 Jira 帳號：先登出，再用另一個帳號登入。</li>
      <li>在「Jira 連線」按「清除 Token 並登出」，會同時登出你所有的裝置。</li>
      <li>API Token 在 <a href="${TOKEN_PAGE}" target="_blank" rel="noopener">Atlassian 帳號 → Security → API tokens</a> 建立，只會顯示一次。</li>
    </ul>
    <p class="help-note">甘特圖的排程資料存在本系統的資料庫，<b>不會回寫到 Jira</b>。</p>`;
}

export function openHelp({ sessionDays = 90, tab = 'usage' } = {}) {
  document.getElementById('help-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'help-overlay';
  overlay.innerHTML = `
    <div class="modal modal-wide help-modal" role="dialog" aria-label="說明">
      <div class="help-head">
        <h3>說明</h3>
        <button class="btn btn-sm btn-ghost" data-close aria-label="關閉">✕</button>
      </div>
      <div class="help-tabs" role="tablist">
        <button class="help-tab" data-tab="usage" role="tab">操作說明</button>
        <button class="help-tab" data-tab="login" role="tab">登入與帳號</button>
      </div>
      <div class="help-body" data-pane="usage">${usageHtml()}</div>
      <div class="help-body" data-pane="login">${loginHtml(sessionDays)}</div>
    </div>`;
  document.body.appendChild(overlay);

  const show = (name) => {
    overlay.querySelectorAll('.help-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    overlay.querySelectorAll('.help-body').forEach((p) => (p.hidden = p.dataset.pane !== name));
  };
  show(tab);

  overlay.querySelectorAll('.help-tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
