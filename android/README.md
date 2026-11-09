# 觅音 Android

原生 Android 客户端，使用 Kotlin + Jetpack Compose 构建，UI 参考 QQ 音乐手机端。

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
