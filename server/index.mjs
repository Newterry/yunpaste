import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import bcrypt from "bcryptjs";
import mime from "mime-types";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  constants as fsConstants, createWriteStream, statfsSync, unlink
} from "node:fs";
import {
  access, copyFile, mkdtemp, readdir, rm, stat, statfs, unlink as unlinkFile, writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { Transform, pipeline as pipelineCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  closeDatabase, configDir, db, defaultSettings, filesDir, getSettings,
  getSettingsRevision, getUserUsage, invalidateSettingsCache, isSystemOwner,
  listUsersWithUsage, objectsDir, publicUser, rootDir, stagingDir
} from "./db.mjs";
import {
  adminOnly, auth, signFileAccess, signUser, verifyFileAccess
} from "./auth.mjs";
import { databaseEncryptionStatus } from "./database.mjs";
import { openSecret, sealSecret } from "./secret-box.mjs";
import { decryptConfigBackup, encryptConfigBackup } from "./config-backup.mjs";
import {
  createStagingPath, createStorageKey, sanitizeStorageBackend, storageProvider,
  personalWebdavProvider, testStorageConnection, validateStorageConfig
} from "./storage.mjs";

const app = express();
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("PORT 必须是 0–65535 的整数");
}
const requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 30 * 60_000);
const headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 60_000);
if (!Number.isInteger(requestTimeout) || requestTimeout < 1_000 || requestTimeout > 24 * 60 * 60_000) {
  throw new Error("REQUEST_TIMEOUT_MS 必须是 1000–86400000 的整数");
}
if (!Number.isInteger(headersTimeout) || headersTimeout < 1_000 || headersTimeout > 5 * 60_000) {
  throw new Error("HEADERS_TIMEOUT_MS 必须是 1000–300000 的整数");
}
const isProd = process.env.NODE_ENV === "production";
const configuredMinimumFreeBytes = Number(process.env.MIN_FREE_BYTES || 256 * 1024 ** 2);
if (!Number.isSafeInteger(configuredMinimumFreeBytes) || configuredMinimumFreeBytes < 0) {
  throw new Error("MIN_FREE_BYTES 必须是非负整数");
}
const minimumFreeBytes = Math.max(64 * 1024 ** 2, configuredMinimumFreeBytes);
const appVersion = process.env.APP_VERSION || "development";
const reservationTtlMs = Math.max(2 * 60 * 60_000, requestTimeout + 60 * 60_000);
const dummyPasswordHash = bcrypt.hashSync(randomBytes(24).toString("base64url"), 12);
const execFileAsync = promisify(execFile);
const officePreviewExtensions = new Set([
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".rtf", ".wps", ".et", ".dps"
]);
const officePreviewConcurrency = Math.max(1, Math.min(4, Number(process.env.OFFICE_PREVIEW_CONCURRENCY) || 2));
let activeOfficePreviews = 0;

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === "true") app.set("trust proxy", 1);
else if (trustProxy && /^\d+$/.test(trustProxy) && Number(trustProxy) <= 10) {
  app.set("trust proxy", Number(trustProxy));
} else if (trustProxy && trustProxy !== "false") {
  throw new Error("TRUST_PROXY 必须为 false、true 或 0–10 的代理跳数");
}

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
  contentSecurityPolicy: isProd ? {
    directives: {
      // 云粘贴既支持直接通过 HTTP 访问，也支持由反向代理终止 HTTPS。
      // Helmet 的默认升级指令会让 Safari 把 HTTP 静态资源改写为 HTTPS，
      // 在未配置证书的自托管实例中会导致页面无法加载。
      "upgrade-insecure-requests": null,
      // 文件预览先经鉴权接口读取，再转换成当前页面创建的 blob URL。
      // 仅放行同源与 blob，避免放宽到任意远端 frame/media 来源。
      "frame-src": ["'self'", "blob:"],
      "media-src": ["'self'", "blob:"],
      "img-src": ["'self'", "data:", "blob:"]
    }
  } : false
}));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "2mb", strict: true }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "登录尝试过于频繁，请稍后再试" }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "注册请求过于频繁，请稍后再试" }
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "上传请求过于频繁，请稍后再试" }
});
const publicShareLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "共享链接访问过于频繁，请稍后再试" }
});
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1, fields: 0, parts: 1 }
}).single("avatar");
const avatarPresets = new Map([
  ["cat", [0, 0]], ["dog", [1, 0]], ["rabbit", [2, 0]], ["fox", [3, 0]], ["panda", [4, 0]],
  ["koala", [0, 1]], ["tiger", [1, 1]], ["lion", [2, 1]], ["bear", [3, 1]], ["frog", [4, 1]],
  ["penguin", [0, 2]], ["owl", [1, 2]], ["chick", [2, 2]], ["unicorn", [3, 2]], ["hamster", [4, 2]],
  ["monkey", [0, 3]], ["pig", [1, 3]], ["mouse", [2, 3]], ["octopus", [3, 3]], ["whale", [4, 3]]
]);

const allowedKinds = new Set(["text", "image", "video", "audio", "document", "archive", "other"]);
const kindFromMime = (type = "", name = "") => {
  const normalized = String(type).toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)$/i.test(name)) return "audio";
  if (/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(name)) return "video";
  if (
    normalized.startsWith("text/")
    || /\.(md|txt|json|csv|log|html|css|js|mjs|cjs|ts|tsx|jsx|yaml|yml|xml|ini)$/i.test(name)
  ) return "text";
  if (
    /pdf|word|excel|powerpoint|opendocument|officedocument|rtf/.test(normalized)
    || /\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|wps|et|dps)$/i.test(name)
  ) return "document";
  if (/zip|rar|tar|gzip|7z|bzip|xz/.test(normalized) || /\.(zip|rar|tar|gz|7z|bz2|xz)$/i.test(name)) return "archive";
  return "other";
};

function cleanFileName(input, fallback = "未命名文件") {
  let value = String(input || "");
  const characters = [...value];
  if (characters.some((character) => character.charCodeAt(0) > 127)
    && characters.every((character) => character.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(value, "latin1").toString("utf8");
    if (!decoded.includes("\uFFFD")) value = decoded;
  }
  value = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return value.slice(0, 180) || fallback;
}

function fileMime(file) {
  const inferred = mime.lookup(file.originalname || file.name);
  const declared = String(file.mimetype || file.mime || "").toLowerCase();
  const selected = inferred || (declared.includes("/") ? declared : "") || "application/octet-stream";
  return String(selected).slice(0, 120);
}

const fileSelect = `
  SELECT
    f.id, f.owner_id, f.folder_id, f.name, f.mime, f.size, f.kind,
    f.is_shared, f.is_favorite, f.is_trashed, f.share_token,
    f.expires_at, f.share_expires_at, f.trashed_at, f.created_at, f.updated_at,
    u.name AS owner_name
  FROM files f JOIN users u ON f.owner_id = u.id
`;

function canAccess(file, user) {
  // Administrative privileges never grant access to another user's file content
  // or metadata. Admins manage accounts and the service, not personal storage.
  return Boolean(file && file.owner_id === user.id);
}

function isExpired(file) {
  return Boolean(file?.expires_at && Date.parse(file.expires_at) <= Date.now());
}

function shareToken() {
  // 256 bits of entropy makes links unguessable and cannot be derived from file metadata.
  return randomBytes(32).toString("base64url");
}

function futureIso(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.normalize("NFKC").trim().toLowerCase();
  const length = [...username].length;
  if (
    length < 3
    || length > 32
    || !/^[\p{L}\p{N}][\p{L}\p{N}._-]*[\p{L}\p{N}]$/u.test(username)
  ) return null;
  return username;
}

function normalizedSearch(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 100).toLowerCase();
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function fuzzySearchWhere(query, params) {
  if (!query) return null;
  const compact = query.replace(/\s+/g, "");
  const tokens = query.split(" ").filter(Boolean).slice(0, 8);
  const clauses = [];
  for (const token of tokens) {
    const pattern = `%${escapeLike(token)}%`;
    clauses.push(`(
      LOWER(f.name) LIKE ? ESCAPE '\\'
      OR LOWER(f.mime) LIKE ? ESCAPE '\\'
      OR LOWER(f.kind) LIKE ? ESCAPE '\\'
    )`);
    params.push(pattern, pattern, pattern);
  }
  if (compact.length >= 2 && compact.length <= 32) {
    const subsequence = `%${[...compact].map(escapeLike).join("%")}%`;
    clauses.push("REPLACE(LOWER(f.name), ' ', '') LIKE ? ESCAPE '\\'");
    params.push(subsequence);
  }
  const tokenClauses = clauses.slice(0, tokens.length).join(" AND ");
  return compact.length >= 2 && compact.length <= 32
    ? `((${tokenClauses}) OR ${clauses.at(-1)})`
    : `(${tokenClauses})`;
}

function folderResponse(row) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    parent_id: row.parent_id || null,
    name: row.name,
    is_favorite: Number(row.is_favorite || 0),
    is_trashed: Number(row.is_trashed || 0),
    expires_at: row.expires_at || null,
    trashed_at: row.trashed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function ownedFolder(id, userId) {
  if (!id) return null;
  return db.prepare("SELECT * FROM folders WHERE id = ? AND owner_id = ?").get(id, userId);
}

function normalizeFolderId(value, userId, { allowNull = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (allowNull) return null;
    const error = new Error("目标文件夹不能为空");
    error.status = 400;
    throw error;
  }
  if (typeof value !== "string" || value.length > 64) {
    const error = new Error("文件夹标识无效");
    error.status = 400;
    throw error;
  }
  const folder = ownedFolder(value, userId);
  if (!folder || folder.is_trashed) {
    const error = new Error("目标文件夹不存在");
    error.status = 404;
    throw error;
  }
  return folder.id;
}

function folderBreadcrumbs(folderId, userId) {
  const result = [];
  const visited = new Set();
  let current = folderId ? ownedFolder(folderId, userId) : null;
  while (current && !visited.has(current.id) && result.length < 64) {
    visited.add(current.id);
    result.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? ownedFolder(current.parent_id, userId) : null;
  }
  return result;
}

function descendantFolderIds(rootId, userId) {
  const rows = db.prepare("SELECT id, parent_id FROM folders WHERE owner_id = ?").all(userId);
  const children = new Map();
  for (const row of rows) {
    const key = row.parent_id || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(row.id);
  }
  const result = [];
  const queue = [rootId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) || []));
  }
  return result;
}

function availableFolderName(ownerId, parentId, requested, excludeId) {
  const base = cleanFileName(requested, "新建文件夹").slice(0, 120);
  const rows = db.prepare(`
    SELECT id, name FROM folders
    WHERE owner_id = ? AND parent_id IS ? AND is_trashed = 0
  `).all(ownerId, parentId);
  const used = new Set(rows.filter((row) => row.id !== excludeId).map((row) => row.name.toLocaleLowerCase("zh-CN")));
  if (!used.has(base.toLocaleLowerCase("zh-CN"))) return base;
  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${base} (${suffix})`.slice(0, 120);
    if (!used.has(candidate.toLocaleLowerCase("zh-CN"))) return candidate;
    suffix += 1;
  }
  return `${base.slice(0, 100)}-${randomUUID().slice(0, 8)}`;
}

function enabledFeature(setting, message) {
  return (_req, res, next) => {
    if (!getSettings()[setting]) return res.status(403).json({ error: message });
    next();
  };
}

const personalWebdavEnabled = enabledFeature("allowPersonalWebdav", "管理员已停用个人 WebDAV");
const ticketsEnabled = enabledFeature("allowTickets", "管理员已停用工单系统");

function validAvatar(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  }
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function requestFlag(body, key) {
  if (!Object.hasOwn(body || {}, key)) return undefined;
  const value = body[key];
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return null;
}

function activeStorageBackend() {
  const row = db.prepare("SELECT * FROM storage_backends WHERE is_active = 1 LIMIT 1").get();
  if (!row) {
    const error = new Error("系统没有可用的活动存储后端");
    error.status = 503;
    throw error;
  }
  return row;
}

function storageBackendById(id) {
  const row = db.prepare("SELECT * FROM storage_backends WHERE id = ?").get(id || "local");
  if (!row) {
    const error = new Error("文件对应的存储后端已不存在");
    error.status = 503;
    throw error;
  }
  return row;
}

function reservedStorageBytes({ userId, excludeId } = {}) {
  db.prepare("DELETE FROM storage_reservations WHERE expires_at <= ?").run(new Date().toISOString());
  const conditions = ["expires_at > ?"];
  const values = [new Date().toISOString()];
  if (userId) {
    conditions.push("user_id = ?");
    values.push(userId);
  }
  if (excludeId) {
    conditions.push("id <> ?");
    values.push(excludeId);
  }
  return Number(db.prepare(`
    SELECT COALESCE(SUM(bytes), 0) AS total
    FROM storage_reservations
    WHERE ${conditions.join(" AND ")}
  `).get(...values).total);
}

function availableStorageBytes({ excludeReservationId } = {}) {
  const volume = statfsSync(filesDir);
  return Math.max(
    0,
    volume.bavail * volume.bsize
      - minimumFreeBytes
      - reservedStorageBytes({ excludeId: excludeReservationId })
  );
}

function reserveStorage(req, res, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return { ok: false, status: 400, error: "上传大小无效" };
  }
  const id = randomUUID();
  const time = new Date();
  let result;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM storage_reservations WHERE expires_at <= ?").run(time.toISOString());
    const account = db.prepare("SELECT quota, status FROM users WHERE id = ?").get(req.user.id);
    const usage = account ? getUserUsage(req.user.id) : 0;
    const userReserved = reservedStorageBytes({ userId: req.user.id });
    if (!account || account.status !== "active") {
      result = { ok: false, status: 403, error: "账户已停用" };
    } else if (usage + userReserved + bytes > Number(account.quota)) {
      result = { ok: false, status: 413, error: "已超出账户存储配额" };
    } else if (bytes > availableStorageBytes()) {
      result = { ok: false, status: 507, error: "服务器存储空间不足，请联系管理员" };
    } else {
      db.prepare(`
        INSERT INTO storage_reservations (id, user_id, bytes, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        req.user.id,
        bytes,
        new Date(time.getTime() + reservationTtlMs).toISOString(),
        time.toISOString()
      );
      result = { ok: true, id };
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (!result.ok) return result;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    db.prepare("DELETE FROM storage_reservations WHERE id = ?").run(id);
  };
  req.storageReservationId = id;
  req.releaseStorageReservation = release;
  res.once("finish", release);
  res.once("close", release);
  return result;
}

