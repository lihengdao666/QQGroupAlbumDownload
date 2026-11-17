/**
 * 时间解析与 EXIF 处理工具
 *
 * 目标：
 * 1. 从相册标题里解析出时间（支持多种常见写法）；
 * 2. 标题里的时间不完整时，用相册上传时间补齐；
 * 3. 照片没有拍摄时间（EXIF DateTimeOriginal）时，把上面得到的时间写进 EXIF。
 */
const fs = require("fs");
const path = require("path");
const piexif = require("piexifjs");

const CN_NUM = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 把「二〇二三」「二零二三」这类中文数字年份转成 2023 */
function normalizeChineseYear(str) {
  const map = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let out = "";
  for (const ch of str) {
    if (map[ch] !== undefined) out += map[ch];
    else return null;
  }
  return out.length === 4 ? Number(out) : null;
}

/** 简单的中文数字（1-31）转换，支持 十一 / 二十三 */
function cnToNumber(str) {
  if (/^\d+$/.test(str)) return Number(str);
  if (str.length === 1) return CN_NUM[str] ?? null;
  if (str.length === 2 && str[0] === "十") return 10 + (CN_NUM[str[1]] ?? 0);
  if (str.length === 2 && str[1] === "十") return (CN_NUM[str[0]] ?? 0) * 10;
  if (str.length === 3 && str[1] === "十") {
    return (CN_NUM[str[0]] ?? 0) * 10 + (CN_NUM[str[2]] ?? 0);
  }
  return null;
}

/**
 * 从标题里解析时间。
 * 返回 { year, month, day, text }，缺失的字段为 null。
 * text 是标题里命中的原始日期串（用于从标题中剥离）。
 */
function parseTimeFromTitle(title) {
  if (!title) return { year: null, month: null, day: null, text: "" };
  const t = String(title).trim();

  // 1) 完整日期：2023-01-05 / 2023/1/5 / 2023.1.5 / 2023年1月5日 / 2023_01_05
  let m = t.match(/((?:19|20)\d{2})\s*[-/.年_]\s*(\d{1,2})\s*[-/.月_]\s*(\d{1,2})\s*日?/);
  if (m) {
    return {
      year: Number(m[1]),
      month: Number(String(m[2]).replace(/\D/g, "")),
      day: Number(String(m[3]).replace(/\D/g, "")),
      text: m[0],
    };
  }

  // 2) 8 位纯数字：20230105
  m = t.match(/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), text: m[0] };
  }

  // 3) 年月：2023-01 / 2023年1月 / 2023.1（后面不再跟日）
  m = t.match(/((?:19|20)\d{2})\s*[-/.年_]\s*(\d{1,2})\s*月?(?!\s*[-/.月_]\s*\d)/);
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]), day: null, text: m[0] };
  }

  // 4) 中文年份：二〇二三年 / 二零二三年
  m = t.match(/([〇零一二三四五六七八九]{4})\s*年(?:\s*([一二三四五六七八九十\d]{1,3})\s*月)?(?:\s*([一二三四五六七八九十\d]{1,3})\s*日)?/);
  if (m) {
    const year = normalizeChineseYear(m[1]);
    if (year) {
      return {
        year,
        month: m[2] ? cnToNumber(m[2]) : null,
        day: m[3] ? cnToNumber(m[3]) : null,
        text: m[0],
      };
    }
  }

  // 5) 只有月日：1月5日 / 1-5（没有年份，靠上传时间补）
  m = t.match(/(?<!\d)(\d{1,2})\s*[-/.月_]\s*(\d{1,2})\s*日?(?!\d)/);
  if (m) {
    return { year: null, month: Number(m[1]), day: Number(m[2]), text: m[0] };
  }

  // 6) 只有年份：2023年 / 2023
  m = t.match(/(?<!\d)((?:19|20)\d{2})\s*年?/);
  if (m) {
    return { year: Number(m[1]), month: null, day: null, text: m[0] };
  }

  return { year: null, month: null, day: null, text: "" };
}

