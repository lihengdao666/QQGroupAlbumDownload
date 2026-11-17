const { default: axios } = require("axios");
const { ipcMain, dialog, shell } = require("electron");
const fsExtra = require("fs-extra");
const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const { TaskStatus } = require("./consts");
const { getCookies, getQQ, getTk } = require("./qqCore");
const CryptoJS = require("crypto-js");
const {
  pickUploadDate,
  buildAlbumDirName,
  resolveAlbumTime,
  ensureExifTime,
  touchFileTime,
  parseTimeFromFileName,
} = require("./timeUtils");

/* ---------------- 群相册整册打包（cgi_arch_photo_v2） ---------------- */

// qzonetoken 打包接口要校验，缓存起来避免每次都去抓页面
let qzoneTokenCache = { value: "", at: 0 };

/** 从群相册页面 HTML 里取 g_qzonetoken */
async function getQzoneToken(qunId) {
  const now = Date.now();
  if (qzoneTokenCache.value && now - qzoneTokenCache.at < 10 * 60 * 1000) {
    return qzoneTokenCache.value;
  }
  const urls = [
    `https://h5.qzone.qq.com/groupphoto/index?inqq=3&groupId=${qunId}`,
    `https://qzs.qq.com/qzone/v6/portal/proxy.html`,
  ];
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          Cookie: getCookies(),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        timeout: 20000,
        responseType: "text",
      });
      const html = typeof data === "string" ? data : JSON.stringify(data);
      const m = html.match(/g_qzonetoken\s*[:=]\s*["']([^"']{8,})["']/);
      if (m) {
        qzoneTokenCache = { value: m[1], at: now };
        return m[1];
      }
    } catch (e) {
      /* 换下一个地址 */
    }
  }
  return "";
}

/** 取相册整册打包后的 zip 下载地址；失败返回空串 */
async function getAlbumZipUrl(qunId, albumId, albumName) {
  const origin = "https://h5.qzone.qq.com/proxy/domain/app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2";
  const direct = "https://app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2";
  const token = await getQzoneToken(qunId);

  const q = new URLSearchParams();
  q.append("g_tk", getTk());
  if (token) q.append("qzonetoken", token);

  const b = new URLSearchParams();
  b.append("uin", getQQ());
  b.append("hostUin", "-1");
  b.append("inCharset", "utf-8");
  b.append("outCharset", "utf-8");
  b.append("refer", "refer");
  b.append("source", "qzone");
  b.append("platform", "qzone");
  b.append("format", "json");
  b.append("appid", "422");
  b.append("selectMode", "1");
  b.append("albumid", albumId);
  b.append("hostid", qunId);
  b.append("albumName", albumName);

  const all = new URLSearchParams(q.toString());
  b.forEach((v, k) => all.append(k, v));

  const headers = {
    Cookie: getCookies(),
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `https://h5.qzone.qq.com/groupphoto/album?groupId=${qunId}`,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };

  const pick = (data) => {
    if (!data) return "";
    let u = "";
    if (typeof data === "string") {
      // 少数情况直接返回 JSONP 或纯文本地址
      try {
        const parsed = JSON.parse(data);
        u = (parsed.data && parsed.data.downloadUrl) || parsed.downloadUrl || "";
      } catch (e) {
        const m = data.match(/https?:\/\/[^"'\s\\]+/);
        if (m) u = m[0];
      }
    } else {
      u = (data.data && data.data.downloadUrl) || data.downloadUrl || "";
    }
    return u ? String(u).replace(/^http:/, "https:") : "";
  };

  const variants = [
    { url: origin + "?" + q.toString(), method: "POST", body: b.toString(), contentType: true },
    { url: origin + "?" + q.toString(), method: "POST", body: b },
    { url: origin + "?" + all.toString(), method: "GET" },
    { url: origin + "?" + all.toString(), method: "POST", body: "" },
    { url: direct + "?" + q.toString(), method: "POST", body: b.toString(), contentType: true },
  ];

  for (const v of variants) {
    try {
      const opt = {
        method: v.method,
        headers: { ...headers },
        timeout: 20000,
        validateStatus: () => true,
      };
      if (v.body !== undefined) opt.data = v.body;
      const res = await axios.request({ url: v.url, ...opt });
      const url = pick(res.data);
      if (url) return url;
    } catch (e) {
      /* 换下一种形态 */
    }
  }
  return "";
}

/** 从 zip 里解出文件到目标目录，返回解出的文件路径列表 */
function extractZipToDir(zipBuffer, targetDir) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const out = [];
  let seq = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rawName = entry.entryName || "";
    const ext = (path.extname(rawName) || "").toLowerCase();
    if (!/^\.(jpe?g|png|gif|bmp|webp|heic|mp4|mov)$/.test(ext)) continue;

    // zip 内文件名可能是 GBK，出现乱码时用序号兜底，避免写入非法路径
    let base = path.basename(rawName);
    let safe = String(base).replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
    if (!safe || !/[0-9a-zA-Z\u4e00-\u9fa5]/.test(safe)) {
      seq += 1;
      safe = `photo_${String(seq).padStart(4, "0")}${ext}`;
    }
    let fileName = path.join(targetDir, safe);
    // 同名冲突时加序号
    if (fs.existsSync(fileName)) {
      const stem = path.basename(safe, ext);
      let i = 1;
      while (fs.existsSync(fileName)) {
        fileName = path.join(targetDir, `${stem}_${i}${ext}`);
        i += 1;
      }
    }
    fs.writeFileSync(fileName, entry.getData());
    out.push(fileName);
  }
  return out;
}


