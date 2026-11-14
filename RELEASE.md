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

**第一步，更新 CHANGELOG。** 仓库根目录的 `CHANGELOG` 会作为 Release 正文的第一部分显示给用户。

### CHANGELOG 怎么写

写给装了这个软件的人看，不是写给改代码的人看。

- 只说这个版本比上个版本多了什么、哪里变好了，不写「改了什么实现」
- 修 bug 写「之前什么表现，现在什么表现」，不写是哪行代码、哪个库的坑
- **不写开发过程中自己造出来又修掉的错误**。用户从没见过那个问题，写上去只会让人困惑「我用的版本是不是坏的」
- 不用类名、字段名、配置键名，这些对用户没有意义

反例（3.2.0 初稿，已被指出）：

> 修：设置窗口标题显示成 `config.study.title`。清理文案时误删了这个键

正例：

> 修：设置窗口标题显示错误

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
- **本地手动构建 release 必须带 `--features custom-protocol`。** 不加的话程序不会内嵌前端资源，运行时去找 `devPath`（`127.0.0.1:1420`），界面显示「拒绝连接」。CI 用的 `tauri build` 会自动加，只有手动 `cargo build` 时容易漏。
- macOS 构建必须显式传 `--bundles app,dmg,updater`，不能沿用配置里的 `nsis`（那是 Windows 专用的）。
- **不要设空的 `APPLE_*` 环境变量。** Tauri v1.6.3 会把它读成空字符串然后走进签名分支，找不到证书就失败。没证书就别设。
- `tauri build` 认的私钥是环境变量里的**文件内容**（base64），不是路径。
- `tauri signer sign` 反过来，只认 `-f` 指定的文件路径，而且**必须传 `-p ""`**，否则会去等交互输入密码，在非终端环境直接挂死。
- `updater` 那个 release 要显式 `make_latest: false`，否则会抢走 Latest 标记，仓库首页显示的会是一个只含 json 的空壳。

## 七、当前状态

**已验证**：v3.1.0 和 v3.1.1 都完整走通了——三平台构建、签名、发布、update.json 生成，安装后配置保留。3.1.1 时 macOS arm64 因 `macos-latest` 排队 15 分钟没分到机器被取消，重跑成功；标签已改成 `macos-14`。

**未验证**：自动更新本身还没跑过。要等下一次有实际改动的发版，在 3.1.1 上确认程序能弹出更新提示、点「更新」能下载安装并重启，整条链路才算闭环。

## 八、macOS 的特殊说明

**runner 标签**：Apple Silicon 用 `macos-15`，Intel 用 `macos-15-intel`。不要用 `macos-latest`——它是通用标签，机器池紧张时排队十几分钟分不到机器，3.1.1 发版时就被取消过一次。

**`macos-14` 已经失效**。GitHub 当前支持的 macOS 标签只有 `macos-15` / `macos-26` / `macos-latest`（arm64）和 `macos-15-intel` / `macos-26-intel`（Intel）。3.2.0 发版时用 `macos-14` 直接报 `The configuration 'macos-14-arm64-us-default' is not supported`，2 秒就失败。改标签时先对一下官方文档的表。

没有 Apple 开发者证书，包是未签名的。macOS 15 之后用户首次打开会被拦，必须去「系统设置 → 隐私与安全性」点「仍要打开」，右键「打开」已经不管用。

这段说明写在 `INSTALL.md` 里，CI 会自动把它拼在 Release 正文后面，不用每次重贴。

要消除这个提示得买 Apple 开发者账号（一年 99 美元）做签名和公证，暂时没做。