/** 把各字段拼成一个合法 Date（月份从 1 开始），非法则返回 null */
function buildDate(year, month, day) {
  if (!year) return null;
  const y = Number(year);
  const mo = Number(month || 1);
  const d = Number(day || 1);
  if (y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (isNaN(dt.getTime())) return null;
  // 处理 2 月 30 日这类溢出
  if (dt.getMonth() + 1 !== mo) return null;
  return dt;
}

/** 从接口返回的各种时间字段里尽量取到一个 Date */
function pickUploadDate(item) {
  if (!item) return null;
  const candidates = [
    item.createtime, item.createTime, item.ctime, item.uploadtime,
    item.uploadTime, item.modifytime, item.modifyTime, item.lastuploadtime,
    item.upload_time, item.create_time, item.lastupload_time,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null || c === "") continue;
    // 字符串日期：2023-01-05 / 2023-01-05 12:30:00 / 2023/1/5
    if (typeof c === "string" && /[-/年月]/.test(c)) {
      const m = c.match(/((?:19|20)\d{2})\D{1,3}(\d{1,2})(?:\D{1,3}(\d{1,2}))?/);
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +(m[3] || 1), 12, 0, 0);
        if (!isNaN(d.getTime()) && d.getMonth() + 1 === +m[2]) return d;
      }
      continue;
    }
    let n = Number(c);
    if (isNaN(n)) continue;
    // 秒级时间戳（约 10 位）转毫秒
    if (n > 100000000 && n < 10000000000) n *= 1000;
    if (n < 946684800000 || n > 4102444800000) continue; // 2000~2100 之外视为无效
    const d = new Date(n);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * 生成相册的最终时间：
 * - 标题里有完整日期 → 用标题的
 * - 标题里只有年 / 只有年月 / 只有月日 → 缺失部分用上传时间补
 * - 标题里没有时间 → 用上传时间
 */
function resolveAlbumTime(title, uploadDate) {
  const parsed = parseTimeFromTitle(title);
  const up = uploadDate instanceof Date && !isNaN(uploadDate.getTime()) ? uploadDate : null;

  const year = parsed.year ?? (up ? up.getFullYear() : null);
  let month = parsed.month;
  let day = parsed.day;

  // 只有年份：月日分别按上传时间补
  if (month === null && up) month = up.getMonth() + 1;
  if (day === null && up) day = up.getDate();

  const dt = buildDate(year, month, day);
  if (dt) {
    let source;
    if (parsed.year && parsed.month && parsed.day) source = "title";
    else if (parsed.year || parsed.month || parsed.day) source = "title+upload";
    else source = "upload";
    return { date: dt, parsed, source, hasFullTitleTime: !!(parsed.year && parsed.month && parsed.day) };
  }
  if (up) return { date: up, parsed, source: "upload", hasFullTitleTime: false };
  return { date: null, parsed, source: "none", hasFullTitleTime: false };
}

