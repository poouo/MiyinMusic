# 觅音 · MiYin Music

一个自托管的 **Web 音乐播放器**，手机 / 平板 / 桌面全端自适应，Web 界面采用**石墨灰与暖橙的唱片店风格**。
歌曲搜索接五大平台公开接口，播放地址由 [洛雪音乐自定义音源](https://github.com/pdone/lx-music-source) 在服务端实时解析。
支持**多用户**（游客 / 普通用户 / 会员 / 管理员）、**管理后台**与可配置的**下载权限**，数据存放在 SQLite。

同时提供 **Windows 原生客户端**（WinUI 3 / C#，非 WebView 套壳），见 [desktop-winui](desktop-winui/README.md)；以及 **Android 原生客户端**（Kotlin / Jetpack Compose + Liquid Glass），见 [android](android/README.md)。

Android APK：[下载](https://github.com/poouo/MiyinMusic/releases/download/android-latest/app-debug.apk)

三端新增功能、操作入口与验证范围见 [1–7 工作包实施记录](docs/implementation-progress.md)。现有发布包尚未包含当前工作区未发布的改动。

---

## 功能特性

**播放**
- 音源脚本在服务端沙箱中运行，多音源并发竞速，失败按音质降级重试
- 音频经同源代理转发，支持 Range，可拖动进度条
- 播放队列、顺序 / 列表循环 / 单曲循环 / 随机四种互斥模式，Web / Android / Windows 使用相同切换顺序
- **点击选择音质**（Hi-Res / 无损 / 高品质 / 标准），不再一键盲切
- 桌面播放条按歌曲、播放控制、歌词进度和功能按钮分组；向左收起成唱片入口，向右展开
- **当前歌词直接显示在播放条里**：长句会按这句的时长自动横向滚动，唱到哪滚到哪，下一句重新开始
- 底部播放条与完整播放页均提供音量滑杆、静音和百分比
- 完整播放页默认显示逐行滚动歌词（含翻译），独立打开播放队列；支持 Media Session 锁屏控制
- 三端搜索历史、睡眠定时、本曲后停止、歌词偏移，以及默认暂停的队列和进度恢复
- 下一首播放地址短期预取；Web 真实五段均衡器，Android 保留系统均衡器

**内容**
- 酷我、酷狗、QQ 音乐、网易云、咪咕五大平台搜索
- **发现页**：推荐歌单、排行榜、新歌速递、热门歌手一屏聚合，平台内容交替展示
- **歌单广场**：网易云 / QQ 音乐精选歌单，按平台筛选、加载更多；点开可直接播放整张歌单
- **新歌速递**：网易云每日新歌 + QQ 音乐新歌榜，实时更新，点封面即播
- **热门歌手**：QQ 音乐热门歌手榜，进入歌手页听热门歌曲
- **54 个排行榜**：网易云 12 + QQ 16 + 酷我 14 + 酷狗 12，可按平台筛选
- **我的喜欢**：内置歌单常驻侧边栏，点心形即收藏
- 自建歌单、播放记录
- QQ / 网易真实歌手作品分页、专辑详情、关注歌手，以及基于喜欢和近期播放的推荐理由
- 公开歌单完整预览并保存独立副本；三端按账号保留音乐库元数据快照
- Android 主动离线下载与队列 / 歌单编辑；Windows 本地目录扫描与音乐索引

**Windows 原生客户端（WinUI 3）**
- 原生 XAML / C#，不依赖 WebView2 / Electron
- 发现、排行榜、歌单广场、搜索、歌单 / 歌手详情
- 我的喜欢、最近播放、自建歌单、下载管理、设置
- 全屏播放与逐行歌词、播放队列、音质切换；循环模式使用不同图标
- 系统托盘：关闭 / 最小化到托盘、托盘菜单播放控制、退出
- 无音频设备时自动静音播放，进度与歌词仍正常推进
- 客户端自动缓存 + 主动下载，播放优先本地文件
- 服务端自动缓存歌单 / 收藏音频，音源脚本自动更新，客户端无需配置音源

**Android 原生客户端（Compose）**
- Kotlin + Jetpack Compose，原生 Material 3 界面，参考 QQ 音乐手机端
- 发现、搜索、歌单 / 榜单 / 歌手详情、我的音乐
- Media3 在线播放、迷你播放器、全屏歌词、播放队列
- Liquid Glass（AndroidLiquidGlass / Backdrop）底栏与播放器
- 登录 / 收藏 / 最近播放同步，浅色 / 深色 / 跟随系统

**外观**
- Web 端 7 套主题：跟随系统 / 石墨 / 日光 / 午夜蓝 / 森林 / 樱花 / 纯黑
- 右上角一键切换，选择保存在本机
- 中性底色、暖橙强调、真实封面与唱片细节，明暗两套完整的组件适配

**账号与权限**

| 角色 | 能力 |
| --- | --- |
| 游客 | 浏览、搜索、在线播放（能否下载由后台策略决定） |
| 普通用户 | 同步收藏 / 歌单 / 记录，按策略下载 |
| 会员 | 在普通用户基础上可单独放开下载权限 |
| 管理员 | 进入管理后台，管理用户、音源、下载策略 |

- 登录 / 注册是**弹出式窗口**，不再占用独立页面
- 第一位注册的用户自动成为管理员
- 管理员可在后台**创建 / 编辑 / 停用 / 删除用户**，重置密码、强制下线、解除登录锁定

**下载**
- 下载范围可配置：**游客 / 普通用户 / 会员 / 管理员** 四个受众任意组合
- 可下载音质可配置：Hi-Res / 无损 / 高品质 / 标准
- 下载请求在服务端二次校验角色与音质，超出范围直接拒绝；下载链接带签名与时效
- **音乐缓存**：歌单 / 收藏中的歌曲会自动缓存到服务端磁盘，上游音源失效后仍可播放；默认 8GB，管理后台可自定义到 4096GB，超出容量按 LRU 清理

**管理后台**（路由 #/admin，非管理员一律返回 404）
- 概览：用户/会话/播放统计、近 7 天注册曲线、平台分布、运行状态
- 用户管理：搜索、筛选、新建、改角色、停用、删号、重置密码、强制下线、解锁
- 音源：启停、重新加载、查看各平台可用性
- 站点设置：**开放 / 关闭注册**
- 下载权限：受众与音质策略
- **音乐缓存**：总容量、音质、自动预热开关、缓存统计 / 清空 / 手动预热
- 操作日志：登录、注册、下载、后台操作全量审计

---

## 界面预览

**桌面端**

![发现页](docs/screenshots/discover.png)

| 搜索 | 播放中（含歌词胶囊） |
| --- | --- |
| ![搜索](docs/screenshots/search.png) | ![播放中](docs/screenshots/playing.png) |

| 全屏播放 | 登录弹窗 |
| --- | --- |
| ![播放页](docs/screenshots/now-playing.png) | ![登录](docs/screenshots/login-modal.png) |

| 我的喜欢 | 主题切换 |
| --- | --- |
| ![我的喜欢](docs/screenshots/liked.png) | ![主题](docs/screenshots/themes.png) |

![排行榜](docs/screenshots/charts.png)

**管理后台**

| 概览 | 用户管理 | 下载权限 |
| --- | --- | --- |
| ![概览](docs/screenshots/admin-overview.png) | ![用户](docs/screenshots/admin-users.png) | ![下载](docs/screenshots/admin-download.png) |

**移动端 / 平板 / 浅色**

| 手机 · 首页 | 手机 · 播放页 | 平板 |
| --- | --- | --- |
| ![手机首页](docs/screenshots/mobile-home.png) | ![手机播放页](docs/screenshots/mobile-player.png) | ![平板](docs/screenshots/tablet.png) |

![浅色主题](docs/screenshots/light.png)

**Windows 原生客户端（WinUI 3）**

![原生首页](docs/screenshots/native-home.png)

| 排行榜 | 歌单广场 |
| --- | --- |
| ![原生排行榜](docs/screenshots/native-charts.png) | ![原生歌单广场](docs/screenshots/native-square.png) |

| 歌单详情 | 搜索 |
| --- | --- |
| ![原生歌单详情](docs/screenshots/native-playlist.png) | ![原生搜索](docs/screenshots/native-search.png) |

| 全屏播放 / 歌词 | 播放队列 |
| --- | --- |
| ![原生全屏播放](docs/screenshots/native-nowplaying.png) | ![原生队列](docs/screenshots/native-queue.png) |

| 我的喜欢 | 下载管理 |
| --- | --- |
| ![原生我的喜欢](docs/screenshots/native-liked.png) | ![原生下载](docs/screenshots/native-downloads.png) |

| 设置 | 自建歌单 |
| --- | --- |
| ![原生设置](docs/screenshots/native-settings.png) | ![原生自建歌单](docs/screenshots/native-my-playlist.png) |

---

## 快速开始

### 环境要求

- Node.js **20+**（推荐 22，内置 node:sqlite）
- 可访问 GitHub 与各大音乐平台接口的网络环境

    npm install          # 安装依赖
    npm run dev          # 开发：前端 5173 + 后端 3000
    npm run build        # 构建前后端
    npm start            # 生产：单端口 3000
    npm run smoke        # 接口自检

首次启动会从 GitHub 拉取音源脚本并缓存到 data/cache/，同时创建 SQLite 数据库 data/miyin.db。

### Windows 原生客户端

免安装包从 GitHub Actions 的 **Build Windows client** 下载 `MiYin-Windows-x64` 产物，内含客户端 ZIP 和 SHA-256 校验文件；解压客户端 ZIP 的完整目录后运行 `MiYin.exe`。客户端固定连接公网域名，不提供服务器配置入口。

从源码构建：

```powershell
cd desktop-winui/MiYin.Desktop
dotnet build MiYin.Desktop.csproj -c Debug -p:Platform=x64 -p:RuntimeIdentifier=win-x64
dotnet publish MiYin.Desktop.csproj -c Release -r win-x64 --self-contained true `
  -p:Platform=x64 -p:WindowsAppSDKSelfContained=true -p:PublishSingleFile=false `
  -o ../publish/win-x64
```

客户端固定连接 `https://music.poouo.com`，不提供服务器配置入口，安装后直接使用；只有 Debug 开发构建可以通过 `MIYIN_API_BASE=http://127.0.0.1:3000` 指向本地服务。
如果你之前用过 JSON 版本，启动时会自动把旧数据迁移进数据库，并把旧文件备份到 data/legacy-backup/。

### Docker 部署

仓库自带 `Dockerfile`、`docker-compose.yml` 和 GitHub Actions。推送到 `main` 后自动构建并推送：

```text
ghcr.io/poouo/miyinmusic:latest
```

NAS 上：

```bash
docker login ghcr.io
docker compose pull
docker compose up -d
```

镜像只支持 **linux/amd64**，数据目录通过 `./data:/app/data` 持久化。GHCR 包默认私有，需要先在 NAS 登录；也可以把 Package 设为 public 后匿名拉取。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| PORT | 3000 | 服务端口 |
| HOST | 0.0.0.0 | 监听地址 |
| MIYIN_DATA_DIR | ./data | 数据目录（数据库、音源缓存） |
| MIYIN_ALLOW_REGISTER | 1 | **首次初始化**时的注册开关，之后以管理后台为准 |
| MIYIN_NO_SOURCE_UPDATE | 0 | 设为 1 时不联网刷新音源脚本 |
| MIYIN_ACTION_TIMEOUT | 12000 | 单个音源动作超时（毫秒） |
| MIYIN_DEBUG | 0 | 输出详细日志 |

---

## 安全设计

**防爆破**
- 登录 / 改密前检查锁定状态，同一 IP 与同一账号分别计数
- 连续失败 5 次后开始锁定：30 秒起，按指数退避，最长 30 分钟
- 锁定期内即使密码正确也会被拒绝，并在审计日志中留痕
- 管理员可在「用户管理」里对单个账号或全部解除锁定
- 密码使用 scrypt 加盐哈希（异步，不阻塞事件循环）

**防爬虫 / 防滥用**
- 全局接口限流（按用户或 IP），搜索、取流、取址、下载各自独立配额
- **播放链接全部走签名代理**：接口不返回任何上游直链，链接 2 小时过期、绑定账号（游客绑定客户端指纹），换设备或改参数一律 403
- 下载链接 5 分钟过期，同样绑定账号
- robots.txt 全站禁止抓取，所有响应带 X-Robots-Tag: noindex
- 写请求做同源校验，拒绝跨站调用（CSRF）
- 代理层拦截内网地址（SSRF），限制响应体积

**权限**
- /api/admin/* 对非管理员统一返回 **404**，不暴露后台存在
- 前端对非管理员隐藏「管理后台」入口，且页面本身渲染 404
- 不能删除 / 停用 / 降级自己，也不能移除最后一位管理员

---

## 目录结构

    miyinmusic/
    ├─ server/                 Node.js 服务端（零运行时依赖）
    │  └─ src/
    │     ├─ index.ts          HTTP 入口（安全响应头、robots）
    │     ├─ routes.ts         REST API + 管理后台接口
    │     ├─ db.ts             SQLite 连接、建表、语句缓存
    │     ├─ migrate.ts        旧 JSON 数据一次性迁移
    │     ├─ auth.ts           用户 / 会话 / 密码 / 角色
    │     ├─ login-guard.ts    登录失败锁定（防爆破）
    │     ├─ rate-limit.ts     接口限流
    │     ├─ app-config.ts     注册开关、下载策略
    │     ├─ admin.ts          后台统计与用户列表
    │     ├─ library.ts        收藏 / 歌单 / 播放记录 / 设置
    │     ├─ audit.ts          审计日志
    │     ├─ stream.ts         音频与图片代理
    │     ├─ lx/               音源沙箱与调度
    │     └─ providers/        五大平台搜索与歌词
    ├─ desktop-winui/          WinUI 3 原生 Windows 客户端（C# / XAML）
    ├─ dist/                   Windows 免安装包
    ├─ web/                    React + Vite 前端
    │  └─ src/
    │     ├─ state/            播放器、账号、音乐库、配置、弹窗
    │     ├─ components/       布局、播放条、歌词滚动、音质菜单、主题切换…
    │     ├─ pages/            发现、搜索、音乐库、我的喜欢、播放页、设置、后台
    │     └─ styles/           液态玻璃设计系统
    ├─ scripts/                开发编排与自检
    ├─ docs/screenshots/       界面截图
    └─ data/                   运行时数据（SQLite + 音源缓存 + audio-cache）

### 数据表

| 表 | 用途 |
| --- | --- |
| users | 账号、角色、状态、最后登录 |
| sessions | 会话（token 的 SHA-256） |
| playlists / playlist_songs | 歌单与歌单歌曲（有序） |
| favorites / history | 收藏与播放记录 |
| user_settings | 每个用户的偏好 |
| sources | 音源启用状态 |
| audit_log | 审计日志 |
| login_guard | 登录失败计数与锁定 |
| audio_cache | 服务端音频缓存索引（歌单 / 收藏预热） |

备份：直接拷贝 data/miyin.db（可先执行 VACUUM INTO 得到紧凑副本）。

---

## 工作原理

    浏览器 ── 搜索 ──▶ providers ──▶ 酷我/酷狗/QQ/网易/咪咕 搜索接口
           ── 播放 ──▶ /api/url ──▶ 音源沙箱（洛雪脚本）──▶ 音频直链
           ── 拉流 ──▶ /api/stream（Range 透传 + 签名）──▶ 音频直链

音源脚本只负责「歌曲 → 播放地址」，因此搜索、歌词、封面由服务端直接对接各平台接口；
服务端用 node:vm 运行脚本并注入与洛雪一致的 globalThis.lx。

---

## 常见问题

**启动后一个音源都没有？**
首次需要访问 GitHub，服务端会自动尝试多个加速镜像；也可以在后台「音源」里点刷新。

**忘记管理员密码？**
删除数据库里该用户记录，或直接用 Node 脚本调用 auth.ts 的 resetPasswordByAdmin。首位注册者会成为管理员。

**关闭注册后还能加人吗？**
可以，管理员在「用户管理 → 新建用户」里手动创建，并可指定角色。

**能多人同时用吗？**
可以。SQLite 使用 WAL 模式，读写并发良好，每个账号数据相互隔离；多实例部署需共享同一数据库文件并注意写锁。

---

## 技术栈

- 前端：React 18、Vite 6、TypeScript，手写 CSS 设计系统（无 UI 框架）
- 桌面端：WinUI 3 / Windows App SDK 2.6.4、C#、.NET 8，自包含发布
- 后端：Node.js 原生 http、node:sqlite、node:vm、node:crypto，零运行时依赖

## 致谢

- 音源：[pdone/lx-music-source](https://github.com/pdone/lx-music-source)、[LX Music](https://github.com/lyswhut/lx-music-desktop)

本项目仅供学习与个人使用，音乐版权归各平台与版权方所有，请勿用于商业用途。
