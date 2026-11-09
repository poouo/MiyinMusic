# 觅音 · Windows 原生客户端

基于 **WinUI 3 / Windows App SDK** 的原生 Windows 桌面客户端，使用 C# + XAML 编写，不是 WebView 套壳，也不依赖 Electron。

## 功能

- 原生 QQ 音乐风格三段式界面：自绘标题栏、侧边栏、内容区、底部播放条
- 发现页：推荐歌单、排行榜、新歌速递、热门歌手、最近播放
- 排行榜（54 个榜单，平台筛选）、歌单广场（平台筛选 + 加载更多）
- 五大平台搜索、歌单 / 榜单 / 歌手详情页、歌曲列表分页
- 我的喜欢、播放记录、自建歌单（重命名 / 删除 / 移除歌曲）、歌曲收藏与添加歌单
- 桌面歌词：独立置顶透明窗口，五种配色、字号、双行、鼠标穿透；拖动移动，双击播放暂停，托盘菜单解锁
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
- 播放优先级：**主动下载文件 → 本地缓存 → 服务端流**
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

在“设置 → 桌面歌词”启用，播放歌曲后自动显示。提供翡翠流光、晴空蓝紫、落霞粉金、经典白色和半透明玻璃五种样式，支持 24–60 像素字号、双行与位置保存。拖动歌词移动，双击播放/暂停，右键锁定；锁定后鼠标穿透，通过托盘菜单或设置页解锁。主窗口隐藏后歌词仍显示，退出程序后自动移除。行内高亮按照该句时间段推进，不代表音源提供逐字时间戳。

GitHub Actions 的 **Build Windows client** 会输出 `miyin-windows-x64`，下载后解压完整目录运行 `MiYin.exe`。

Debug 构建支持 `MIYIN_DESKTOP_DATA_DIR` 指定测试数据目录，配合 `MIYIN_API_BASE` 可隔离本地验证；Release 构建不读取这些调试覆盖。
