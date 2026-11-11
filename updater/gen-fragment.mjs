// 为一个平台生成更新片段（fragment）。
// 每个构建 job 各跑一次，产物是 { "<platformKey>": { signature, url } }，
// 最后由 merge-fragments.mjs 合成完整的 update.json。
//
// 用法：
//   node updater/gen-fragment.mjs <platformKey> <sigPath> <assetName> <version> <repo> <outPath>
//
// 例：
//   node updater/gen-fragment.mjs windows-x86_64 \
//     src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/pot-study_3.1.0_x64-setup.nsis.zip.sig \
//     pot-study_3.1.0_x64-setup.nsis.zip 3.1.0 LIU-31415/pot-study fragment.json

import fs from 'fs';

const [platformKey, sigPath, assetName, version, repo, outPath] = process.argv.slice(2);

if (!platformKey || !sigPath || !assetName || !version || !repo || !outPath) {
    console.error(
        '用法: node updater/gen-fragment.mjs <platformKey> <sigPath> <assetName> <version> <repo> <outPath>'
    );
    process.exit(1);
}

// signature 必须是 .sig 文件的内容（不是路径），Tauri 用它验签
const signature = fs.readFileSync(sigPath, 'utf8').trim();
if (!signature) {
    console.error(`签名文件是空的: ${sigPath}`);
    process.exit(1);
}

const url = `https://github.com/${repo}/releases/download/v${version}/${assetName}`;
const fragment = { [platformKey]: { signature, url } };

fs.writeFileSync(outPath, JSON.stringify(fragment, null, 2));
console.log(`${platformKey} -> ${outPath}`);
console.log(`  url: ${url}`);
console.log(`  signature 长度: ${signature.length}`);
