# 云粘贴 Flutter 客户端

这是云粘贴现有 Express 后端对应的 Flutter 客户端，源码位于独立目录
`flutter_app/`，支持一套代码构建：

- Flutter Web / H5
- Android APK / App Bundle
- macOS 应用（可在 macOS 上直接构建）
- Windows 桌面应用（需在 Windows 环境构建）
- iOS 应用（需要完整 Xcode、Apple Developer 账号和签名配置）

## 已接入后端能力

客户端复用当前目录下 `server/index.mjs` 提供的接口。文件列表页会保留已有内容并只显示局部进度条，快速切换“全部文件 / 我的分享 / 收藏 / 回收站”时不会清空整页；请求返回顺序也受到保护，旧页面请求不会覆盖当前页面。

复制/粘贴同时支持两种场景：文件列表中的“复制”和“剪切”会写入云端文件剪贴板，进入目标文件夹后点击“粘贴到这里”即可复制或移动文件、文件夹；复制后的项目可以在横幅中重复粘贴，也可以清除剪贴板。文本预览和新建粘贴窗口使用系统剪贴板，Android、Web、macOS 和 Windows 都可以从系统剪贴板读取或复制文本。

分享、收藏和回收站能力包括：

- “我的分享”支持复制链接、打开链接、查看有效期、延长有效期和关闭分享；
- 文件和文件夹都可以收藏或取消收藏；
- 文件和文件夹都可以移入回收站、恢复，文件夹操作会级联处理内部内容；
- 永久删除前会要求二次确认。

客户端复用当前目录下 `server/index.mjs` 提供的接口：

- `/api/config`：站点配置
- `/api/auth/login`、`/api/auth/register`、`/api/auth/me`：登录、注册、会话恢复
- `/api/overview`：概览统计
- `/api/files`、`/api/files/upload`、`/api/files/paste`：文件列表、上传、文本粘贴
- `/api/folders`：文件夹浏览与创建
- `/api/file-operations`：文件和文件夹云端复制、移动与粘贴
- `/api/files/:id`、`/api/files/:id/access`：收藏、回收站、分享和受保护访问
- `/api/folders/:id`：文件夹收藏、回收站级联恢复/移入和永久删除
- `/api/share/:token`：公共分享页和下载

## API 地址配置

客户端在代码中提供两个 API 环境选项：

| 模式 | `API_MODE` | 默认地址 |
| --- | --- | --- |
| 正式环境 | `production` | `https://ccopy.cloud123.uk:333` |
| 本地开发 | `local` | `http://127.0.0.1:8787` |

**默认模式是正式环境**，不传任何参数时，Web、Android 和 iOS 都会请求：

```text
https://ccopy.cloud123.uk:333/api/...
```

通过 `--dart-define=API_MODE=local` 切换到本地开发。`API_BASE_URL` 优先级最高，
可用于临时指定任意 API 根地址；所有地址都只填写根地址，不要重复写 `/api`。
`LOCAL_API_BASE_URL` 可覆盖本地模式的默认地址。

```bash
# 默认正式环境（无需额外参数）
flutter run
flutter build web --release
flutter build apk --release

# Web / macOS / iOS Simulator 访问本机后端
flutter run -d chrome --web-port 5174 \
  --dart-define=API_MODE=local \
  --dart-define=LOCAL_API_BASE_URL=http://127.0.0.1:8787

# macOS 桌面调试与发布构建
flutter run -d macos
flutter build macos --release

# Windows 桌面构建（请在 Windows + Visual Studio Desktop C++ 环境执行）
flutter build windows --release

# Android 模拟器访问宿主机后端
flutter run -d emulator-5554 \
  --dart-define=API_MODE=local \
  --dart-define=LOCAL_API_BASE_URL=http://10.0.2.2:8787

# Android 真机访问电脑后端：替换为电脑局域网 IP
flutter run \
  --dart-define=API_MODE=local \
  --dart-define=LOCAL_API_BASE_URL=http://192.168.1.100:8787

# 最高优先级：临时指定任意 API
flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.example.com

# API 与 H5 分域时，指定公共分享链接的 H5 根地址
flutter build web --release \
  --dart-define=API_BASE_URL=https://ccopy.cloud123.uk:333 \
  --dart-define=WEB_BASE_URL=https://paste.example.com
```