function assertCommitWithinQuota(req, incomingBytes) {
  const account = db.prepare("SELECT quota, status FROM users WHERE id = ?").get(req.user.id);
  if (!account || account.status !== "active") {
    const error = new Error("账户已停用");
    error.status = 403;
    throw error;
  }
  const otherReserved = reservedStorageBytes({
    userId: req.user.id,
    excludeId: req.storageReservationId
  });
  if (getUserUsage(req.user.id) + otherReserved + incomingBytes > Number(account.quota)) {
    const error = new Error("已超出账户存储配额");
    error.status = 413;
    throw error;
  }
  const volume = statfsSync(filesDir);
  const rawFreeBytes = volume.bavail * volume.bsize;
  const globalReserved = reservedStorageBytes({ excludeId: req.storageReservationId });
  if (rawFreeBytes < minimumFreeBytes + globalReserved) {
    const error = new Error("服务器存储空间不足，请联系管理员");
    error.status = 507;
    throw error;
  }
}

class BudgetCounter extends Transform {
  constructor(req, fieldname) {
    super();
    this.req = req;
    this.fieldname = fieldname;
  }

  _transform(chunk, encoding, callback) {
    this.req.uploadBytes += chunk.length;
    if (this.req.uploadBytes > this.req.uploadBudget) {
      callback(new multer.MulterError("LIMIT_FILE_SIZE", this.fieldname));
      return;
    }
    callback(null, chunk);
  }
}

const quotaStorage = {
  _handleFile(req, file, callback) {
    const filename = createStorageKey(file.originalname);
    const path = createStagingPath(file.originalname);
    const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
    const counter = new BudgetCounter(req, file.fieldname);
    pipelineCallback(file.stream, counter, output, (error) => {
      if (error) {
        unlink(path, () => callback(error));
        return;
      }
      callback(null, { destination: stagingDir, filename, path, size: output.bytesWritten });
    });
  },

  _removeFile(_req, file, callback) {
    const path = file.path;
    delete file.destination;
    delete file.filename;
    delete file.path;
    unlink(path, callback);
  }
};

function currentUpload(req, res, next) {
  const settings = getSettings();
  const configuredKinds = new Set(
    String(settings.allowedTypes || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedKinds.has(value))
  );
  const currentReserved = reservedStorageBytes({ userId: req.user.id });
  const remaining = Math.max(
    0,
    Number(req.user.quota) - getUserUsage(req.user.id) - currentReserved
  );
  if (remaining === 0) return res.status(413).json({ error: "已超出账户存储配额" });
  const diskBudget = availableStorageBytes();
  if (diskBudget === 0) return res.status(507).json({ error: "服务器存储空间不足，请联系管理员" });
  const declaredBytes = Number(req.headers["x-upload-bytes"]);
  const hasDeclaredBytes = Number.isSafeInteger(declaredBytes) && declaredBytes >= 0;
  const maxBatchBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    Number(settings.maxUploadMb) * 1024 * 1024 * Number(settings.maxFilesPerUpload)
  );
  const reservation = hasDeclaredBytes
    ? declaredBytes
    : Math.min(remaining, diskBudget, maxBatchBytes);
  if (hasDeclaredBytes && declaredBytes > Math.min(remaining, diskBudget)) {
    return res.status(declaredBytes > remaining ? 413 : 507).json({
      error: declaredBytes > remaining ? "已超出账户存储配额" : "服务器存储空间不足，请联系管理员"
    });
  }
  const reserved = reserveStorage(req, res, reservation);
  if (!reserved.ok) {
    return res.status(reserved.status).json({ error: reserved.error });
  }

  req.uploadBytes = 0;
  req.uploadBudget = reservation;
  const middleware = multer({
    storage: quotaStorage,
    limits: {
      fileSize: Math.min(Number(settings.maxUploadMb) * 1024 * 1024, remaining),
      files: Number(settings.maxFilesPerUpload),
      fields: 4,
      parts: Number(settings.maxFilesPerUpload) + 4
    },
    fileFilter: (_request, file, callback) => {
      file.originalname = cleanFileName(file.originalname);
      file.mimetype = fileMime(file);
      const kind = kindFromMime(file.mimetype, file.originalname);
      if (configuredKinds.size && !configuredKinds.has(kind)) {
        const error = new Error(`系统不允许上传“${kind}”类别的文件`);
        error.status = 415;
        callback(error);
        return;
      }
      callback(null, true);
    }
  }).array("files", Number(settings.maxFilesPerUpload));
  middleware(req, res, next);
}

function currentWebdavUpload(req, res, next) {
  const settings = getSettings();
  const configuredKinds = new Set(
    String(settings.allowedTypes || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedKinds.has(value))
  );
  const diskBudget = availableStorageBytes();
  if (diskBudget === 0) return res.status(507).json({ error: "服务器临时空间不足，请稍后再试" });
  const declaredBytes = Number(req.headers["x-upload-bytes"]);
  const hasDeclaredBytes = Number.isSafeInteger(declaredBytes) && declaredBytes >= 0;
  const maxBatchBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    Number(settings.maxUploadMb) * 1024 * 1024 * Number(settings.maxFilesPerUpload)
  );
  if (hasDeclaredBytes && declaredBytes > Math.min(diskBudget, maxBatchBytes)) {
    return res.status(declaredBytes > maxBatchBytes ? 413 : 507).json({
      error: declaredBytes > maxBatchBytes ? "上传批次超过系统限制" : "服务器临时空间不足，请稍后再试"
    });
  }
  req.uploadBytes = 0;
  req.uploadBudget = hasDeclaredBytes ? declaredBytes : Math.min(diskBudget, maxBatchBytes);
  const middleware = multer({
    storage: quotaStorage,
    limits: {
      fileSize: Number(settings.maxUploadMb) * 1024 * 1024,
      files: Number(settings.maxFilesPerUpload),
      fields: 3,
      parts: Number(settings.maxFilesPerUpload) + 3
    },
    fileFilter: (_request, file, callback) => {
      file.originalname = cleanFileName(file.originalname);
      file.mimetype = fileMime(file);
      const kind = kindFromMime(file.mimetype, file.originalname);
      if (configuredKinds.size && !configuredKinds.has(kind)) {
        const error = new Error(`系统不允许上传“${kind}”类别的文件`);
        error.status = 415;
        callback(error);
        return;
      }
      callback(null, true);
    }
  }).array("files", Number(settings.maxFilesPerUpload));
  middleware(req, res, next);
}

async function removeUploadedFiles(files = []) {
  await Promise.allSettled(
    files.map((file) => file?.path && unlinkFile(file.path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    }))
  );
}

async function stageStoredObject(file, signal) {
  const sourceProvider = storageProvider(storageBackendById(file.storage_backend_id));
  const stagedPath = createStagingPath(file.name);
  let opened;
  try {
    opened = await sourceProvider.open(file.stored_name, { signal });
    await pipeline(opened.stream, createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }), { signal });
    await opened.completion;
    return stagedPath;
  } catch (error) {
    opened?.cancel?.();
    await unlinkFile(stagedPath).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function copyStoredObject(file, destinationBackend, destinationKey, signal) {
  const stagedPath = await stageStoredObject(file, signal);
  try {
    await storageProvider(destinationBackend).commit(stagedPath, destinationKey, signal);
  } catch (error) {
    await unlinkFile(stagedPath).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function deleteUserStoredObjects(userId) {
  const files = db.prepare("SELECT * FROM files WHERE owner_id = ?").all(userId);
  const results = await Promise.allSettled(files.map((file) => (
    storageProvider(storageBackendById(file.storage_backend_id)).delete(file.stored_name)
  )));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    const error = new Error("账户文件暂时无法全部删除，请稍后重试");
    error.status = 503;
    throw error;
  }
}

function contentDisposition(name) {
  const clean = cleanFileName(name).replace(/["\\]/g, "_");
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function inlineContentDisposition(name) {
  const clean = cleanFileName(name).replace(/["\\]/g, "_");
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function safeInlineMime(file) {
  const type = String(file.mime || "application/octet-stream").toLowerCase();
  if (type === "text/html" || type.includes("javascript") || type === "application/xhtml+xml") {
    return "text/plain; charset=utf-8";
  }
  return type;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return false;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function sendStoredFile(req, res, file, { download = false } = {}) {
  const provider = storageProvider(storageBackendById(file.storage_backend_id));
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortIfIncomplete = () => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", abortIfIncomplete);
  const info = await provider.stat(file.stored_name, controller.signal);
  if (!info) {
    req.off("aborted", abort);
    res.off("close", abortIfIncomplete);
    return res.status(404).json({ error: "文件内容不存在" });
  }

  const range = parseRange(req.headers.range, info.size);
  if (range === false) {
    req.off("aborted", abort);
    res.off("close", abortIfIncomplete);
    res.setHeader("Content-Range", `bytes */${info.size}`);
    return res.status(416).end();
  }

  const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", info.mtime.toUTCString());
  res.setHeader("Cache-Control", "private, no-cache, no-transform, max-age=0, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (download) {
    res.setHeader("Content-Disposition", contentDisposition(file.name));
  } else if (file.mime === "application/pdf") {
    // Browser PDF viewers cannot initialize inside a CSP sandbox. The MIME type
    // is fixed and nosniff remains enabled, so the document can be rendered
    // without granting uploaded HTML or script content any execution path.
    res.removeHeader("Content-Security-Policy");
    res.setHeader("Content-Disposition", inlineContentDisposition(file.name));
  } else {
    res.setHeader("Content-Security-Policy", "sandbox");
  }
  res.type(download ? file.mime : safeInlineMime(file));

  if (!range && req.headers["if-none-match"] === etag) {
    req.off("aborted", abort);
    res.off("close", abortIfIncomplete);
    return res.status(304).end();
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const length = Math.max(0, end - start + 1);
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
  }
  res.setHeader("Content-Length", length);
  if (req.method === "HEAD" || length === 0) {
    req.off("aborted", abort);
    res.off("close", abortIfIncomplete);
    return res.end();
  }

  let opened;
  try {
    opened = await provider.open(file.stored_name, {
      start,
      end,
      signal: controller.signal
    });
    await Promise.all([pipeline(opened.stream, res), opened.completion]);
  } catch (error) {
    if (!controller.signal.aborted && !res.destroyed && !res.headersSent) throw error;
  } finally {
    opened?.cancel?.();
    req.off("aborted", abort);
    res.off("close", abortIfIncomplete);
  }
}

async function readiness(_req, res) {
  try {
    db.prepare("SELECT 1").get();
    await Promise.all([
      access(configDir, fsConstants.R_OK | fsConstants.W_OK),
      access(filesDir, fsConstants.R_OK | fsConstants.W_OK)
    ]);
    const volume = await statfs(filesDir);
    const storageFreeBytes = volume.bavail * volume.bsize;
    const reservedBytes = reservedStorageBytes();
    if (storageFreeBytes < minimumFreeBytes) {
      return res.status(503).json({
        status: "error",
        error: "存储空间低于安全余量",
        storageFreeBytes,
        reservedStorageBytes: reservedBytes
      });
    }
    const backend = activeStorageBackend();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let backendStatus;
    try {
      backendStatus = await storageProvider(backend).health(controller.signal);
    } finally {
      clearTimeout(timeout);
    }
    res.json({
      status: "ok",
      version: appVersion,
      time: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      storageFreeBytes,
      reservedStorageBytes: reservedBytes,
      storageBackend: { driver: backend.driver, state: backendStatus.state }
    });
  } catch (error) {
    res.status(503).json({ status: "error", error: error.message });
  }
}

app.get("/livez", (_req, res) => res.json({ status: "ok" }));
app.get("/readyz", readiness);
app.get("/health", readiness);
app.get("/api/version", (_req, res) => res.json({ version: appVersion }));

app.get("/api/config", (_req, res) => {
  const settings = getSettings();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    config: {
      siteName: settings.siteName,
      siteSubtitle: settings.siteSubtitle,
      allowRegistration: settings.allowRegistration,
      maxUploadMb: settings.maxUploadMb,
      defaultExpiryDays: settings.defaultExpiryDays,
      defaultShareDays: settings.defaultShareDays,
      expiryWarningDays: settings.expiryWarningDays,
      maxFilesPerUpload: settings.maxFilesPerUpload,
      allowedTypes: settings.allowedTypes,
      allowPersonalWebdav: settings.allowPersonalWebdav,
      allowTickets: settings.allowTickets
    }
  });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  if (typeof req.body?.email !== "string" || typeof req.body?.password !== "string") {
    return res.status(400).json({ error: "账号和密码必须为文本" });
  }
  const account = req.body.email.trim().toLowerCase().slice(0, 254);
  const password = req.body.password;
  const user = db.prepare(`
    SELECT * FROM users
    WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
    LIMIT 1
  `).get(account, account);
  const passwordWithinLimit = Buffer.byteLength(password) <= 72;
  const valid = await bcrypt.compare(
    passwordWithinLimit ? password : "",
    user?.password_hash || dummyPasswordHash
  );
  if (!user || !passwordWithinLimit || !valid) {
    return res.status(401).json({ error: "账号或密码不正确" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "账户已停用" });
  const lastSeen = new Date().toISOString();
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(lastSeen, user.id);
  res.json({
    token: signUser(user),
    user: publicUser({ ...user, last_seen_at: lastSeen })
  });
});

app.post("/api/auth/register", registerLimiter, async (req, res, next) => {
  if (!getSettings().allowRegistration) return res.status(403).json({ error: "系统未开放注册" });
  if (
    (Object.hasOwn(req.body || {}, "username") && typeof req.body.username !== "string")
    ||
    typeof req.body?.name !== "string"
    || typeof req.body?.email !== "string"
    || typeof req.body?.password !== "string"
  ) {
    return res.status(400).json({ error: "注册信息格式不正确" });
  }
  const name = cleanFileName(req.body?.name, "").slice(0, 80);
  const email = req.body.email.trim().toLowerCase();
  // Keep API compatibility for trusted older clients while the current UI asks
  // users to choose a username explicitly.
  const username = normalizeUsername(
    req.body.username ?? (email.includes("@") ? email.split("@")[0] : "")
  );
  const password = req.body.password;
  const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (
    !username
    || name.length < 2
    || !validEmail
    || password.length < 8
    || Buffer.byteLength(password) > 72
  ) {
    return res.status(400).json({
      error: "用户名需为 3–32 位字母、数字、点、下划线或连字符；密码需为 8–72 字节"
    });
  }
  if (db.prepare(`
    SELECT 1 FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
  `).get(email, username)) {
    return res.status(409).json({ error: "该用户名或邮箱已经注册" });
  }
  try {
    const id = randomUUID();
    const time = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(`
      INSERT INTO users
        (id, username, name, email, password_hash, role, status, quota, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'member', 'active', ?, ?, ?)
    `).run(
      id,
      username,
      name,
      email,
      passwordHash,
      Number(getSettings().defaultUserQuotaGb) * 1024 ** 3,
      time,
      time
    );
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    res.status(201).json({ token: signUser(user), user: publicUser(user) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "该用户名或邮箱已经注册" });
    }
    next(error);
  }
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ user: { ...req.user, usage: getUserUsage(req.user.id) } });
});

app.patch("/api/profile", auth, async (req, res) => {
  if (
    !Object.hasOwn(req.body || {}, "name")
    && !Object.hasOwn(req.body || {}, "username")
    && !Object.hasOwn(req.body || {}, "email")
  ) {
    return res.status(400).json({ error: "没有需要更新的个人资料" });
  }
  const account = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  let name = account.name;
  let username = account.username;
  let email = account.email;
  if (Object.hasOwn(req.body || {}, "name")) {
    if (typeof req.body.name !== "string") {
      return res.status(400).json({ error: "显示名称必须为文本" });
    }
    name = cleanFileName(req.body.name, "").slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: "显示名称至少需要 2 个字符" });
  }
  if (Object.hasOwn(req.body || {}, "username")) {
    username = normalizeUsername(req.body.username);
    if (!username) {
      return res.status(400).json({
        error: "用户名需为 3–32 位字母、数字、点、下划线或连字符"
      });
    }
    const conflict = db.prepare(`
      SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id <> ?
    `).get(username, req.user.id);
    if (conflict) return res.status(409).json({ error: "该用户名已被使用" });
  }
  if (Object.hasOwn(req.body || {}, "email")) {
    if (typeof req.body.email !== "string" || typeof req.body.currentPassword !== "string") {
      return res.status(400).json({ error: "修改邮箱需要填写当前密码" });
    }
    email = req.body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "请输入有效的邮箱地址" });
    }
    if (Buffer.byteLength(req.body.currentPassword) > 72
      || !await bcrypt.compare(req.body.currentPassword, account.password_hash)) {
      return res.status(403).json({ error: "当前密码不正确" });
    }
    const conflict = db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id <> ?")
      .get(email, req.user.id);
    if (conflict) return res.status(409).json({ error: "该邮箱已被使用" });
  }
  db.prepare("UPDATE users SET username = ?, name = ?, email = ? WHERE id = ?")
    .run(username, name, email, req.user.id);
  res.json({
    user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id))
  });
});

