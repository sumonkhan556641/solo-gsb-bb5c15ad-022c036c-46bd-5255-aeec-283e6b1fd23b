/**
 * 冒烟测试：范围解析、脚本分类、字体 cmap 解析。
 * 用法：node scripts/smoke.js
 */
import assert from 'node:assert/strict';
import { parseRangeSpec, formatSegments, subtractSegments, PRESETS } from '../shared/ranges.js';
import { scriptOf } from '../shared/scripts.js';
import { compressCodepoints, sniffFormat } from '../server/font-parser.js';
import { intersectSegments, countSegments, planFontCoverage } from '../shared/planner.js';

// 范围解析
assert.deepEqual(parseRangeSpec('U+41').segments, [[0x41, 0x41]]);
assert.deepEqual(parseRangeSpec('U+41-U+43').segments, [[0x41, 0x43]]);
assert.equal(parseRangeSpec('basic-latin').count, 96);
assert.deepEqual(parseRangeSpec('4E2D').segments, [[0x4e2d, 0x4e2d]]);
// 裸字母按字面量（相邻码位会被合并）
assert.deepEqual(parseRangeSpec('ABC').segments, [[0x41, 0x43]]);
assert.deepEqual(parseRangeSpec('A C').segments, [[0x20, 0x20], [0x41, 0x41], [0x43, 0x43]]);
// 区间合并
assert.deepEqual(parseRangeSpec('U+41-U+43, U+42-U+45').segments, [[0x41, 0x45]]);
// 引号字面量
assert.equal(parseRangeSpec('"AB"').count, 2);
// 排除项：码位区间从预设中扣除（basic-latin 0x20-0x7F 扣掉 A-Z 0x41-0x5A）
assert.deepEqual(
  parseRangeSpec('basic-latin,!U+0041-U+005A').segments,
  [[0x20, 0x40], [0x5b, 0x7f]],
);
assert.equal(parseRangeSpec('basic-latin,!U+0041-U+005A').count, 96 - 26);
// 排除项可与预设、区间、字面量混用
assert.deepEqual(parseRangeSpec('U+41-U+5A, !ABC').segments, [[0x44, 0x5a]]);
assert.deepEqual(parseRangeSpec('basic-latin,!ascii-printable').segments, [[0x7f, 0x7f]]);
assert.deepEqual(parseRangeSpec('U+41-U+45,!"B"').segments, [[0x41, 0x41], [0x43, 0x45]]);
// 全角分隔符与全角 ！ 排除标记
assert.deepEqual(parseRangeSpec('U+41-U+43，！U+42').segments, [[0x41, 0x41], [0x43, 0x43]]);
// 排除后合并去重、保持升序（0x4F 与 0x50 相邻，正向片段会先合并）
{
  const { segments, exclusions } = parseRangeSpec('U+50-U+5F, U+41-U+4F, !U+45');
  assert.deepEqual(exclusions, [[0x45, 0x45]]);
  assert.deepEqual(segments, [[0x41, 0x44], [0x46, 0x5f]]);
  assert.equal(parseRangeSpec('U+50-U+5F, U+41-U+4F, !U+45').count, 30);
}
// 排除命中数以 warning 形式反馈
assert.ok(parseRangeSpec('U+41-U+43,!U+42').warnings.some((w) => w.includes('扣除 1')));
assert.ok(parseRangeSpec('U+41-U+43,!U+60').warnings.some((w) => w.includes('未命中')));
// subtractSegments 直接验证：部分相交 / 完全包含 / 多区间
assert.deepEqual(
  subtractSegments([[0x41, 0x50], [0x60, 0x70]], [[0x45, 0x65]]),
  [[0x41, 0x44], [0x66, 0x70]],
);
assert.deepEqual(subtractSegments([[0x41, 0x41]], [[0x40, 0x42]]), []);
// 只有排除项 / 空排除 / 排除清空全部 → 明确报错
assert.throws(() => parseRangeSpec('!U+41'), /没有要检测的正向范围/);
assert.throws(() => parseRangeSpec('basic-latin, !'), /缺少要扣除的范围/);
assert.throws(() => parseRangeSpec('U+41, !U+41'), /没有剩余可检测的码位/);
// 越界与空输入
assert.throws(() => parseRangeSpec('U+110000'));
assert.throws(() => parseRangeSpec(''));
// 所有预设名可解析且非空（除占位空预设）
for (const [name, segs] of Object.entries(PRESETS)) {
  if (segs.length) assert.ok(parseRangeSpec(name).count > 0, name);
}

// 脚本分类
assert.equal(scriptOf(0x41).id, 'Latn');
assert.equal(scriptOf(0x4e2d).id, 'Hani');
assert.equal(scriptOf(0x3042).id, 'Hira');
assert.equal(scriptOf(0x0627).id, 'Arab');
assert.equal(scriptOf(0xffff).id, 'Zzzz');

