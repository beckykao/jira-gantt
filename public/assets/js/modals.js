// Dialogs used by app.js. Plain DOM, no framework.

import { escapeHtml } from './gantt.js';
import { calcEndDate, nextWorkingDay, toIso } from './workdays.js';
import { TRACK_COLOR_CHOICES, trackColor } from './tracks.js';

const PALETTE = ['#4C6EF5', '#12B886', '#F59F00', '#E64980', '#7048E8', '#15AABF', '#FA5252', '#495057', '#2F9E44', '#1971C2'];

function openOverlay(innerHtml, { wide = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal${wide ? ' modal-wide' : ''}">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
  return overlay;
}

function showError(overlay, message) {
  const el = overlay.querySelector('.modal-error');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

function todayIso() {
  return toIso(new Date());
}

// ---------------------------------------------------------------------------
export function openCreateBoardModal({ onCreate }) {
  const overlay = openOverlay(`
    <h3>新增甘特圖專案</h3>
    <div class="form-row">
      <label>專案名稱</label>
      <input class="input" id="m-board-name" placeholder="例如：App 登入頁改版" />
    </div>
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="m-board-submit">建立</button>
    </div>
  `);
  const nameInput = overlay.querySelector('#m-board-name');
  nameInput.focus();
  overlay.querySelector('#m-board-submit').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return showError(overlay, '請輸入專案名稱。');
    try {
      await onCreate(name);
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
}

// ---------------------------------------------------------------------------
/**
 * The multi-track scheduling dialog — used when adding one issue, adding a
 * batch of issues, or adding extra tracks to an issue that's already on the
 * chart. Tick the tracks that apply and give each its own dates, work days
 * and owner.
 */
export function openTrackScheduleModal({
  heading,
  subtitle,
  presets,
  calendar,
  disabledTracks = [],
  submitLabel = '加入甘特圖',
  onSave,
}) {
  const rows = presets.map((p) => ({ ...p, custom: false }));

  const overlay = openOverlay(
    `
    <h3>${escapeHtml(heading)}</h3>
    ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
    <div class="track-table">
      <div class="track-table-head">
        <span class="col-check"></span>
        <span class="col-track">分工</span>
        <span class="col-date">開始日期</span>
        <span class="col-days">工作天</span>
        <span class="col-owner">負責人</span>
      </div>
      <div id="m-track-rows"></div>
    </div>
    <div class="add-custom-track">
      <input class="input" id="m-custom-track" placeholder="其他分工名稱（例如：後端）" />
      <button class="btn btn-sm" id="m-add-custom">＋ 加一列</button>
    </div>
    <div class="form-row" style="margin-top:12px;">
      <label>備註（套用到本次新增的所有分工）</label>
      <textarea class="input" id="m-note" placeholder="選填"></textarea>
    </div>
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="m-submit">${escapeHtml(submitLabel)}</button>
    </div>
  `,
    { wide: true }
  );

  const rowsEl = overlay.querySelector('#m-track-rows');

  function renderRows() {
    rowsEl.innerHTML = rows
      .map((r, i) => {
        const disabled = disabledTracks.includes(r.name);
        return `
        <div class="track-row${disabled ? ' disabled' : ''}" data-i="${i}">
          <span class="col-check"><input type="checkbox" data-check="${i}" ${disabled ? 'disabled' : ''} /></span>
          <span class="col-track"><span class="track-chip" style="background:${escapeHtml(r.color)}">${escapeHtml(r.name)}</span>${disabled ? '<span class="tag-chip">已排</span>' : ''}</span>
          <span class="col-date"><input class="input" type="date" data-start="${i}" ${disabled ? 'disabled' : ''} /></span>
          <span class="col-days"><input class="input" type="number" min="1" value="1" data-days="${i}" ${disabled ? 'disabled' : ''} /></span>
          <span class="col-owner"><input class="input" data-owner="${i}" placeholder="選填" ${disabled ? 'disabled' : ''} /></span>
        </div>`;
      })
      .join('');
    wireRowEvents();
  }

  function wireRowEvents() {
    rowsEl.querySelectorAll('[data-check]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.check);
        const startInput = rowsEl.querySelector(`[data-start="${i}"]`);
        if (cb.checked && !startInput.value) {
          startInput.value = suggestedStartFor(i);
        }
      })
    );
  }

  /** Chain onto the previous ticked track so 前端 → 中台 → 測試 lines up by default. */
  function suggestedStartFor(index) {
    for (let i = index - 1; i >= 0; i--) {
      const cb = rowsEl.querySelector(`[data-check="${i}"]`);
      const start = rowsEl.querySelector(`[data-start="${i}"]`)?.value;
      const days = Number(rowsEl.querySelector(`[data-days="${i}"]`)?.value) || 0;
      if (cb?.checked && start && days > 0) {
        try {
          return nextWorkingDay(calcEndDate(start, days, calendar), calendar);
        } catch {
          return start;
        }
      }
    }
    return todayIso();
  }

  renderRows();

  overlay.querySelector('#m-add-custom').addEventListener('click', () => {
    const input = overlay.querySelector('#m-custom-track');
    const name = input.value.trim();
    if (!name) return;
    if (rows.some((r) => r.name === name)) return showError(overlay, `「${name}」已經在清單裡了。`);
    rows.push({ name, color: trackColor(presets, name), custom: true });
    input.value = '';
    renderRows();
  });

  overlay.querySelector('#m-submit').addEventListener('click', async () => {
    const selected = [];
    rows.forEach((r, i) => {
      const cb = rowsEl.querySelector(`[data-check="${i}"]`);
      if (!cb?.checked) return;
      selected.push({
        track: r.name,
        color: r.color,
        startDate: rowsEl.querySelector(`[data-start="${i}"]`).value,
        workDays: Number(rowsEl.querySelector(`[data-days="${i}"]`).value),
        owner: rowsEl.querySelector(`[data-owner="${i}"]`).value.trim(),
      });
    });

    if (!selected.length) return showError(overlay, '請至少勾選一個分工。');
    for (const s of selected) {
      if (!s.startDate) return showError(overlay, `「${s.track}」還沒設定開始日期。`);
      if (!s.workDays || s.workDays < 1) return showError(overlay, `「${s.track}」的工作天數需大於 0。`);
    }

    const note = overlay.querySelector('#m-note').value;
    const btn = overlay.querySelector('#m-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 處理中...';
    try {
      await onSave(selected.map((s) => ({ ...s, note })));
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
      btn.disabled = false;
      btn.textContent = submitLabel;
    }
  });
}

// ---------------------------------------------------------------------------
export function openItemEditModal({ mode, item, presets, defaultTitle, onSave, onDelete }) {
  const isManualNew = mode === 'create-manual';
  const title = item?.title || defaultTitle || '';
  const color = item?.color || PALETTE[0];

  const trackOptions = presets.map((p) => p.name);
  if (item?.track && !trackOptions.includes(item.track)) trackOptions.push(item.track);

  const overlay = openOverlay(`
    <h3>${isManualNew ? '新增手動項目' : '編輯項目'}</h3>
    ${
      isManualNew
        ? `<div class="form-row"><label>項目名稱</label><input class="input" id="m-title" value="${escapeHtml(title)}" placeholder="項目名稱" /></div>`
        : `<div class="form-row"><label>名稱</label><div class="input readonly-box">${escapeHtml(title)}</div></div>`
    }
    <div class="form-grid-2">
      <div class="form-row">
        <label>分工</label>
        <input class="input" id="m-track" list="m-track-list" value="${escapeHtml(item?.track || '')}" placeholder="選填，例如：前端" />
        <datalist id="m-track-list">${trackOptions.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-row"><label>負責人</label><input class="input" id="m-owner" value="${escapeHtml(item?.owner || '')}" placeholder="選填" /></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>開始日期</label><input class="input" type="date" id="m-start" value="${escapeHtml(item?.start_date || '')}" /></div>
      <div class="form-row"><label>工作天數</label><input class="input" type="number" min="1" id="m-workdays" value="${item?.work_days || 1}" /></div>
    </div>
    ${isManualNew ? `<div class="form-row"><label>群組（同群組的手動項目會收在同一列底下）</label><input class="input" id="m-group" value="${escapeHtml(item?.group_name || '')}" placeholder="選填" /></div>` : ''}
    <div class="form-row">
      <label>顏色</label>
      <div class="color-swatches" id="m-colors">
        ${PALETTE.map((c) => `<div class="color-swatch${c === color ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
      <div class="field-hint">預設會跟著分工別的顏色走，這裡可以單獨調整這一條。</div>
    </div>
    <div class="form-row"><label>備註</label><textarea class="input" id="m-note" placeholder="備註...">${escapeHtml(item?.note || '')}</textarea></div>
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      ${!isManualNew ? `<button class="btn btn-danger" id="m-item-delete" style="margin-right:auto;">刪除</button>` : ''}
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="m-item-submit">儲存</button>
    </div>
  `);

  let selectedColor = color;
  overlay.querySelectorAll('.color-swatch').forEach((sw) =>
    sw.addEventListener('click', () => {
      overlay.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    })
  );

  overlay.querySelector('#m-item-delete')?.addEventListener('click', async () => {
    if (!confirm('確定要刪除這一條排程嗎？此動作無法復原。')) return;
    try {
      await onDelete();
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });

  overlay.querySelector('#m-item-submit').addEventListener('click', async () => {
    const startVal = overlay.querySelector('#m-start').value;
    const workDaysVal = Number(overlay.querySelector('#m-workdays').value);
    const titleVal = isManualNew ? overlay.querySelector('#m-title').value.trim() : title;
    if (isManualNew && !titleVal) return showError(overlay, '請輸入項目名稱。');
    if (!startVal) return showError(overlay, '請選擇開始日期。');
    if (!workDaysVal || workDaysVal < 1) return showError(overlay, '工作天數需為大於 0 的整數。');

    try {
      await onSave({
        title: titleVal,
        track: overlay.querySelector('#m-track').value.trim() || null,
        owner: overlay.querySelector('#m-owner').value.trim() || null,
        groupName: isManualNew ? overlay.querySelector('#m-group')?.value.trim() || null : undefined,
        startDate: startVal,
        workDays: workDaysVal,
        note: overlay.querySelector('#m-note').value,
        color: selectedColor,
      });
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
}

// ---------------------------------------------------------------------------
/** Add / rename / delete / reorder / recolour the board's work tracks. */
export function openTrackSettingsModal({ presets, onSave }) {
  const rows = presets.map((p) => ({ name: p.name, color: p.color, previousName: p.name }));

  const overlay = openOverlay(
    `
    <h3>分工設定</h3>
    <p class="modal-subtitle">這裡調整的分工會出現在「加入甘特圖」的勾選清單。改名時，已經排好的項目會一起更新；換顏色時，該分工的所有色塊會一起換。</p>
    <div id="m-track-settings"></div>
    <button class="btn btn-sm" id="m-add-track" style="margin-top:8px;">＋ 新增分工</button>
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="m-save-tracks">儲存</button>
    </div>
  `,
    { wide: true }
  );

  const listEl = overlay.querySelector('#m-track-settings');

  function render() {
    listEl.innerHTML = rows
      .map(
        (r, i) => `
      <div class="track-setting-row" data-i="${i}">
        <input class="input" data-name="${i}" value="${escapeHtml(r.name)}" placeholder="分工名稱" />
        <div class="color-swatches">
          ${TRACK_COLOR_CHOICES.map(
            (c) => `<div class="color-swatch${c === r.color ? ' selected' : ''}" data-color="${c}" data-row="${i}" style="background:${c}"></div>`
          ).join('')}
        </div>
        <div class="track-setting-actions">
          <button class="btn btn-icon btn-ghost" data-up="${i}" title="上移">↑</button>
          <button class="btn btn-icon btn-ghost" data-down="${i}" title="下移">↓</button>
          <button class="btn btn-icon btn-ghost" data-del="${i}" title="刪除">🗑️</button>
        </div>
      </div>`
      )
      .join('');

    listEl.querySelectorAll('[data-name]').forEach((inp) =>
      inp.addEventListener('input', () => {
        rows[Number(inp.dataset.name)].name = inp.value;
      })
    );
    listEl.querySelectorAll('.color-swatch').forEach((sw) =>
      sw.addEventListener('click', () => {
        rows[Number(sw.dataset.row)].color = sw.dataset.color;
        render();
      })
    );
    listEl.querySelectorAll('[data-up]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.up);
        if (i === 0) return;
        [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        render();
      })
    );
    listEl.querySelectorAll('[data-down]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.down);
        if (i >= rows.length - 1) return;
        [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
        render();
      })
    );
    listEl.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.del);
        if (!confirm(`要把「${rows[i].name}」從分工清單移除嗎？\n（已經排在甘特圖上的項目不會被刪除，只是之後不會出現在勾選清單。）`)) return;
        rows.splice(i, 1);
        render();
      })
    );
  }

  render();

  overlay.querySelector('#m-add-track').addEventListener('click', () => {
    rows.push({ name: '', color: TRACK_COLOR_CHOICES[rows.length % TRACK_COLOR_CHOICES.length] });
    render();
    listEl.querySelector(`[data-name="${rows.length - 1}"]`)?.focus();
  });

  overlay.querySelector('#m-save-tracks').addEventListener('click', async () => {
    const cleaned = rows.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name);
    if (!cleaned.length) return showError(overlay, '至少要保留一個分工。');
    const names = cleaned.map((r) => r.name);
    if (new Set(names).size !== names.length) return showError(overlay, '分工名稱不能重複。');
    try {
      await onSave(cleaned);
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
}

// ---------------------------------------------------------------------------
/** The ⚠ prompt for an issue that left its Jira Version. */
export function openIssueResolveModal({ issueKey, movedToVersion, onResolve }) {
  const overlay = openOverlay(`
    <h3>⚠ ${escapeHtml(issueKey)}</h3>
    <p class="modal-subtitle">${
      movedToVersion
        ? `這張需求已移至 Version「${escapeHtml(movedToVersion)}」。`
        : '這張需求已經不在目前同步的 Jira Version 裡了。'
    }已排好的日期、備註不會被自動更動，請選擇要怎麼處理：</p>
    <div class="resolve-options">
      ${
        movedToVersion
          ? `<button class="btn resolve-btn" data-act="move"><strong>移至新 Version</strong><span>把這張需求改掛在「${escapeHtml(movedToVersion)}」底下，排程完整保留。</span></button>`
          : ''
      }
      <button class="btn resolve-btn" data-act="keep"><strong>保留目前排程</strong><span>維持現狀，只是把警告標記記下來，之後同步仍會再次提醒。</span></button>
      <button class="btn resolve-btn danger" data-act="remove"><strong>從甘特圖移除</strong><span>刪掉這張需求的所有分工排程（Jira 本身不受影響）。</span></button>
    </div>
    <div class="modal-error" hidden></div>
    <div class="modal-actions"><button class="btn" data-close>取消</button></div>
  `);

  overlay.querySelectorAll('.resolve-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await onResolve(btn.dataset.act);
        overlay.remove();
      } catch (err) {
        showError(overlay, err.message);
      }
    })
  );
}

// ---------------------------------------------------------------------------
/** Each person's own Jira connection. The token never comes back from the API. */
export function openJiraSettingsModal({ status, onSave, onTest, onClear }) {
  const overlay = openOverlay(`
    <h3>Jira 連線設定</h3>
    <p class="modal-subtitle">這是<strong>你個人</strong>的 Jira 連線，只會用在你自己的同步操作上。Token 會加密後儲存，任何人（包含你自己）都無法再從畫面上讀回原文。</p>
    <div class="form-row">
      <label>Jira 網址</label>
      <input class="input" id="m-jira-url" value="${escapeHtml(status.baseUrl || '')}" placeholder="https://your-domain.atlassian.net" ${status.locked ? 'readonly' : ''} />
      <div class="field-hint">${status.locked ? '公司的 Jira 站台，無法修改。' : '只要到 .atlassian.net 為止，結尾不要加斜線或路徑。'}</div>
    </div>
    <div class="form-row">
      <label>Jira 登入 Email</label>
      <input class="input" id="m-jira-email" value="${escapeHtml(status.jiraEmail || '')}" placeholder="you@company.com" ${status.locked ? 'readonly' : ''} />
      ${status.locked ? '<div class="field-hint">就是你登入用的帳號。要換帳號，請先登出再用另一個帳號登入。</div>' : ''}
    </div>
    <div class="form-row">
      <label>API Token</label>
      <input class="input" id="m-jira-token" type="password" placeholder="${
        status.tokenSet ? '已儲存，留空表示不修改' : '貼上你的 API Token'
      }" />
      <div class="field-hint">到 id.atlassian.com → Security → Create API token 產生，建立後只會顯示一次。${status.locked ? 'Token 過期或換新時，貼上新的再按儲存即可。' : ''}</div>
    </div>
    ${
      status.lastCheckedAt
        ? `<p class="field-hint">上次測試：${new Date(status.lastCheckedAt).toLocaleString('zh-TW', { hour12: false })}　${
            status.lastCheckOk ? '✅ 成功' : '❌ 失敗'
          }</p>`
        : ''
    }
    ${
      status.usingSharedFallback
        ? '<p class="field-hint">目前你沒有自己的設定，系統暫時使用部署時設定的共用連線。填入上面欄位後就會改用你自己的。</p>'
        : ''
    }
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      ${status.tokenSet ? `<button class="btn btn-danger" id="m-jira-clear" style="margin-right:auto;">${status.locked ? '清除 Token 並登出' : '清除連線'}</button>` : ''}
      <button class="btn" id="m-jira-test">測試連線</button>
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="m-jira-save">儲存</button>
    </div>
  `);

  const read = () => ({
    baseUrl: overlay.querySelector('#m-jira-url').value.trim(),
    jiraEmail: overlay.querySelector('#m-jira-email').value.trim(),
    token: overlay.querySelector('#m-jira-token').value.trim(),
  });

  overlay.querySelector('#m-jira-save').addEventListener('click', async () => {
    try {
      await onSave(read());
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });

  overlay.querySelector('#m-jira-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 測試中...';
    try {
      const res = await onTest(read());
      showError(overlay, '');
      const box = overlay.querySelector('.modal-error');
      box.hidden = false;
      box.style.color = 'var(--color-success)';
      box.textContent = `連線成功，Jira 帳號：${res.displayName || '（未提供名稱）'}`;
    } catch (err) {
      const box = overlay.querySelector('.modal-error');
      box.style.color = '';
      showError(overlay, err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '測試連線';
    }
  });

  overlay.querySelector('#m-jira-clear')?.addEventListener('click', async () => {
    const msg = status.locked
      ? '確定要清除已儲存的 Jira Token 嗎？清除後會登出所有裝置，下次需要重新輸入 Token 登入。'
      : '確定要清除已儲存的 Jira 連線嗎？之後同步前需要重新設定。';
    if (!confirm(msg)) return;
    try {
      await onClear();
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
}

// ---------------------------------------------------------------------------
/** Who can edit this board. Owner-only controls. */
export function openMembersModal({ board, owner, members, myRole, onAdd, onRemove, onTransfer }) {
  const isOwner = myRole === 'owner';
  const overlay = openOverlay(`
    <h3>共用設定</h3>
    <p class="modal-subtitle">「${escapeHtml(board.name)}」的擁有者是 <strong>${escapeHtml(owner || '（未指定）')}</strong>。
    其他登入的同事預設只能檢視；加為編輯者後才能調整排程與同步。</p>
    <div class="form-row">
      <label>目前成員（${members.length}）</label>
      <div class="table-scroll" style="max-height:200px;">
        <table class="data-table"><tbody>
          ${
            members
              .map(
                (m) =>
                  `<tr><td>${escapeHtml(m.email)}</td><td><span class="badge badge-status">${
                    m.role === 'viewer' ? '檢視者' : '編輯者'
                  }</span></td>${
                    isOwner
                      ? `<td style="text-align:right;white-space:nowrap;"><button class="btn btn-sm" data-transfer="${escapeHtml(
                          m.email
                        )}" title="把擁有者身分交給這位成員">設為擁有者</button> <button class="btn btn-sm btn-danger" data-rm="${escapeHtml(m.email)}">移除</button></td>`
                      : '<td></td>'
                  }</tr>`
              )
              .join('') || `<tr><td colspan="3" style="color:var(--color-text-muted);">尚未加入其他人</td></tr>`
          }
        </tbody></table>
      </div>
    </div>
    ${
      isOwner
        ? `<div class="form-row">
             <label>加入同事</label>
             <div style="display:flex;gap:8px;">
               <input class="input" id="m-mem-email" placeholder="colleague@company.com" style="flex:1 1 auto;min-width:0;width:auto;" />
               <select id="m-mem-role" style="flex:0 0 auto;width:auto;"><option value="editor">編輯者</option><option value="viewer">檢視者</option></select>
               <button class="btn btn-primary btn-sm" id="m-mem-add" style="flex:0 0 auto;">加入</button>
             </div>
             <div class="field-hint">請填他們登入本系統時使用的公司 email。</div>
           </div>
           <p class="field-hint">要交接專案時，在成員旁按「設為擁有者」。轉移後你會變成編輯者，加減成員和刪除專案就改由對方負責。</p>`
        : '<p class="field-hint">只有擁有者可以調整成員。</p>'
    }
    <div class="modal-error" hidden></div>
    <div class="modal-actions"><button class="btn" data-close>關閉</button></div>
  `);

  overlay.querySelector('#m-mem-add')?.addEventListener('click', async () => {
    const email = overlay.querySelector('#m-mem-email').value.trim();
    if (!email) return showError(overlay, '請輸入 email。');
    try {
      await onAdd(email, overlay.querySelector('#m-mem-role').value);
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
  overlay.querySelectorAll('[data-transfer]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const email = btn.dataset.transfer;
      if (
        !confirm(
          `確定要把「${board.name}」的擁有者轉移給 ${email} 嗎？\n\n轉移後你會變成編輯者，之後只有 ${email} 可以加減成員、轉移或刪除這個專案。`
        )
      )
        return;
      try {
        await onTransfer(email);
        overlay.remove();
      } catch (err) {
        showError(overlay, err.message);
      }
    })
  );
  overlay.querySelectorAll('[data-rm]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await onRemove(btn.dataset.rm);
        overlay.remove();
      } catch (err) {
        showError(overlay, err.message);
      }
    })
  );
}