app.delete("/api/profile", auth, async (req, res) => {
  if (isSystemOwner(req.user.id)) {
    return res.status(403).json({ error: "主管理员不能注销；请先在管理中心转移主管理员身份" });
  }
  if (typeof req.body?.password !== "string" || req.body?.confirmation !== "DELETE") {
    return res.status(400).json({ error: "请输入当前密码并确认注销账号" });
  }
  const account = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!account || Buffer.byteLength(req.body.password) > 72
    || !await bcrypt.compare(req.body.password, account.password_hash)) {
    return res.status(403).json({ error: "当前密码不正确" });
  }
  if (account.role === "admin") {
    const admins = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"
    ).get().count);
    if (admins <= 1) return res.status(409).json({ error: "至少需要保留一个可用管理员账号" });
  }
  try {
    await deleteUserStoredObjects(account.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(account.id);
    res.status(204).end();
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

app.patch("/api/profile/password", auth, async (req, res) => {
  if (typeof req.body?.currentPassword !== "string" || typeof req.body?.newPassword !== "string") {
    return res.status(400).json({ error: "密码必须为文本" });
  }
  const currentPassword = req.body.currentPassword;
  const newPassword = req.body.newPassword;
  if (
    newPassword.length < 8
    || Buffer.byteLength(newPassword) > 72
    || Buffer.byteLength(currentPassword) > 72
  ) {
    return res.status(400).json({ error: "新密码需为 8–72 字节" });
  }
  const account = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!account || !await bcrypt.compare(currentPassword, account.password_hash)) {
    return res.status(403).json({ error: "当前密码不正确" });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, req.user.id);
  res.json({ ok: true });
});

app.post("/api/profile/avatar", auth, (req, res, next) => {
  avatarUpload(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: "头像不能超过 512 KB" });
      }
      return next(error);
    }
    if (!req.file) return res.status(400).json({ error: "请选择头像文件" });
    const mimeType = String(req.file.mimetype || "").toLowerCase();
    if (!validAvatar(req.file.buffer, mimeType)) {
      return res.status(415).json({ error: "头像仅支持真实的 PNG、JPEG 或 WebP 图片" });
    }
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE users
      SET avatar_mime = ?, avatar_data = ?, avatar_preset = NULL, avatar_updated_at = ?
      WHERE id = ?
    `).run(mimeType, req.file.buffer, updatedAt, req.user.id);
    res.json({
      user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id))
    });
  });
});

app.post("/api/profile/avatar/preset", auth, (req, res) => {
  if (typeof req.body?.preset !== "string" || !avatarPresets.has(req.body.preset)) {
    return res.status(400).json({ error: "请选择有效的预设头像" });
  }
  db.prepare(`
    UPDATE users
    SET avatar_mime = NULL, avatar_data = NULL, avatar_preset = ?, avatar_updated_at = ?
    WHERE id = ?
  `).run(req.body.preset, new Date().toISOString(), req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

app.delete("/api/profile/avatar", auth, (req, res) => {
  db.prepare(`
    UPDATE users SET avatar_mime = NULL, avatar_data = NULL, avatar_preset = NULL, avatar_updated_at = NULL
    WHERE id = ?
  `).run(req.user.id);
  res.json({
    user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id))
  });
});

app.get("/api/avatar-presets/:preset.png", (req, res) => {
  if (!avatarPresets.has(req.params.preset)) return res.status(404).end();
  const assetRoot = join(rootDir, isProd ? "dist" : "public", "assets", "avatar-presets");
  res.sendFile(join(assetRoot, `${req.params.preset}.png`), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

app.get("/api/users/:id/avatar", (req, res) => {
  const avatar = db.prepare(`
    SELECT avatar_mime, avatar_data, avatar_updated_at FROM users WHERE id = ?
  `).get(req.params.id);
  if (!avatar?.avatar_data || !avatar.avatar_mime) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Type", avatar.avatar_mime);
  res.setHeader("Content-Length", avatar.avatar_data.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(avatar.avatar_data);
});

app.get("/api/overview", auth, (req, res) => {
  const nowIso = new Date().toISOString();
  const expiryWarningDays = getSettings().expiryWarningDays;
  const soonIso = futureIso(expiryWarningDays);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(req.query.page || "1"), 10) || 1));
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(String(req.query.pageSize || "8"), 10) || 8));
  const filter = ["all", "text", "image", "file", "favorite"].includes(String(req.query.filter))
    ? String(req.query.filter)
    : "all";
  const recentConditions = ["f.owner_id = ?", "f.is_trashed = 0"];
  if (filter === "favorite") recentConditions.push("f.is_favorite = 1");
  else if (filter === "file") recentConditions.push("f.kind NOT IN ('text', 'image')");
  else if (filter !== "all") recentConditions.push(`f.kind = '${filter}'`);
  const recentWhere = recentConditions.join(" AND ");
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_files,
      SUM(CASE WHEN expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ? THEN 1 ELSE 0 END)
        AS expiring_soon,
      SUM(CASE WHEN is_shared = 1 AND (share_expires_at IS NULL OR share_expires_at > ?) THEN 1 ELSE 0 END)
        AS active_shares
    FROM files
    WHERE owner_id = ? AND is_trashed = 0
  `).get(nowIso, soonIso, nowIso, req.user.id);
  const recentTotal = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM files f WHERE ${recentWhere}
  `).get(req.user.id).count || 0);
  const recent = db.prepare(`
    ${fileSelect}
    WHERE ${recentWhere}
    ORDER BY f.updated_at DESC, f.id DESC LIMIT ? OFFSET ?
  `).all(req.user.id, pageSize, (page - 1) * pageSize);
  const expiring = db.prepare(`
    ${fileSelect}
    WHERE f.owner_id = ? AND f.is_trashed = 0
      AND f.expires_at IS NOT NULL AND f.expires_at > ? AND f.expires_at <= ?
    ORDER BY f.expires_at ASC, f.id ASC LIMIT 6
  `).all(req.user.id, nowIso, soonIso);
  res.json({
    overview: {
      totalFiles: Number(summary.total_files || 0),
      expiringSoon: Number(summary.expiring_soon || 0),
      activeShares: Number(summary.active_shares || 0),
      usage: getUserUsage(req.user.id),
      quota: Number(req.user.quota),
      recent,
      recentTotal,
      recentPage: page,
      recentPageSize: pageSize,
      expiring,
      expiryWarningDays
    }
  });
});

app.get("/api/files", auth, (req, res) => {
  // Always scope the query at SQL level. There is intentionally no admin bypass.
  const conditions = ["f.owner_id = ?"];
  const params = [req.user.id];
  if (req.query.view === "trash") conditions.push("f.is_trashed = 1");
  else conditions.push("f.is_trashed = 0");
  if (req.query.view === "shared") conditions.push("f.is_shared = 1");
  if (req.query.view === "favorites") conditions.push("f.is_favorite = 1");
  if (req.query.kind && req.query.kind !== "all" && allowedKinds.has(String(req.query.kind))) {
    conditions.push("f.kind = ?");
    params.push(req.query.kind);
  }
  const query = normalizedSearch(req.query.q);
  let folderId = null;
  if (!query && req.query.folderId) {
    try {
      folderId = normalizeFolderId(req.query.folderId, req.user.id);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
  }
  if (!query) {
    conditions.push("f.folder_id IS ?");
    params.push(folderId);
  }
  const searchCondition = fuzzySearchWhere(query, params);
  if (searchCondition) conditions.push(searchCondition);

  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(req.query.page || "1"), 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(req.query.pageSize || "50"), 10) || 50));
  const order = req.query.order === "asc" ? "ASC" : "DESC";
  const sortColumn = {
    name: "LOWER(f.name)",
    size: "f.size",
    updated: "f.updated_at"
  }[String(req.query.sort || "updated")] || "f.updated_at";
  const orderParams = [];
  let relevanceOrder = "";
  if (query) {
    relevanceOrder = `CASE
      WHEN LOWER(f.name) = ? THEN 0
      WHEN LOWER(f.name) LIKE ? ESCAPE '\\' THEN 1
      WHEN LOWER(f.name) LIKE ? ESCAPE '\\' THEN 2
      ELSE 3
    END ASC,`;
    orderParams.push(query, `${escapeLike(query)}%`, `%${escapeLike(query)}%`);
  }
  const where = conditions.join(" AND ");
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM files f JOIN users u ON f.owner_id = u.id WHERE ${where}`
  ).get(...params).count);
  const rows = db.prepare(
    `${fileSelect} WHERE ${where} ORDER BY ${relevanceOrder} ${sortColumn} ${order}, f.id ${order} LIMIT ? OFFSET ?`
  ).all(...params, ...orderParams, pageSize, (page - 1) * pageSize);
  const folderParams = [req.user.id];
  const folderConditions = ["owner_id = ?"];
  if (req.query.view === "trash") folderConditions.push("is_trashed = 1");
  else folderConditions.push("is_trashed = 0");
  if (req.query.view === "favorites") folderConditions.push("is_favorite = 1");
  if (req.query.view === "shared") folderConditions.push("0 = 1");
  if (query) {
    const tokens = query.split(" ").filter(Boolean).slice(0, 8);
    const fuzzy = tokens.map(() => "LOWER(name) LIKE ? ESCAPE '\\'").join(" AND ");
    folderConditions.push(`(${fuzzy})`);
    folderParams.push(...tokens.map((token) => `%${escapeLike(token)}%`));
  } else {
    folderConditions.push("parent_id IS ?");
    folderParams.push(folderId);
  }
  const folderRows = db.prepare(`
    SELECT * FROM folders
    WHERE ${folderConditions.join(" AND ")}
    ORDER BY LOWER(name) ASC, id ASC
    LIMIT 5000
  `).all(...folderParams).map(folderResponse);
  res.json({
    files: rows,
    folders: folderRows,
    breadcrumbs: folderBreadcrumbs(folderId, req.user.id),
    currentFolderId: folderId,
    page,
    pageSize,
    total: total + folderRows.length,
    fileTotal: total,
    hasMore: page * pageSize < total
  });
});

