/**
 * 「字体搭配规划」页逻辑（原生 ESM，无框架）。
 *
 * 复用范围解析（/shared/ranges.js）与字体列表接口（api.listFonts），
 * 区间交差运算由 /shared/planner.js 完成，全程不逐码位展开。
 * 结论只基于字体 cmap 表声明，不验证字形是否真实可渲染。
 */
import { api, escapeHtml, fmtNum } from './api.js';
import { parseRangeSpec, formatSegments } from '/shared/ranges.js';
import { planFontCoverage } from '/shared/planner.js';

const $ = (sel) => document.querySelector(sel);

const CAVEATS = [
  '结果仅基于字体 cmap 表「声明」的码位区间，不代表真实渲染：声明的字形可能是 .notdef 豆腐块、空白或需回退到其他字体。',
  '选择策略为逐轮贪心（覆盖缺口最多优先，增量相同按字体 ID 升序），贪心结果是实用搭配建议，不保证全局最优。',
  '重叠覆盖只归给最先选中它的字体；同一码位不会被重复计入新增覆盖数。',
];

let fonts = [];

function toast(msg, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function fontLabel(f) {
  return f.fullName || f.familyName || `字体 #${f.id}`;
}

/** 由 app.js 在字体列表加载 / 上传 / 删除后调用 */
export function setPlanFonts(list) {
  fonts = Array.isArray(list) ? list : [];
  const el = $('#planner-font-count');
  if (el) el.textContent = String(fonts.length);
}

/* 预设下拉（与覆盖检测页相同的插入行为） */
function fillPresets(PRESET_NAMES) {
  const sel = $('#planner-preset');
  sel.innerHTML += PRESET_NAMES.map((p) => `<option value="${p}">${p}</option>`).join('');
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const target = $('#planner-range');
    target.value = target.value.trim()
      ? `${target.value.replace(/[,，]\s*$/, '')}, ${sel.value}`
      : sel.value;
    sel.value = '';
  });
}

/* ---------------- 规划执行与渲染 ---------------- */

$('#planner-run').addEventListener('click', runPlanner);

function runPlanner() {
  const rangeInput = $('#planner-range').value;
  const maxFonts = Number($('#planner-max-fonts').value);
  const warnBox = $('#planner-warnings');
  const result = $('#planner-result');
  warnBox.innerHTML = '';

  let parsed;
  try {
    parsed = parseRangeSpec(rangeInput);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!Number.isInteger(maxFonts) || maxFonts < 1) {
    return toast('最多使用字体数必须是 ≥ 1 的整数', true);
  }
  if (!fonts.length) return toast('还没有已上传字体，请先在「覆盖检测」页上传字体', true);

  warnBox.innerHTML = parsed.warnings
    // 规划走区间交差运算，「真实渲染模式较慢」的提示与本页无关
    .filter((w) => !w.includes('真实渲染模式较慢'))
    .map((w) => `<div>⚠ ${escapeHtml(w)}</div>`)
    .join('');

  let plan;
  try {
    plan = planFontCoverage({ target: parsed.segments, fonts, maxFonts });
  } catch (err) {
    return toast(err.message, true);
  }
  renderPlan({ rangeInput, parsed, maxFonts, plan });
  result.classList.remove('hidden');
}

function renderPlan({ rangeInput, parsed, maxFonts, plan }) {
  const rate = plan.total ? Number((plan.covered / plan.total) * 100).toFixed(2) : 0;
  const stopText = plan.stopReason === 'max-fonts'
    ? `已选满 ${maxFonts} 个字体（达到上限）`
    : '剩余字体对当前缺口均无新增覆盖，提前结束';
  const stat = (cls, num, lbl) =>
    `<div class="stat ${cls}"><div class="num">${fmtNum(num)}</div><div class="lbl">${lbl}</div></div>`;

  $('#planner-result').innerHTML = `
    <div class="card result-head">
      <h2 style="margin:0">搭配规划结果 <span class="badge">仅 cmap 声明 · 不代表真实渲染</span></h2>
      <div class="rate-line">
        <strong>总覆盖率</strong>
        <div class="bar"><div class="bar-fill" style="width:${rate}%"></div></div>
        <span class="pct">${rate}%</span>
      </div>
      <div class="stat-grid">
        ${stat('blue', plan.total, '目标码位')}
        ${stat('green', plan.covered, '累计新增覆盖')}
        ${stat('red', plan.uncoveredCount, '仍未覆盖')}
        ${stat('purple', plan.picks.length, '选中字体数')}
      </div>
      <div class="env-box">
        范围表达式：${escapeHtml(rangeInput)}<br>
        合并后区间：${escapeHtml(formatSegments(parsed.segments).slice(0, 600))}${formatSegments(parsed.segments).length > 600 ? ' …' : ''}<br>
        候选字体（含有效 cmap）：${fmtNum(plan.candidateCount)} / ${fmtNum(fonts.length)} 个
        ｜ 字体数上限：${fmtNum(maxFonts)}<br>
        终止原因：${escapeHtml(stopText)}
      </div>
      <div class="caveat-banner">
        ⚠ ${CAVEATS[0]}<br>
        · ${CAVEATS[1]}<br>
        · ${CAVEATS[2]}
      </div>
    </div>

    <div class="card">
      <h2>字体选用顺序与各自新增覆盖</h2>
      ${renderPicksTable(plan)}
    </div>

    <div class="card">
      <h2>仍未覆盖的区间 <span class="badge">${fmtNum(plan.uncoveredCount)} 码位 · ${plan.uncoveredSegments.length} 段</span></h2>
      ${plan.uncoveredSegments.length
        ? `<pre class="range-list">${escapeHtml(formatSegments(plan.uncoveredSegments))}</pre>`
        : '<p class="muted" style="margin:0">🎉 目标范围已被所选字体全部覆盖（按 cmap 声明）。</p>'}
    </div>
  `;
}

function renderPicksTable(plan) {
  if (!plan.picks.length) {
    return '<p class="muted" style="margin:0">没有任何已上传字体的 cmap 覆盖到目标范围，无法选用。</p>';
  }
  const rows = plan.picks.map((p) => {
    const f = fonts.find((x) => x.id === p.id);
    const name = f ? fontLabel(f) : `字体 #${p.id}`;
    return `
      <tr>
        <td class="round">第 ${p.round} 轮</td>
        <td>
          <div class="pick-name">#${p.id} · ${escapeHtml(name)}</div>
          ${f?.familyName ? `<div class="muted">${escapeHtml(f.familyName)}${f.subfamilyName ? ' / ' + escapeHtml(f.subfamilyName) : ''}</div>` : ''}
        </td>
        <td class="num-cell">+${fmtNum(p.gain)}</td>
        <td class="range-cell"><pre class="range-list">${escapeHtml(formatSegments(p.gainSegments))}</pre></td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="data plan-table">
        <thead>
          <tr><th>顺序</th><th>字体</th><th>新增覆盖数</th><th>本轮首次覆盖区间</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function initPlannerView(PRESET_NAMES) {
  fillPresets(PRESET_NAMES);
}