Android 模拟器不能通过 `127.0.0.1` 访问电脑，必须使用 `10.0.2.2`；Android 真机必须使用
电脑局域网 IP，并确保手机与电脑在同一网络。生产 Release 包应使用默认的 HTTPS 正式地址，
不要使用明文 HTTP。

### 客户端运行时切换服务端

登录后，在首页右上角菜单（移动端）或左侧导航（桌面端）打开“设置”，可以保存三组服务端地址：

- **外网**：默认正式地址 `https://ccopy.cloud123.uk:333`；
- **内网**：填写局域网服务端 IP，例如 `http://192.168.1.100:8787`；
- **自定义**：填写测试环境、反向代理或其他部署地址。

选择“内网”或“外网”后点击“保存并切换”即可一键切换。客户端会先请求目标地址的 `/api/config`
测试连接，测试通过后才会保存配置；已有登录令牌会在新服务端重新校验，若新服务端不接受该令牌，
客户端会自动回到登录页。地址只填写服务端根地址，末尾 `/api` 会自动去除。

Android 模拟器访问本机后端时仍使用 `http://10.0.2.2:8787`；Android 真机不能填写
`127.0.0.1`，应填写开发电脑在局域网中的实际 IP，并确保手机和电脑处在同一网络。Android 客户端
已允许用户配置内网 HTTP 地址；正式公网服务仍建议使用 HTTPS。若 H5 页面通过 HTTPS 部署，浏览器
会阻止访问 HTTP 内网地址，此时应给内网服务配置 HTTPS 或使用同源反向代理。

## Android Studio 导入（Android 优先）

截图中的“未配置 Dart SDK”通常是因为打开了仓库根目录，或 Android Studio 使用了旧的
`.idea/modules.xml`。Flutter 工程根目录必须选择：

```text
<仓库根目录>/flutter_app
```

不要选择以下目录作为 Flutter 工程根目录：

- `<仓库根目录>`（这里是 Express/Vite 后端与 Web 前端）
- `<仓库根目录>/flutter_app/android`（这里只是原生 Android Gradle 子工程）

导入步骤：

1. 在 Android Studio 选择 **File → Open**，打开 `flutter_app/`；
2. 确认已安装并启用 **Flutter** 插件（它会同时启用 Dart 插件）；
3. 在 **Settings/Preferences → Languages & Frameworks → Flutter** 设置 Flutter SDK 根目录，
   例如：`/opt/homebrew/share/flutter`；
4. Dart SDK 应自动使用 Flutter SDK 内置路径：
   `/opt/homebrew/share/flutter/bin/cache/dart-sdk`；
5. 执行一次 `flutter pub get`，然后关闭并重新打开 `flutter_app/` 工程；
6. 运行配置选择 `main.dart`，设备选择 Android 模拟器或真机。

如果只需要查看/调试原生 Android Gradle 工程，可以单独打开
`flutter_app/android/`；但此方式不会把 `lib/main.dart` 作为 Flutter 运行入口。

本项目已修正 Flutter 工程的 Android Studio 模块引用，模块应为：

- `yunpaste_flutter.iml`
- `android/yunpaste_flutter_android.iml`

## 本地开发

在仓库根目录启动后端（默认 `127.0.0.1:8787`）后，在 Flutter 目录执行：

```bash
cd flutter_app
flutter pub get
flutter analyze
flutter test
flutter run -d chrome --web-port 5174 \
  --dart-define=API_MODE=local \
  --dart-define=LOCAL_API_BASE_URL=http://127.0.0.1:8787
```

Android 模拟器使用 `10.0.2.2`；iOS Simulator 通常可以使用
`http://127.0.0.1:8787`。真机不能使用设备自身的 `localhost`，必须使用开发机局域网 IP，
并确保手机与电脑在同一网络。

## H5 构建与部署

### 构建

```bash
cd flutter_app
# 默认使用 https://ccopy.cloud123.uk:333
flutter build web --release
```

构建产物在：

```text
flutter_app/build/web/
```

### 推荐的同源 Nginx 部署

当前 Express 后端没有默认开放跨域，并且安全响应头按同源策略配置。因此推荐：

