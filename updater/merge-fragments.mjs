// 把各平台的更新片段合并成 Tauri 要的 update.json。
//
// 用法：
//   node updater/merge-fragments.mjs <fragmentsDir> <version> <outPath> [notesFile]
//
// 例：
//   node updater/merge-fragments.mjs ./fragments 3.1.0 ./update.json CHANGELOG
//
// 注意：Tauri 会先校验整份文件再比版本号，所以每个平台的条目都必须是
// 完整的 { signature, url }。缺了哪个平台，那个平台的用户就更新不了。

import fs from 'fs';
import path from 'path';

const [dir, version, outPath, notesFile] = process.argv.slice(2);

if (!dir || !version || !outPath) {
    console.error('用法: node updater/merge-fragments.mjs <fragmentsDir> <version> <outPath> [notesFile]');
    process.exit(1);
}

if (!fs.existsSync(dir)) {
    console.error(`片段目录不存在: ${dir}`);
    process.exit(1);
}

const platforms = {};
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const f of files) {
    const full = path.join(dir, f);
    let obj;
    try {
        obj = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
        console.error(`跳过无法解析的文件 ${f}: ${e.message}`);
        continue;
    }
    for (const [key, value] of Object.entries(obj)) {
        if (!value || !value.signature || !value.url) {
            console.error(`片段 ${f} 里的 ${key} 缺少 signature 或 url，跳过`);
            continue;
        }
        platforms[key] = value;
    }
}

const keys = Object.keys(platforms);
if (keys.length === 0) {
    console.error('没有可用的平台条目，update.json 不会生成');
    process.exit(1);
}

let notes = '';
if (notesFile && fs.existsSync(notesFile)) {
    notes = fs.readFileSync(notesFile, 'utf8').trim();
}

const update = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
};

fs.writeFileSync(outPath, JSON.stringify(update, null, 2));
console.log(`已生成 ${outPath}`);
console.log(`  版本: ${version}`);
console.log(`  平台: ${keys.join(', ')}`);
for (const k of keys) {
    console.log(`    ${k} -> ${platforms[k].url}`);
}
