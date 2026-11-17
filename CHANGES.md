# QQGroupAlbumDownload 改造说明

基于 https://github.com/lihengdao666/QQGroupAlbumDownload （main 分支）改造。

## 一、需求对照

| 需求 | 实现情况 |
| --- | --- |
| 改成通过批量下载（整册打包 ZIP）下载照片 | 已实现。优先调 `cgi_arch_photo_v2` 拿整册 ZIP，解压后落盘 |
| 无法完成则用老方式下载 | 已实现。打包接口失败/返回空/解压异常/无可识别文件，自动回退逐张下载 |
| 相册标题前面增加上传时间 | 已实现。目录名 = `日期前缀 + 标题` |
| 相册标题里有时间则保留标题的时间 | 已实现。标题自带完整日期时不再重复加前缀 |
| 标题时间不完整则用上传时间补充完整 | 已实现。只有年/年月/月日时，缺失部分取相册上传时间 |
| 照片没有拍摄时间则按上面的时间写入 EXIF | 已实现。无 EXIF 拍摄时间的 JPEG 写入 `DateTimeOriginal`，并设置文件时间 |

## 二、改了哪些文件

```
ipcMain.js                      主流程：打包接口、zip 解压、回退、目录命名、EXIF
timeUtils.js                    新增：时间解析 + EXIF 读写
package.json                    新增依赖 adm-zip、piexifjs
src/components/SelectAlbum.vue   相册列表新增「上传时间」列
README.md                       功能与时间/EXIF 规则说明
test-time-exif.js               自测：时间解析、EXIF 写入、zip 结构
test-albumtask.js               自测：zip 优先 / 失败回退 两条路径
```

## 三、关键实现

### 1. 整册打包（ZIP 优先）

QQ 群相册的整册打包接口：

```
POST https://h5.qzone.qq.com/proxy/domain/app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2
     ?g_tk=...&qzonetoken=...
body: uin / hostUin=-1 / albumid / hostid=群号 / albumName / appid=422 / selectMode=1 ...
返回: data.downloadUrl  →  ZIP 下载地址
```

要点：
- 该接口要 `qzonetoken`，程序会先抓群相册页面 HTML 用正则取 `g_qzonetoken`，缓存 10 分钟；
- 网关对参数位置敏感，内置 5 种请求形态轮询（票据在 URL+参数在 body、显式 Content-Type、
  全部在 query、POST 空 body、直连 `app.photo.qq.com`），任一成功即用；
- 失败（403/HTML/无 downloadUrl）直接视为不支持，走回退，不会卡住任务。

### 2. ZIP 解压

用 `adm-zip` 在内存中解压，只保留图片/视频扩展名，跳过目录和其它文件。
文件名做非法字符清理；中文乱码或空名时用 `photo_0001.jpg` 这类序号兜底；同名自动加序号。

### 3. 回退逐张

保留原有逻辑（`getPatchAlbum` 翻页 + 逐张下载），只把目录名换成带时间前缀的目录，
并在每张下载完成后补 EXIF。

顺带修了一个原有隐患：下载用 `stream.pipe(fileSteam)`，以前在 `stream` 的 `end` 就回调，
此时文件可能还没写完。现在改为等写入流 `finish` 再返回，否则紧接着读文件会读到空内容。

### 4. 相册目录命名

规则见 README 的表格。举例：

```
春游                + 上传 2023-06-18  →  2023-06-18 春游
2023-01-05 春游     + 任意             →  2023-01-05 春游
2023-01 一月        + 上传 2023-06-18  →  2023-01-18 2023-01 一月
1月5日 小聚         + 上传 2023-06-18  →  2023-01-05 1月5日 小聚
```

支持标题写法：`2023-01-05`、`2023/1/5`、`2023.01.05`、`2023年1月5日`、`20230105`、
`2023-01`、`2023年`、`二〇二三年`、`1月5日`。

上传时间来源优先级：相册列表的 `createtime/uploadtime/modifytime` 等字段 →
取不到时用照片列表里第一张照片的 `uploadtime` 推断 → 都没有则不加前缀（不瞎猜）。