app.post("/api/folders", auth, (req, res) => {
  if (typeof req.body?.name !== "string") {
    return res.status(400).json({ error: "文件夹名称必须为文本" });
  }
  let parentId;
  try {
    parentId = normalizeFolderId(req.body.parentId, req.user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const name = availableFolderName(req.user.id, parentId, req.body.name);
  const time = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO folders
      (id, owner_id, parent_id, name, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, parentId, name, futureIso(getSettings().defaultExpiryDays), time, time);
  res.status(201).json({ folder: folderResponse(ownedFolder(id, req.user.id)) });
});

app.patch("/api/folders/:id", auth, (req, res) => {
  const folder = ownedFolder(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: "文件夹不存在" });
  const fields = [];
  const values = [];
  if (Object.hasOwn(req.body || {}, "name")) {
    if (typeof req.body.name !== "string" || !req.body.name.trim()) {
      return res.status(400).json({ error: "文件夹名称不能为空" });
    }
    fields.push("name = ?");
    values.push(availableFolderName(req.user.id, folder.parent_id, req.body.name, folder.id));
  }
  if (Object.hasOwn(req.body || {}, "parent_id")) {
    let parentId;
    try {
      parentId = normalizeFolderId(req.body.parent_id, req.user.id);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    if (parentId && descendantFolderIds(folder.id, req.user.id).includes(parentId)) {
      return res.status(400).json({ error: "不能把文件夹移动到自身内部" });
    }
    fields.push("parent_id = ?", "name = ?");
    values.push(parentId, availableFolderName(req.user.id, parentId, folder.name, folder.id));
  }
  if (Object.hasOwn(req.body || {}, "is_favorite")) {
    const favorite = requestFlag(req.body, "is_favorite");
    if (favorite === null) return res.status(400).json({ error: "收藏状态必须为布尔值" });
    fields.push("is_favorite = ?", "expires_at = ?");
    values.push(favorite, favorite ? null : futureIso(getSettings().defaultExpiryDays));
  }
  if (Object.hasOwn(req.body || {}, "is_trashed")) {
    const trashed = requestFlag(req.body, "is_trashed");
    if (trashed === null) return res.status(400).json({ error: "回收站状态必须为布尔值" });
    const ids = descendantFolderIds(folder.id, req.user.id);
    const placeholders = ids.map(() => "?").join(",");
    const time = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE folders SET is_trashed = ?, trashed_at = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(trashed, trashed ? time : null, time, ...ids);
      db.prepare(`UPDATE files SET is_trashed = ?, trashed_at = ?, access_version = access_version + 1, updated_at = ? WHERE owner_id = ? AND folder_id IN (${placeholders})`)
        .run(trashed, trashed ? time : null, time, req.user.id, ...ids);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return res.json({ folder: folderResponse(ownedFolder(folder.id, req.user.id)) });
  }
  if (!fields.length) return res.status(400).json({ error: "没有可更新的内容" });
  fields.push("updated_at = ?");
  values.push(new Date().toISOString(), folder.id);
  db.prepare(`UPDATE folders SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  res.json({ folder: folderResponse(ownedFolder(folder.id, req.user.id)) });
});

app.delete("/api/folders/:id", auth, async (req, res) => {
  const folder = ownedFolder(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: "文件夹不存在" });
  const ids = descendantFolderIds(folder.id, req.user.id);
  const placeholders = ids.map(() => "?").join(",");
  const files = db.prepare(`SELECT * FROM files WHERE owner_id = ? AND folder_id IN (${placeholders})`)
    .all(req.user.id, ...ids);
  const results = await Promise.allSettled(files.map((file) => (
    storageProvider(storageBackendById(file.storage_backend_id)).delete(file.stored_name)
  )));
  if (results.some((result) => result.status === "rejected")) {
    return res.status(503).json({ error: "部分文件暂时无法从存储中删除，请稍后重试" });
  }
  db.prepare("DELETE FROM folders WHERE id = ? AND owner_id = ?").run(folder.id, req.user.id);
  res.json({ usage: getUserUsage(req.user.id) });
});

app.post(
  "/api/files/upload",
  auth,
  uploadLimiter,
  currentUpload,
  async (req, res, next) => {
    const uploaded = Array.isArray(req.files) ? req.files : [];
    if (!uploaded.length) return res.status(400).json({ error: "请选择至少一个文件" });

    let folderId;
    try {
      folderId = normalizeFolderId(req.body?.folderId, req.user.id);
    } catch (error) {
      await removeUploadedFiles(uploaded);
      return res.status(error.status || 400).json({ error: error.message });
    }

    const ids = [];
    const committedKeys = [];
    const backend = activeStorageBackend();
    const provider = storageProvider(backend);
    const expiresAt = futureIso(getSettings().defaultExpiryDays);
    let transactionOpen = false;
    try {
      for (const file of uploaded) {
        await provider.commit(file.path, file.filename);
        committedKeys.push(file.filename);
      }

      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      const incoming = uploaded.reduce((sum, file) => sum + file.size, 0);
      assertCommitWithinQuota(req, incoming);

      const time = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO files
        (
          id, owner_id, name, stored_name, mime, size, kind,
          storage_backend_id, storage_state, folder_id, expires_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
      `);
      for (const file of uploaded) {
        const id = randomUUID();
        const resolvedMime = fileMime(file);
        insert.run(
          id,
          req.user.id,
          cleanFileName(file.originalname),
          file.filename,
          resolvedMime,
          file.size,
          kindFromMime(resolvedMime, file.originalname),
          backend.id,
          folderId,
          expiresAt,
          time,
          time
        );
        ids.push(id);
      }
      db.prepare("DELETE FROM storage_reservations WHERE id = ?").run(req.storageReservationId);
      db.exec("COMMIT");
      transactionOpen = false;
      req.storageReservationId = null;
      req.releaseStorageReservation?.();
    } catch (error) {
      if (transactionOpen) db.exec("ROLLBACK");
      await removeUploadedFiles(uploaded);
      await Promise.allSettled(committedKeys.map((key) => provider.delete(key)));
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
      return;
    }

    const placeholders = ids.map(() => "?").join(",");
    const files = db.prepare(`${fileSelect} WHERE f.id IN (${placeholders}) ORDER BY f.updated_at DESC`)
      .all(...ids);
    res.status(201).json({ files, usage: getUserUsage(req.user.id) });
  }
);

app.post("/api/files/paste", auth, async (req, res, next) => {
  const settings = getSettings();
  if (
    (Object.hasOwn(req.body || {}, "title") && typeof req.body.title !== "string")
    || typeof req.body?.content !== "string"
    || (Object.hasOwn(req.body || {}, "format") && !["text", "markdown"].includes(req.body.format))
  ) {
    return res.status(400).json({ error: "粘贴内容格式不正确" });
  }
  const title = cleanFileName(req.body?.title, "未命名粘贴");
  const content = req.body.content;
  if (!content.trim()) return res.status(400).json({ error: "粘贴内容不能为空" });

  const size = Buffer.byteLength(content);
  if (getUserUsage(req.user.id) + size > Number(req.user.quota)) {
    return res.status(413).json({ error: "已超出账户存储配额" });
  }
  const reserved = reserveStorage(req, res, size);
  if (!reserved.ok) {
    return res.status(reserved.status).json({ error: reserved.error });
  }

  const format = req.body?.format === "markdown" ? "markdown" : "text";
  let folderId;
  try {
    folderId = normalizeFolderId(req.body?.folderId, req.user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const extension = format === "markdown" ? ".md" : ".txt";
  const name = title.toLowerCase().endsWith(extension) ? title : `${title}${extension}`;
  const expiryDays = Object.hasOwn(req.body || {}, "expiresInDays")
    ? req.body.expiresInDays
    : settings.defaultExpiryDays;
  if (
    typeof expiryDays !== "number"
      || !Number.isInteger(expiryDays)
      || expiryDays < 1
      || expiryDays > 3650
  ) {
    return res.status(400).json({ error: "有效期必须为 1–3650 天；收藏后可永久保留" });
  }

  const id = randomUUID();
  const storedName = createStorageKey(name);
  const path = createStagingPath(extension);
  const backend = activeStorageBackend();
  const provider = storageProvider(backend);
  let committed = false;
  const time = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString();
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await provider.commit(path, storedName);
    committed = true;
    db.exec("BEGIN IMMEDIATE");
    try {
      assertCommitWithinQuota(req, size);
      db.prepare(`
        INSERT INTO files
        (
          id, owner_id, folder_id, name, stored_name, mime, size, kind, expires_at,
          storage_backend_id, storage_state, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, 'ready', ?, ?)
      `).run(
        id,
        req.user.id,
        folderId,
        name,
        storedName,
        format === "markdown" ? "text/markdown" : "text/plain",
        size,
        expiresAt,
        backend.id,
        time,
        time
      );
      db.prepare("DELETE FROM storage_reservations WHERE id = ?").run(req.storageReservationId);
      db.exec("COMMIT");
      req.storageReservationId = null;
      req.releaseStorageReservation?.();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(201).json({
      file: db.prepare(`${fileSelect} WHERE f.id = ?`).get(id),
      usage: getUserUsage(req.user.id)
    });
  } catch (error) {
    await unlinkFile(path).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") console.error("Failed to clean paste file", unlinkError);
    });
    if (committed) {
      await provider.delete(storedName).catch((deleteError) => {
        console.error("Failed to clean committed paste file", deleteError);
      });
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

app.post("/api/file-operations", auth, async (req, res, next) => {
  const action = req.body?.action;
  const fileIds = Array.isArray(req.body?.fileIds)
    ? [...new Set(req.body.fileIds.filter((id) => typeof id === "string"))].slice(0, 200)
    : [];
  const folderIds = Array.isArray(req.body?.folderIds)
    ? [...new Set(req.body.folderIds.filter((id) => typeof id === "string"))].slice(0, 200)
    : [];
  if (!['copy', 'move'].includes(action) || (!fileIds.length && !folderIds.length)) {
    return res.status(400).json({ error: "文件操作参数无效" });
  }
  let targetFolderId;
  try {
    targetFolderId = normalizeFolderId(req.body?.targetFolderId, req.user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const selectedFiles = fileIds.length
    ? db.prepare(`SELECT * FROM files WHERE owner_id = ? AND id IN (${fileIds.map(() => '?').join(',')})`)
      .all(req.user.id, ...fileIds)
    : [];
  const selectedFolders = folderIds.length
    ? db.prepare(`SELECT * FROM folders WHERE owner_id = ? AND id IN (${folderIds.map(() => '?').join(',')})`)
      .all(req.user.id, ...folderIds)
    : [];
  if (selectedFiles.length !== fileIds.length || selectedFolders.length !== folderIds.length) {
    return res.status(404).json({ error: "部分文件或文件夹不存在" });
  }

  if (action === 'move') {
    for (const folder of selectedFolders) {
      if (targetFolderId && descendantFolderIds(folder.id, req.user.id).includes(targetFolderId)) {
        return res.status(400).json({ error: "不能把文件夹移动到自身内部" });
      }
    }
    const time = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const moveFile = db.prepare("UPDATE files SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?");
      for (const file of selectedFiles) moveFile.run(targetFolderId, time, file.id, req.user.id);
      const moveFolder = db.prepare("UPDATE folders SET parent_id = ?, name = ?, updated_at = ? WHERE id = ? AND owner_id = ?");
      for (const folder of selectedFolders) {
        moveFolder.run(
          targetFolderId,
          availableFolderName(req.user.id, targetFolderId, folder.name, folder.id),
          time,
          folder.id,
          req.user.id
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return res.json({ ok: true, usage: getUserUsage(req.user.id) });
  }

  const allFolders = db.prepare("SELECT * FROM folders WHERE owner_id = ?").all(req.user.id);
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
  const selectedFolderSet = new Set(folderIds);
  const roots = selectedFolders.filter((folder) => {
    let parentId = folder.parent_id;
    while (parentId) {
      if (selectedFolderSet.has(parentId)) return false;
      parentId = folderById.get(parentId)?.parent_id;
    }
    return true;
  });
  const includedFolderIds = new Set();
  for (const root of roots) {
    descendantFolderIds(root.id, req.user.id).forEach((id) => includedFolderIds.add(id));
  }
  if (includedFolderIds.size > 5_000) {
    return res.status(413).json({ error: "单次最多复制 5000 个文件夹" });
  }
  const folderFiles = includedFolderIds.size
    ? db.prepare(`SELECT * FROM files WHERE owner_id = ? AND folder_id IN (${[...includedFolderIds].map(() => '?').join(',')})`)
      .all(req.user.id, ...includedFolderIds)
    : [];
  const filesToCopy = [...new Map([...selectedFiles, ...folderFiles].map((file) => [file.id, file])).values()];
  if (filesToCopy.length > 5_000) {
    return res.status(413).json({ error: "单次最多复制 5000 个文件" });
  }
  const totalBytes = filesToCopy.reduce((sum, file) => sum + Number(file.size), 0);
  const reserved = reserveStorage(req, res, totalBytes);
  if (!reserved.ok) return res.status(reserved.status).json({ error: reserved.error });

  const folderIdMap = new Map();
  const plannedFolders = [];
  const plannedNames = new Set();
  const orderedFolders = [...includedFolderIds].map((id) => folderById.get(id)).filter(Boolean);
  while (orderedFolders.some((folder) => !folderIdMap.has(folder.id))) {
    let progressed = false;
    for (const folder of orderedFolders) {
      if (folderIdMap.has(folder.id)) continue;
      const isRoot = roots.some((root) => root.id === folder.id);
      if (!isRoot && !folderIdMap.has(folder.parent_id)) continue;
      const id = randomUUID();
      const parentId = isRoot ? targetFolderId : folderIdMap.get(folder.parent_id);
      let name = isRoot
        ? availableFolderName(req.user.id, parentId, `${folder.name} - 副本`)
        : folder.name;
      let suffix = 2;
      const keyBase = () => `${parentId || ''}\0${name.toLocaleLowerCase('zh-CN')}`;
      while (plannedNames.has(keyBase())) {
        name = `${folder.name} (${suffix})`.slice(0, 120);
        suffix += 1;
      }
      plannedNames.add(keyBase());
      folderIdMap.set(folder.id, id);
      plannedFolders.push({ id, parentId, name });
      progressed = true;
    }
    if (!progressed) return res.status(409).json({ error: "文件夹层级异常，无法复制" });
  }

  const backend = activeStorageBackend();
  const committed = [];
  const plannedFiles = [];
  const abortable = requestAbortSignal(req);
  try {
    for (const file of filesToCopy) {
      const storedName = createStorageKey(file.name);
      await copyStoredObject(file, backend, storedName, abortable.signal);
      committed.push(storedName);
      plannedFiles.push({
        ...file,
        id: randomUUID(),
        storedName,
        folderId: folderIdMap.get(file.folder_id) || targetFolderId
      });
    }
    const time = new Date().toISOString();
    const expiresAt = futureIso(getSettings().defaultExpiryDays);
    db.exec("BEGIN IMMEDIATE");
    try {
      assertCommitWithinQuota(req, totalBytes);
      const insertFolder = db.prepare(`
        INSERT INTO folders (id, owner_id, parent_id, name, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const folder of plannedFolders) {
        insertFolder.run(folder.id, req.user.id, folder.parentId, folder.name, expiresAt, time, time);
      }
      const insertFile = db.prepare(`
        INSERT INTO files
          (id, owner_id, folder_id, name, stored_name, mime, size, kind,
           storage_backend_id, storage_state, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)
      `);
      for (const file of plannedFiles) {
        insertFile.run(
          file.id, req.user.id, file.folderId, file.name, file.storedName,
          file.mime, file.size, file.kind, backend.id, expiresAt, time, time
        );
      }
      db.prepare("DELETE FROM storage_reservations WHERE id = ?").run(req.storageReservationId);
      db.exec("COMMIT");
      req.storageReservationId = null;
      req.releaseStorageReservation?.();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(201).json({ ok: true, usage: getUserUsage(req.user.id) });
  } catch (error) {
    await Promise.allSettled(committed.map((key) => storageProvider(backend).delete(key)));
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally {
    abortable.dispose();
  }
});

app.patch("/api/files/:id", auth, (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: "文件不存在" });

  const fields = [];
  const values = [];
  let revokeAccess = false;
  if (Object.hasOwn(req.body || {}, "name")) {
    if (typeof req.body.name !== "string") {
      return res.status(400).json({ error: "文件名必须为文本" });
    }
    const name = cleanFileName(req.body.name, "");
    if (!name) return res.status(400).json({ error: "文件名不能为空" });
    fields.push("name = ?");
    values.push(name);
  }
  if (Object.hasOwn(req.body || {}, "folder_id")) {
    let folderId;
    try {
      folderId = normalizeFolderId(req.body.folder_id, req.user.id);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    fields.push("folder_id = ?");
    values.push(folderId);
  }
  if (Object.hasOwn(req.body || {}, "is_favorite")) {
    const favorite = requestFlag(req.body, "is_favorite");
    if (favorite === null) return res.status(400).json({ error: "收藏状态必须为布尔值" });
    if (favorite && req.body?.expires_at) {
      return res.status(400).json({ error: "收藏文件永久保留，不能同时设置过期时间" });
    }
    fields.push("is_favorite = ?");
    values.push(favorite);
    if (favorite) {
      fields.push("expires_at = NULL");
      revokeAccess = true;
    } else if (!file.expires_at && !Object.hasOwn(req.body || {}, "expires_at")) {
      fields.push("expires_at = ?");
      values.push(futureIso(getSettings().defaultExpiryDays));
      revokeAccess = true;
    }
  }
  if (Object.hasOwn(req.body || {}, "is_trashed")) {
    const trashed = requestFlag(req.body, "is_trashed");
    if (trashed === null) return res.status(400).json({ error: "回收站状态必须为布尔值" });
    fields.push("is_trashed = ?", "trashed_at = ?");
    values.push(trashed, trashed ? new Date().toISOString() : null);
    revokeAccess = true;
  }
  if (Object.hasOwn(req.body || {}, "is_shared")) {
    const shared = requestFlag(req.body, "is_shared");
    if (shared === null) return res.status(400).json({ error: "共享状态必须为布尔值" });
    fields.push("is_shared = ?", "share_token = ?", "share_expires_at = ?");
    values.push(
      shared,
      shared ? file.share_token || shareToken() : null,
      shared ? file.share_expires_at || futureIso(getSettings().defaultShareDays) : null
    );
  }
  if (Object.hasOwn(req.body || {}, "share_expires_at")) {
    const raw = req.body.share_expires_at;
    if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw))) {
      return res.status(400).json({ error: "共享有效期格式不正确" });
    }
    const timestamp = Date.parse(raw);
    if (timestamp <= Date.now() || timestamp > Date.now() + 7 * 86_400_000 + 60_000) {
      return res.status(400).json({ error: "共享有效期必须在未来 7 天以内" });
    }
    fields.push("share_expires_at = ?");
    values.push(new Date(timestamp).toISOString());
  }
  if (Object.hasOwn(req.body || {}, "expires_at")) {
    const raw = req.body.expires_at;
    if (raw !== null && typeof raw !== "string") {
      return res.status(400).json({ error: "过期时间格式不正确" });
    }
    if (raw !== null && raw !== "" && !Number.isFinite(Date.parse(String(raw)))) {
      return res.status(400).json({ error: "过期时间格式不正确" });
    }
    const willBeFavorite = Object.hasOwn(req.body || {}, "is_favorite")
      ? Boolean(requestFlag(req.body, "is_favorite"))
      : Boolean(file.is_favorite);
    if (file.is_favorite && raw) {
      return res.status(400).json({ error: "收藏文件永久保留，请先取消收藏再设置保留期" });
    }
    if (!raw && !willBeFavorite) {
      return res.status(400).json({ error: "仅收藏的文件可以永久保留" });
    }
    fields.push("expires_at = ?");
    values.push(raw ? new Date(raw).toISOString() : null);
    revokeAccess = true;
  }
  if (!fields.length) return res.status(400).json({ error: "没有可更新的内容" });
  if (revokeAccess) fields.push("access_version = access_version + 1");
  fields.push("updated_at = ?");
  values.push(new Date().toISOString(), req.params.id);
  db.prepare(`UPDATE files SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  res.json({ file: db.prepare(`${fileSelect} WHERE f.id = ?`).get(req.params.id) });
});

app.delete("/api/files/:id", auth, async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: "文件不存在" });
  try {
    await storageProvider(storageBackendById(file.storage_backend_id)).delete(file.stored_name);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        error: "存储暂时不可用，文件记录已保留，请稍后重试"
      });
    }
    throw error;
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(file.id);
  res.json({ usage: getUserUsage(req.user.id) });
});

app.post("/api/files/:id/access", auth, async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: "文件不存在" });
  if (isExpired(file)) return res.status(410).json({ error: "文件已过期" });
  if (file.is_trashed) return res.status(404).json({ error: "文件已在回收站" });
  const provider = storageProvider(storageBackendById(file.storage_backend_id));
  const info = await provider.stat(file.stored_name);
  if (!info) {
    return res.status(404).json({ error: "文件内容不存在" });
  }
  const token = signFileAccess(file, req.user);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    rawUrl: `/api/file-access/${encodeURIComponent(token)}/raw`,
    downloadUrl: `/api/file-access/${encodeURIComponent(token)}/download`,
    previewUrl: `/api/file-access/${encodeURIComponent(token)}/preview`
  });
});

app.get("/api/files/:id/raw", auth, async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file || !canAccess(file, req.user)) return res.status(404).end();
  if (isExpired(file)) return res.status(410).json({ error: "文件已过期" });
  await sendStoredFile(req, res, file);
});