function getMD5FirstSixChars(input) {
  // 计算 MD5 哈希值
  const hash = CryptoJS.MD5(input).toString(CryptoJS.enc.Hex);

  // 取前六位字符
  const firstSixChars = hash.substring(0, 6);

  return firstSixChars;
}
async function getAlbumList(event, qunId) {
  const url = `https://h5.qzone.qq.com/proxy/domain/u.photo.qzone.qq.com/cgi-bin/upp/qun_list_album_v2?g_tk=${getTk()}&callback=shine2_Callback&qunId=${qunId}&uin=${getQQ()}&start=0&num=1000&getMemberRole=1&inCharset=utf-8&outCharset=utf-8&source=qzone&attach_info=&callbackFun=shine2`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        Cookie: getCookies(),
      },
    });
    if (data.indexOf("对不起，您") !== -1) {
      return {
        status: "error",
        msg: "无访问权限",
      };
    }
    let list =
      new Function("", "const shine2_Callback=a=>a;return " + data)().data
        .album ?? [];

    list = list
      .map((item) => {
        const uploadDate = pickUploadDate(item);
        return {
          id: item.id,
          title: item.title,
          num: item.photocnt,
          // 上传时间（毫秒）。标题里没有完整日期时用它补齐
          uploadTime: uploadDate ? uploadDate.getTime() : null,
        };
      })
      .filter((item) => item.num != 0);
    return {
      status: "success",
      data: list,
    };
  } catch (error) {
    console.log(error);

    return {
      status: "error",
      msg: "未知错误",
    };
  }
}
async function getPatchAlbum(qunId, albumId, start) {
  const url = `https://h5.qzone.qq.com/groupphoto/inqq?g_tk=` + getTk();
  const postData = `"qunId=${qunId}&albumId=${albumId}&uin=${getQQ()}&start=${start}&num=36&getCommentCnt=0&getMemberRole=0&hostUin=${getQQ()}&getalbum=0&platform=qzone&inCharset=utf-8&outCharset=utf-8&source=qzone&cmd=qunGetPhotoList&qunid=${qunId}&albumid=${albumId}&attach_info=start_count%3D${start}"`;
  try {
    const { data } = await axios.post(url, postData, {
      headers: {
        Cookie: getCookies(),
        "Referrer-Policy": "strict-origin-when-cross-origin",
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "sec-ch-ua":
          '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "x-requested-with": "XMLHttpRequest",
      },
    });

    let list = (data && data.data && data.data.photolist) || [];
    list = list
      .map((item) => {
        const picList = [];
        if (item && item.photourl) {
          for (const key in item.photourl) {
            picList.push(item.photourl[key]);
          }
        }
        if (!picList.length) return null;
        const originPic = picList.find((i) => {
          if (i.width === 0 && i.height === 0) {
            return true
          }
          return false
        })
        picList.sort((a, b) => {
          if (a.width !== b.width) {
            return b.width - a.width;
          }
          if (a.height !== b.height) {
            return b.height - a.height;
          }
          return b.enlarge_rate - a.enlarge_rate;
        });
        const videoAction = item.videodata && item.videodata.actionurl;
        return {
          photoURL: (originPic || picList[0]).url, //目前未遇到不存在
          videoURL: !videoAction ? undefined : videoAction, //默认值空字符串
          name: item.sloc,
          // 单张照片的上传时间，相册整体没有时间时用来兜底
          uploadTime: (() => {
            const d = pickUploadDate(item);
            return d ? d.getTime() : null;
          })(),
        };
      })
      .filter((item) => item && item.photoURL);
    return {
      status: "success",
      data: list,
    };
  } catch (error) {
    console.log(error);

    return {
      status: "error",
      msg: "未知错误",
    };
  }
}
let globalQueue;

