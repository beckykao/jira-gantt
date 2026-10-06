// Renders the Gantt list + timeline.
//
// Layout: one parent row per Jira issue (or per manual group), with each work
// track (分工) as an indented child row underneath. The parent shows a summary
// bar spanning the earliest start to the latest end of its tracks.
//
// Track bars are drawn as one segment per contiguous run of *working* days,
// so weekends, national holidays and custom days off appear as gaps — a bar
// crossing 中秋連假 no longer looks like nine days of work.
//
// Long titles wrap onto extra lines (how many depends on the screen width).
// Each timeline row is then resized to match its list row, so the left list
// and the right timeline always stay aligned. Notes stay as a tooltip.

import { addDaysIso, countWorkDays, formatDateShort, isWorkingDay, parseIso, toIso, workingRuns } from './workdays.js';
import { trackSortIndex } from './tracks.js';

const DAY_WIDTH = 32;
const PARENT_ROW_H = 48;
const CHILD_ROW_H = 38;
const HEADER_H = 45;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** Collapsed group keys survive re-renders (the whole view re-renders on save). */
const collapsedGroups = new Set();

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function daysBetween(aIso, bIso) {
  return Math.round((parseIso(bIso).getTime() - parseIso(aIso).getTime()) / 86400000);
}

function itemDisplayTitle(item) {
  if (item.source === 'jira') return item.jira_summary || item.title || item.issue_key;
  return item.title || '(未命名項目)';
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function buildGroups(items, presets) {
  const map = new Map();
  for (const item of items) {
    let key;
    if (item.issue_key) key = `jira:${item.issue_key}`;
    else if (item.group_name) key = `group:${item.group_name}`;
    else key = `solo:${item.id}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        issueKey: item.issue_key || null,
        source: item.source,
        title: itemDisplayTitle(item),
        groupName: item.group_name || null,
        items: [],
      });
    }
    map.get(key).items.push(item);
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.items.sort((a, b) => {
      const ti = trackSortIndex(presets, a.track) - trackSortIndex(presets, b.track);
      if (ti !== 0) return ti;
      return a.sort_order - b.sort_order;
    });
    g.minSort = Math.min(...g.items.map((i) => i.sort_order));
    g.startDate = g.items.reduce((min, i) => (i.start_date < min ? i.start_date : min), g.items[0].start_date);
    g.endDate = g.items.reduce((max, i) => (i.end_date > max ? i.end_date : max), g.items[0].end_date);
    const first = g.items[0];
    g.jiraStatus = first.jira_status;
    g.jiraAssignee = first.jira_assignee;
    g.jiraSyncState = first.jira_sync_state;
    g.jiraMovedTo = first.jira_moved_to_version_name;
    g.flat = g.items.length === 1 && !g.items[0].track;
  }
  groups.sort((a, b) => a.minSort - b.minSort);
  return groups;
}

function computeRange(groups) {
  const today = toIso(new Date());
  if (!groups.length) return { start: addDaysIso(today, -3), end: addDaysIso(today, 30) };
  let minStart = groups[0].startDate;
  let maxEnd = groups[0].endDate;
  for (const g of groups) {
    if (g.startDate < minStart) minStart = g.startDate;
    if (g.endDate > maxEnd) maxEnd = g.endDate;
  }
  return { start: addDaysIso(minStart, -4), end: addDaysIso(maxEnd, 8) };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderGantt(container, opts) {
  const { items, calendar, jiraBaseUrl, presets = [], readOnly = false } = opts;
  container._rowHeightObserver?.disconnect();
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓️</div>尚未有任何排程項目。${
      readOnly ? '' : '從下方「待排程需求」加入 Jira 需求，或按「新增項目」手動建立。'
    }</div>`;
    return;
  }

  const groups = buildGroups(items, presets);
  const { start: rangeStart, end: rangeEnd } = computeRange(groups);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;
  const todayIso = toIso(new Date());

  const wrap = document.createElement('div');
  wrap.className = 'gantt-wrap';

  const list = document.createElement('div');
  list.className = 'gantt-list';
  list.innerHTML = `<div class="gantt-list-header">項目 / 分工</div>`;
  const listBody = document.createElement('div');
  listBody.className = 'gantt-list-body';
  list.appendChild(listBody);

  const timeline = document.createElement('div');
  timeline.className = 'gantt-timeline';
  const inner = document.createElement('div');
  inner.className = 'gantt-timeline-inner';
  inner.style.width = `${totalDays * DAY_WIDTH}px`;
  inner.style.minWidth = '100%';

  const headerRow = document.createElement('div');
  headerRow.className = 'gantt-header-row';
  headerRow.style.height = `${HEADER_H}px`;
  for (let i = 0; i < totalDays; i++) {
    const iso = addDaysIso(rangeStart, i);
    const d = parseIso(iso);
    const col = document.createElement('div');
    col.className = dayColClass(iso, calendar, todayIso);
    const isFirstOfMonth = d.getUTCDate() === 1 || i === 0;
    col.innerHTML = `${isFirstOfMonth ? `<div class="month-label">${d.getUTCMonth() + 1}月</div>` : ''}<div>${d.getUTCDate()}</div><div class="dow">${WEEKDAY_LABELS[d.getUTCDay()]}</div>`;
    if (calendar.workdays.has(iso)) col.title = '補班日（照常上班）';
    headerRow.appendChild(col);
  }
  inner.appendChild(headerRow);

  const rowCtx = { totalDays, rangeStart, calendar, todayIso };

  for (const group of groups) {
    const collapsed = collapsedGroups.has(group.key);

    if (group.flat) {
      const item = group.items[0];
      listBody.appendChild(buildListRow({ kind: 'flat', group, item, jiraBaseUrl, readOnly }));
      inner.appendChild(buildTimelineRow({ ...rowCtx, height: PARENT_ROW_H, item, readOnly }));
      continue;
    }

    listBody.appendChild(buildListRow({ kind: 'parent', group, jiraBaseUrl, readOnly, collapsed }));
    inner.appendChild(buildTimelineRow({ ...rowCtx, height: PARENT_ROW_H, group, readOnly }));

    if (collapsed) continue;

    for (const item of group.items) {
      listBody.appendChild(buildListRow({ kind: 'child', group, item, readOnly }));
      inner.appendChild(buildTimelineRow({ ...rowCtx, height: CHILD_ROW_H, item, readOnly }));
    }
  }

  timeline.appendChild(inner);
  wrap.appendChild(list);
  wrap.appendChild(timeline);
  container.appendChild(wrap);

  syncRowHeights(container, listBody, inner);
  syncVerticalScroll(list, timeline);
  if (!readOnly) wireInteractions(container, { ...opts, groups, rangeStart });
}

function dayColClass(iso, calendar, todayIso) {
  const forcedWork = calendar.workdays.has(iso);
  const weekend = !forcedWork && [0, 6].includes(parseIso(iso).getUTCDay());
  const holiday = !forcedWork && calendar.holidays.has(iso);
  return (
    'gantt-day-col' +
    (weekend ? ' weekend' : '') +
    (holiday ? ' holiday' : '') +
    (forcedWork ? ' makeup' : '') +
    (iso === todayIso ? ' today' : '')
  );
}

function issueKeyTag(issueKey, jiraBaseUrl) {
  if (!issueKey) return '';
  if (!jiraBaseUrl) return `<span class="issue-key-pill">[JIRA] ${escapeHtml(issueKey)}</span>`;
  return `<a class="issue-key-pill" target="_blank" rel="noopener" href="${jiraBaseUrl}/browse/${encodeURIComponent(
    issueKey
  )}">[JIRA] ${escapeHtml(issueKey)}</a>`;
}

function buildListRow({ kind, group, item, jiraBaseUrl, readOnly, collapsed }) {
  const row = document.createElement('div');
  row.dataset.groupKey = group.key;
  row.style.minHeight = `${kind === 'child' ? CHILD_ROW_H : PARENT_ROW_H}px`;
  if (kind === 'child' || kind === 'flat') row.dataset.id = item.id;
  if (!readOnly) row.draggable = true;

  if (kind === 'child') {
    row.className = 'gantt-list-row child-row';
    row.innerHTML = `
      <span class="child-indent"></span>
      <span class="track-chip" style="background:${escapeHtml(item.color)}">${escapeHtml(item.track || '未分類')}</span>
      <div class="item-main">
        <div class="child-line">
          ${item.owner ? `<span class="owner-name">${escapeHtml(item.owner)}</span>` : ''}
          <span class="date-range">${formatDateShort(item.start_date)}–${formatDateShort(item.end_date)}（${item.work_days}天）</span>
          ${item.note ? `<span class="note-icon" title="${escapeHtml(item.note)}">📝</span>` : ''}
        </div>
      </div>
      ${
        readOnly
          ? ''
          : `<div class="row-actions">
               <button class="btn btn-icon btn-ghost" data-action="edit" title="編輯分工">✏️</button>
               <button class="btn btn-icon btn-ghost" data-action="delete" title="刪除分工">🗑️</button>
             </div>`
      }`;
    return row;
  }

  const isParent = kind === 'parent';
  row.className = `gantt-list-row ${isParent ? 'parent-row' : 'flat-row'}${group.jiraSyncState === 'removed' ? ' removed-row' : ''}`;

  const removedChip =
    group.jiraSyncState === 'removed'
      ? `<button class="warn-chip"${readOnly ? ' disabled' : ' data-action="resolve"'} title="此需求已不在目前 Jira Version">⚠ ${
          group.jiraMovedTo ? `已移至 ${escapeHtml(group.jiraMovedTo)}` : '已移出 Version'
        }</button>`
      : '';

  const metaLine = isParent
    ? `<span class="date-range">${formatDateShort(group.startDate)}–${formatDateShort(group.endDate)}</span>
       <span class="tag-chip">${group.items.length} 個分工</span>
       ${group.jiraAssignee ? `<span class="tag-chip">${escapeHtml(group.jiraAssignee)}</span>` : ''}
       ${group.jiraStatus ? `<span class="badge badge-status">${escapeHtml(group.jiraStatus)}</span>` : ''}
       ${removedChip}`
    : `<span class="date-range">${formatDateShort(item.start_date)}–${formatDateShort(item.end_date)}（${item.work_days}天）</span>
       ${item.owner ? `<span class="owner-name">${escapeHtml(item.owner)}</span>` : ''}
       ${item.note ? `<span class="note-icon" title="${escapeHtml(item.note)}">📝</span>` : ''}
       ${group.jiraStatus ? `<span class="badge badge-status">${escapeHtml(group.jiraStatus)}</span>` : ''}
       ${removedChip}`;

  row.innerHTML = `
    ${readOnly ? '' : '<span class="drag-handle" title="拖曳排序">⠿</span>'}
    ${isParent ? `<button class="caret" data-action="toggle" title="${collapsed ? '展開' : '收合'}">${collapsed ? '▸' : '▾'}</button>` : '<span class="caret-space"></span>'}
    ${!isParent ? `<span class="swatch" style="background:${escapeHtml(item.color)}"></span>` : ''}
    <div class="item-main">
      <div class="item-title">${isParent ? issueKeyTag(group.issueKey, jiraBaseUrl) + ' ' : ''}${escapeHtml(group.title)}</div>
      <div class="item-meta">${metaLine}</div>
    </div>
    ${
      readOnly
        ? ''
        : `<div class="row-actions">
             ${isParent ? `<button class="btn btn-icon btn-ghost" data-action="add-track" title="新增分工">＋</button>` : `<button class="btn btn-icon btn-ghost" data-action="edit" title="編輯">✏️</button>`}
             <button class="btn btn-icon btn-ghost" data-action="${isParent ? 'delete-group' : 'delete'}" title="${isParent ? '刪除整張需求的排程' : '刪除'}">🗑️</button>
           </div>`
    }`;
  return row;
}

function buildTimelineRow({ height, totalDays, rangeStart, calendar, todayIso, item, group, readOnly }) {
  const bodyRow = document.createElement('div');
  bodyRow.className = 'gantt-body-row';
  bodyRow.style.height = `${height}px`;

  for (let i = 0; i < totalDays; i++) {
    const iso = addDaysIso(rangeStart, i);
    const col = document.createElement('div');
    col.className = dayColClass(iso, calendar, todayIso);
    bodyRow.appendChild(col);
  }

  if (group) {
    const left = daysBetween(rangeStart, group.startDate) * DAY_WIDTH;
    const width = (daysBetween(group.startDate, group.endDate) + 1) * DAY_WIDTH - 4;
    const bar = document.createElement('div');
    bar.className = 'gantt-summary-bar';
    bar.style.left = `${left + 2}px`;
    bar.style.width = `${Math.max(width, DAY_WIDTH - 4)}px`;
    bar.title = `${group.title}\n整體：${group.startDate} → ${group.endDate}（${group.items.length} 個分工）`;
    bodyRow.appendChild(bar);
    return bodyRow;
  }

  bodyRow.appendChild(buildItemBar(item, rangeStart, calendar, readOnly));
  return bodyRow;
}

/**
 * One positioned group per item, containing a segment per contiguous run of
 * working days. Dragging the group moves the whole item, so the gaps don't
 * complicate the interaction.
 */
function buildItemBar(item, rangeStart, calendar, readOnly) {
  const spanStart = daysBetween(rangeStart, item.start_date);
  const spanDays = daysBetween(item.start_date, item.end_date) + 1;

  const holder = document.createElement('div');
  holder.className = 'gantt-bar' + (item.jira_sync_state === 'removed' ? ' removed-bar' : '');
  holder.style.left = `${spanStart * DAY_WIDTH + 2}px`;
  holder.style.width = `${Math.max(spanDays * DAY_WIDTH - 4, DAY_WIDTH - 4)}px`;
  holder.dataset.id = item.id;
  if (readOnly) holder.style.cursor = 'default';

  const label = item.track ? `${item.track}${item.owner ? '・' + item.owner : ''}` : itemDisplayTitle(item);
  const offDays = spanDays - item.work_days;
  holder.title =
    `${itemDisplayTitle(item)}${item.track ? `　[${item.track}]` : ''}${item.owner ? `　${item.owner}` : ''}\n` +
    `${item.start_date} → ${item.end_date}（${item.work_days} 個工作天${offDays > 0 ? `，跨過 ${offDays} 天假日` : ''}）` +
    `${item.note ? `\n備註：${item.note}` : ''}`;

  // Thin line spanning the whole period, so split segments still read as one task.
  const link = document.createElement('div');
  link.className = 'bar-link';
  link.style.background = item.color;
  holder.appendChild(link);

  const runs = workingRuns(item.start_date, item.end_date, calendar);
  const effective = runs.length ? runs : [{ from: item.start_date, to: item.end_date }];
  let widest = 0;
  effective.forEach((run, i) => {
    const len = daysBetween(run.from, run.to) + 1;
    if (len > daysBetween(effective[widest].from, effective[widest].to) + 1) widest = i;
  });

  effective.forEach((run, i) => {
    const seg = document.createElement('div');
    seg.className = 'bar-seg';
    const offset = daysBetween(item.start_date, run.from) * DAY_WIDTH;
    const len = (daysBetween(run.from, run.to) + 1) * DAY_WIDTH;
    seg.style.left = `${offset}px`;
    seg.style.width = `${Math.max(len - 2, 6)}px`;
    seg.style.background = item.color;
    if (i === widest) seg.textContent = label;
    holder.appendChild(seg);
  });

  if (!readOnly) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    holder.appendChild(handle);
  }
  return holder;
}

