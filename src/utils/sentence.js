// 分句逻辑。界面和测试都从这里导入，避免两处各存一份实现而悄悄跑偏。
//
// 主要处理两类文本：
// - 英文：按 . ! ? 切，排除缩写和文献引用（hydrophobic.36-38 这种紧贴写法）
// - 中文：按 。！？； 切，句末的引用编号要留在前一句

// 常见缩写：句号后不当作句子边界
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'figs',
    'eq', 'eqs', 'ref', 'refs', 'al', 'no', 'nos', 'vol', 'pp', 'cf', 'approx',
    'dept', 'univ', 'inc', 'ltd', 'co', 'corp', 'min', 'max', 'ca', 'resp',
    'eg', 'ie', 'viz', 'ed', 'eds', 'ch', 'sec', 'tab', 'supp', 'wt',
]);

export function splitSentences(text) {
    const out = [];
    if (!text) return out;
    const paragraphs = text
        .split(/\r?\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

    for (const para of paragraphs) {
        // 按汉字占比判断，而不是「出现任意一个汉字」：
        // 中英混排的段落里如果只有几个汉字，走中文分支会把后面的英文句子全合在一起
        const cjk = (para.match(/[\u4e00-\u9fa5]/g) ?? []).length;
        const isChinese = cjk > 0 && cjk * 3 >= para.length;
        if (isChinese) {
            const raw = para.split(/(?<=[。！？；!?;])/);
            const parts = [];
            for (const seg of raw) {
                let s = seg.trim();
                if (!s) continue;
                // 句末引用编号（结果稳定。36 下一组…）要留在前一句，
                // 不能变成下一句的开头。
                // 判据：纯数字形式后面必须跟空白才算引用；方括号形式允许紧贴内容。
                // 这样 2025年、3.5 倍、纯数字句子里的数字都不会被误判成引用编号。
                const cite =
                    s.match(/^(\d+(?:[-\u2013,]\s?\d+)?)\s+(.*)$/s) ||
                    s.match(/^(\[\d+(?:[-\u2013,]\s?\d+)*\])\s*(.*)$/s);
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
        // 英文：按 . ! ? 后跟空白切，排除缩写。
        // 额外处理文献引用：PDF 复制出来的文本里编号常紧贴句号（hydrophobic.36-38），
        // 中间没有空格。要求句号前是字母、后面紧跟编号，所以 0.5、3.14 不会误伤。
        // 支持 .36 / .36-38 / .36,38 / .[36] 几种写法。
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
                    // 数字后的单字母大写多半是单位（0.4 T.），应切开；否则当人名首字母（John A.）合并
                    if (!/\d\s+[A-Z]\.$/.test(buf)) continue;
                }
            }
            // 缩写后面直接跟编号的（Fig.3、Ref.12）不是句末，并回下一块
            const m2 = buf.match(/([A-Za-z][A-Za-z.]*)\.(\d+(?:[-\u2013,]\s?\d+)*)$/);
            if (m2 && ABBREVIATIONS.has(m2[1].toLowerCase().replace(/\./g, ''))) continue;
            if (buf.trim()) out.push(buf.trim());
            buf = '';
        }
        if (buf.trim()) out.push(buf.trim());
    }
    return out;
}
