// 前端「依赖数组里用了但没声明」检查。
//
// 背景：vite build 不检查未定义标识符，把 `const serviceKey = ...` 删掉
// 但留下 `}, [serviceKey]);` 时，构建照样通过，运行时才 ReferenceError 白屏。
// 这个脚本专门盯这一类：useEffect / useCallback / useMemo 的依赖数组。
//
// 用法：node scripts/check-undeclared.mjs
// 不依赖任何第三方包，纯正则 + 声明收集。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const SRC = join(ROOT, 'src');

// 运行时全局，出现在依赖数组里也算合法
const GLOBALS = new Set([
    'window', 'document', 'console', 'navigator', 'location', 'process',
    'localStorage', 'sessionStorage', 'fetch', 'React', 'undefined', 'globalThis',
]);

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
    }
    return out;
}

// 收集文件里所有「声明出来的名字」
function collectDeclared(code) {
    const out = new Set();
    const addAll = (s) => {
        for (const m of String(s).matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0]);
    };

    // const/let/var 单名
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    // 解构：const [a, b] = / const { a, b: c } =
    for (const m of code.matchAll(/\b(?:const|let|var)\s*[\[{]([\s\S]{0,400}?)[\]}]\s*=/g)) addAll(m[1]);
    // function 名
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    // class 名
    for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    // import { a, b as c } / import X from
    for (const m of code.matchAll(/import\s+([\s\S]{0,400}?)\s+from\s+['"]/g)) addAll(m[1]);
    for (const m of code.matchAll(/import\s+['"][^'"]+['"]/g)) addAll('');
    // 函数参数：(a, b) => / function (a, b) / async (a, b)
    for (const m of code.matchAll(/\(([^()]{0,300})\)\s*(?:=>|\{)/g)) addAll(m[1]);
    for (const m of code.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]{0,300})\)/g)) addAll(m[1]);
    // 单个箭头参数：x =>
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) out.add(m[1]);
    // catch (e)
    for (const m of code.matchAll(/catch\s*\(([^()]*)\)/g)) addAll(m[1]);
    // 对象解构赋值：const { a } = xxx 已在上面覆盖；这里补 for...of 的变量
    for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);

    return out;
}

// 提取所有依赖数组，返回 { 行号, 名字列表 }
function collectDeps(code) {
    const results = [];
    // 匹配 }, [ ... ]);  或  }, [ ... ], 或 ] 后接 );
    const re = /\}\s*,\s*\[([^\]]{0,600})\]\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const body = m[1];
        const line = code.slice(0, m.index).split('\n').length;
        const names = body
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s)); // 只认纯标识符，跳过 a?.b 这类表达式
        if (names.length) results.push({ line, names, raw: body.trim() });
    }
    return results;
}

const problems = [];
for (const file of walk(SRC)) {
    const code = readFileSync(file, 'utf8');
    const declared = collectDeclared(code);
    for (const { line, names } of collectDeps(code)) {
        for (const name of names) {
            if (declared.has(name) || GLOBALS.has(name)) continue;
            problems.push(`${relative(ROOT, file)}:${line}  依赖数组里的 \`${name}\` 在文件里找不到声明`);
        }
    }
}

if (problems.length === 0) {
    console.log('OK: 依赖数组里的标识符都有声明');
} else {
    console.log(`发现 ${problems.length} 处可疑：`);
    for (const p of problems) console.log('  ' + p);
    process.exitCode = 1;
}