/**
 * Make every timeline row exactly as tall as its list row. List rows grow when
 * a long title wraps; a ResizeObserver re-syncs whenever the width changes
 * (window resize, rotating a phone, the section becoming visible, ...).
 */
function syncRowHeights(container, listBody, inner) {
  const listRows = [...listBody.children];
  const bodyRows = [...inner.children].filter((n) => n.classList.contains('gantt-body-row'));
  const sync = () => {
    listRows.forEach((r, i) => {
      // Fractional height, so tiny rounding errors can't add up over many rows.
      const h = r.getBoundingClientRect().height;
      if (h > 0 && bodyRows[i]) bodyRows[i].style.height = `${h}px`;
    });
  };
  sync();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(sync);
    listRows.forEach((r) => ro.observe(r));
    container._rowHeightObserver = ro;
  }
}

function syncVerticalScroll(list, timeline) {
  let lock = false;
  const link = (from, to) => {
    from.addEventListener('scroll', () => {
      if (lock) return;
      lock = true;
      to.scrollTop = from.scrollTop;
      requestAnimationFrame(() => {
        lock = false;
      });
    });
  };
  link(timeline, list);
  link(list, timeline);
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function wireInteractions(container, ctx) {
  const {
    onItemChange,
    onEdit,
    onDelete,
    onDeleteGroup,
    onReorder,
    onResolveIssue,
    onAddTrack,
    onRerender,
    groups,
    calendar,
  } = ctx;

  const itemById = new Map();
  const groupByKey = new Map();
  for (const g of groups) {
    groupByKey.set(g.key, g);
    for (const it of g.items) itemById.set(it.id, it);
  }

  container.querySelectorAll('.gantt-list-row').forEach((row) => {
    const id = row.dataset.id;
    const group = groupByKey.get(row.dataset.groupKey);

    row.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = row.dataset.groupKey;
      collapsedGroups.has(key) ? collapsedGroups.delete(key) : collapsedGroups.add(key);
      onRerender?.();
    });
    row.querySelector('[data-action="edit"]')?.addEventListener('click', () => onEdit?.(id));
    row.querySelector('[data-action="delete"]')?.addEventListener('click', () => onDelete?.(id));
    row.querySelector('[data-action="delete-group"]')?.addEventListener('click', () =>
      onDeleteGroup?.(group?.items.map((i) => i.id) ?? [], group?.title ?? '')
    );
    row.querySelector('[data-action="add-track"]')?.addEventListener('click', () => onAddTrack?.(group));
    row.querySelector('[data-action="resolve"]')?.addEventListener('click', () =>
      onResolveIssue?.(group?.issueKey, group?.jiraMovedTo ?? null)
    );
  });

  wireRowReorder(container, groupByKey, onReorder);
  wireBarDrag(container, itemById, calendar, onItemChange);
}

