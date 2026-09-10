# 云粘贴 YunPaste

## 一处复制，随处粘贴

**不下载，不占手机文件空间。**

云粘贴是一款轻量、高效的自托管跨设备文件助手。文件保存在自己的服务器，手机无需
安装额外 App；在电脑粘贴文字或上传文件，手机、平板和其他电脑打开浏览器即可继续使用。

![云粘贴跨设备文件管理与预览](https://raw.githubusercontent.com/Newterry/yunpaste/main/public/assets/yunpaste-social-preview.webp)

### 为什么比聊天式文件传输更好用

- **手机保持轻盈**：浏览器打开即用，只有主动下载才会写入手机文件空间。
- **一条链接分享给任何人**：对方无需注册、加好友或安装应用即可预览和下载。
- **真正的文件管理**：文件夹、搜索、排序、收藏、复制、移动、回收站和多种视图。
- **优秀的在线预览**：图片缩放旋转、文本复制、JSON 美化，以及 PDF、Office、WPS、
  音视频和常见代码文件预览。
- **数据由自己掌控**：多用户严格隔离、数据库加密、限时高熵分享和完整备份恢复。

## 快速启动

```yaml
services:
  yunpaste:
    image: newterry/yunpaste:latest
    restart: unless-stopped
    ports:
      - "8787:8787"
    volumes:
      - ./config:/config
      - ./files:/files
```

准备持久目录后运行：

```bash
mkdir -p config files
sudo chown -R 10001:10001 config files
docker compose up -d
```

浏览器访问 `http://服务器地址:8787`。公网部署请配置 HTTPS、强密码和可靠的密钥管理。

## 持久化目录

| 容器目录 | 用途 |
| --- | --- |
| `/config` | 加密 SQLite 数据库、设置、会话密钥和备份 |
| `/files` | 本地对象、上传暂存区和预览缓存 |

## 主要能力

- 文本、图片、音视频、PDF、Office、WPS、代码和数据文件预览
- 文件夹、模糊搜索、列表/网格/图片视图及批量操作
- 高熵限时分享链接，最长 7 天并支持随时撤销
- 多用户与管理员角色，默认每位用户 20 GiB 配额
- 每位用户可配置多个个人 WebDAV
- 全局本地、WebDAV 或 SMB 存储
- AES-256 数据库静态加密和加密配置备份
- 默认 30 天保留，收藏内容永久保存
- 自适应字号、6 套皮肤、7 种界面语言和 PWA

## 镜像标签

- `latest`：最新稳定版
- `1.15.3`：本次固定版本

支持 Linux `amd64` 和 `arm64`。容器以非 root 用户 `10001:10001` 运行。

完整部署、安全和备份说明请访问：
[github.com/Newterry/yunpaste](https://github.com/Newterry/yunpaste)