let download = async () => undefined;
let downloadUserDir = "";

/** 只去掉文件系统非法字符，保留日期前缀里的 - 和空格 */
function sanitizeDirName(name) {
  return String(name == null ? "" : name)
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
}

/** 根据相册名算出最终落盘目录 */
function albumDirOf(albumDirName) {
  let dirName = sanitizeDirName(albumDirName);
  if (dirName.length == 0) {
    dirName = generateAlbumName(albumDirName);
  }
  return path.join(downloadUserDir, dirName);
}

function downloadFactory(userDir) {
  downloadUserDir = userDir;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return async function (url, albumDirName, name) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      name = filterFileName(name);
      const baseDir = albumDirOf(albumDirName);
      const fileName = path.join(baseDir, name);
      await fsExtra.mkdirp(baseDir);
      // eslint-disable-next-line no-async-promise-executor
      const fileStatus = await new Promise(async (resolve) => {
        try {
          const result = await fsExtra.pathExists(fileName);
          resolve(result);
        } catch (error) {
          resolve(false);
        }
      });
      if (fileStatus) {
        resolve(fileName);
        return;
      }
      const stream = (
        await axios.get(url, {
          responseType: "stream",
        })
      ).data;
      const fileSteam = fsExtra.createWriteStream(fileName, {
        highWaterMark: 1000,
      });
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        stream.unpipe?.(fileSteam);
        if (err) reject(err);
        else resolve(fileName);
      };
      // 写完落盘再返回，避免调用方紧接着读文件时内容还不完整
      fileSteam.on("finish", () => done());
      fileSteam.on("error", (e) => done(e));
      stream.on("error", (e) => {
        try {
          fileSteam.end();
        } catch (e2) {
          /* ignore */
        }
        done(e);
      });
      stream.pipe(fileSteam);

      let isEnd = false;
      const timer = setInterval(() => {
        if (isEnd) {
          isEnd = false;
        } else {
          clearInterval(timer);
          try {
            fileSteam.end();
          } catch (e) {
            /* ignore */
          }
          done(new Error("下载超时"));
        }
      }, 30000);
      stream.on("progress", () => {
        isEnd = true;
      });
    });
  };
}

async function createDownloadAlbum(event, qunId, arr) {
  await globalQueue?.pause();
  globalQueue = new queue();
  for (let index = 0; index < arr.length; index++) {
    const item = arr[index];
    const uploadTime = item.uploadTime ? Number(item.uploadTime) : null;
    globalQueue.addTask(
      new AlbumTask(qunId, item.id, item.num, item.title, uploadTime)
    );
  }
  return true;
}
async function startDownloadAlbum() {
  const showDialog = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (showDialog.filePaths.length == 0) {
    return false;
  }
  download = downloadFactory(showDialog.filePaths[0]);
  downloadUserDir = showDialog.filePaths[0];
  globalQueue?.run();
}

/** 统一设置下载目录（真实流程与自测共用） */
function setDownloadDir(dir) {
  downloadUserDir = dir;
  download = downloadFactory(dir);
}

