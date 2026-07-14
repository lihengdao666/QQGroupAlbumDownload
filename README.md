# QQGroupAlbumDownload

一个用于批量下载 QQ 群相册内容的桌面工具。  
输入群号、选择相册、指定保存目录后，即可按相册批量保存照片与视频，适合群相册备份、资料迁移和个人回忆归档。

![Release](https://img.shields.io/github/v/release/lihengdao666/QQGroupAlbumDownload?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square)
![License](https://img.shields.io/github/license/lihengdao666/QQGroupAlbumDownload?style=flat-square)

## 功能特性

- **群相册读取**：输入 QQ 群号后自动获取可访问的群相册列表。
- **多相册选择**：以表格展示相册名称和图片数量，支持一次勾选多个相册。
- **批量下载**：选择保存目录后，按相册创建文件夹并批量下载内容。
- **照片与视频保存**：支持下载群相册中的图片；包含视频地址时会同步保存视频文件。
- **优先高清/原图**：下载时优先选择原图或更高分辨率资源。
- **任务队列管理**：展示每个相册的下载状态、成功数和失败数。
- **暂停与继续**：支持单个任务或全部任务暂停、继续。
- **删除任务**：支持删除单个任务或清空全部下载任务。
- **重复文件跳过**：目标文件已存在时自动跳过，避免重复下载。
- **开源提醒**：软件完全免费，请优先从本仓库 Releases 下载。

## 使用流程

1. 打开程序，输入需要下载相册的 QQ 群号。
2. 等待程序读取群相册列表。
3. 勾选需要下载的相册，点击开始下载。
4. 选择本地保存目录。
5. 在任务页面查看进度，可按需暂停、继续或删除任务。

## 页面说明

### 输入群号

首页用于输入 QQ 群号，并提供项目开源地址、作者信息和安全提示入口。

### 选择相册

相册页展示当前群内可访问的相册列表，包括相册名称和内容数量。  
勾选一个或多个相册后，即可进入下载任务页面。

### 处理任务

任务页展示每个相册的下载状态、成功数量和失败数量。  
支持开始下载、停止下载、恢复下载、删除任务和返回上级页面。

## 下载最新版本

请前往 Releases 页面下载最新构建产物：

[https://github.com/lihengdao666/QQGroupAlbumDownload/releases](https://github.com/lihengdao666/QQGroupAlbumDownload/releases)

当前发布流程由 GitHub Actions 在线构建：

- Windows：生成便携版 `.exe`
- macOS：生成 `.dmg`

## 本地开发

```bash
npm install
npm run serve
```

构建前端：

```bash
npm run build
```

打包 Electron 应用：

```bash
npm run pack
```

## 注意事项

- 只能下载当前账号有权限访问的群相册内容。
- 下载前请确保 QQ 登录状态、Cookie 和网络环境正常。
- 相册或图片接口由 QQ/Qzone 提供，若接口调整，功能可能需要同步适配。
- 本项目为免费开源软件，请勿从不明渠道购买或下载二次打包版本。

## 技术栈

- Electron
- Vue 3
- Element Plus
- Axios
- electron-builder

## 版权说明

程序图标由 Pixel perfect 提供。  
本项目仅用于个人数据备份与迁移，请遵守相关平台规则与法律法规。