/** 格式化成文件夹名前缀：2023-01-05 */
function formatDatePrefix(dt) {
  if (!dt) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 清理目录名里的非法字符，保留日期前缀的 - 和空格 */
function sanitizeDirNameSafe(name) {
  return String(name == null ? "" : name)
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
}

/**
 * 生成相册文件夹名：
 * 时间前缀 + 标题；若标题本身已用完整时间开头，则不重复添加。
 */
function buildAlbumDirName(title, uploadDate) {
  const rawTitle = String(title == null ? "" : title).trim() || "未命名相册";
  const { date, hasFullTitleTime, parsed } = resolveAlbumTime(rawTitle, uploadDate);
  const prefix = formatDatePrefix(date);

  if (!prefix) return sanitizeDirNameSafe(rawTitle);

  if (hasFullTitleTime) {
    // 标题自带完整时间：保留原标题的时间，但若它不是以日期开头，仍补一个前缀便于排序
    const startWithDate = /^\s*(19|20)\d{2}\s*[-/.年_]\s*\d{1,2}/.test(rawTitle) ||
      /^\s*(19|20)\d{6}\s*/.test(rawTitle) ||
      /^\s*[〇零一二三四五六七八九]{4}\s*年/.test(rawTitle) ||
      /^\s*\d{4}\s*年/.test(rawTitle);
    if (startWithDate) return sanitizeDirNameSafe(rawTitle);
    // 标题里的时间在中间/末尾：前缀 + 原始标题（去掉重复日期串以免太啰嗦）
    const cleaned = parsed.text ? rawTitle.replace(parsed.text, "").replace(/\s{2,}/g, " ").trim() : rawTitle;
    return sanitizeDirNameSafe(`${prefix} ${cleaned || rawTitle}`);
  }

  // 时间不完整或没有时间：前缀 + 原题
  return sanitizeDirNameSafe(`${prefix} ${rawTitle}`);
}

/** EXIF 需要的格式：YYYY:MM:DD HH:MM:SS */
function formatExifDate(dt) {
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}:${p(dt.getMonth() + 1)}:${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

const JPEG_EXT = /\.(jpe?g)$/i;

/** 读取 JPEG 的 EXIF，返回 { hasShootTime, exifObj } */
function readJpegExif(filePath) {
  const buf = fs.readFileSync(filePath);
  const binary = buf.toString("binary");
  let exifObj;
  try {
    exifObj = piexif.load(binary);
  } catch (e) {
    return { hasShootTime: false, exifObj: null, binary };
  }
  const exif = exifObj.Exif || {};
  const zeroth = exifObj["0th"] || {};
  const shoot = exif[piexif.ExifIFD.DateTimeOriginal] || exif[piexif.ExifIFD.DateTimeDigitized];
  const created = zeroth[piexif.ImageIFD.DateTime];
  const hasShootTime = !!(shoot && String(shoot).trim() && String(shoot).trim() !== "0000:00:00 00:00:00") ||
    !!(created && String(created).trim() && String(created).trim() !== "0000:00:00 00:00:00");
  return { hasShootTime, exifObj, binary, shootTime: shoot || created };
}

/**
 * 给一张 JPEG 写入拍摄时间（若已有则跳过）。
 * 返回 "skipped" | "written" | "error"
 */
function ensureExifTime(filePath, date) {
  if (!JPEG_EXT.test(filePath)) return "skipped";
  if (!date || isNaN(date.getTime())) return "skipped";
  try {
    const { hasShootTime, exifObj, binary } = readJpegExif(filePath);
    if (hasShootTime) return "skipped";

    const str = formatExifDate(date);
    const obj = exifObj || {
      "0th": {},
      Exif: {},
      GPS: {},
      Interop: {},
      "1st": {},
      thumbnail: null,
    };
    obj["0th"] = obj["0th"] || {};
    obj.Exif = obj.Exif || {};
    obj["0th"][piexif.ImageIFD.DateTime] = str;
    obj.Exif[piexif.ExifIFD.DateTimeOriginal] = str;
    obj.Exif[piexif.ExifIFD.DateTimeDigitized] = str;

    const exifBytes = piexif.dump(obj);
    const newBinary = piexif.insert(exifBytes, binary);
    fs.writeFileSync(filePath, Buffer.from(newBinary, "binary"));
    return "written";
  } catch (e) {
    return "error";
  }
}

/** 同时把文件系统时间戳设为该时间，方便按时间排序 */
function touchFileTime(filePath, date) {
  if (!date || isNaN(date.getTime())) return;
  try {
    fs.utimesSync(filePath, date, date);
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 从 zip 解压出来的文件名里再尝试取时间（有些相机文件名是 IMG_20230105_123456.jpg）
 * 找不到返回 null
 */
function parseTimeFromFileName(fileName) {
  const base = path.basename(String(fileName || ""));
  // IMG_20230105_123456 / 20230105_123456 / 2023-01-05_12-34-56
  let m = base.match(/((?:19|20)\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ ]?(\d{2})[-_:]?(\d{2})[-_:]?(\d{2})?/);
  if (m) {
    const dt = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
    if (!isNaN(dt.getTime()) && dt.getFullYear() === +m[1] && dt.getMonth() + 1 === +m[2]) return dt;
  }
  return null;
}

module.exports = {
  parseTimeFromTitle,
  pickUploadDate,
  resolveAlbumTime,
  buildDate,
  formatDatePrefix,
  buildAlbumDirName,
  sanitizeDirNameSafe,
  formatExifDate,
  ensureExifTime,
  touchFileTime,
  parseTimeFromFileName,
  readJpegExif,
};