async function stopDownloadAlbum(event, id) {
  await globalQueue?.pause(id);
}
async function resumeDownloadAlbum(event, id) {
  await globalQueue?.resume(id);
}
function openPage(event, url) {
  shell.openExternal(url);
}
async function deleteDownloadAlbum(event, id) {
  if (id !== undefined) {
    await globalQueue?.delete(id);
  } else {
    await globalQueue?.deleteAll();
    globalQueue = undefined;
  }
}
async function getDownloadAlbumStatus() {
  return globalQueue?.getAllStatus() ?? [];
}
ipcMain?.handle("getAlbumList", getAlbumList);
ipcMain?.handle("createDownloadAlbum", createDownloadAlbum);
ipcMain?.handle("startDownloadAlbum", startDownloadAlbum);
ipcMain?.handle("stopDownloadAlbum", stopDownloadAlbum);
ipcMain?.handle("resumeDownloadAlbum", resumeDownloadAlbum);
ipcMain?.handle("openPage", openPage);
ipcMain?.handle("deleteDownloadAlbum", deleteDownloadAlbum);
ipcMain?.handle("getDownloadAlbumStatus", getDownloadAlbumStatus);
exports.getAlbumList = getAlbumList;
exports.getPatchAlbum = getPatchAlbum;
const sanitizeFileName = (fileName) => {
  return fileName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
};
const filterFileName = (name) => {
  return name.match(/[0-9a-zA-Z/.]*/g).join("");
};
const generateAlbumName = (albumDirName) => {
  const randomString = getMD5FirstSixChars(albumDirName);
  // 返回【相册下载】+ 6 个随机字符
  return `相册下载${randomString}`;
};

// 这部分涉及到下载功能
// 第一次首先考虑的是能限制数量并且顺序下载
// 更新后改成并发
// 但是涉及到任务的暂停，删除
// 之前的循环执行不适合
// 那么第一反应是分为一个完成数组，运行数组，等待数组
// 但是这样设计，暂停的任务再继续，需要更换不同数组
// 颠倒了用户顺序，而用户顺序是不能变的，就推翻了之前我们的设想
// 这个时候就考虑到一个显示的用户数组
// 一个进行下载的队列数组
// 所以设计了一个任务队列，一个运行队列，而用户的信息从taskList获取
// 监听子任务run的结束然后回调运行下一个子任务
// 如果用then反复暂停继续会多次监听，所以多封装一层callback
// 确保每个task的run函数只回调一次

class queue {
  taskList = []; //用户插入任务的顺序，具体的执行顺序由waiQueue和runList控制
  flag = ""; // pause 暂停 run 运行中
  maxRun = 2;
  runList = [];
  waitQueue = [];
  addTask(item) {
    this.taskList.push(item);
    this.waitQueue.push(item);
  }
  async delete(id) {
    //删除列表内容
    const itemIndex = this.taskList.findIndex(
      (item) => item.getSingleID() == id
    );
    if (itemIndex != -1) {
      this.taskList.splice(itemIndex, 1);
    }
    //如果在运行，需要暂停再删除  如果在等待，可以直接删除
    const runIndex = this.runList.findIndex((item) => item.getSingleID() == id);
    if (runIndex != -1) {
      await this.runList[runIndex].pause();
      this.runList.splice(runIndex, 1);
    } else {
      const waitIndex = this.waitQueue.findIndex(
        (item) => item.getSingleID() == id
      );
      if (waitIndex != -1) {
        this.waitQueue.splice(waitIndex, 1);
      }
    }
  }
  async deleteAll() {
    await this.pause();
    this.taskList.length = 0;
    this.runList.length = 0;
    this.waitQueue.length = 0;
  }
  async pause(id) {
    if (id == undefined) {
      //全局暂停
      this.flag = "pause";
    }
    const list = [];
    const addList = (item) => {
      list.push(item.pause());
    };
    for (let index = 0; index < this.runList.length; index++) {
      if (id == undefined) {
        addList(this.runList[index]);
      } else if (id === this.runList[index].getSingleID()) {
        addList(this.runList[index]);
      }
    }
    return Promise.all(list);
  }
  async resume(id) {
    if (id == undefined) {
      for (const item of this.runList) {
        item.resume();
      }
      this.run();
    } else {
      const index = this.taskList.findIndex((item) => item.getSingleID() == id);
      if (index !== -1) {
        this.taskList[index].resume();
        this.waitQueue.unshift(this.taskList[index]);
        this.run();
      }
    }
  }
  async runTask(index) {
    if (this.runList[index].isRun()) {
      return;
    }
    const id = this.runList[index].getSingleID();
    this.runList[index].registerRun(() => {
      if (this.flag == "run") {
        //队列运行中，且执行过任务才可以执行下一个任务
        const itemIndex = this.runList.findIndex(
          (item) => item.getSingleID() == id
        );
        //需要继续运行，删除队列进行处理
        if (itemIndex !== -1) {
          this.runList.splice(itemIndex, 1);
        }
        process.nextTick(() => {
          this.run();
        });
      }
    });
  }
  async run() {
    this.flag = "run";
    while (this.runList.length < this.maxRun && this.waitQueue.length !== 0) {
      const item = this.waitQueue.shift();
      this.runList.push(item);
    }
    for (let index = 0; index < this.runList.length; index++) {
      this.runTask(index);
    }
  }
  getAllStatus() {
    const list = [];
    for (const item of this.taskList) {
      const data = item.getStatus();
      list.push(data);
    }
    return list;
  }
}
class AlbumTask {
  list = [];
  qunId;
  albumId;
  start = 0;
  runStatus = TaskStatus.WATING;
  // wating 等待中 run 运行中 pause暂停中 finish完成 error 错误
  // 等待中->运行中
  // 运行中->暂停中/完成/错误
  // 暂停中->等待中
  waitResolve = undefined;
  success = 0;
  fail = 0;
  total = 0;
  title = "";
  runCallback = undefined;
  uploadDate = null;
  albumDate = null;
  dirName = "";
  zipTried = false;
  constructor(qunId, albumId, total, title, uploadTime) {
    this.qunId = qunId;
    this.albumId = albumId;
    this.total = total;
    this.title = title;
    this.uploadDate = uploadTime ? new Date(uploadTime) : null;
    const resolved = resolveAlbumTime(title, this.uploadDate);
    this.albumDate = resolved.date;
    // 目录名：时间前缀 + 标题（标题已有完整时间则保留标题时间）
    this.dirName = buildAlbumDirName(title, this.uploadDate);
  }
  getSingleID() {
    return this.albumId;
  }