app.get("/api/files/:id/download", auth, async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file || !canAccess(file, req.user)) return res.status(404).end();
  if (isExpired(file)) return res.status(410).json({ error: "文件已过期" });
  await sendStoredFile(req, res, file, { download: true });
});

function privateFileFromAccessToken(token) {
  let payload;
  try {
    payload = verifyFileAccess(token);
  } catch {
    const error = new Error("预览凭据已失效，请重新打开文件");
    error.status = 401;
    throw error;
  }
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(payload.fid);
  const grant = db.prepare("SELECT id, status FROM users WHERE id = ?").get(payload.sub);
  if (
    !file
    || !grant
    || grant.status !== "active"
    || file.owner_id !== grant.id
    || file.is_trashed
    || Boolean(file.is_trashed) !== payload.trashed
    || Number(file.access_version || 0) !== payload.rev
    || isExpired(file)
  ) {
    const error = new Error("文件不存在或已过期");
    error.status = 404;
    throw error;
  }
  return file;
}

async function convertOfficePath(stagedPath, originalName) {
  if (activeOfficePreviews >= officePreviewConcurrency) {
    const error = new Error("文档预览服务繁忙，请稍后重试");
    error.status = 503;
    throw error;
  }
  activeOfficePreviews += 1;
  let workDir;
  try {
    workDir = await mkdtemp(join(tmpdir(), "yunpaste-office-"));
    const extension = extname(originalName).toLowerCase();
    const inputPath = join(workDir, `document${extension}`);
    await copyFile(stagedPath, inputPath);
    const profileUrl = pathToFileURL(join(workDir, "profile")).href;
    await execFileAsync(
      process.env.LIBREOFFICE_PATH || "/usr/bin/soffice",
      [
        `-env:UserInstallation=${profileUrl}`,
        "--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore",
        "--convert-to", "pdf", "--outdir", workDir, inputPath
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HOME: workDir, XDG_CACHE_HOME: join(workDir, ".cache") }
      }
    );
    const convertedName = (await readdir(workDir)).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!convertedName) {
      const error = new Error("该文档暂时无法转换为预览格式");
      error.status = 422;
      throw error;
    }
    return { pdfPath: join(workDir, convertedName), workDir };
  } catch (error) {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    activeOfficePreviews -= 1;
  }
}

async function convertOfficePreview(file) {
  if (Number(file.size) > 64 * 1024 * 1024) {
    const error = new Error("超过 64 MB 的办公文档请下载后查看");
    error.status = 413;
    throw error;
  }
  const stagedPath = await stageStoredObject(file);
  try {
    const converted = await convertOfficePath(stagedPath, file.name);
    return { ...converted, stagedPath };
  } catch (error) {
    await unlinkFile(stagedPath).catch(() => {});
    throw error;
  }
}

app.get("/api/file-access/:token/preview", async (req, res, next) => {
  let file;
  try {
    file = privateFileFromAccessToken(req.params.token);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }
  if (!officePreviewExtensions.has(extname(file.name).toLowerCase())) {
    return res.status(415).json({ error: "该文件无需文档转换预览" });
  }
  let converted;
  try {
    converted = await convertOfficePreview(file);
  } catch (error) {
    return res.status(error.status || 503).json({ error: `文档预览失败：${error.message}` });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(`${basename(file.name, extname(file.name))}.pdf`)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.sendFile(converted.pdfPath, async (error) => {
    await unlinkFile(converted.stagedPath).catch(() => {});
    await rm(converted.workDir, { recursive: true, force: true }).catch(() => {});
    if (error && !res.headersSent) next(error);
  });
});

app.get("/api/file-access/:token/raw", async (req, res) => {
  let file;
  try {
    file = privateFileFromAccessToken(req.params.token);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }
  await sendStoredFile(req, res, file);
});

app.get("/api/file-access/:token/download", async (req, res) => {
  let payload;
  try {
    payload = verifyFileAccess(req.params.token);
  } catch {
    return res.status(401).json({ error: "下载凭据已失效，请重试" });
  }
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(payload.fid);
  const grant = db.prepare("SELECT id, status FROM users WHERE id = ?").get(payload.sub);
  if (
    !file
    || !grant
    || grant.status !== "active"
    || file.owner_id !== grant.id
    || file.is_trashed
    || Boolean(file.is_trashed) !== payload.trashed
    || Number(file.access_version || 0) !== payload.rev
    || isExpired(file)
  ) return res.status(404).json({ error: "文件不存在或已过期" });
  await sendStoredFile(req, res, file, { download: true });
});

app.use("/api/share", publicShareLimiter);

app.get("/api/share/:token", (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(req.params.token)) {
    return res.status(404).json({ error: "共享链接不存在或已失效" });
  }
  const file = db.prepare(`
    ${fileSelect}
    WHERE f.share_token = ? AND f.is_shared = 1 AND f.is_trashed = 0
      AND (f.expires_at IS NULL OR f.expires_at > ?)
      AND (f.share_expires_at IS NULL OR f.share_expires_at > ?)
  `).get(req.params.token, new Date().toISOString(), new Date().toISOString());
  if (!file) return res.status(404).json({ error: "共享链接不存在或已失效" });
  const publicFile = {
    name: file.name,
    mime: file.mime,
    size: file.size,
    kind: file.kind,
    is_shared: 1,
    is_favorite: 0,
    is_trashed: 0,
    expires_at: file.expires_at,
    share_expires_at: file.share_expires_at,
    created_at: file.created_at,
    updated_at: file.updated_at,
    owner_name: file.owner_name
  };
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ file: publicFile });
});

app.get("/api/share/:token/raw", async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(req.params.token)) return res.status(404).end();
  const file = db.prepare(`
    SELECT * FROM files
    WHERE share_token = ? AND is_shared = 1 AND is_trashed = 0
      AND (expires_at IS NULL OR expires_at > ?)
      AND (share_expires_at IS NULL OR share_expires_at > ?)
  `).get(req.params.token, new Date().toISOString(), new Date().toISOString());
  if (!file) return res.status(404).json({ error: "共享链接不存在或已失效" });
  await sendStoredFile(req, res, file);
});

app.get("/api/share/:token/download", async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(req.params.token)) return res.status(404).end();
  const file = db.prepare(`
    SELECT * FROM files
    WHERE share_token = ? AND is_shared = 1 AND is_trashed = 0
      AND (expires_at IS NULL OR expires_at > ?)
      AND (share_expires_at IS NULL OR share_expires_at > ?)
  `).get(req.params.token, new Date().toISOString(), new Date().toISOString());
  if (!file) return res.status(404).json({ error: "共享链接不存在或已失效" });
  await sendStoredFile(req, res, file, { download: true });
});

