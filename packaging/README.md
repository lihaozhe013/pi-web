# Fork 本地便携包（纯自用）

这个 fork 只供个人使用，开发、测试和打包全部在本地进行。所有 GitHub Actions 工作流均已主动移除，**不使用也不需要 CI**；不要为打包恢复工作流。这里不承诺公开发行或跨平台持续验证。

Fork 的 UI 风格和上游升级后的重建原则见 [UI 设计说明](../docs/fork-ui-design.md)。

## 与现有命令的区别

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发，使用当前目录 `.next` |
| `npm run start` | 直接执行 `next start`，需要已构建的 `.next` 和依赖 |
| `node bin/pi-web.js --no-open` | 上游 CLI 启动器：检查 Node、轮换 preview secrets、启动项目内 Next、管理进程记录 |
| `npm run release` | 上游 npm 发布：增加 patch 版本、在当前目录构建、发布到 npm。**不是便携打包，不要用于个人 fork 发行。** |
| `npm run package:portable` | 新增：隔离构建、安装运行依赖、打包并验证，不改版本、不发布 npm、不修改当前 `.next` |

目标机器只需 Node；Next 和运行依赖已经包含在压缩包中。无需全局 Next，也无需在目标机器 `npm install`。

## 本机打包

要求：Git、Node.js **最新 LTS**（本地手动安装或升级，并满足 `package.json.engines`）、npm、支持 gzip 的 `tar`，以及 `node-pty` 所需的系统环境/必要时的原生编译工具。
现代 Windows 自带 tar；Linux/macOS 使用系统 tar。必须在目标操作系统/架构上构建，不支持交叉编译。

```sh
npm run test:portable
npm run package:portable
# 可选：指定输出目录
npm run package:portable -- /path/to/output
```

脚本不要求先在仓库安装依赖。它在系统临时目录中：

1. 用 `git ls-files` 复制受 Git 跟踪的工作区文件（包含已修改文件，不含未跟踪文件）。新增应用文件应先 `git add`；已跟踪的敏感文件也会进入构建，发布前务必审查。
2. `npm ci`，再执行上游 `npm run build`，不占用当前仓库 `.next`。
3. `npm pack` 复用上游 `package.json.files` 白名单；此操作只生成文件，不发布到 npm。
4. 解压 npm 包，带上 lockfile，再 `npm ci --omit=dev` 安装匹配平台的生产依赖，保留安装脚本和原生资源。
5. 生成含完整 `node_modules` 的 tar.gz，再解压到另一个带空格的路径进行验证。
6. 验证 CLI、真实 PTY 子进程、HTTP 首页、静态资源、sessions API；通过后输出压缩包和 SHA-256。

默认输出在已忽略的 `build/portable/`。临时目录无论成功失败都会清理。此流程依赖网络下载 npm 依赖，但**目标服务器运行不需要 npm 安装**。
首次版本优先完整依赖，不使用 standalone，也不重写上游启动器。包体较大是有意的取舍。

## 目标机器运行

```sh
# Linux x64 示例，文件名版本以实际 release 为准
sha256sum -c pi-web-0.12.2-linux-x64-glibc.tar.gz.sha256
tar -xzf pi-web-0.12.2-linux-x64-glibc.tar.gz
cd pi-web
node bin/pi-web.js --no-open
```

Windows 也可用 `tar -xzf ...`，然后用相同 Node 命令。macOS 可用 `shasum -a 256` 校验。
压缩包所有文件放在 `pi-web/` 下，请保留隐藏 `.next` 和完整依赖目录。
安装目录必须对运行用户可写，启动器需要轮换 preview secrets。

默认监听 `127.0.0.1:30141`。无头服务器推荐 SSH 转发：

```sh
ssh -N -L 30141:127.0.0.1:30141 user@server
```

然后本地打开 `http://127.0.0.1:30141`。不要将未认证服务直接暴露到公网。
若需要后台常驻，请另用 systemd 等进程管理器，启动命令指向安装目录中的 `bin/pi-web.js`；默认命令保持前台运行。

## 本地验证与版本留存

没有 `.github/workflows/fork-portable.yml`，也没有 Actions 构建矩阵、自动 artifacts 或自动 GitHub Release。推送 `portable-*` tag 不会触发打包或发行。

- 按需在自己的目标平台运行本地打包；在什么系统/CPU 上构建，就验证该平台的包，不把某个平台的结果当作其他平台已通过。
- 留存压缩包、SHA-256 和 `PORTABLE.json`，需要时手动备份或搬到自己的机器。Git tag 可以用于个人版本标记，但不是必需步骤，也不会自动发布。
- 不要使用 `npm run release`：它是上游 npm 发布命令，会修改版本、在当前目录构建并发布到 npm。自用打包不需要 npm 发布 token。
- 压缩包文件名取应用版本和平台；`PORTABLE.json` 记录精确提交、构建平台和实际 Node 版本。脚本会复制已跟踪的未提交修改，因此需要可追溯的包时应先提交代码，不能仅靠提交号还原未提交内容。

没有固定的跨平台 runner 基线或自动跟随 LTS 的机制。请自行维护本地 Node LTS；原生模块问题按 `PORTABLE.json` 中的实际环境排查。Alpine/musl 不受支持，不能把依赖目录跨平台复制。

可先单独验证当前依赖中的 PTY，不必重复构建整个应用：

```sh
node packaging/pty-probe.mjs .
```

此探测会记录加载、启动和退出阶段；确认子进程成功退出并输出标记后，主动退出独立探测进程，避免 Windows ConPTY 的残留原生句柄导致假超时。真实失败仍会使打包终止。

## 更新与边界

- 停止旧实例，解压新包到新目录，再启动；保留旧目录方便回退。用户会话和设置仍在用户数据目录中，升级前备份。
- 不要在运行中的目录覆盖 `.next` / `node_modules`，不要同时用新旧版本写同一会话。
- 上游 `update` 命令针对全局 npm 安装，不适用于便携包。
- 可用 `PI_WEB_SKIP_VERSION_CHECK=1` 禁用上游版本检查，避免将其提示误认为 fork 更新。
- 便携包不包含 Node、Git、Python、shell 或 MCP 外部程序。插件/技能安装可能需要 npm/npx；完整安装 Node 时通常已经包含它们。
- 冒烟验证不等于全部功能验证；OAuth、各种模型、MCP 和第三方插件仍需按实际用途测试。

所有打包实现留在 `packaging/`，仅通过 `package.json` 的本地命令接入；不依赖任何 workflow，应用运行时/SDK/API 不变，便于继续跟上游合并。
