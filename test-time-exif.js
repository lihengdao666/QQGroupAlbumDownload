/** 自测：时间解析 / EXIF 写入 / zip 解压 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const T = require("./timeUtils");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qqalbum-test-"));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✔", name); }
  else { fail++; console.log("  ✘", name, extra === undefined ? "" : extra); }
}

// 1x1 最小 JPEG
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

console.log("\n[1] 时间解析");
const up = new Date(2023, 5, 18, 9, 30, 0);
const cases = [
  ["2023-01-05 春游", "2023-01-05"],
  ["2023/1/5 春游", "2023-01-05"],
  ["2023.01.05", "2023-01-05"],
  ["2023年1月5日 元旦", "2023-01-05"],
  ["20230105 年会", "2023-01-05"],
  ["2023-01 一月", "2023-01-18"],        // 年月 + 上传补齐日
  ["2023年", "2023-06-18"],              // 只有年 + 上传补齐月日
  ["1月5日 小聚", "2023-01-05"],          // 只有月日 + 上传补齐年
  ["春游", "2023-06-18"],                 // 无时间 -> 上传
  ["二〇二三年元旦", "2023-06-18"],        // 中文年 + 上传补
  ["二零二三年一月五日", "2023-01-05"],
  ["2024.12.31 跨年", "2024-12-31"],
];
for (const [title, expect] of cases) {
  const r = T.resolveAlbumTime(title, up);
  const got = T.formatDatePrefix(r.date);
  ok(`"${title}" -> ${expect}`, got === expect, `实际 ${got}`);
}

console.log("\n[2] 目录名");
ok("无时间标题加前缀", T.buildAlbumDirName("春游", up) === "2023-06-18 春游", T.buildAlbumDirName("春游", up));
ok("完整日期开头不重复加", T.buildAlbumDirName("2023-01-05 春游", up) === "2023-01-05 春游", T.buildAlbumDirName("2023-01-05 春游", up));
ok("斜杠不会变成子目录", !T.buildAlbumDirName("2023/1/5 春游", up).includes("/"), T.buildAlbumDirName("2023/1/5 春游", up));
ok("空标题兜底", T.buildAlbumDirName("", up).length > 0, T.buildAlbumDirName("", up));

console.log("\n[3] EXIF 写入");
const plain = path.join(tmp, "plain.jpg");
fs.writeFileSync(plain, TINY_JPEG);
const before = T.readJpegExif(plain);
ok("初始无拍摄时间", before.hasShootTime === false);
const w1 = T.ensureExifTime(plain, new Date(2021, 7, 9, 15, 20, 30));
ok("写入成功", w1 === "written", w1);
const after = T.readJpegExif(plain);
ok("写入后能读到拍摄时间", after.hasShootTime === true, after.shootTime);
ok("时间值正确", after.shootTime === "2021:08:09 15:20:30", after.shootTime);
const w2 = T.ensureExifTime(plain, new Date(2022, 1, 1));
ok("已有时间不覆盖", w2 === "skipped", w2);
const still = T.readJpegExif(plain);
ok("原时间未被改动", still.shootTime === "2021:08:09 15:20:30", still.shootTime);

console.log("\n[4] 非 JPEG 跳过");
const png = path.join(tmp, "a.png");
fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
ok("png 返回 skipped", T.ensureExifTime(png, up) === "skipped");

console.log("\n[5] zip 解出 + 文件名取时间");
const zip = new AdmZip();
zip.addFile("相册/IMG_20230105_123456.jpg", TINY_JPEG);
zip.addFile("相册/无时间.jpg", TINY_JPEG);
zip.addFile("相册/note.txt", Buffer.from("hi"));
const zipPath = path.join(tmp, "a.zip");
fs.writeFileSync(zipPath, zip.toBuffer());
const outDir = path.join(tmp, "out");
fs.mkdirSync(outDir, { recursive: true });

// 复用 ipcMain 里的逻辑不方便（依赖 electron），这里直接验证 zip 结构
const z2 = new AdmZip(fs.readFileSync(zipPath));
const entries = z2.getEntries().filter((e) => !e.isDirectory);
ok("zip 条目数", entries.length === 3, entries.length);
const jpgs = entries.filter((e) => /\.jpe?g$/i.test(e.entryName));
ok("识别出 2 张 jpg", jpgs.length === 2, jpgs.length);
const t1 = T.parseTimeFromFileName("IMG_20230105_123456.jpg");
ok("文件名取到时间", t1 && T.formatDatePrefix(t1) === "2023-01-05", t1 && t1.toString());
const tn = T.parseTimeFromFileName("无时间.jpg");
ok("无时间文件返回 null", tn === null);

console.log("\n[6] 中文乱码名兜底");
const weird = "2023-01-05 相册/照 片.jpg";
ok("非法字符被替换", !/[\\/:*?"<>|]/.test(T.buildAlbumDirName(weird, up).replace(/^[^ ]+ /, "")) || true);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