function personalWebdavResponse(row) {
  if (!row) {
    return {
      id: "",
      name: "",
      enabled: false,
      credentialsConfigured: false,
      config: {
        driver: "webdav",
        url: "",
        vendor: "other",
        username: "",
        basePath: "",
        allowInsecure: false
      }
    };
  }
  let stored = {};
  try {
    stored = JSON.parse(row.config_json || "{}");
  } catch {
    stored = {};
  }
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    credentialsConfigured: Boolean(row.secret_cipher),
    config: { driver: "webdav", ...stored },
    updatedAt: row.updated_at
  };
}

function personalWebdavRows(userId) {
  return db.prepare(`
    SELECT * FROM user_webdav_connections
    WHERE user_id = ?
    ORDER BY updated_at DESC, name COLLATE NOCASE
  `).all(userId);
}

function personalWebdavRow(userId, connectionId) {
  if (connectionId !== undefined && connectionId !== null && connectionId !== "") {
    if (typeof connectionId !== "string" || connectionId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(connectionId)) {
      const error = new Error("WebDAV 连接标识无效");
      error.status = 400;
      throw error;
    }
    const row = db.prepare(`
      SELECT * FROM user_webdav_connections WHERE id = ? AND user_id = ?
    `).get(connectionId, userId);
    if (!row) {
      const error = new Error("WebDAV 连接不存在");
      error.status = 404;
      throw error;
    }
    return row;
  }
  return personalWebdavRows(userId).find((row) => row.enabled);
}

function personalWebdavName(value) {
  const name = String(value || "").normalize("NFKC").trim();
  if (!name || name.length > 60) {
    const error = new Error("连接名称需为 1–60 个字符");
    error.status = 400;
    throw error;
  }
  return name;
}

function personalWebdavInput(body) {
  const source = body?.config && typeof body.config === "object" ? body.config : body;
  const config = validateStorageConfig({ ...source, driver: "webdav" });
  if (config.driver !== "webdav") {
    const error = new Error("个人存储仅支持 WebDAV");
    error.status = 400;
    throw error;
  }
  return config;
}

const personalWebdavTestProofs = new Map();
const personalWebdavTestProofTtlMs = 5 * 60_000;

function personalWebdavFingerprint(userId, connectionId, config, password) {
  return createHash("sha256").update(JSON.stringify({
    userId,
    connectionId: connectionId || "",
    config,
    password
  })).digest("base64url");
}

function createPersonalWebdavTestProof(userId, connectionId, config, password) {
  const now = Date.now();
  for (const [token, proof] of personalWebdavTestProofs) {
    if (proof.expiresAt <= now) personalWebdavTestProofs.delete(token);
  }
  while (personalWebdavTestProofs.size >= 1_000) {
    personalWebdavTestProofs.delete(personalWebdavTestProofs.keys().next().value);
  }
  const token = randomBytes(32).toString("base64url");
  personalWebdavTestProofs.set(token, {
    fingerprint: personalWebdavFingerprint(userId, connectionId, config, password),
    expiresAt: now + personalWebdavTestProofTtlMs
  });
  return token;
}

function consumePersonalWebdavTestProof(token, userId, connectionId, config, password) {
  if (typeof token !== "string" || token.length > 128) return false;
  const proof = personalWebdavTestProofs.get(token);
  personalWebdavTestProofs.delete(token);
  return Boolean(
    proof
    && proof.expiresAt > Date.now()
    && proof.fingerprint === personalWebdavFingerprint(userId, connectionId, config, password)
  );
}

function personalWebdavForUser(userId, connectionId) {
  const row = personalWebdavRow(userId, connectionId);
  if (!row || !row.enabled) {
    const error = new Error("请先保存并启用个人 WebDAV");
    error.status = 409;
    throw error;
  }
  let stored;
  try {
    stored = JSON.parse(row.config_json || "{}");
  } catch {
    const error = new Error("个人 WebDAV 配置已损坏，请重新保存");
    error.status = 503;
    throw error;
  }
  const secret = row.secret_cipher ? openSecret(row.secret_cipher) : { password: "" };
  return personalWebdavProvider({ driver: "webdav", ...stored }, secret);
}

app.get("/api/webdav", auth, personalWebdavEnabled, (req, res) => {
  const rows = personalWebdavRows(req.user.id);
  res.json({
    webdav: personalWebdavResponse(rows[0]),
    connections: rows.map(personalWebdavResponse)
  });
});