// ---------------------------------------------------------------------------
export function openHolidayModal({ holidays, lastImport, canEdit, onAdd, onDelete, onImport }) {
  const gov = holidays.filter((h) => h.type === 'government');
  const custom = holidays.filter((h) => h.type === 'custom');
  const makeup = holidays.filter((h) => h.is_workday);

  const overlay = openOverlay(
    `
    <h3>休假日設定</h3>
    <p class="modal-subtitle">工作天數計算會跳過週六日與這裡列出的休假日；標記為「補班」的日期即使落在週末也算工作天。</p>

    ${
      canEdit
        ? `<div class="form-row">
             <label>匯入政府行政機關辦公日曆表 (CSV)</label>
             <div class="import-box">
               <input type="file" id="m-hol-file" accept=".csv,text/csv" />
               <div class="field-hint">可直接使用政府資料開放平臺的「政府行政機關辦公日曆表」CSV（西元日期／星期／是否放假／備註），或自製的「日期,名稱」兩欄格式。選檔後會先顯示預覽再決定是否套用。</div>
             </div>
             <div id="m-hol-preview"></div>
           </div>`
        : ''
    }
    ${
      lastImport
        ? `<p class="field-hint">最後一次匯入：${new Date(lastImport.imported_at).toLocaleString('zh-TW', {
            hour12: false,
          })}　by ${escapeHtml(lastImport.imported_by)}${
            lastImport.file_name ? `（${escapeHtml(lastImport.file_name)}）` : ''
          }</p>`
        : ''
    }

    ${
      canEdit
        ? `<div class="form-row">
             <label>手動新增單一日期</label>
             <div style="display:flex;gap:8px;flex-wrap:wrap;">
               <input class="input" type="date" id="m-hol-date" />
               <input class="input" id="m-hol-name" placeholder="名稱（選填）" style="flex:1;min-width:120px;" />
               <label class="checkbox-row"><input type="checkbox" id="m-hol-workday" /> 這天是補班日</label>
               <button class="btn btn-primary btn-sm" id="m-hol-add">新增</button>
             </div>
           </div>`
        : ''
    }
    <div class="modal-error" hidden></div>

    <div class="form-row">
      <label>本專案自訂（${custom.length}）　補班日共 ${makeup.length} 天</label>
      <div class="table-scroll" style="max-height:150px;">
        <table class="data-table"><tbody>
          ${
            custom
              .map(
                (h) =>
                  `<tr><td>${h.date}</td><td>${escapeHtml(h.name)}</td><td>${
                    h.is_workday ? '<span class="badge badge-status">補班</span>' : ''
                  }</td>${
                    canEdit
                      ? `<td style="text-align:right;"><button class="btn btn-sm btn-danger" data-del="${h.id}">刪除</button></td>`
                      : '<td></td>'
                  }</tr>`
              )
              .join('') || `<tr><td colspan="4" style="color:var(--color-text-muted);">尚無自訂項目</td></tr>`
          }
        </tbody></table>
      </div>
    </div>

    <div class="form-row">
      <label>政府公告日曆（${gov.length}，全站共用）</label>
      <div class="table-scroll" style="max-height:170px;">
        <table class="data-table"><tbody>
          ${gov
            .map(
              (h) =>
                `<tr><td>${h.date}</td><td>${escapeHtml(h.name)}</td><td>${
                  h.is_workday ? '<span class="badge badge-status">補班</span>' : ''
                }</td></tr>`
            )
            .join('')}
        </tbody></table>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" data-close>關閉</button></div>
  `,
    { wide: true }
  );

  overlay.querySelector('#m-hol-add')?.addEventListener('click', async () => {
    const date = overlay.querySelector('#m-hol-date').value;
    if (!date) return showError(overlay, '請選擇日期。');
    try {
      await onAdd(
        date,
        overlay.querySelector('#m-hol-name').value.trim(),
        overlay.querySelector('#m-hol-workday').checked
      );
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });

  overlay.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await onDelete(Number(btn.dataset.del));
        overlay.remove();
      } catch (err) {
        showError(overlay, err.message);
      }
    })
  );

  const fileInput = overlay.querySelector('#m-hol-file');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const box = overlay.querySelector('#m-hol-preview');
    if (!file) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<div class="field-hint"><span class="spinner"></span> 讀取中…</div>';
    try {
      const text = await file.text();
      const { preview } = await onImport({ csv: text, fileName: file.name, apply: false });
      box.innerHTML = `
        <div class="import-preview">
          <div><strong>預覽</strong>　格式：${preview.format === 'dgpa' ? '政府辦公日曆表' : '日期,名稱'}　年度：${preview.years.join('、')}</div>
          <div class="import-stats">
            <span>新增 <strong>${preview.willAdd}</strong></span>
            <span>更新 <strong>${preview.willUpdate}</strong></span>
            <span>休假日 <strong>${preview.holidays}</strong></span>
            <span>補班日 <strong>${preview.workdays}</strong></span>
            <span class="muted">略過 ${preview.skipped}（一般上班日與純週末）</span>
          </div>
          <div class="import-sample">${preview.sample
            .map((s) => `${s.date} ${escapeHtml(s.name)}${s.isWorkday ? '（補班）' : ''}`)
            .join('　/　')}…</div>
          <button class="btn btn-primary btn-sm" id="m-hol-apply">套用這份日曆</button>
        </div>`;
      box.querySelector('#m-hol-apply').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.innerHTML = '<span class="spinner"></span> 匯入中…';
        try {
          await onImport({ csv: text, fileName: file.name, apply: true });
          overlay.remove();
        } catch (err) {
          showError(overlay, err.message);
        }
      });
    } catch (err) {
      box.innerHTML = '';
      showError(overlay, err.message);
    }
  });
}

