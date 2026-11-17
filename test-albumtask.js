/** 端到端自测：AlbumTask 的 zip 优先 / 失败回退 / EXIF 补齐 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");
const AdmZip = require("adm-zip");
const { Readable } = require("stream");

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✔", name); }
  else { fail++; console.log("  ✘", name, extra === undefined ? "" : extra); }
}

/* ---------- 构造模拟环境 ---------- */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qqalbum-e2e-"));

// 预置 zip（模拟 QQ 打包结果）
const zip = new AdmZip();
zip.addFile("album/IMG_20230105_123456.jpg", TINY_JPEG);
zip.addFile("album/随手拍.jpg", TINY_JPEG);
zip.addFile("album/readme.txt", Buffer.from("x"));
const zipBuffer = zip.toBuffer();

const state = {
  zipMode: true,       // true: 打包接口可用；false: 不可用，走逐张
  zipDownloads: 0,
  photoDownloads: 0,
  photoListCalls: 0,
};

const fakeAxios = {
  async get(url, opt) {
    if (String(url).includes("groupphoto/index")) {
      return { data: `<html><script>window.g_qzonetoken="FAKE_TOKEN_123456";</script></html>` };
    }
    if (String(url).includes("fake-zip")) {
      state.zipDownloads += 1;
      return { data: zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength) };
    }
    if (opt && opt.responseType === "stream") {
      state.photoDownloads += 1;
      return { data: Readable.from([TINY_JPEG]) };
    }
    return { data: "" };
  },
  async request(cfg) {
    if (String(cfg.url).includes("cgi_arch_photo_v2")) {
      if (!state.zipMode) return { status: 403, data: "<html>forbidden</html>" };
      return { status: 200, data: { data: { downloadUrl: "https://x/fake-zip" } } };
    }
    return { status: 404, data: "" };
  },
  async post(url) {
    if (String(url).includes("groupphoto/inqq")) {
      state.photoListCalls += 1;
      // 真实接口翻页到底返回空数组；这里第一页给 2 张，之后给空
      if (state.photoListCalls > 1) {
        return { data: { data: { photolist: [] } } };
      }
      return {
        data: {
          data: {
            photolist: [
              {
                sloc: "p1",
                photourl: { a: { url: "https://x/p1.jpg", width: 100, height: 100, enlarge_rate: 1 } },
                videodata: { actionurl: "" },
              },
              {
                sloc: "p2",
                photourl: { a: { url: "https://x/p2.jpg", width: 100, height: 100, enlarge_rate: 1 } },
                videodata: { actionurl: "" },
              },
            ],
          },
        },
      };
    }
    return { data: {} };
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return { ipcMain: { handle() {} }, dialog: {}, shell: {} };
  }
  if (request === "axios") {
    return { default: fakeAxios };
  }
  return origLoad.apply(this, arguments);
};

const ipc = require("./ipcMain.js");
const T = require("./timeUtils");