function wireRowReorder(container, groupByKey, onReorder) {
  let dragged = null;

  container.querySelectorAll('.gantt-list-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragged = {
        id: row.dataset.id || null,
        groupKey: row.dataset.groupKey,
        isParent: row.classList.contains('parent-row'),
      };
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-target');
      if (!dragged) return;

      const targetGroupKey = row.dataset.groupKey;
      const orderedKeys = [...new Set([...container.querySelectorAll('.gantt-list-row')].map((r) => r.dataset.groupKey))];

      if (dragged.isParent || row.classList.contains('parent-row') || dragged.groupKey !== targetGroupKey) {
        const from = orderedKeys.indexOf(dragged.groupKey);
        const to = orderedKeys.indexOf(targetGroupKey);
        if (from === -1 || to === -1 || from === to) return;
        orderedKeys.splice(to, 0, orderedKeys.splice(from, 1)[0]);
      } else if (dragged.id && row.dataset.id) {
        const group = groupByKey.get(targetGroupKey);
        if (!group) return;
        const ids = group.items.map((i) => i.id);
        const from = ids.indexOf(dragged.id);
        const to = ids.indexOf(row.dataset.id);
        if (from === -1 || to === -1 || from === to) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        group.items = ids.map((id) => group.items.find((i) => i.id === id));
      }

      const flatIds = [];
      for (const key of orderedKeys) {
        const g = groupByKey.get(key);
        if (g) for (const it of g.items) flatIds.push(it.id);
      }
      onReorder?.(flatIds);
      dragged = null;
    });
  });
}

