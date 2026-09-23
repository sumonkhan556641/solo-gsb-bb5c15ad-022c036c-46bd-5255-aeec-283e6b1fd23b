/**
 * 字体搭配规划（前端浏览器与后端 Node 共用的纯 ESM 模块）。
 *
 * 输入目标 Unicode 范围与若干字体的 cmap 区间，逐轮贪心选择
 * 「对当前缺口新增覆盖最多」的字体：
 *   - 每轮只把该字体首次覆盖到的区间归给该字体；
 *   - 新增覆盖数（增量）相同时，按字体 ID 升序取用；
 *   - 所有候选字体的增量都为 0 时提前结束；
 *   - 否则直到选满 maxFonts 个字体为止。
 *
 * 全程以「已合并的闭区间 [lo, hi]」做交集 / 差集运算，
 * 不逐码位展开（区间数与字体数的量级，与码位总量无关）。
 *
 * 注意：结果仅基于字体 cmap 表「声明」的码位区间——cmap 有映射不代表
 * 字形可真实渲染（可能为 .notdef 豆腐块 / 空白 / 依赖回退字体），
 * 不代表真实渲染效果。
 *
 * @module shared/planner
 */
import { mergeSegments, subtractSegments } from './ranges.js';

/**
 * 两组已合并闭区间的交集。
 * 双指针线性扫描；输出再经 mergeSegments 规范化（升序、不重叠）。
 * @param {number[][]} a 已合并区间
 * @param {number[][]} b 已合并区间
 * @returns {number[][]}
 */
export function intersectSegments(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [alo, ahi] = a[i];
    const [blo, bhi] = b[j];
    const lo = Math.max(alo, blo);
    const hi = Math.min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
    // 末端较小的一方已不可能再与对方当前（及之后）区间相交
    if (ahi < bhi) i++;
    else j++;
  }
  return mergeSegments(out);
}

/** 统计已合并闭区间内的码位总数 */
export function countSegments(segments) {
  let n = 0;
  for (const [lo, hi] of segments) n += hi - lo + 1;
  return n;
}

/**
 * 执行字体搭配规划。
 *
 * @param {object} args
 * @param {number[][]} args.target 目标范围（parseRangeSpec 得到的已合并闭区间）
 * @param {Array<{id:number, cmapRanges:number[][]|null}>} args.fonts
 *   字体列表（字体列表接口返回的对象即可，只需 id 与 cmapRanges；
 *   cmapRanges 为空 / 缺失的字体自动跳过）
 * @param {number} args.maxFonts 最多使用字体数（≥1 的整数）
 * @returns {{
 *   total:number, covered:number, uncoveredCount:number,
 *   uncoveredSegments:number[][], picks:Array<{round:number,id:number,gain:number,gainSegments:number[][]}>,
 *   candidateCount:number, stopReason:'no-gain'|'max-fonts'
 * }}
 * @throws {Error} target 为空 / maxFonts 非法
 */
export function planFontCoverage({ target, fonts, maxFonts }) {
  if (!Array.isArray(target) || target.length === 0) {
    throw new Error('目标范围不能为空');
  }
  const limit = Number(maxFonts);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('最多使用字体数必须是 ≥ 1 的整数');
  }
  if (!Array.isArray(fonts)) {
    throw new Error('fonts 必须为数组');
  }

  // 候选预先按 ID 升序：增量比较使用严格大于才替换，
  // 因此增量相同时自然保留 ID 最小者
  const candidates = fonts
    .filter((f) => f && Array.isArray(f.cmapRanges) && f.cmapRanges.length > 0)
    .map((f) => ({
      id: Number(f.id),
      ranges: mergeSegments(f.cmapRanges.map(([lo, hi]) => [lo, hi])),
    }))
    .filter((f) => Number.isInteger(f.id))
    .sort((x, y) => x.id - y.id);

  const total = countSegments(target);
  let gap = target.map(([lo, hi]) => [lo, hi]);
  const usedIds = new Set();
  const picks = [];
  let stopReason = 'max-fonts';

  for (let round = 1; round <= limit; round++) {
    let best = null;
    for (const f of candidates) {
      if (usedIds.has(f.id)) continue;
      // 该字体相对「当前缺口」的新增覆盖：cmap ∩ gap
      const gainSegments = intersectSegments(gap, f.ranges);
      const gain = countSegments(gainSegments);
      if (best === null || gain > best.gain) {
        best = { id: f.id, gain, gainSegments };
      }
    }

    // 没有候选、或剩余字体对当前缺口全部无增益 → 提前结束
    if (!best || best.gain === 0) {
      stopReason = 'no-gain';
      break;
    }

    picks.push({ round, id: best.id, gain: best.gain, gainSegments: best.gainSegments });
    usedIds.add(best.id);
    // 只扣除本轮首次覆盖的区间（差集运算，保持区间形态）
    gap = subtractSegments(gap, best.gainSegments);
  }

  const covered = picks.reduce((n, p) => n + p.gain, 0);
  return {
    total,
    covered,
    uncoveredCount: total - covered,
    uncoveredSegments: gap,
    picks,
    candidateCount: candidates.length,
    stopReason,
  };
}
