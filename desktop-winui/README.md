# 觅音 · Windows 原生客户端

基于 **WinUI 3 / Windows App SDK** 的原生 Windows 桌面客户端，使用 C# + XAML 编写，不是 WebView 套壳，也不依赖 Electron。

## 功能

- 原生 QQ 音乐风格三段式界面：自绘标题栏、侧边栏、内容区、底部播放条
- 发现页：推荐歌单、排行榜、新歌速递、热门歌手、最近播放
- 排行榜（54 个榜单，平台筛选）、歌单广场（平台筛选 + 加载更多）
- 五大平台搜索、歌单 / 榜单 / 歌手详情页、歌曲列表分页
- 我的喜欢、播放记录、自建歌单（重命名 / 删除 / 移除歌曲）、歌曲收藏与添加歌单
- 桌面歌词：播放条“词”直接开关，悬停工具条、五种配色、字号、双行与鼠标穿透；锁定后悬停仅显示解锁按钮
- 全屏播放页：大封面、逐行歌词、点击歌词跳转、播放进度
- 播放队列面板、随机 / 单曲 / 列表循环、音质切换、音量 / 静音
- 下载管理：主动下载永久保留、进度 / 取消 / 打开位置
- 本地自动缓存：缓存目录、容量上限、自动缓存开关、清空缓存
- 账号登录 / 注册、昵称修改、收藏 / 歌单 / 记录同步
- 主题支持浅色 / 深色 / 跟随系统，默认跟随 Windows
- 固定连接 `https://music.poouo.com`，没有服务器配置入口
- 启动直接进入主界面，连接和账号同步全部后台静默进行；连接成功后自动刷新，不显示“已连接”状态
- 首页内容会缓存到本地，断网或慢网时先展示上次内容，再静默更新
- **系统托盘**：关闭窗口 / 最小化到托盘可分别配置；托盘菜单支持播放暂停、上一首、下一首和退出
- 无可用音频输出端点时自动进入静音播放时钟，播放进度、歌词和队列仍正常推进
- 任务栏显示自定义图标（同时设置窗口类图标和 WM_SETICON，修复 WinUI 3 任务栏空白图标）

## 技术实现

- `WinUI 3` + `Windows App SDK 2.6.4`，目标 `net8.0-windows10.0.19041.0`，x64
- 播放使用 `Windows.Media.Playback.MediaPlayer`，SMTC / 系统媒体控制
- 本地 `127.0.0.1` Kestrel 回环代理转发音频请求，解决 MediaPlayer 无法携带自定义 UA / Bearer 的问题
- 普通播放优先级：**主动下载文件 → 本地缓存 → 服务端流**；手动切换音质仅复用匹配音质的本地文件
- 客户端缓存独立于下载目录，LRU 清理；主动下载不受缓存上限影响
- 服务端负责音源脚本自动更新和歌单 / 收藏音频缓存，客户端不需要关心音源更新

## 构建

环境：Windows 10 1809+ / Windows 11 x64，.NET 8 SDK，Windows App SDK 通过 NuGet 还原。

```powershell
cd desktop-winui\MiYin.Desktop
dotnet build MiYin.Desktop.csproj -c Debug -p:Platform=x64 -p:RuntimeIdentifier=win-x64
dotnet publish MiYin.Desktop.csproj -c Release -r win-x64 --self-contained true `
  -p:Platform=x64 -p:WindowsAppSDKSelfContained=true -p:PublishSingleFile=false `
  -o ..\publish\win-x64
```

发布目标是自包含的免安装程序，目标机器不需要安装 .NET 或 Windows App SDK。
`dotnet publish` 默认不会复制 WinUI 的 XBF / PRI，项目里的 `CopyXamlArtifactsForUnpackagedPublish` 目标会自动补齐。

## 运行与服务器地址

- 正式版固定 API：`https://music.poouo.com`，客户端内不可修改
- 只有 Debug 构建允许用环境变量 `MIYIN_API_BASE=http://127.0.0.1:3000` 做本地调试；Release 包忽略该变量
- 配置保存在 `%APPDATA%\MiYin\config.json`
- 本地缓存默认在 `%LOCALAPPDATA%\MiYin\Cache`
- 主动下载默认在 `%USERPROFILE%\Music\觅音`

## 目录

```
MiYin.Desktop/
├─ Models/          数据模型
├─ Services/        Api / Auth / Library / Media / Cache / Download / LocalMediaServer
├─ Controls/        SongListView 等原生控件
├─ Views/           Home / Search / Charts / Square / Songs / Library / Downloads / Settings
├─ Styles/          Theme.xaml 设计系统与卡片模板
├─ MainWindow.xaml  自绘标题栏 + 侧边栏 + 播放条 + 全屏播放 + 队列
└─ Assets/          应用图标
```

## 说明

- 当前自动化验证环境没有可用的音频输出端点，MediaPlayer 会返回 `SourceNotSupported`；在有声卡的 Windows 上播放链路正常。音频解析、服务端流、回环代理和缓存写入均已验证。
- 客户端不做音源更新入口；服务端每 6 小时检查并更新 GitHub 洛雪音源。

## 桌面歌词

播放条与完整播放页的“词”直接开关桌面歌词。未锁定时，鼠标移入显示半透明底板和居中工具条，支持打开主窗口、上一首、播放暂停、下一首、时间微调、锁定、设置与关闭；移出隐藏。设置菜单提供配色、24–60 像素字号与单双行，右键“词”也可打开。

锁定后保持透明背景，鼠标移入只显示居中的解锁按钮，其余区域穿透鼠标；解锁后恢复工具条。位置会自动保存，主窗口隐藏后歌词仍显示，退出程序后自动移除。行内高亮按照该句时间段推进，不代表音源提供逐字时间戳。

GitHub Actions 的 **Build Windows client** 统一输出 `MiYin-Windows-x64` 产物，内含 `MiYin-Windows-x64.zip` 与 SHA-256 校验文件。下载产物后，再解压客户端 ZIP 的完整目录运行 `MiYin.exe`；`build-info.json` 记录对应提交和构建链接。云端先检查播放与歌词逻辑，再发布并校验 EXE、PRI、XBF 和自包含运行库；同分支新构建取消旧的未完成构建，产物保留 14 天。

Debug 构建支持 `MIYIN_DESKTOP_DATA_DIR` 指定测试数据目录，配合 `MIYIN_API_BASE` 可隔离本地验证；Release 构建不读取这些调试覆盖。

## 当前播放器布局

底部播放条支持点击空白区展开完整播放页，播放模式从四项菜单中选择。左侧导航可收起为图标栏并保存状态；音量按钮打开竖向调节浮窗。鼠标离开窗口 5 秒后底栏歌曲信息改为当前歌词，移回恢复；在完整播放页播放时离开约 8 秒淡出控制区，移回或暂停恢复。

桌面歌词未锁定时，右边缘可调宽，右下角可调宽与字号；调整自动保存，锁定后禁用缩放。新版自包含发布包为 `publish/MiYin-Windows-x64-2026-11-10-layout-fix.zip`。