// ---------------------------------------------------------------------------
export function openShareModal({ links, onCreate, onRevoke }) {
  const activeLinks = links.filter((l) => !l.revoked_at);
  const shareUrl = (token) => `${location.origin}/share?token=${token}`;
  const overlay = openOverlay(`
    <h3>分享（唯讀）連結</h3>
    <p class="modal-subtitle">任何取得連結的人都可以檢視此甘特圖，但無法編輯，也不需要登入。</p>
    <div>
      ${
        activeLinks
          .map(
            (l) => `
        <div class="form-row" style="display:flex;gap:8px;align-items:center;">
          <input class="input" readonly value="${shareUrl(l.id)}" style="flex:1;" />
          <button class="btn btn-sm" data-copy="${shareUrl(l.id)}">複製</button>
          <button class="btn btn-sm btn-danger" data-revoke="${l.id}">停用</button>
        </div>`
          )
          .join('') || `<p style="font-size:13px;color:var(--color-text-muted);">尚未建立分享連結。</p>`
      }
    </div>
    <div class="modal-error" hidden></div>
    <div class="modal-actions">
      <button class="btn" data-close>關閉</button>
      <button class="btn btn-primary" id="m-share-create">建立新的分享連結</button>
    </div>
  `);

  overlay.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = '已複製';
        setTimeout(() => (btn.textContent = '複製'), 1500);
      } catch {
        prompt('請手動複製連結：', btn.dataset.copy);
      }
    })
  );
  overlay.querySelectorAll('[data-revoke]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await onRevoke(btn.dataset.revoke);
        overlay.remove();
      } catch (err) {
        showError(overlay, err.message);
      }
    })
  );
  overlay.querySelector('#m-share-create').addEventListener('click', async () => {
    try {
      await onCreate();
      overlay.remove();
    } catch (err) {
      showError(overlay, err.message);
    }
  });
}