function wireBarDrag(container, itemById, calendar, onItemChange) {
  container.querySelectorAll('.gantt-bar').forEach((bar) => {
    const item = itemById.get(bar.dataset.id);
    if (!item) return;

    let mode = null;
    let startX = 0;
    let originLeft = 0;
    let originWidth = 0;

    bar.addEventListener('pointerdown', (e) => {
      mode = e.target.classList.contains('resize-handle') ? 'resize' : 'move';
      startX = e.clientX;
      originLeft = parseFloat(bar.style.left);
      originWidth = parseFloat(bar.style.width);
      bar.classList.add('dragging');
      bar.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    bar.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const deltaDays = Math.round((e.clientX - startX) / DAY_WIDTH);
      if (mode === 'move') bar.style.left = `${originLeft + deltaDays * DAY_WIDTH}px`;
      else bar.style.width = `${Math.max(DAY_WIDTH - 4, originWidth + deltaDays * DAY_WIDTH)}px`;
    });

    const finish = (e) => {
      if (!mode) return;
      bar.classList.remove('dragging');
      const deltaDays = Math.round((e.clientX - startX) / DAY_WIDTH);
      const restore = () => {
        bar.style.left = `${originLeft}px`;
        bar.style.width = `${originWidth}px`;
      };

      if (deltaDays === 0) {
        restore();
      } else if (mode === 'move') {
        let newStart = addDaysIso(item.start_date, deltaDays);
        // Land on a working day so the bar starts where work actually starts.
        let guard = 0;
        while (!isWorkingDay(newStart, calendar) && guard++ < 30) newStart = addDaysIso(newStart, deltaDays > 0 ? 1 : -1);
        onItemChange?.(item.id, { startDate: newStart, workDays: item.work_days });
      } else {
        const newEnd = addDaysIso(item.end_date, deltaDays);
        if (newEnd >= item.start_date) {
          onItemChange?.(item.id, {
            startDate: item.start_date,
            workDays: Math.max(1, countWorkDays(item.start_date, newEnd, calendar)),
          });
        } else {
          restore();
        }
      }
      mode = null;
    };

    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', () => {
      mode = null;
      bar.classList.remove('dragging');
    });
  });
}