(async () => {
  console.log("\n[1] zip 优先：成功解压 + 补 EXIF");
  state.zipMode = true;
  const userDir1 = path.join(tmpRoot, "u1");
  fs.mkdirSync(userDir1, { recursive: true });
  ipc.setDownloadDir(userDir1);

  const task1 = new ipc.AlbumTask("123456", "albumA", 2, "春游", new Date(2023, 5, 18).getTime());
  ok("目录名带时间前缀", task1.dirName === "2023-06-18 春游", task1.dirName);
  await task1.run();

  const dir1 = path.join(userDir1, "2023-06-18 春游");
  ok("相册目录已创建", fs.existsSync(dir1), dir1);
  const files1 = fs.existsSync(dir1) ? fs.readdirSync(dir1) : [];
  ok("txt 被过滤", !files1.some((f) => f.endsWith(".txt")), files1.join(","));
  ok("解出 2 张图", files1.filter((f) => /\.jpe?g$/i.test(f)).length === 2, files1.join(","));
  ok("走了 zip 而不是逐张", state.zipDownloads === 1 && state.photoDownloads === 0, `zip=${state.zipDownloads} photo=${state.photoDownloads}`);

  // 文件名带 20230105 的那张应写入该日期；另一张用相册日期
  const byName = path.join(dir1, "IMG_20230105_123456.jpg");
  if (fs.existsSync(byName)) {
    const ex = T.readJpegExif(byName);
    ok("文件名时间写入 EXIF", ex.shootTime && ex.shootTime.startsWith("2023:01:05"), ex.shootTime);
  } else {
    ok("文件名时间写入 EXIF", false, "文件不存在");
  }
  const plainName = path.join(dir1, "随手拍.jpg");
  if (fs.existsSync(plainName)) {
    const ex2 = T.readJpegExif(plainName);
    ok("无时间照片用相册日期补齐", ex2.shootTime && ex2.shootTime.startsWith("2023:06:18"), ex2.shootTime);
  } else {
    ok("无时间照片用相册日期补齐", false, "文件不存在");
  }

  console.log("\n[2] zip 失败：回退逐张下载");
  state.zipMode = false;
  state.zipDownloads = 0;
  state.photoDownloads = 0;
  state.photoListCalls = 0;
  const userDir2 = path.join(tmpRoot, "u2");
  fs.mkdirSync(userDir2, { recursive: true });
  ipc.setDownloadDir(userDir2);

  const task2 = new ipc.AlbumTask("123456", "albumB", 2, "2023-01-05 年会", new Date(2024, 0, 1).getTime());
  ok("标题完整日期不被污染", task2.dirName === "2023-01-05 年会", task2.dirName);
  await task2.run();

  const dir2 = path.join(userDir2, "2023-01-05 年会");
  const files2 = fs.existsSync(dir2) ? fs.readdirSync(dir2) : [];
  ok("逐张下载出 2 张", files2.filter((f) => /\.jpe?g$/i.test(f)).length === 2, files2.join(","));
  ok("确实回退到逐张", state.photoDownloads >= 2, `photo=${state.photoDownloads}`);
  ok("任务完成状态", task2.runStatus === "finish", task2.runStatus);
  ok("成功计数", task2.success === 2, task2.success);
  if (files2.length) {
    const ex = T.readJpegExif(path.join(dir2, files2[0]));
    ok("逐张下载也补了 EXIF", ex.hasShootTime === true, ex.shootTime);
  }

  console.log("\n[3] 暂停/恢复状态不崩");
  const task3 = new ipc.AlbumTask("1", "albumC", 1, "测试", Date.now());
  ok("初始等待状态", task3.runStatus === "wating", task3.runStatus);
  ok("状态文本含成功失败", /成功|无执行/.test(task3.getStatus().showText), task3.getStatus().showText);

  console.log("\n[4] 相册无上传时间：从照片列表推断");
  state.zipMode = false;
  state.photoDownloads = 0;
  state.photoListCalls = 0;
  // 让照片带上 uploadtime（2022-03-04）
  const oldPost = fakeAxios.post;
  fakeAxios.post = async (url) => {
    if (String(url).includes("groupphoto/inqq")) {
      state.photoListCalls += 1;
      if (state.photoListCalls > 1) return { data: { data: { photolist: [] } } };
      return {
        data: {
          data: {
            photolist: [
              {
                sloc: "q1",
                uploadtime: String(Math.floor(new Date(2022, 2, 4, 10, 0, 0).getTime() / 1000)),
                photourl: { a: { url: "https://x/q1.jpg", width: 100, height: 100, enlarge_rate: 1 } },
                videodata: { actionurl: "" },
              },
            ],
          },
        },
      };
    }
    return { data: {} };
  };

  const userDir4 = path.join(tmpRoot, "u4");
  fs.mkdirSync(userDir4, { recursive: true });
  ipc.setDownloadDir(userDir4);
  const task4 = new ipc.AlbumTask("123456", "albumD", 1, "毕业照", null);
  ok("初始无相册时间", task4.albumDate === null);
  await task4.run();
  ok("从照片推断出时间", task4.dirName === "2022-03-04 毕业照", task4.dirName);
  const dir4 = path.join(userDir4, "2022-03-04 毕业照");
  const files4 = fs.existsSync(dir4) ? fs.readdirSync(dir4) : [];
  ok("文件落在推断出的日期目录", files4.length === 1, files4.join(","));
  if (files4.length) {
    const ex = T.readJpegExif(path.join(dir4, files4[0]));
    ok("EXIF 用推断时间", ex.shootTime && ex.shootTime.startsWith("2022:03:04"), ex.shootTime);
  }
  fakeAxios.post = oldPost;

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});