1. 将 `build/web/` 内容发布到 Nginx 静态目录；
2. Nginx 将 `/api/` 和 `/livez` 反向代理到现有 Express 服务 `127.0.0.1:8787`；
3. Flutter Web 与 API 使用同一个 HTTPS 域名。

可直接参考：

```text
flutter_app/deploy/nginx.conf.example
```

如果 H5 和 API 使用不同域名，需要在 Express 前增加严格的 CORS 白名单，并同步处理
文件下载、预览和授权请求；未配置 CORS 时不要跨域部署。移动端如果 API 与 H5 分域，
构建时还应同时传入 `WEB_BASE_URL`，否则公共分享链接会回退到 API 地址。

## 私有文件预览与下载

在“全部文件”“我的分享”“收藏”等文件列表中，点击文件即可获取后端签发的短期访问凭据。
当前客户端支持：

- 文本文件：在客户端内读取并显示可选择文本；
- 图片文件：在客户端内预览，并支持缩放；
- Word、Excel、PowerPoint、OpenDocument 等办公文档：调用后端 LibreOffice 转 PDF 预览；
- 视频、音频、压缩包及其他文件：通过系统浏览器或播放器打开，或直接下载；
- 私有访问 URL 不写入持久化存储，文件状态变化或凭据过期后需要重新打开文件。

后端对应接口为 `/api/files/:id/access` 和签名后的
`/api/file-access/:token/{raw,download,preview}`。

## Android 打包

### 本地可安装 APK

```bash
cd flutter_app
# 默认使用 https://ccopy.cloud123.uk:333
flutter build apk --release
```

输出：

```text
flutter_app/build/app/outputs/flutter-apk/app-release.apk
```

### Google Play App Bundle

```bash
# 默认使用 https://ccopy.cloud123.uk:333
flutter build appbundle --release
```

输出：

```text
flutter_app/build/app/outputs/bundle/release/app-release.aab
```

当前 Application ID 为 `com.yunpaste.app`。正式发布前请生成自己的 keystore，并在
`android/key.properties` 配置（该文件已被忽略，不要提交密码或 keystore）：

```properties
storePassword=替换为密钥库密码
keyPassword=替换为签名密码
keyAlias=upload
storeFile=/绝对路径或相对 android/app 目录的路径/upload-keystore.jks
```

项目会自动读取 `android/key.properties`：存在该文件时使用正式 keystore，不存在时才回退
到 Debug signing，方便本地验证。正式发布前必须配置自己的 keystore；没有配置时生成的 APK
不能直接用于 Google Play 正式发布。应用图标、版本号和商店元数据也应按发布账号调整。

## iOS 打包

### 仅构建、不签名（用于 CI 或检查 Flutter 工程）

```bash
cd flutter_app
# 默认使用 https://ccopy.cloud123.uk:333
flutter build ios --release --no-codesign
```

### Xcode / TestFlight / App Store

```bash
open ios/Runner.xcworkspace
```

在 Xcode 中：

1. 选择 `Runner` target；
2. 在 Signing & Capabilities 选择自己的 Team；
3. 确认 Bundle Identifier `com.yunpaste.app` 未与其他应用冲突；
4. 配置证书、Provisioning Profile、App ID 和必要能力；
5. 通过 Xcode Archive，或执行 `flutter build ipa --release`。

项目不再写入机器特定的 `DEVELOPMENT_TEAM`，这样不会把当前开发机账号带入仓库。
如果本机提示 Xcode 未完整安装，需要先在 macOS 安装完整 Xcode、打开一次并接受许可，
再执行 `flutter doctor` 和 iOS 构建。

## 版本号

`pubspec.yaml` 中的 `version: 1.15.0+1` 会同步用于：

- Android `versionName` / `versionCode`
- iOS `CFBundleShortVersionString` / `CFBundleVersion`
- Web 构建元数据（如项目自行接入）

发版时请同时更新版本号和项目根目录的变更记录。

## 重要安全说明

- 不要把 JWT、keystore、Apple 证书、Provisioning Profile 或密码提交到 Git。
- 公网部署必须使用 HTTPS；不要用 `API_BASE_URL=http://...` 生成生产 Release 包。
- 后端的 `/config`、`/files`、`/share` 等路径仍由现有 Express 服务负责，Flutter 客户端
  不会替换或修改现有数据库和文件存储。