// cmap 压缩与魔数
assert.deepEqual(compressCodepoints([1, 2, 3, 5, 6, 8]), [[1, 3], [5, 6], [8, 8]]);
assert.equal(sniffFormat(Buffer.from([0x00, 0x01, 0x00, 0x00])), 'ttf');
assert.equal(sniffFormat(Buffer.from('wOFFxxxx')), 'woff');
assert.equal(sniffFormat(Buffer.from('wOF2xxxx')), 'woff2');
assert.equal(sniffFormat(Buffer.from('ttcfxxxx')), 'otf/ttc');

// 区间交集（合并区间的交差运算，不展开码位）
assert.deepEqual(intersectSegments([[1, 10]], [[4, 6], [8, 12]]), [[4, 6], [8, 10]]);
assert.deepEqual(intersectSegments([[1, 3], [8, 10]], [[4, 7]]), []);
assert.deepEqual(intersectSegments([[1, 5], [7, 9]], [[2, 8]]), [[2, 5], [7, 8]]);
assert.equal(countSegments([[1, 3], [10, 12]]), 6);

// 字体搭配规划：逐轮贪心 + 每轮只计首次覆盖
{
  const target = [[0x41, 0x50]]; // 16 码位
  const fonts = [
    { id: 3, cmapRanges: [[0x41, 0x48]] },                       // +8
    { id: 1, cmapRanges: [[0x41, 0x4a], [0x4b, 0x4b], [0x4d, 0x50]] }, // 合并后 +15
    { id: 2, cmapRanges: [[0x41, 0x4a], [0x4c, 0x50]] },         // 同样 +15，平局按 ID 取 1
  ];
  const plan = planFontCoverage({ target, fonts, maxFonts: 5 });
  assert.deepEqual(plan.picks.map((p) => p.id), [1, 2]);
  assert.equal(plan.picks[0].gain, 15);
  assert.deepEqual(plan.picks[0].gainSegments, [[0x41, 0x4b], [0x4d, 0x50]]);
  assert.equal(plan.picks[1].gain, 1);
  assert.deepEqual(plan.picks[1].gainSegments, [[0x4c, 0x4c]]);
  assert.equal(plan.covered, 16);
  assert.equal(plan.uncoveredCount, 0);
  assert.deepEqual(plan.uncoveredSegments, []);
  assert.equal(plan.stopReason, 'no-gain'); // 剩余 id3 对新缺口无增益 → 提前结束
}

// 增量相同时按字体 ID 升序
{
  const plan = planFontCoverage({
    target: [[1, 10]],
    fonts: [{ id: 9, cmapRanges: [[1, 5]] }, { id: 2, cmapRanges: [[6, 10]] }],
    maxFonts: 1,
  });
  assert.equal(plan.picks[0].id, 2);
  assert.equal(plan.picks[0].gain, 5);
  assert.equal(plan.stopReason, 'max-fonts'); // 只允许 1 个 → 达到上限
  assert.deepEqual(plan.uncoveredSegments, [[1, 5]]);
}

// maxFonts 限制轮数
{
  const plan = planFontCoverage({
    target: [[1, 30]],
    fonts: [
      { id: 1, cmapRanges: [[1, 10]] },
      { id: 2, cmapRanges: [[11, 20]] },
      { id: 3, cmapRanges: [[21, 30]] },
    ],
    maxFonts: 2,
  });
  assert.deepEqual(plan.picks.map((p) => p.round), [1, 2]);
  assert.equal(plan.covered, 20);
  assert.equal(plan.uncoveredCount, 10);
  assert.equal(plan.stopReason, 'max-fonts');
}

// 无字体覆盖目标 / 空 cmap 字体 → 首轮即无增益
{
  const plan = planFontCoverage({
    target: [[1, 10]],
    fonts: [{ id: 1, cmapRanges: [] }, { id: 2, cmapRanges: null }, { id: 3, cmapRanges: [[20, 30]] }],
    maxFonts: 3,
  });
  assert.deepEqual(plan.picks, []);
  assert.equal(plan.covered, 0);
  assert.equal(plan.uncoveredCount, 10);
  assert.deepEqual(plan.uncoveredSegments, [[1, 10]]);
  assert.equal(plan.stopReason, 'no-gain');
  assert.equal(plan.candidateCount, 1); // 仅 id3 的 cmap 非空
}

// 非法参数
assert.throws(() => planFontCoverage({ target: [], fonts: [], maxFonts: 1 }), /目标范围/);
assert.throws(() => planFontCoverage({ target: [[1, 2]], fonts: [], maxFonts: 0 }), /最多使用字体数/);

console.log('smoke tests passed ✓');
void formatSegments;
