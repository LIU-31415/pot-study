// 分句逻辑的回归测试。
// 函数体与 src/window/Translate/components/StudyArea/index.jsx 的 splitSentences
// 保持一致，改那边时同步改这里。
//
// 用法：node scripts/test-split.mjs

const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'figs',
    'eq', 'eqs', 'ref', 'refs', 'al', 'no', 'nos', 'vol', 'pp', 'cf', 'approx',
    'dept', 'univ', 'inc', 'ltd', 'co', 'corp', 'min', 'max', 'ca', 'resp',
    'eg', 'ie', 'viz', 'ed', 'eds', 'ch', 'sec', 'tab', 'supp', 'wt',
]);

function splitSentences(text) {
    const out = [];
    if (!text) return out;
    const paragraphs = text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);

    for (const para of paragraphs) {
        const cjk = (para.match(/[\u4e00-\u9fa5]/g) ?? []).length;
        const isChinese = cjk > 0 && cjk * 3 >= para.length;
        if (isChinese) {
            const raw = para.split(/(?<=[。！？；!?;])/);
            const parts = [];
            for (const seg of raw) {
                let s = seg.trim();
                if (!s) continue;
                const cite = s.match(
                    /^(\d+(?:[-\u2013,]\s?\d+)?|\[\d+(?:[-\u2013,]\s?\d+)*\])\s*(.*)$/s
                );
                if (cite && parts.length) {
                    parts[parts.length - 1] += cite[1];
                    s = cite[2].trim();
                    if (!s) continue;
                }
                parts.push(s);
            }
            out.push(...parts);
            continue;
        }
        const chunks = para.split(
            /(?<=[。！？])|(?<=[.!?])\s+|(?<=[A-Za-z][.!?]\d+(?:[-\u2013,]\s?\d+)*)\s+|(?<=[A-Za-z][.!?]\[\d+(?:[-\u2013,]\s?\d+)*\])\s+/
        );
        let buf = '';
        for (const chunk of chunks) {
            buf = buf ? buf + ' ' + chunk : chunk;
            const m = buf.match(/([A-Za-z][A-Za-z.]*)\.$/);
            if (m) {
                const w = m[1].toLowerCase().replace(/\./g, '');
                if (ABBREVIATIONS.has(w)) continue;
                if (w.length === 1 && /^[A-Z]$/.test(m[1])) {
                    if (!/\d\s+[A-Z]\.$/.test(buf)) continue;
                }
            }
            const m2 = buf.match(/([A-Za-z][A-Za-z.]*)\.(\d+(?:[-\u2013,]\s?\d+)*)$/);
            if (m2 && ABBREVIATIONS.has(m2[1].toLowerCase().replace(/\./g, ''))) continue;
            if (buf.trim()) out.push(buf.trim());
            buf = '';
        }
        if (buf.trim()) out.push(buf.trim());
    }
    return out;
}

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
    // 以下为贤者指出的边界情况
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
];

let failed = 0;
for (const c of CASES) {
    const got = splitSentences(c.input);
    const okCount = got.length === c.expect;
    const okFirst = !c.expectFirst || got[0] === c.expectFirst;
    if (okCount && okFirst) {
        console.log(`  PASS  ${c.name}  (${got.length} 句)`);
    } else {
        failed++;
        console.log(`  FAIL  ${c.name}`);
        console.log(`        期望 ${c.expect} 句，实际 ${got.length} 句`);
        if (!okFirst) console.log(`        首句期望：${c.expectFirst}\n        首句实际：${got[0]}`);
        got.forEach((s, i) => console.log(`        [${i + 1}] ${s}`));
    }
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exitCode = failed === 0 ? 0 : 1;
