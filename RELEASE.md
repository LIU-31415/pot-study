# 发布与维护流程

这份文档记录 Pot Study 的改动、发版和自动更新是怎么串起来的。所有内容都基于本机实测，不是照抄文档。

## 一、先认清几个关键位置

| 东西 | 位置 |
| --- | --- |
| 仓库 | `github.com/LIU-31415/pot-study`，主分支 `master` |
| 签名私钥 | `C:\Users\LIU\.tauri\pot-study.key` |
| 公钥 | 写在 `src-tauri/tauri.conf.json` 的 `tauri.updater.pubkey` |
| GitHub Secret | `TAURI_PRIVATE_KEY`（私钥文件内容） |
| 本机安装 | `C:\Program Files\Pot Study` |
| 配置文件 | `%APPDATA%\com.pot-app.desktop\config.json` |
| CI 流程 | `.github/workflows/release.yml` |

**私钥只有这一份，丢了就再也发不出更新**，所有装了旧版的人只能手动重装。务必在网盘或密码管理器留备份。

## 二、日常改动

改代码 → 本地看效果 → 提交。

本地调试用开发模式（热重载，改完界面立刻变）：

```
node node_modules\@tauri-apps\cli\tauri.js dev
```

本机没装 `pnpm` 命令，所以直接调 `node_modules` 里的 CLI，不要写 `pnpm tauri dev`。

改完提交：

```
git add -A
git commit -m "fix(study): 修 xxx"
git push origin master
```

push 到 master **不会**触发构建，只有打 tag 才会发版。可以放心提交。

## 三、发版：三步

**第一步，更新 CHANGELOG。** 仓库根目录的 `CHANGELOG` 会作为 Release 正文的第一部分显示给用户。现在里面还是 3.0.7 的旧记录，发新版前先改成这次改了什么。

**第二步，打 tag 并推送。** tag 名就是版本号，前面加 `v`：

```
git tag v3.1.1
git push origin v3.1.1
```

**第三步，等 CI 跑完。** 大约 15–20 分钟，四个任务：Windows x64、macOS Apple Silicon、macOS Intel、发布。

看进度：

```
gh run list --repo LIU-31415/pot-study --limit 3
gh run view <run-id> --repo LIU-31415/pot-study
```

或者直接开 `https://github.com/LIU-31415/pot-study/actions`。

跑完之后：

- `releases/tag/v3.1.1` 里有各平台安装包
- `releases/tag/updater` 里的 `update.json` 会自动更新，客户端靠它判断有没有新版

## 四、版本号规则

tag 名去掉 `v` 就是版本号，CI 会自动写进 `package.json`、`tauri.conf.json`、`tauri.release.conf.json` 和 `Cargo.toml`，不需要手动改。

**只能往上走，不要重复或倒退。** 客户端比较的是「远端版本 > 当前版本」，版本号没涨就不会提示更新。

**不要用 `-beta` 这类预发布后缀。** 在 semver 里 `3.1.1-beta.1` 比 `3.1.1` 小，而且用着稳定版的人也会收到 beta 提示，因为静态更新清单没有测试通道的概念。

## 五、自动更新是怎么工作的

1. 程序启动后读 `https://github.com/LIU-31415/pot-study/releases/download/updater/update.json`
2. 比对里面的 `version` 和当前程序版本
3. 更高就下载对应平台的包，用内置公钥验签
4. 验签通过才安装

`update.json` 里的三个平台键是固定的：`windows-x86_64`、`darwin-aarch64`、`darwin-x86_64`。签名必须是对应 `.sig` 文件的**内容**，不是路径。

因为程序装在 `Program Files`，自动更新时会弹一次 UAC 让你允许，这是正常的。

## 六、CI 里几个容易踩的地方

这些都踩过，改 workflow 时留意：

- `--config` 的路径相对**项目根**，不是相对 `src-tauri`。要写 `src-tauri/tauri.release.conf.json`。
- macOS 构建必须显式传 `--bundles app,dmg,updater`，不能沿用配置里的 `nsis`（那是 Windows 专用的）。
- **不要设空的 `APPLE_*` 环境变量。** Tauri v1.6.3 会把它读成空字符串然后走进签名分支，找不到证书就失败。没证书就别设。
- `tauri build` 认的私钥是环境变量里的**文件内容**（base64），不是路径。
- `tauri signer sign` 反过来，只认 `-f` 指定的文件路径，而且**必须传 `-p ""`**，否则会去等交互输入密码，在非终端环境直接挂死。
- `updater` 那个 release 要显式 `make_latest: false`，否则会抢走 Latest 标记，仓库首页显示的会是一个只含 json 的空壳。

## 七、当前状态

**已验证**：v3.1.0 完整走通了一遍——三个平台构建、签名、发布、update.json 生成，本机装 3.1.0 后功能正常、配置保留。

**未验证**：自动更新本身还没跑过。要等下一次发版（比如 3.1.1），在 3.1.0 上确认程序能弹出更新提示并装上，整条链路才算闭环。

## 八、macOS 的特殊说明

没有 Apple 开发者证书，包是未签名的。macOS 15 之后用户首次打开会被拦，必须去「系统设置 → 隐私与安全性」点「仍要打开」，右键「打开」已经不管用。

这段说明写在 `INSTALL.md` 里，CI 会自动把它拼在 Release 正文后面，不用每次重贴。

要消除这个提示得买 Apple 开发者账号（一年 99 美元）做签名和公证，暂时没做。
