/**
 * 冒烟测试：范围解析、脚本分类、字体 cmap 解析。
 * 用法：node scripts/smoke.js
 */
import assert from 'node:assert/strict';
import { parseRangeSpec, formatSegments, subtractSegments, PRESETS } from '../shared/ranges.js';
import { scriptOf } from '../shared/scripts.js';
import { compressCodepoints, sniffFormat } from '../server/font-parser.js';

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

console.log('smoke tests passed ✓');
void formatSegments;