### 5. EXIF 补齐

每张 JPEG 按以下顺序决定时间：

1. 已有 `EXIF DateTimeOriginal / DateTimeDigitized / DateTime` → 原样保留，不覆盖；
2. 文件名含时间（如 `IMG_20230105_123456.jpg`）→ 用文件名时间；
3. 都没有 → 用相册最终时间写入上述三个 EXIF 字段。

同时用 `fs.utimes` 把文件修改时间设为同一时间，便于按时间排序。
非 JPEG（PNG/HEIC 等）只设置文件时间，不写 EXIF（格式不支持）。

## 四、怎么用

### 直接改源码

把上面「改了哪些文件」里的文件覆盖到你的仓库，然后：

```bash
npm install          # 新增了 adm-zip、piexifjs
npm run serve        # 开发调试
npm run pack         # 打包便携版 exe
```

> 注意：如果你本机的 `~/.npmrc` 里 registry 写错了（本机就是
> `registry="[https://registry.npm.taobao.org]"`，带方括号和引号，非法），
> 会出现 `npm error code ERR_INVALID_URL`。改成 `registry=https://registry.npmmirror.com` 即可。

### 自测

```bash
node test-time-exif.js    # 28 项
node test-albumtask.js    # 19 项
```

### 打包便携版 exe

双击项目根目录的 `打包便携版.cmd` 即可（内含镜像配置与失败重试）。
它做三件事：构建前端 → 确认 Electron 二进制 → 用本地 Electron 目录打包 portable。

手动等价命令：

```bash
npx vue-cli-service build
npx electron-builder --win portable -c.electronDist=node_modules/electron/dist
```

产物在 `dist/` 下，形如 `QQGroupAlbumDownload 0.1.6.exe`（约 76MB）。
首次运行会自解压到临时目录，启动比开发模式慢几秒，属正常。

打包时可能遇到的两个坑：

1. **下载 Electron / NSIS 工具链超时**：electron-builder 默认从 GitHub 拉取，国内常失败。
   解决办法是设置 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR`（脚本里已设），
   并用 `-c.electronDist=node_modules/electron/dist` 直接复用已下载的 Electron，完全跳过下载。
2. **`EBUSY: resource busy or locked`**：刚复制出来的 exe 被 Windows 杀毒实时扫描锁住，
   electron-builder 写图标/版本信息时失败。重试一次通常就过（脚本已内置 3 次重试）；
   仍失败可临时关闭实时防护。

## 五、已知限制

1. **打包接口有频率限制**：相册多时建议分批选，单批别太多；失败会自动回退，不会丢数据。
2. **打包接口需要有效登录态**：Cookie 过期会 403，此时同样回退逐张。
3. **ZIP 内文件名可能是 GBK**：`adm-zip` 按 UTF-8 解析，中文名可能乱码，
   已做「乱码/空名 → 序号兜底」，不影响图片内容和 EXIF 写入。
4. **只有 JPEG 能写 EXIF**：PNG/HEIC 只改文件时间。
5. **上传时间依赖接口字段**：不同版本接口字段名可能变，已做多字段兜底；
   若全部取不到，目录名不加时间前缀，照片 EXIF 也不写（不会写入错误时间）。

## 六、验证结果

- `test-time-exif.js`：28 项全通过（12 种标题写法、目录名规则、EXIF 写入/跳过、zip 结构、
  非 JPEG 跳过、文件名取时间）。
- `test-albumtask.js`：19 项全通过，覆盖
  ① ZIP 成功路径（不触发逐张、txt 被过滤、文件名时间与相册时间分别写对）；
  ② ZIP 失败回退（确实逐张、计数正确、EXIF 也补上）；
  ③ 状态机（等待/完成/状态文案）；
  ④ 相册无上传时间时从照片列表推断出时间并落到对应目录。
- `SelectAlbum.vue` 通过 `@vue/compiler-sfc` 模板与脚本编译校验。