  /** 整册打包下载：成功返回 true，失败返回 false（由调用方回退） */
  async downloadByZip() {
    const zipUrl = await getAlbumZipUrl(this.qunId, this.albumId, this.title);
    if (!zipUrl) return false;

    let buffer;
    try {
      const res = await axios.get(zipUrl, {
        responseType: "arraybuffer",
        timeout: 180000,
        maxContentLength: 1024 * 1024 * 1024,
        headers: {
          Cookie: getCookies(),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      buffer = Buffer.from(res.data);
    } catch (e) {
      return false;
    }
    if (!buffer || buffer.length < 100) return false;

    const targetDir = albumDirOf(this.dirName);
    await fsExtra.mkdirp(targetDir);

    let files;
    try {
      files = extractZipToDir(buffer, targetDir);
    } catch (e) {
      return false;
    }
    if (!files.length) return false;

    for (const f of files) {
      if (this.runStatus != TaskStatus.RUN) break;
      const ext = path.extname(f).toLowerCase();
      if (!/^\.(jpe?g)$/.test(ext)) {
        this.success += 1;
        continue;
      }
      // 优先用文件名里的时间，其次用相册时间；已有 EXIF 的会被跳过
      const timeFromName = parseTimeFromFileName(f);
      const useDate = timeFromName || this.albumDate;
      ensureExifTime(f, useDate);
      touchFileTime(f, useDate);
      this.success += 1;
    }
    return true;
  }

  async nextAlbum() {
    for (let index = 0; index < 3; index++) {
      const data = await getPatchAlbum(this.qunId, this.albumId, this.start);
      if (data.status == "success") {
        this.start += 40;
        this.list = data.data;
        // 相册列表没给上传时间时，用第一张照片的上传时间兜底
        if (!this.albumDate && this.list.length) {
          const hit = this.list.find((it) => it.uploadTime);
          if (hit) {
            this.uploadDate = new Date(hit.uploadTime);
            const resolved = resolveAlbumTime(this.title, this.uploadDate);
            this.albumDate = resolved.date;
            this.dirName = buildAlbumDirName(this.title, this.uploadDate);
          }
        }
        return;
      }
    }
    this.list = [];
    this.runStatus = TaskStatus.ERROR;
  }
  isRun() {
    return this.runStatus == TaskStatus.RUN;
  }
  async pause() {
    return new Promise((resolve) => {
      if (this.runStatus != TaskStatus.RUN) {
        resolve();
      } else {
        this.runStatus = TaskStatus.PAUSE;
        this.waitResolve = resolve;
      }
    });
  }
  async resume() {
    if (this.runStatus == TaskStatus.PAUSE) {
      this.runStatus = TaskStatus.WATING;
    }
  }
  async registerRun(callback) {
    this.runCallback = callback;
    await this.run();
    if (this.runCallback) {
      this.runCallback();
      this.runCallback = undefined;
    }
  }
  async run() {
    if (this.runStatus != TaskStatus.WATING) {
      return false;
    }
    this.runStatus = TaskStatus.RUN;

    // 相册时间未知时，先取一页照片列表，从中推断上传时间（影响目录名和 EXIF）
    if (!this.albumDate && this.list.length == 0) {
      await this.nextAlbum();
      if (this.runStatus == TaskStatus.ERROR) {
        // 取列表失败不影响继续尝试整册打包
        this.runStatus = TaskStatus.RUN;
      }
    }

    // 优先走整册打包（zip 里多为原图，带 EXIF，且一次拿全）
    if (!this.zipTried) {
      this.zipTried = true;
      let zipOk = false;
      try {
        zipOk = await this.downloadByZip();
      } catch (e) {
        zipOk = false;
      }
      if (zipOk) {
        this.runStatus =
          this.runStatus === TaskStatus.PAUSE
            ? TaskStatus.PAUSE
            : TaskStatus.FINISH;
        if (this.runStatus === TaskStatus.PAUSE) {
          this.waitResolve();
        }
        return true;
      }
      // 打包失败：本轮已计入的统计清零，回到逐张模式
      if (this.runStatus !== TaskStatus.RUN) {
        return true;
      }
      this.success = 0;
      this.fail = 0;
    }

    if (this.list.length == 0) {
      // 理论第一个判断是失效的
      // 因为执行nextAlbum，相册必然为0
      // 这里当暂停，继续的时候相册刚好为0则获取下一部分
      // 首次执行为0也获取下一部分
      // 如果溢出腾讯会自动返回空数组，无需担心
      await this.nextAlbum();
    }
    while (this.list.length !== 0 && this.runStatus == TaskStatus.RUN) {
      const item = this.list.pop();
      try {
        const fileName = await download(
          item.photoURL,
          this.dirName,
          item.name + ".jpg"
        );
        if (item.videoURL) {
          await download(item.videoURL, this.dirName, item.name + ".mp4");
        }
        // 逐张下载得到的照片同样补齐 EXIF 时间
        if (fileName && /\.jpe?g$/i.test(fileName)) {
          const timeFromName = parseTimeFromFileName(fileName);
          const useDate = timeFromName || this.albumDate;
          ensureExifTime(fileName, useDate);
          touchFileTime(fileName, useDate);
        }
        this.success++;
      } catch (error) {
        this.fail++;
      }
      //离开状态
      if (this.runStatus != TaskStatus.RUN) {
        break;
      }
      if (this.list.length == 0) {
        await this.nextAlbum();
      }
    }
    if (this.runStatus === TaskStatus.PAUSE) {
      // 回调暂停
      this.waitResolve();
    } else if (this.runStatus == TaskStatus.RUN) {
      // 回调完成
      this.runStatus = TaskStatus.FINISH;
    }
    return true;
  }
  getStatus() {
    let showText = "";
    if (this.success == 0 && this.fail == 0) {
      showText = `无执行内容`;
    } else {
      showText = `成功:${this.success} 失败:${this.fail}`;
    }
    return {
      id: this.albumId,
      num: this.total,
      fail: this.fail,
      success: this.success,
      status: this.runStatus,
      title: this.dirName || this.title,
      showText: showText,
    };
  }
}

// 供自测使用（放在文件末尾，避免类声明暂时性死区）
exports.AlbumTask = AlbumTask;
exports.downloadFactory = downloadFactory;
exports.setDownloadDir = setDownloadDir;
exports.getAlbumZipUrl = getAlbumZipUrl;
exports.extractZipToDir = extractZipToDir;
exports.sanitizeDirName = sanitizeDirName;
exports.albumDirOf = albumDirOf;
