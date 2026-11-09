# 觅音 Android

原生 Android 客户端，使用 Kotlin + Jetpack Compose 构建，界面借鉴 QQ 音乐鸿蒙版的卡片与内容层级，结合 AndroidLiquidGlass 的折射、高光与悬浮胶囊。

## 功能

- 发现页：推荐歌单、排行榜、新歌速递、热门歌手
- 多平台搜索：QQ 音乐 / 网易云 / 酷我 / 酷狗 / 咪咕
- 歌单详情、排行榜详情
- Media3 / ExoPlayer 播放，支持后台播放、进度拖动、上一首 / 下一首、随机 / 循环
- 系统媒体通知、锁屏控制：封面、标题、播放 / 暂停、上一首 / 下一首、进度
- 只有播放中才允许横屏；横屏播放页为封面 + 歌词 / 控制双栏布局，暂停后自动回到竖屏
- 全屏歌词页：LRC 解析、当前行高亮、翻译行、播放队列
- 收藏 / 最近播放 / 收藏歌单，账号登录后同步
- 登录 / 注册、自动恢复会话
- 浅色 / 深色 / 跟随系统主题
- 页面切换、播放页展开、迷你播放器、底栏选中、歌词高亮等动画
- AndroidLiquidGlass（Backdrop）玻璃质感底栏、迷你播放器
- 首页和账号内容持久化：启动先显示上次快照，各区块并发刷新；断网保留缓存
- QQ 音乐 / 网易云音乐公开歌单外链导入，支持分享文字、移动端链接及官方短链接；先预览再保存
- 独立设置页：主题、默认音质、音频缓存上限（128 MB–2 GB）、缓存用量与清理
- 播放页切换标准 / 高品质 / 无损 / Hi-Res，保留播放进度，显示实际返回的音质
- 均衡器：原声 / 流行 / 摇滚 / 古典 / 人声 / 低音增强，以及自动保存的五段自定义曲线
- 可选车载蓝牙歌词兼容模式：通过 AVRCP 媒体标题与歌词广播更新当前歌词；能否展示取决于车机，通知和锁屏标题也会同步变化
- 通知栏喜欢 / 取消喜欢按钮，与 APP 收藏同步；后台播放控制随服务保留
- 展开歌词后上下拖动，松手跳转到居中的歌词；也可点按某句定位
- 统一自适应图标与系统启动页，支持深浅色和 Android 13 主题图标

## 固定签名与覆盖更新

GitHub debug 构建统一使用 `signing/miyin-debug.p12`，本地与 CI 签名相同。该文件是刻意公开的开发证书（别名 `androiddebugkey`，口令 `android`），只用于当前 debug 分发。请保留此文件，重新生成会再次造成签名冲突。正式商用发布应使用独立、私密的 release 密钥。

历史 CI 使用临时生成的 debug 密钥，无法从 APK 反推出原始私钥。若没有旧密钥，旧安装首次迁移到本版需要卸载一次；账号收藏和歌单重新登录后恢复，此后本工作流的 APK 可正常覆盖。工作流用递增的 `github.run_number` 设置版本号，并校验 APK 签名指纹。

## 验证

`gradle testDebugUnitTest lintDebug assembleDebug`：链接识别、模型字段与歌词时间、EQ 频率映射、静态检查和 APK 编译。

GitHub 的 Android Emulator Smoke Test 使用 `scripts/android-smoke.py` 按无障碍标签操作，生成首页、滚动内容、设置、EQ、播放、歌词、队列、横屏和通知截图。

服务端新增导入去重、原子容量检查、收藏幂等和严格音质选择，需要同步更新服务端；外链读取与旧服务端的公开歌单接口兼容。公开、可访问的歌曲才可读取，单个导入歌单上限 2000 首。

## 技术栈

- Kotlin 2.3.10，Compose Multiplatform 1.10.3
- Android Gradle Plugin 8.13.2，Gradle 8.13
- Media3 1.8.0
- OkHttp 4.12.0 + kotlinx.serialization
- Coil 2.7.0
- [AndroidLiquidGlass / Backdrop](https://github.com/Kyant0/AndroidLiquidGlass) 1.0.6

客户端固定连接 `https://music.poouo.com`，不提供服务器地址配置。

## 构建

本地需要 JDK 17、Android SDK 36。也可以直接使用 GitHub Actions：

下载最新 debug APK：

https://github.com/poouo/MiyinMusic/releases/download/android-latest/app-debug.apk

## 运行

1. 安装 APK（最低 Android 8.0，minSdk 26）
2. 打开后自动连接公网服务端
3. 在“我的”页登录账号，或直接以游客身份浏览和播放

## 截图

- [首页](../docs/screenshots/android/screenshot-home.png)
- [搜索](../docs/screenshots/android/screenshot-search-results.png)
- [播放·竖屏](../docs/screenshots/android/screenshot-now-portrait.png)
- [播放·横屏](../docs/screenshots/android/screenshot-now-landscape.png)
- [系统媒体通知](../docs/screenshots/android/screenshot-notification.png)
- [我的](../docs/screenshots/android/screenshot-library.png)
- [登录](../docs/screenshots/android/screenshot-login.png)

## 说明

AndroidLiquidGlass 以 Apache-2.0 许可证使用，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 桌面歌词 / 悬浮歌词

在“我的 → 设置 → 桌面歌词”开启，首次使用会跳转系统的“显示在其他应用上层”授权页，返回后自动显示。歌词由现有播放服务管理，支持五种配色、三档字号、当前句与下一句双行显示。未锁定时可上下拖动，底部可锁定或关闭；锁定后触摸穿透，回到设置可解锁或重置位置。没有时间轴歌词时显示歌曲名与歌手。系统禁止悬浮窗的页面无法覆盖；部分手机后台显示需在系统电池设置中允许音乐应用持续运行。

设置页与用户错误提示不展示服务端域名或 API 路径；内部请求地址仍保留以正常连接服务。