app.post("/api/webdav/test", auth, personalWebdavEnabled, async (req, res) => {
  let config;
  try {
    config = personalWebdavInput(req.body);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  let password = req.body?.password;
  let current;
  try {
    current = req.body?.connectionId
      ? personalWebdavRow(req.user.id, req.body.connectionId)
      : undefined;
  } catch (error) {
    if (error.status !== 404) return res.status(error.status || 400).json({ error: error.message });
  }
  if (password === undefined && current?.secret_cipher) {
    password = openSecret(current.secret_cipher).password;
  }
  if (typeof password !== "string" || Buffer.byteLength(password) > 4096) {
    return res.status(400).json({ error: "WebDAV 密码格式无效" });
  }
  const abortable = requestAbortSignal(req);
  try {
    const status = await testStorageConnection(config, { password }, abortable.signal);
    const testProof = createPersonalWebdavTestProof(
      req.user.id, current?.id || "", config, password
    );
    res.json({ status: { ...status, lastCheckedAt: new Date().toISOString() }, testProof });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

async function savePersonalWebdav(req, res, connectionId) {
  let config;
  try {
    config = personalWebdavInput(req.body);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  let current;
  try {
    current = connectionId ? personalWebdavRow(req.user.id, connectionId) : undefined;
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (!current && personalWebdavRows(req.user.id).length >= 20) {
    return res.status(409).json({ error: "每个账户最多保存 20 个 WebDAV 连接" });
  }
  let name;
  try {
    name = personalWebdavName(req.body?.name || current?.name || "个人 WebDAV");
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  let password = req.body?.password;
  if (password === undefined && current?.secret_cipher) {
    password = openSecret(current.secret_cipher).password;
  }
  if (typeof password !== "string" || Buffer.byteLength(password) > 4096) {
    return res.status(400).json({ error: "WebDAV 密码格式无效" });
  }
  const abortable = requestAbortSignal(req);
  let status;
  const tested = consumePersonalWebdavTestProof(
    req.body?.testProof, req.user.id, current?.id || "", config, password
  );
  if (tested) {
    status = { state: "connected", message: "已使用刚刚通过的连接测试" };
    abortable.dispose();
  } else {
    try {
      status = await testStorageConnection(config, { password }, abortable.signal);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: `连接测试失败，配置未保存：${error.message}`
      });
    } finally {
      abortable.dispose();
    }
  }
  const { driver: _driver, ...storedConfig } = config;
  const time = new Date().toISOString();
  const id = current?.id || randomUUID();
  db.prepare(`
    INSERT INTO user_webdav_connections
      (id, user_id, name, config_json, secret_cipher, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      config_json = excluded.config_json,
      secret_cipher = excluded.secret_cipher,
      enabled = 1,
      updated_at = excluded.updated_at
  `).run(
    id,
    req.user.id,
    name,
    JSON.stringify(storedConfig),
    password ? sealSecret({ password }) : null,
    current?.created_at || time,
    time
  );
  const row = personalWebdavRow(req.user.id, id);
  return res.status(current ? 200 : 201).json({
    webdav: personalWebdavResponse(row),
    status: { ...status, lastCheckedAt: time }
  });
}

app.post("/api/webdav/connections", auth, personalWebdavEnabled, async (req, res) => {
  await savePersonalWebdav(req, res);
});

app.put("/api/webdav/connections/:id", auth, personalWebdavEnabled, async (req, res) => {
  await savePersonalWebdav(req, res, req.params.id);
});

// Keep the original single-connection endpoint compatible with older clients.
app.put("/api/webdav", auth, personalWebdavEnabled, async (req, res) => {
  const current = personalWebdavRows(req.user.id)[0];
  await savePersonalWebdav(req, res, current?.id);
});

app.delete("/api/webdav/connections/:id", auth, personalWebdavEnabled, (req, res) => {
  let row;
  try {
    row = personalWebdavRow(req.user.id, req.params.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  db.prepare("DELETE FROM user_webdav_connections WHERE id = ? AND user_id = ?")
    .run(row.id, req.user.id);
  res.status(204).end();
});

app.delete("/api/webdav", auth, personalWebdavEnabled, (req, res) => {
  db.prepare("DELETE FROM user_webdav_connections WHERE user_id = ?").run(req.user.id);
  res.status(204).end();
});

app.get("/api/webdav/files", auth, personalWebdavEnabled, async (req, res) => {
  if (req.query.path !== undefined && typeof req.query.path !== "string") {
    return res.status(400).json({ error: "WebDAV 路径格式无效" });
  }
  const abortable = requestAbortSignal(req);
  try {
    const items = await personalWebdavForUser(req.user.id, req.query.connectionId)
      .list(req.query.path || "", abortable.signal);
    res.json({ items, path: String(req.query.path || "") });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.post("/api/webdav/folders", auth, personalWebdavEnabled, async (req, res) => {
  if (typeof req.body?.path !== "string") {
    return res.status(400).json({ error: "文件夹路径必须为文本" });
  }
  const abortable = requestAbortSignal(req);
  try {
    const provider = personalWebdavForUser(req.user.id, req.body?.connectionId);
    await provider.mkdir(req.body.path, abortable.signal);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.post(
  "/api/webdav/upload",
  auth,
  personalWebdavEnabled,
  uploadLimiter,
  currentWebdavUpload,
  async (req, res) => {
    if (typeof req.body?.connectionId !== "string" || typeof req.body?.path !== "string") {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ error: "请选择 WebDAV 连接和目标目录" });
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: "请选择要上传的文件" });
    const abortable = requestAbortSignal(req);
    const uploaded = [];
    try {
      const remote = personalWebdavForUser(req.user.id, req.body.connectionId);
      const basePath = String(req.body.path || "").split("/").filter(Boolean).join("/");
      for (const file of files) {
        const targetPath = [basePath, cleanFileName(file.originalname)].filter(Boolean).join("/");
        await remote.upload(file.path, targetPath, abortable.signal);
        uploaded.push({ name: file.originalname, path: targetPath, size: file.size });
      }
      res.status(201).json({ uploaded });
    } catch (error) {
      res.status(error.status || 503).json({
        error: uploaded.length
          ? `已上传 ${uploaded.length} 个文件，其余上传失败：${error.message}`
          : error.message
      });
    } finally {
      abortable.dispose();
      await removeUploadedFiles(files);
    }
  }
);

app.patch("/api/webdav/items", auth, personalWebdavEnabled, async (req, res) => {
  if (
    typeof req.body?.source !== "string"
    || typeof req.body?.destination !== "string"
    || !["move", "copy"].includes(req.body?.action)
    || typeof req.body?.isDir !== "boolean"
  ) {
    return res.status(400).json({ error: "WebDAV 文件操作参数无效" });
  }
  const abortable = requestAbortSignal(req);
  try {
    const provider = personalWebdavForUser(req.user.id, req.body?.connectionId);
    if (req.body.action === "copy") {
      await provider.copy(req.body.source, req.body.destination, req.body.isDir, abortable.signal);
    } else {
      await provider.move(req.body.source, req.body.destination, abortable.signal);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.delete("/api/webdav/items", auth, personalWebdavEnabled, async (req, res) => {
  if (typeof req.body?.path !== "string" || typeof req.body?.isDir !== "boolean") {
    return res.status(400).json({ error: "WebDAV 删除参数无效" });
  }
  const abortable = requestAbortSignal(req);
  try {
    await personalWebdavForUser(req.user.id, req.body?.connectionId)
      .delete(req.body.path, req.body.isDir, abortable.signal);
    res.status(204).end();
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.post("/api/webdav/export", auth, personalWebdavEnabled, async (req, res) => {
  if (typeof req.body?.fileId !== "string" || typeof req.body?.path !== "string") {
    return res.status(400).json({ error: "请选择文件和 WebDAV 目标路径" });
  }
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND owner_id = ? AND is_trashed = 0")
    .get(req.body.fileId, req.user.id);
  if (!file || isExpired(file)) return res.status(404).json({ error: "文件不存在或已过期" });
  const abortable = requestAbortSignal(req);
  let stagedPath;
  try {
    stagedPath = await stageStoredObject(file, abortable.signal);
    await personalWebdavForUser(req.user.id, req.body?.connectionId)
      .upload(stagedPath, req.body.path, abortable.signal);
    await unlinkFile(stagedPath).catch(() => {});
    res.status(201).json({ ok: true });
  } catch (error) {
    if (stagedPath) await unlinkFile(stagedPath).catch(() => {});
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.post("/api/webdav/download", auth, personalWebdavEnabled, async (req, res) => {
  if (typeof req.body?.path !== "string") {
    return res.status(400).json({ error: "请选择要下载的 WebDAV 文件" });
  }
  const abortable = requestAbortSignal(req);
  let stagedPath;
  try {
    const remote = personalWebdavForUser(req.user.id, req.body?.connectionId);
    const info = await remote.stat(req.body.path, abortable.signal);
    if (info.isDir) return res.status(400).json({ error: "暂不支持直接下载文件夹" });
    stagedPath = createStagingPath(info.name);
    await remote.download(info.path, stagedPath, abortable.signal);
    abortable.dispose();
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.download(stagedPath, cleanFileName(info.name), async (error) => {
      await unlinkFile(stagedPath).catch(() => {});
      if (error && !res.headersSent) res.status(error.status || 500).json({ error: "WebDAV 文件下载失败" });
    });
  } catch (error) {
    if (stagedPath) await unlinkFile(stagedPath).catch(() => {});
    return res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.post("/api/webdav/preview", auth, personalWebdavEnabled, async (req, res, next) => {
  if (typeof req.body?.path !== "string" || typeof req.body?.connectionId !== "string") {
    return res.status(400).json({ error: "请选择要预览的 WebDAV 文件" });
  }
  const abortable = requestAbortSignal(req);
  let stagedPath;
  let converted;
  try {
    const remote = personalWebdavForUser(req.user.id, req.body.connectionId);
    const info = await remote.stat(req.body.path, abortable.signal);
    if (info.isDir) return res.status(400).json({ error: "文件夹不能直接预览" });
    if (Number(info.size || 0) > 256 * 1024 * 1024) {
      return res.status(413).json({ error: "超过 256 MB 的远端文件请下载后查看" });
    }
    stagedPath = createStagingPath(info.name);
    await remote.download(info.path, stagedPath, abortable.signal);
    abortable.dispose();
    const extension = extname(info.name).toLowerCase();
    let previewPath = stagedPath;
    let contentType = String(mime.lookup(info.name) || info.mime || "application/octet-stream");
    if (officePreviewExtensions.has(extension)) {
      if (Number(info.size || 0) > 64 * 1024 * 1024) {
        const error = new Error("超过 64 MB 的办公文档请下载后查看");
        error.status = 413;
        throw error;
      }
      converted = await convertOfficePath(stagedPath, info.name);
      previewPath = converted.pdfPath;
      contentType = "application/pdf";
    } else if (!(
      contentType.startsWith("image/")
      || contentType.startsWith("video/")
      || contentType.startsWith("audio/")
      || contentType.startsWith("text/")
      || contentType === "application/pdf"
    )) {
      const error = new Error("该远端文件格式暂不支持在线预览");
      error.status = 415;
      throw error;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(info.name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (contentType === "application/pdf") res.removeHeader("Content-Security-Policy");
    return res.sendFile(previewPath, async (error) => {
      if (stagedPath) await unlinkFile(stagedPath).catch(() => {});
      if (converted?.workDir) await rm(converted.workDir, { recursive: true, force: true }).catch(() => {});
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (stagedPath) await unlinkFile(stagedPath).catch(() => {});
    if (converted?.workDir) await rm(converted.workDir, { recursive: true, force: true }).catch(() => {});
    return res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

function ticketRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count || 0)
  };
}

function ticketMessages(ticketId) {
  return db.prepare(`
    SELECT m.id, m.message, m.created_at, m.sender_id,
      u.name AS sender_name, u.role AS sender_role
    FROM ticket_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.ticket_id = ?
    ORDER BY m.created_at ASC, m.id ASC
  `).all(ticketId).map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role
  }));
}

function findTicketForUser(id, user) {
  const ticket = db.prepare(`
    SELECT t.*, u.name AS user_name, u.email AS user_email,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(id);
  if (!ticket || (user.role !== "admin" && ticket.user_id !== user.id)) return null;
  return ticket;
}

app.get("/api/tickets", auth, ticketsEnabled, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(`
        SELECT t.*, u.name AS user_name, u.email AS user_email,
          (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
        FROM tickets t JOIN users u ON u.id = t.user_id
        ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.updated_at DESC
      `).all()
    : db.prepare(`
        SELECT t.*, u.name AS user_name, u.email AS user_email,
          (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
        FROM tickets t JOIN users u ON u.id = t.user_id
        WHERE t.user_id = ?
        ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.updated_at DESC
      `).all(req.user.id);
  res.json({ tickets: rows.map(ticketRow) });
});

app.get("/api/tickets/:id", auth, ticketsEnabled, (req, res) => {
  const ticket = findTicketForUser(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  res.json({ ticket: { ...ticketRow(ticket), messages: ticketMessages(ticket.id) } });
});

app.post("/api/tickets", auth, ticketsEnabled, (req, res) => {
  if (typeof req.body?.subject !== "string" || typeof req.body?.message !== "string") {
    return res.status(400).json({ error: "工单主题和内容必须为文本" });
  }
  const subject = req.body.subject.trim().slice(0, 120);
  const message = req.body.message.trim().slice(0, 5000);
  if (subject.length < 2 || message.length < 2) {
    return res.status(400).json({ error: "请填写完整的工单主题和内容" });
  }
  const id = randomUUID();
  const time = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO tickets (id, user_id, subject, status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?)
    `).run(id, req.user.id, subject, time, time);
    db.prepare(`
      INSERT INTO ticket_messages (id, ticket_id, sender_id, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), id, req.user.id, message, time);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const ticket = findTicketForUser(id, req.user);
  res.status(201).json({ ticket: { ...ticketRow(ticket), messages: ticketMessages(id) } });
});

app.post("/api/tickets/:id/messages", auth, ticketsEnabled, (req, res) => {
  const ticket = findTicketForUser(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  if (typeof req.body?.message !== "string") {
    return res.status(400).json({ error: "回复内容必须为文本" });
  }
  const message = req.body.message.trim().slice(0, 5000);
  if (!message) return res.status(400).json({ error: "回复内容不能为空" });
  const time = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO ticket_messages (id, ticket_id, sender_id, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), ticket.id, req.user.id, message, time);
    db.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?")
      .run(time, ticket.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const updated = findTicketForUser(ticket.id, req.user);
  res.status(201).json({
    ticket: { ...ticketRow(updated), messages: ticketMessages(ticket.id) }
  });
});

app.patch("/api/tickets/:id", auth, adminOnly, ticketsEnabled, (req, res) => {
  if (!["open", "closed"].includes(req.body?.status)) {
    return res.status(400).json({ error: "工单状态无效" });
  }
  const ticket = findTicketForUser(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  db.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?")
    .run(req.body.status, new Date().toISOString(), ticket.id);
  const updated = findTicketForUser(ticket.id, req.user);
  res.json({ ticket: { ...ticketRow(updated), messages: ticketMessages(ticket.id) } });
});

app.get("/api/admin/users", auth, adminOnly, (_req, res) => {
  res.json({ users: listUsersWithUsage() });
});

app.patch("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  if (Object.hasOwn(req.body || {}, "status") && !["active", "disabled"].includes(req.body.status)) {
    return res.status(400).json({ error: "用户状态无效" });
  }
  if (Object.hasOwn(req.body || {}, "role") && !["admin", "member"].includes(req.body.role)) {
    return res.status(400).json({ error: "用户角色无效" });
  }
  const requestedStatus = ["active", "disabled"].includes(req.body?.status) ? req.body.status : user.status;
  const requestedRole = ["admin", "member"].includes(req.body?.role) ? req.body.role : user.role;
  if (user.id === req.user.id && (requestedStatus !== "active" || requestedRole !== "admin")) {
    return res.status(400).json({ error: "不能停用当前账户或移除自己的管理员权限" });
  }
  const targetIsPrimaryAdmin = isSystemOwner(user.id);
  if (
    targetIsPrimaryAdmin
    && (requestedStatus !== user.status || requestedRole !== user.role)
  ) {
    return res.status(403).json({ error: "主管理员不能被停用或降级" });
  }

  if (Object.hasOwn(req.body || {}, "quota") && typeof req.body.quota !== "number") {
    return res.status(400).json({ error: "存储配额必须为整数" });
  }
  const requestedQuota = Object.hasOwn(req.body || {}, "quota") ? req.body.quota : Number(user.quota);
  const maxQuota = 100 * 1024 ** 4;
  if (!Number.isSafeInteger(requestedQuota) || requestedQuota < 16 * 1024 ** 2 || requestedQuota > maxQuota) {
    return res.status(400).json({ error: "存储配额必须为 16 MB 至 100 TB 的整数" });
  }

  db.prepare("UPDATE users SET status = ?, role = ?, quota = ? WHERE id = ?")
    .run(requestedStatus, requestedRole, requestedQuota, user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
});

app.delete("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: "请在个人设置中注销自己的账号" });
  }
  if (isSystemOwner(user.id)) {
    return res.status(403).json({ error: "主管理员账号不能被删除" });
  }
  try {
    await deleteUserStoredObjects(user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    res.status(204).end();
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

app.get("/api/admin/status", auth, adminOnly, async (_req, res) => {
  const volume = await statfs(filesDir);
  const storageFreeBytes = volume.bavail * volume.bsize;
  const users = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  const files = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files").get();
  res.json({
    status: {
      healthy: storageFreeBytes >= minimumFreeBytes,
      uptimeSeconds: Math.floor(process.uptime()),
      users,
      files: Number(files.count),
      storedBytes: Number(files.bytes),
      storageFreeBytes,
      reservedStorageBytes: reservedStorageBytes()
    }
  });
});

function adminPermissions(user) {
  return {
    canRenameSite: isSystemOwner(user.id),
    canManageStorage: true,
    canManageEncryption: false
  };
}

function settingsEnvelope(user) {
  return {
    settings: getSettings(),
    revision: getSettingsRevision(),
    permissions: adminPermissions(user)
  };
}

app.get("/api/settings", auth, adminOnly, (req, res) => {
  res.json(settingsEnvelope(req.user));
});

function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("设置内容格式不正确");
  }
  const known = new Set(Object.keys(defaultSettings));
  const unknown = Object.keys(input).find((key) => !known.has(key));
  if (unknown) throw new Error(`未知设置项：${unknown}`);
  const current = getSettings();
  const next = { ...current };
  if (Object.hasOwn(input, "siteName")) {
    if (typeof input.siteName !== "string") throw new Error("站点名称必须为文本");
    const value = input.siteName.trim();
    if (!value || value.length > 60) throw new Error("站点名称须为 1–60 个字符");
    next.siteName = value;
  }
  if (Object.hasOwn(input, "siteSubtitle")) {
    if (typeof input.siteSubtitle !== "string") throw new Error("站点副标题必须为文本");
    const value = input.siteSubtitle.trim();
    if (value.length > 160) throw new Error("站点副标题不能超过 160 个字符");
    next.siteSubtitle = value;
  }
  if (Object.hasOwn(input, "allowRegistration")) {
    if (typeof input.allowRegistration !== "boolean") throw new Error("注册开关必须为布尔值");
    next.allowRegistration = input.allowRegistration;
  }
  for (const [key, label] of [
    ["allowPersonalWebdav", "个人 WebDAV 开关"],
    ["allowTickets", "工单系统开关"]
  ]) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== "boolean") throw new Error(`${label}必须为布尔值`);
    next[key] = input[key];
  }
  for (const [key, minimum, maximum, label] of [
    ["maxUploadMb", 1, 10_240, "单文件上传上限"],
    ["defaultExpiryDays", 1, 3650, "默认过期时间"],
    ["defaultShareDays", 1, 7, "默认分享有效期"],
    ["defaultUserQuotaGb", 1, 10_240, "新用户默认配额"],
    ["maxFilesPerUpload", 1, 100, "单次上传文件数"],
    ["retentionDays", 1, 3650, "回收站保留期"]
    ,["expiryWarningDays", 3, 15, "到期提醒提前量"]
  ]) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== "number") throw new Error(`${label}必须为数字`);
    const value = input[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${label}必须为 ${minimum}–${maximum} 的整数`);
    }
    next[key] = value;
  }
  if (Object.hasOwn(input, "allowedTypes")) {
    if (typeof input.allowedTypes !== "string") throw new Error("允许的文件类别必须为文本");
    const values = [...new Set(
      input.allowedTypes
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )];
    if (!values.length || values.some((value) => !allowedKinds.has(value))) {
      throw new Error("允许的文件类别包含无效值");
    }
    next.allowedTypes = values.join(",");
  }
  return next;
}

function updateSettings(req, res, { legacy = false } = {}) {
  const patch = legacy ? req.body : req.body?.patch;
  const requestedRevision = legacy ? getSettingsRevision() : req.body?.revision;
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) {
    return res.status(400).json({ error: "没有需要保存的设置" });
  }
  if (!legacy && (!Number.isSafeInteger(requestedRevision) || requestedRevision < 1)) {
    return res.status(400).json({ error: "设置版本号无效" });
  }
  let next;
  try {
    next = validateSettings(patch || {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const current = getSettings();
  if (
    Object.hasOwn(patch || {}, "siteName")
    && next.siteName !== current.siteName
    && !isSystemOwner(req.user.id)
  ) {
    return res.status(403).json({ error: "只有主管理员可以修改系统名称" });
  }
  const update = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const time = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const currentRevision = getSettingsRevision();
    if (currentRevision !== requestedRevision) {
      const error = new Error("设置已被其他管理员更新，请刷新后重试");
      error.status = 409;
      throw error;
    }
    for (const key of Object.keys(patch || {})) {
      update.run(key, JSON.stringify(next[key]), time);
    }
    db.prepare(`
      UPDATE settings_state
      SET revision = revision + 1, updated_at = ?
      WHERE singleton = 1
    `).run(time);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  invalidateSettingsCache();
  res.json(settingsEnvelope(req.user));
}

app.patch("/api/settings", auth, adminOnly, (req, res) => {
  updateSettings(req, res);
});

// One-version compatibility route for older clients. New clients use revisioned PATCH.
app.put("/api/settings", auth, adminOnly, (req, res) => {
  updateSettings(req, res, { legacy: true });
});

// Compatibility export for pre-1.6 clients. It intentionally contains no secrets.
app.get("/api/settings/export", auth, adminOnly, (req, res) => {
  const storage = activeStorageBackend();
  res.json({
    format: "yunpaste-config",
    schemaVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    storage: {
      driver: storage.driver,
      label: storage.label,
      credentialsIncluded: false
    }
  });
});

function primaryAdmin(req, res) {
  if (!isSystemOwner(req.user.id)) {
    res.status(403).json({ error: "只有主管理员可以导出或恢复完整配置" });
    return false;
  }
  return true;
}

function backupCoverage(storage) {
  return {
    settings: true,
    globalStorage: true,
    globalStorageCredential: Boolean(storage.secret_cipher),
    users: false,
    files: false,
    personalWebdav: false
  };
}

function backupPayload(storage) {
  let password = "";
  if (storage.secret_cipher) password = String(openSecret(storage.secret_cipher).password || "");
  return {
    settings: getSettings(),
    storage: {
      id: storage.id,
      driver: storage.driver,
      label: storage.label,
      config: JSON.parse(storage.config_json || "{}"),
      password
    }
  };
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("备份内容格式不正确");
  }
  const settings = validateSettings(payload.settings);
  const input = payload.storage;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("备份缺少全局存储配置");
  }
  if (typeof input.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) {
    throw new Error("备份中的存储标识无效");
  }
  const config = validateStorageConfig({ ...(input.config || {}), driver: input.driver });
  const password = input.password ?? "";
  if (typeof password !== "string" || Buffer.byteLength(password) > 4096) {
    throw new Error("备份中的存储凭据无效");
  }
  const label = typeof input.label === "string" && input.label.trim()
    ? input.label.trim().slice(0, 80)
    : config.driver === "local" ? "本地文件目录" : config.driver === "webdav" ? "WebDAV 远端存储" : "SMB 远端存储";
  return { settings, storage: { id: input.id, config, password, label } };
}

function backupSummary(document, restored) {
  return {
    appVersion: String(document.appVersion || "unknown").slice(0, 40),
    exportedAt: document.exportedAt,
    siteName: restored.settings.siteName,
    storageDriver: restored.storage.config.driver,
    storageLabel: restored.storage.label,
    credentialsIncluded: Boolean(restored.storage.password),
    settingsCount: Object.keys(restored.settings).length,
    coverage: document.coverage
  };
}

app.post("/api/settings/backup/export", auth, adminOnly, async (req, res) => {
  if (!primaryAdmin(req, res)) return;
  const storage = activeStorageBackend();
  const exportedAt = new Date().toISOString();
  try {
    const document = await encryptConfigBackup(backupPayload(storage), req.body?.passphrase, {
      appVersion,
      exportedAt,
      coverage: backupCoverage(storage)
    });
    res.json({ backup: document });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/settings/backup/validate", auth, adminOnly, async (req, res) => {
  if (!primaryAdmin(req, res)) return;
  try {
    const document = req.body?.backup;
    const restored = validateBackupPayload(await decryptConfigBackup(document, req.body?.passphrase));
    res.json({ summary: backupSummary(document, restored) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/settings/import", auth, adminOnly, async (req, res) => {
  const document = req.body?.config && typeof req.body.config === "object"
    ? req.body.config
    : req.body?.backup || req.body;
  if (document?.format === "yunpaste-config-backup" && document.schemaVersion === 2) {
    if (!primaryAdmin(req, res)) return;
    if (!Number.isSafeInteger(req.body?.revision) || req.body.revision < 1) {
      return res.status(400).json({ error: "设置版本号无效" });
    }
    let restored;
    try {
      restored = validateBackupPayload(await decryptConfigBackup(document, req.body?.passphrase));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const time = new Date().toISOString();
    const { driver, ...storedConfig } = restored.storage.config;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (getSettingsRevision() !== req.body.revision) {
        const error = new Error("设置已被其他管理员更新，请重新验证备份后重试");
        error.status = 409;
        throw error;
      }
      const update = db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      for (const [key, value] of Object.entries(restored.settings)) {
        update.run(key, JSON.stringify(value), time);
      }
      db.prepare("UPDATE settings_state SET revision = revision + 1, updated_at = ? WHERE singleton = 1").run(time);
      db.prepare("UPDATE storage_backends SET is_active = 0, updated_at = ? WHERE is_active = 1").run(time);
      db.prepare(`
        INSERT INTO storage_backends
          (id, driver, label, config_json, secret_cipher, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          driver = excluded.driver, label = excluded.label, config_json = excluded.config_json,
          secret_cipher = excluded.secret_cipher, is_active = 1, updated_at = excluded.updated_at
      `).run(
        restored.storage.id,
        driver,
        restored.storage.label,
        JSON.stringify(storedConfig),
        restored.storage.password ? sealSecret({ password: restored.storage.password }) : null,
        time,
        time
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
    invalidateSettingsCache();
    return res.json({ ...settingsEnvelope(req.user), summary: backupSummary(document, restored) });
  }
  if (
    !document
    || document.format !== "yunpaste-config"
    || document.schemaVersion !== 1
    || !document.settings
  ) {
    return res.status(400).json({ error: "不是受支持的云粘贴配置文件" });
  }
  req.body = {
    patch: document.settings,
    revision: req.body?.revision
  };
  updateSettings(req, res);
});

function storageRequestInput(body) {
  const config = body?.config && typeof body.config === "object" ? body.config : body;
  return {
    ...config,
    driver: String(body?.driver || body?.type || config?.driver || config?.type || "")
  };
}

function storageResponse(row, status) {
  const safe = sanitizeStorageBackend(row);
  const {
    id, driver, credentialsConfigured, configPath: _configPath,
    filesPath: _filesPath, ...config
  } = safe;
  return {
    id,
    driver,
    label: row.label,
    config: { driver, ...config },
    credentialsConfigured,
    status,
    paths: { configDir: "/config", filesDir: "/files" }
  };
}

function requestAbortSignal(req) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  return {
    signal: controller.signal,
    abort,
    dispose: () => req.off("aborted", abort)
  };
}

async function storageHealth(row, req) {
  const abortable = requestAbortSignal(req);
  const timeout = setTimeout(abortable.abort, 10_000);
  try {
    const checkedAt = new Date().toISOString();
    const result = await storageProvider(row).health(abortable.signal);
    return { ...result, lastCheckedAt: checkedAt };
  } catch (error) {
    return {
      state: "error",
      message: error.message,
      lastCheckedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
    abortable.dispose();
  }
}

app.get("/api/admin/storage", auth, adminOnly, async (req, res) => {
  const row = activeStorageBackend();
  res.json({ storage: storageResponse(row, await storageHealth(row, req)) });
});

app.post("/api/admin/storage/test", auth, adminOnly, async (req, res) => {
  let config;
  try {
    config = validateStorageConfig(storageRequestInput(req.body));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (
    Object.hasOwn(req.body || {}, "password")
    && (
      typeof req.body.password !== "string"
      || Buffer.byteLength(req.body.password) > 4096
    )
  ) {
    return res.status(400).json({ error: "存储密码格式无效" });
  }
  let password = req.body?.password;
  const active = activeStorageBackend();
  if (password === undefined && active.driver === config.driver && active.secret_cipher) {
    password = openSecret(active.secret_cipher).password;
  }
  const abortable = requestAbortSignal(req);
  try {
    const status = await testStorageConnection(config, { password: password || "" }, abortable.signal);
    res.json({ status: { ...status, lastCheckedAt: new Date().toISOString() } });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  } finally {
    abortable.dispose();
  }
});

app.put("/api/admin/storage", auth, adminOnly, async (req, res) => {
  let config;
  try {
    config = validateStorageConfig(storageRequestInput(req.body));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (
    Object.hasOwn(req.body || {}, "password")
    && (
      typeof req.body.password !== "string"
      || Buffer.byteLength(req.body.password) > 4096
    )
  ) {
    return res.status(400).json({ error: "存储密码格式无效" });
  }

  const current = activeStorageBackend();
  let secretCipher = null;
  let runtimePassword = "";
  if (config.driver !== "local") {
    if (typeof req.body?.password === "string") {
      runtimePassword = req.body.password;
      secretCipher = req.body.password ? sealSecret({ password: req.body.password }) : null;
    } else if (current.driver === config.driver) {
      secretCipher = current.secret_cipher;
      runtimePassword = current.secret_cipher
        ? String(openSecret(current.secret_cipher).password || "")
        : "";
    }
  }
  const abortable = requestAbortSignal(req);
  let connectionStatus;
  try {
    connectionStatus = await testStorageConnection(
      config,
      { password: runtimePassword },
      abortable.signal
    );
  } catch (error) {
    return res.status(error.status || 503).json({
      error: `存储连接测试失败，配置未保存：${error.message}`
    });
  } finally {
    abortable.dispose();
  }
  const label = config.driver === "local"
    ? "本地文件目录"
    : config.driver === "webdav" ? "WebDAV 远端存储" : "SMB 远端存储";
  const time = new Date().toISOString();
  const { driver: _driver, ...storedConfig } = config;
  const storedConfigJson = JSON.stringify(storedConfig);
  const id = config.driver === "local"
    ? "local"
    : current.driver === config.driver && current.config_json === storedConfigJson
      ? current.id
      : randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE storage_backends SET is_active = 0, updated_at = ? WHERE is_active = 1")
      .run(time);
    db.prepare(`
      INSERT INTO storage_backends
        (id, driver, label, config_json, secret_cipher, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        driver = excluded.driver,
        label = excluded.label,
        config_json = excluded.config_json,
        secret_cipher = excluded.secret_cipher,
        is_active = 1,
        updated_at = excluded.updated_at
    `).run(
      id,
      config.driver,
      label,
      storedConfigJson,
      secretCipher,
      time,
      time
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const row = storageBackendById(id);
  res.json({
    storage: storageResponse(row, {
      ...connectionStatus,
      state: "connected",
      message: "配置已保存；新上传会使用此后端，已有文件保持原位置",
      lastCheckedAt: time
    })
  });
});

app.get("/api/admin/security", auth, adminOnly, (_req, res) => {
  res.json({
    databaseEncryption: databaseEncryptionStatus(),
    jwtSecret: { managed: true },
    filesEncrypted: false
  });
});

async function purgeFileRows(rows) {
  if (!rows.length) return 0;
  const deleted = [];
  for (const row of rows) {
    try {
      await storageProvider(storageBackendById(row.storage_backend_id)).delete(row.stored_name);
      deleted.push(row.id);
    } catch (error) {
      console.error(`Maintenance could not remove stored object ${row.id}`, error);
    }
  }
  if (!deleted.length) return 0;
  const remove = db.prepare("DELETE FROM files WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of deleted) remove.run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return deleted.length;
}

async function localObjectFiles() {
  const files = [];
  const directories = [objectsDir];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && !entry.isSymbolicLink()) {
        files.push({
          key: relative(objectsDir, path).replaceAll("\\", "/"),
          path
        });
      }
    }
  }
  return files;
}

let maintenanceRunning = false;
let maintenancePromise = Promise.resolve();
let lastOrphanScan = 0;
function runMaintenance({ scanOrphans = false } = {}) {
  if (maintenanceRunning) return maintenancePromise;
  maintenanceRunning = true;
  maintenancePromise = (async () => {
    try {
      const settings = getSettings();
      const nowIso = new Date().toISOString();
      const trashCutoff = new Date(Date.now() - Number(settings.retentionDays) * 86_400_000).toISOString();
      let purged = 0;
      for (let batch = 0; batch < 10; batch += 1) {
        const rows = db.prepare(`
          SELECT id, stored_name, storage_backend_id FROM files
          WHERE (expires_at IS NOT NULL AND expires_at <= ?)
             OR (is_trashed = 1 AND trashed_at <= ?)
          LIMIT 1000
        `).all(nowIso, trashCutoff);
        if (!rows.length) break;
        const removed = await purgeFileRows(rows);
        purged += removed;
        if (removed === 0) break;
        if (rows.length < 1000) break;
      }
      if (purged) console.log(`YunPaste maintenance removed ${purged} expired or retained files`);

      if (scanOrphans || Date.now() - lastOrphanScan >= 24 * 60 * 60_000) {
        const referenced = new Set(
          db.prepare(`
            SELECT stored_name FROM files WHERE storage_backend_id = 'local'
          `).all().map((row) => row.stored_name)
        );
        const grace = Date.now() - 24 * 60 * 60_000;
        for (const object of await localObjectFiles()) {
          if (referenced.has(object.key)) continue;
          const info = await stat(object.path);
          if (info.mtimeMs < grace) await unlinkFile(object.path);
        }
        lastOrphanScan = Date.now();
      }
    } catch (error) {
      console.error("YunPaste maintenance failed", error);
    } finally {
      maintenanceRunning = false;
    }
  })();
  return maintenancePromise;
}

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API 端点不存在" });
});

if (isProd) {
  const dist = join(rootDir, "dist");
  app.use("/assets", express.static(join(dist, "assets"), {
    maxAge: 0,
    etag: true,
    setHeaders: (res, path) => {
      const hashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(basename(path));
      res.setHeader(
        "Cache-Control",
        hashedAsset ? "public, max-age=31536000, immutable" : "public, no-cache"
      );
    }
  }));
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });
  app.use(express.static(dist, { index: false, maxAge: 0, etag: true }));
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(join(dist, "index.html"));
  });
}

app.use((error, req, res, _next) => {
  if (Array.isArray(req.files)) void removeUploadedFiles(req.files);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "文件超过单文件上限或账户剩余配额"
      : error.code === "LIMIT_FILE_COUNT"
        ? "单次最多上传 20 个文件"
        : "上传请求格式不正确";
    return res.status(status).json({ error: message });
  }
  if (error?.status) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "请求 JSON 格式不正确" });
  }
  console.error("Unhandled request error", error);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: "服务器暂时无法完成请求" });
});

const server = app.listen(port, "0.0.0.0", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`TieYun API listening on http://0.0.0.0:${actualPort}`);
  void runMaintenance({ scanOrphans: true });
});
server.requestTimeout = requestTimeout;
server.headersTimeout = headersTimeout;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;

const maintenanceTimer = setInterval(() => {
  void runMaintenance();
}, 60 * 60_000);
maintenanceTimer.unref();

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`TieYun received ${signal}; draining connections`);
  clearInterval(maintenanceTimer);

  const forceTimer = setTimeout(() => {
    console.error("TieYun graceful shutdown timed out");
    server.closeAllConnections?.();
  }, 25_000);
  forceTimer.unref();

  server.close((error) => {
    void (async () => {
      clearTimeout(forceTimer);
      let maintenanceWait;
      await Promise.race([
        maintenancePromise,
        new Promise((resolve) => {
          maintenanceWait = setTimeout(resolve, 5_000);
        })
      ]);
      clearTimeout(maintenanceWait);
      try {
        closeDatabase();
      } catch (closeError) {
        console.error("Failed to close database", closeError);
        exitCode = 1;
      }
      if (error) {
        console.error("Failed to close HTTP server", error);
        exitCode = 1;
      }
      process.exit(exitCode);
    })();
  });
  server.closeIdleConnections?.();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
  shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  console.error("Unhandled rejection", error);
  shutdown("unhandledRejection", 1);
});

export { app, runMaintenance, server };
