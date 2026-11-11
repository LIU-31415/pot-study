// 分句逻辑的回归测试。
// 直接 import 生产函数，不再复制一份实现——之前两处各存一份，
// 改了生产代码而忘了改测试，就会出现「测试通过但功能是坏的」。
//
// 用法：node scripts/test-split.mjs

import { splitSentences } from '../src/utils/sentence.js';

const CASES = [
    {
        name: '文献引用紧贴句号（用户截图里的真实段落）',
        input:
            'In order to maximize oil absorption, the microparticle surface generally needs to be highly hydrophobic.36-38 However, the particle hydrophobicity causes severe agglomeration in aqueous solution due to the interparticle attraction exceeding water-particle interactions.39 Particle aggregation limits the effective particle surface area exposed in solution and hence disturbs the emulsion absorption ability.',
        expect: 3,
        expectFirst:
            'In order to maximize oil absorption, the microparticle surface generally needs to be highly hydrophobic.36-38',
    },
    {
        name: '逗号后接引用编号不应切',
        input:
            'Using surfactants as general dispersants is generally employed to prevent particle aggregation,40-43 but surfactant coating tends to reduce surface hydrophobicity.',
        expect: 1,
    },
    { name: '小数不能被切开', input: 'The solution was 0.5 M NaCl and the pH was 7.4 before use.', expect: 1 },
    { name: '小数后面接句子', input: 'The value was 0.5 M. Then we waited.', expect: 2 },
    { name: 'Fig. 3 缩写不切', input: 'Fig. 3 shows the result. It is clear.', expect: 2 },
    { name: 'et al. 缩写不切', input: 'Smith et al. 2020 reported this. We confirmed it.', expect: 2 },
    { name: '单位后的句点要切（0.4 T.）', input: 'The field was 0.4 T. Next we measured.', expect: 2 },
    { name: '中文按全角标点切', input: '这是一个句子。这是第二个句子。这是第三个。', expect: 3 },
    { name: 'en dash 引用范围', input: 'The surface is hydrophobic.36–38 However, aggregation occurs.', expect: 2 },
    {
        name: 'Fig.3 无空格时不能被当成句末引用',
        input: 'Fig.3 shows the result. It is clear.',
        expect: 2,
        expectFirst: 'Fig.3 shows the result.',
    },
    {
        name: 'Ref.12 无空格同理',
        input: 'See Ref.12 for details. We agree.',
        expect: 2,
        expectFirst: 'See Ref.12 for details.',
    },
    {
        name: '方括号引用 .[36]',
        input: 'The surface is hydrophobic.[36] However, aggregation occurs.',
        expect: 2,
        expectFirst: 'The surface is hydrophobic.[36]',
    },
    {
        name: '列表引用 .36,38',
        input: 'The surface is hydrophobic.36,38 However, aggregation occurs.',
        expect: 2,
        expectFirst: 'The surface is hydrophobic.36,38',
    },
    {
        name: '中文句末引用编号留在前一句',
        input: '结果稳定。36 下一组实验开始。',
        expect: 2,
        expectFirst: '结果稳定。36',
    },
    {
        name: '中英混排：中文句号也要切',
        input: '样品稳定。The result was significant.36 Further tests confirmed this.',
        expect: 3,
        expectFirst: '样品稳定。',
    },

    // ---- 以下为中文句首数字误判的回归用例 ----
    {
        name: '年份不能被当成引用编号',
        input: '实验结果可靠。2025年再次验证。',
        expect: 2,
        expectAll: ['实验结果可靠。', '2025年再次验证。'],
    },
    {
        name: '数量开头的单句不被误切',
        input: '提高了3.5倍。',
        expect: 1,
        expectAll: ['提高了3.5倍。'],
    },
    {
        name: '数量开头且前有句子时保持独立',
        input: '实验结果可靠。3.5倍的提升仍需验证。',
        expect: 2,
        expectAll: ['实验结果可靠。', '3.5倍的提升仍需验证。'],
    },
    {
        name: '纯数字句子不被上一句吞掉',
        input: '第一段结束。2025。',
        expect: 2,
        expectAll: ['第一段结束。', '2025。'],
    },
    {
        name: '数字开头正常句与真实引用编号相邻',
        input: '结果稳定。36 下一组实验开始。2025年再次验证。',
        expect: 3,
        expectAll: ['结果稳定。36', '下一组实验开始。', '2025年再次验证。'],
    },
    {
        name: '中文方括号引用仍并入前句',
        input: '该结论成立。[12] 后续研究继续。',
        expect: 2,
        expectAll: ['该结论成立。[12]', '后续研究继续。'],
    },
];

let failed = 0;
for (const c of CASES) {
    const got = splitSentences(c.input);
    const okCount = got.length === c.expect;
    const okFirst = !c.expectFirst || got[0] === c.expectFirst;
    const okAll = !c.expectAll || JSON.stringify(got) === JSON.stringify(c.expectAll);
    if (okCount && okFirst && okAll) {
        console.log(`  PASS  ${c.name}  (${got.length} 句)`);
    } else {
        failed++;
        console.log(`  FAIL  ${c.name}`);
        console.log(`        期望 ${c.expect} 句，实际 ${got.length} 句`);
        if (!okFirst) console.log(`        首句期望：${c.expectFirst}\n        首句实际：${got[0]}`);
        if (!okAll) {
            console.log(`        逐句期望：${JSON.stringify(c.expectAll)}`);
            console.log(`        逐句实际：${JSON.stringify(got)}`);
        }
        got.forEach((s, i) => console.log(`        [${i + 1}] ${s}`));
    }
}

console.log(failed === 0 ? `\n全部通过（${CASES.length} 项）` : `\n${failed} 项失败`);
process.exitCode = failed === 0 ? 0 : 1;
