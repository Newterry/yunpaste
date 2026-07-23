import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  lstat, mkdir, readFile, realpath, rename, statfs, unlink, writeFile
} from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { filesDir, legacyLayout, objectsDir, stagingDir } from "./paths.mjs";
import { openSecret } from "./secret-box.mjs";

const rclonePath = String(process.env.RCLONE_PATH || "rclone");
const nullConfigPath = process.platform === "win32" ? "NUL" : "/dev/null";
const remoteTimeoutMs = validatedInteger(
  process.env.REMOTE_STORAGE_TIMEOUT_MS || 120_000,
  5_000,
  30 * 60_000,
  "REMOTE_STORAGE_TIMEOUT_MS"
);
const remoteConcurrency = validatedInteger(
  process.env.REMOTE_STORAGE_CONCURRENCY || 8,
  1,
  64,
  "REMOTE_STORAGE_CONCURRENCY"
);
const remoteQueueLimit = validatedInteger(
  process.env.REMOTE_STORAGE_QUEUE_LIMIT || 128,
  1,
  10_000,
  "REMOTE_STORAGE_QUEUE_LIMIT"
);
const childEnvironmentAllowlist = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy",
  "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"
]);

function validatedInteger(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须为 ${minimum}–${maximum} 的整数`);
  }
  return parsed;
}

function isCloudMetadataHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "metadata.google.internal"
    || host === "metadata.azure.internal"
    || host === "100.100.100.200"
    || host === "fd00:ec2::254"
    || /^169\.254\./.test(host);
}

class StorageError extends Error {
  constructor(message, {
    code = "STORAGE_ERROR",
    status = 503,
    cause,
    exitCode,
    retryable = false
  } = {}) {
    super(message, { cause });
    this.name = "StorageError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (exitCode !== undefined) this.exitCode = exitCode;
  }
}

function abortedError() {
  return new StorageError("远端存储请求已取消", {
    code: "STORAGE_ABORTED",
    status: 499
  });
}

class Semaphore {
  active = 0;
  queue = [];

  acquire(signal, timeoutMs, { priority = false } = {}) {
    if (signal?.aborted) return Promise.reject(abortedError());
    if (this.active < remoteConcurrency) {
      this.active += 1;
      return Promise.resolve(this.release());
    }
    const priorityQueued = this.queue.reduce(
      (count, entry) => count + (entry.priority ? 1 : 0),
      0
    );
    if (
      (!priority && this.queue.length >= remoteQueueLimit)
      || (priority && priorityQueued >= remoteConcurrency)
    ) {
      return Promise.reject(new StorageError("远端存储任务过多，请稍后重试", {
        code: "STORAGE_QUEUE_FULL",
        status: 429,
        retryable: true
      }));
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const entry = {
        signal,
        resolve: resolvePromise,
        reject: rejectPromise,
        abort: null,
        timer: null,
        priority
      };
      entry.abort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", entry.abort);
        rejectPromise(abortedError());
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      entry.timer = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        signal?.removeEventListener("abort", entry.abort);
        rejectPromise(new StorageError("等待远端存储任务超时", {
          code: "STORAGE_QUEUE_TIMEOUT",
          status: 504,
          retryable: true
        }));
      }, timeoutMs);
      entry.timer.unref?.();
      if (priority) this.queue.unshift(entry);
      else this.queue.push(entry);
      if (signal?.aborted) entry.abort();
    });
  }

  drain() {
    while (this.active < remoteConcurrency && this.queue.length) {
      const entry = this.queue.shift();
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.abort);
      if (entry.signal?.aborted) {
        entry.reject(abortedError());
        continue;
      }
      this.active += 1;
      entry.resolve(this.release());
    }
  }

  release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }
}

const remoteSemaphore = new Semaphore();

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function invalidConfig(message) {
  return new StorageError(message, {
    code: "INVALID_STORAGE_CONFIG",
    status: 400
  });
}

function cleanRemotePart(value, { allowEmpty = true } = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw invalidConfig("远端存储路径必须为文本");
  }
  const text = String(value || "").trim().replaceAll("\\", "/");
  if (Buffer.byteLength(text, "utf8") > 2_048) {
    throw invalidConfig("远端存储路径过长");
  }
  const pieces = text.split("/").filter(Boolean);
  if (
    pieces.some((piece) => (
      piece === "."
      || piece === ".."
      || Buffer.byteLength(piece, "utf8") > 255
      || /[\u0000-\u001f\u007f]/.test(piece)
    ))
    || (!allowEmpty && pieces.length === 0)
  ) {
    throw invalidConfig("远端存储路径无效");
  }
  return pieces.join("/");
}

function validatedCredentialText(value, name, { required = false, maximumBytes = 1_024 } = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw invalidConfig(`${name}必须为文本`);
  }
  const text = String(value || "").trim();
  if (
    (required && !text)
    || Buffer.byteLength(text, "utf8") > maximumBytes
    || /[\u0000\r\n]/.test(text)
  ) {
    throw invalidConfig(`${name}无效`);
  }
  return text;
}

function validateStorageSecret(value, { persisted = false } = {}) {
  const fail = (message) => {
    throw new StorageError(message, {
      code: persisted ? "BACKEND_INVALID" : "INVALID_STORAGE_CONFIG",
      status: persisted ? 503 : 400
    });
  };
  if (value === undefined || value === null) return { password: "" };
  if (!plainObject(value)) fail("存储凭据格式不正确");
  const unknown = Object.keys(value).filter((key) => key !== "password");
  if (unknown.length) fail("存储凭据包含不支持的字段");
  if (value.password !== undefined && typeof value.password !== "string") {
    fail("存储密码必须为文本");
  }
  const password = String(value.password || "");
  if (Buffer.byteLength(password, "utf8") > 4_096 || /[\u0000\r\n]/.test(password)) {
    fail("存储密码无效");
  }
  return { password };
}

export function validateStorageConfig(input) {
  if (!plainObject(input)) throw invalidConfig("存储配置格式不正确");
  if (typeof input.driver !== "string") throw invalidConfig("存储驱动格式不正确");
  const driver = input.driver;
  if (!["local", "webdav", "smb"].includes(driver)) {
    throw invalidConfig("存储驱动必须为 local、webdav 或 smb");
  }
  if (driver === "local") return { driver: "local" };

  const basePath = cleanRemotePart(input.basePath);
  const username = validatedCredentialText(input.username, "存储用户名", {
    required: driver === "smb",
    maximumBytes: 254
  });
  if (driver === "webdav") {
    if (typeof input.url !== "string" || Buffer.byteLength(input.url, "utf8") > 2_048) {
      throw invalidConfig("WebDAV 地址无效");
    }
    let url;
    try {
      url = new URL(input.url);
    } catch {
      throw invalidConfig("WebDAV 地址无效");
    }
    if (
      !["https:", "http:"].includes(url.protocol)
      || !url.hostname
      || url.username
      || url.password
      || url.hash
      || url.search
    ) {
      throw invalidConfig("WebDAV 地址必须是无内嵌凭据、查询参数和片段的 HTTP(S) URL");
    }
    if (isCloudMetadataHost(url.hostname)) {
      throw invalidConfig("WebDAV 地址不能指向云主机元数据或链路本地地址");
    }
    const allowInsecure = input.allowInsecure === true;
    if (url.protocol !== "https:" && !allowInsecure) {
      throw invalidConfig("HTTP WebDAV 必须显式开启“不安全连接”");
    }
    const vendor = String(input.vendor || "other");
    if (![
      "other", "fastmail", "nextcloud", "owncloud", "infinitescale",
      "sharepoint", "sharepoint-ntlm", "rclone"
    ].includes(vendor)) {
      throw invalidConfig("WebDAV 服务类型无效");
    }
    return {
      driver,
      url: url.toString(),
      vendor,
      username,
      basePath,
      allowInsecure
    };
  }

  const host = validatedCredentialText(input.host, "SMB 主机名", {
    required: true,
    maximumBytes: 253
  });
  if (isCloudMetadataHost(host)) {
    throw invalidConfig("SMB 主机不能指向云主机元数据或链路本地地址");
  }
  if (/[/\\\s]/.test(host)) throw invalidConfig("SMB 主机名无效");
  const port = input.port === undefined ? 445 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalidConfig("SMB 端口必须为 1–65535");
  }
  const share = cleanRemotePart(input.share, { allowEmpty: false });
  if (share.includes("/") || /["<>|:*?]/.test(share)) {
    throw invalidConfig("SMB 共享名包含无效字符");
  }
  const domain = validatedCredentialText(input.domain ?? "WORKGROUP", "SMB 域名称", {
    maximumBytes: 128
  }) || "WORKGROUP";
  return { driver, host, port, share, username, domain, basePath };
}

export function createStorageKey(name = "") {
  const id = randomUUID();
  const extension = extname(String(name)).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  return legacyLayout ? `${id}${extension}` : `${id.slice(0, 2)}/${id}${extension}`;
}

export function createStagingPath(name = "") {
  const id = randomUUID();
  const extension = extname(String(name)).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  return join(stagingDir, `${id}${extension}.part`);
}

function localPath(key) {
  let normalized;
  try {
    normalized = cleanRemotePart(key, { allowEmpty: false });
  } catch (error) {
    throw new StorageError("本地存储路径无效", {
      code: "INVALID_STORAGE_KEY",
      status: 404,
      cause: error
    });
  }
  const root = resolve(objectsDir);
  const candidate = resolve(root, normalized);
  if (!candidate.startsWith(`${root}${sep}`)) {
    throw new StorageError("本地存储路径无效", {
      code: "INVALID_STORAGE_KEY",
      status: 404
    });
  }
  return candidate;
}

async function stagedFilePath(value) {
  if (typeof value !== "string") {
    throw new StorageError("暂存文件路径无效", {
      code: "INVALID_STAGING_PATH",
      status: 400
    });
  }
  const root = resolve(stagingDir);
  const candidate = resolve(value);
  if (!candidate.startsWith(`${root}${sep}`)) {
    throw new StorageError("暂存文件路径无效", {
      code: "INVALID_STAGING_PATH",
      status: 400
    });
  }
  await verifyParentInsideRoot(candidate, stagingDir, {
    code: "INVALID_STAGING_PATH",
    status: 400,
    message: "暂存文件路径无效"
  });
  const info = await regularFileInfo(candidate);
  if (!info) {
    throw new StorageError("暂存文件不存在或类型不安全", {
      code: "STAGED_FILE_MISSING",
      status: 409
    });
  }
  return candidate;
}

async function verifyParentInsideRoot(candidate, root, {
  allowMissing = false,
  code,
  status,
  message
}) {
  let realRoot;
  let realParent;
  try {
    realRoot = await realpath(root);
    realParent = await realpath(dirname(candidate));
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return;
    if (error.code === "ENOENT") {
      throw new StorageError(message, { code, status, cause: error });
    }
    throw localFailure(error, "验证路径");
  }
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
    throw new StorageError(message, { code, status });
  }
}

async function regularFileInfo(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return info;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw localFailure(error, "读取");
  }
}

function localFailure(error, operation) {
  if (error instanceof StorageError) return error;
  if (error?.code === "ENOSPC") {
    return new StorageError("本地存储空间不足", {
      code: "LOCAL_STORAGE_FULL",
      status: 507,
      cause: error
    });
  }
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) {
    return new StorageError(`本地存储无法${operation}`, {
      code: "LOCAL_STORAGE_PERMISSION",
      status: 503,
      cause: error
    });
  }
  return new StorageError(`本地存储${operation}失败`, {
    code: "LOCAL_STORAGE_FAILED",
    status: 503,
    cause: error,
    retryable: ["EBUSY", "EMFILE", "ENFILE"].includes(error?.code)
  });
}

function persistedBackendError(error) {
  if (error instanceof StorageError && error.code === "BACKEND_INVALID") return error;
  return new StorageError("文件存储后端配置损坏", {
    code: "BACKEND_INVALID",
    status: 503,
    cause: error
  });
}

function backendConfig(row) {
  if (!row) {
    throw new StorageError("文件存储后端不存在", {
      code: "BACKEND_MISSING",
      status: 503
    });
  }
  let config;
  try {
    config = JSON.parse(row.config_json || "{}");
    const validated = validateStorageConfig({ ...config, driver: row.driver });
    const secret = row.driver === "local"
      ? { password: "" }
      : validateStorageSecret(openSecret(row.secret_cipher), { persisted: true });
    return { id: row.id, ...validated, secret };
  } catch (error) {
    throw persistedBackendError(error);
  }
}

function remoteRoot(config) {
  if (config.driver === "smb") {
    return [config.share, config.basePath].filter(Boolean).join("/");
  }
  return config.basePath;
}

function remoteTarget(config, key = "") {
  let cleanedKey;
  try {
    cleanedKey = cleanRemotePart(key);
  } catch (error) {
    throw new StorageError("远端存储对象路径无效", {
      code: "INVALID_STORAGE_KEY",
      status: 404,
      cause: error
    });
  }
  const suffix = [remoteRoot(config), cleanedKey].filter(Boolean).join("/");
  return `yunpaste_remote:${suffix}`;
}

function remoteTemporaryKey(key) {
  let cleaned;
  try {
    cleaned = cleanRemotePart(key, { allowEmpty: false });
  } catch (error) {
    throw new StorageError("远端存储对象路径无效", {
      code: "INVALID_STORAGE_KEY",
      status: 404,
      cause: error
    });
  }
  const pieces = cleaned.split("/");
  const filename = pieces.pop();
  pieces.push(`.${filename.slice(0, 96)}.${randomUUID()}.yunpaste-part`);
  return pieces.join("/");
}

function childEnvironment(overrides) {
  const environment = {};
  for (const name of childEnvironmentAllowlist) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}

function rcloneExitError(exitCode, childSignal, terminationReason) {
  if (terminationReason === "aborted") return abortedError();
  if (terminationReason === "timeout" || exitCode === 10) {
    return new StorageError("远端存储操作超时", {
      code: "STORAGE_TIMEOUT",
      status: 504,
      exitCode,
      retryable: true
    });
  }
  if (exitCode === 3 || exitCode === 4) {
    return new StorageError("远端存储对象不存在", {
      code: "REMOTE_NOT_FOUND",
      status: 404,
      exitCode
    });
  }
  if (exitCode === 5) {
    return new StorageError("远端存储暂时不可用，请稍后重试", {
      code: "REMOTE_TEMPORARY",
      status: 503,
      exitCode,
      retryable: true
    });
  }
  if (exitCode === 7) {
    return new StorageError("远端存储拒绝操作或配置不可用", {
      code: "REMOTE_FATAL",
      status: 503,
      exitCode
    });
  }
  return new StorageError(
    childSignal ? "远端存储进程意外终止" : "远端存储操作失败",
    {
      code: "REMOTE_STORAGE_FAILED",
      status: 503,
      exitCode,
      retryable: exitCode === 1 || exitCode === 6
    }
  );
}

async function runProcess(args, {
  env = {},
  input,
  signal,
  timeoutMs = remoteTimeoutMs,
  stream = false,
  stdoutLimit = 2 * 1024 * 1024,
  priority = false
} = {}) {
  const queuedAt = performance.now();
  const release = await remoteSemaphore.acquire(signal, timeoutMs, { priority });
  if (signal?.aborted) {
    release();
    throw abortedError();
  }
  const remainingTimeoutMs = Math.max(1, timeoutMs - (performance.now() - queuedAt));

  let child;
  try {
    child = spawn(rclonePath, args, {
      env: childEnvironment(env),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    release();
    throw new StorageError("无法启动远端存储连接", {
      code: "RCLONE_START_FAILED",
      status: 503,
      cause: error
    });
  }

  let stdout = "";
  let stdoutOverflow = false;
  let terminationReason = null;
  let hardKillTimer;
  let timeoutTimer;

  const terminate = (reason) => {
    terminationReason ||= reason;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!hardKillTimer) {
      hardKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000);
      hardKillTimer.unref?.();
    }
  };
  const abort = () => terminate("aborted");

  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  timeoutTimer = setTimeout(() => terminate("timeout"), remainingTimeoutMs);
  timeoutTimer.unref?.();

  // stdin can receive EPIPE when rclone exits early. The process close/error
  // event below is the authoritative operation result.
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});
  child.stderr.on("data", () => {
    // Always drain stderr, but never retain or surface it: backend responses
    // may contain credentials or private endpoint details.
  });
  if (!stream) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdoutOverflow) return;
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(chunk, "utf8") > stdoutLimit) {
        stdoutOverflow = true;
        stdout = "";
        return;
      }
      stdout += chunk;
    });
  }
  child.stdin.end(input === undefined ? undefined : input);

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      rejectPromise(new StorageError(
        error.code === "ENOENT"
          ? "未找到 rclone，WebDAV/SMB 存储当前不可用"
          : "无法启动远端存储连接",
        {
          code: error.code === "ENOENT" ? "RCLONE_MISSING" : "RCLONE_START_FAILED",
          status: 503,
          cause: error
        }
      ));
    });
    child.once("close", (code, childSignal) => {
      if (terminationReason || code !== 0) {
        rejectPromise(rcloneExitError(code, childSignal, terminationReason));
        return;
      }
      if (stdoutOverflow) {
        rejectPromise(new StorageError("远端存储返回的数据过大", {
          code: "REMOTE_RESPONSE_TOO_LARGE",
          status: 502
        }));
        return;
      }
      resolvePromise({ stdout });
    });
  }).finally(() => {
    clearTimeout(timeoutTimer);
    clearTimeout(hardKillTimer);
    signal?.removeEventListener("abort", abort);
    release();
  });

  if (stream) {
    // The caller still receives and awaits the original promise. This handler
    // only prevents a very fast spawn/abort failure from becoming an
    // unhandled rejection before the HTTP pipeline has attached its waiter.
    completion.catch(() => {});
    return {
      child,
      stream: child.stdout,
      completion,
      cancel: abort
    };
  }
  return completion;
}

const obscuredPasswords = new Map();
const backendPasswordCacheKeys = new Map();

function obscuredPasswordCacheKey(config) {
  return createHash("sha256")
    .update(String(config.id))
    .update("\0")
    .update(config.secret.password)
    .digest("base64url");
}

async function obscurePassword(config, signal) {
  if (!config.secret.password) return "";
  const cacheKey = obscuredPasswordCacheKey(config);
  const cached = obscuredPasswords.get(cacheKey);
  if (cached) return cached;
  const result = await runProcess(
    ["obscure", "-", `--config=${nullConfigPath}`, "--ask-password=false"],
    {
      input: `${config.secret.password}\n`,
      signal,
      timeoutMs: Math.min(remoteTimeoutMs, 30_000),
      env: {
        RCLONE_CONFIG: nullConfigPath,
        RCLONE_ASK_PASSWORD: "false"
      },
      stdoutLimit: 8_192
    }
  );
  const obscured = result.stdout.trim();
  if (!obscured || !/^[A-Za-z0-9_-]+$/.test(obscured)) {
    throw new StorageError("rclone 无法安全处理存储密码", {
      code: "RCLONE_OBSCURE_FAILED",
      status: 503
    });
  }
  const previousKey = backendPasswordCacheKeys.get(config.id);
  if (previousKey && previousKey !== cacheKey) obscuredPasswords.delete(previousKey);
  backendPasswordCacheKeys.set(config.id, cacheKey);
  obscuredPasswords.set(cacheKey, obscured);
  while (backendPasswordCacheKeys.size > 256) {
    const oldestId = backendPasswordCacheKeys.keys().next().value;
    const oldestCacheKey = backendPasswordCacheKeys.get(oldestId);
    backendPasswordCacheKeys.delete(oldestId);
    obscuredPasswords.delete(oldestCacheKey);
  }
  while (obscuredPasswords.size > 256) {
    const oldestKey = obscuredPasswords.keys().next().value;
    obscuredPasswords.delete(oldestKey);
  }
  return obscured;
}

async function rcloneEnvironment(config, signal) {
  const environment = {
    RCLONE_CONFIG: nullConfigPath,
    RCLONE_ASK_PASSWORD: "false",
    RCLONE_CONFIG_YUNPASTE_REMOTE_TYPE: config.driver,
    RCLONE_CONFIG_YUNPASTE_REMOTE_USER: config.username || "",
    RCLONE_CONFIG_YUNPASTE_REMOTE_PASS: await obscurePassword(config, signal)
  };
  if (config.driver === "webdav") {
    Object.assign(environment, {
      RCLONE_CONFIG_YUNPASTE_REMOTE_URL: config.url,
      RCLONE_CONFIG_YUNPASTE_REMOTE_VENDOR: config.vendor
    });
  } else {
    Object.assign(environment, {
      RCLONE_CONFIG_YUNPASTE_REMOTE_HOST: config.host,
      RCLONE_CONFIG_YUNPASTE_REMOTE_PORT: String(config.port),
      RCLONE_CONFIG_YUNPASTE_REMOTE_DOMAIN: config.domain
    });
  }
  return environment;
}

async function remoteCommand(config, args, options = {}) {
  const environment = await rcloneEnvironment(config, options.signal);
  return runProcess(
    [
      ...args,
      `--config=${nullConfigPath}`,
      "--ask-password=false",
      "--log-level=ERROR"
    ],
    { ...options, env: environment }
  );
}

function parseRemoteJson(output, message) {
  try {
    return JSON.parse(output || "null");
  } catch (error) {
    throw new StorageError(message, {
      code: "REMOTE_RESPONSE_INVALID",
      status: 502,
      cause: error
    });
  }
}

export function personalWebdavProvider(configInput, secretInput = {}) {
  const config = validateStorageConfig({ ...configInput, driver: "webdav" });
  const runtime = {
    id: `personal-webdav-${createHash("sha256").update(config.url).digest("hex").slice(0, 16)}`,
    ...config,
    secret: validateStorageSecret(secretInput)
  };
  const target = (path = "") => remoteTarget(runtime, path);

  return {
    async list(path = "", signal) {
      const cleanPath = cleanRemotePart(path);
      const result = await remoteCommand(
        runtime,
        ["lsjson", target(cleanPath), "--max-depth", "1"],
        { signal, stdoutLimit: 8 * 1024 * 1024 }
      );
      const parsed = parseRemoteJson(result.stdout, "WebDAV 返回了无效的目录信息");
      if (!Array.isArray(parsed)) {
        throw new StorageError("WebDAV 返回了无效的目录信息", {
          code: "REMOTE_RESPONSE_INVALID",
          status: 502
        });
      }
      return parsed.slice(0, 5_000).map((entry) => {
        const relativePath = cleanRemotePart(entry?.Path || entry?.Name, { allowEmpty: false });
        const name = relativePath.split("/").at(-1);
        const size = Number(entry?.Size || 0);
        return {
          name,
          path: [cleanPath, name].filter(Boolean).join("/"),
          isDir: Boolean(entry?.IsDir),
          size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
          mime: typeof entry?.MimeType === "string" ? entry.MimeType.slice(0, 120) : "",
          modifiedAt: Number.isFinite(Date.parse(entry?.ModTime)) ? new Date(entry.ModTime).toISOString() : null
        };
      }).filter((entry) => entry.name !== ".yunpaste-health");
    },
    async stat(path, signal) {
      const cleanPath = cleanRemotePart(path, { allowEmpty: false });
      const result = await remoteCommand(runtime, ["lsjson", target(cleanPath), "--stat"], { signal });
      const entry = parseRemoteJson(result.stdout, "WebDAV 返回了无效的文件信息");
      const size = Number(entry?.Size || 0);
      return {
        name: cleanPath.split("/").at(-1),
        path: cleanPath,
        isDir: Boolean(entry?.IsDir),
        size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
        mime: typeof entry?.MimeType === "string" ? entry.MimeType.slice(0, 120) : "",
        modifiedAt: Number.isFinite(Date.parse(entry?.ModTime)) ? new Date(entry.ModTime).toISOString() : null
      };
    },
    async mkdir(path, signal) {
      const cleanPath = cleanRemotePart(path, { allowEmpty: false });
      await remoteCommand(runtime, ["mkdir", target(cleanPath)], { signal });
    },
    async move(source, destination, signal) {
      const cleanSource = cleanRemotePart(source, { allowEmpty: false });
      const cleanDestination = cleanRemotePart(destination, { allowEmpty: false });
      if (cleanDestination === cleanSource || cleanDestination.startsWith(`${cleanSource}/`)) {
        throw invalidConfig("不能把目录移动到自身内部");
      }
      await remoteCommand(runtime, ["moveto", target(cleanSource), target(cleanDestination)], {
        signal,
        timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000)
      });
    },
    async copy(source, destination, isDir, signal) {
      const cleanSource = cleanRemotePart(source, { allowEmpty: false });
      const cleanDestination = cleanRemotePart(destination, { allowEmpty: false });
      const args = isDir
        ? ["copy", target(cleanSource), target(cleanDestination)]
        : ["copyto", target(cleanSource), target(cleanDestination), "--no-traverse"];
      await remoteCommand(runtime, args, {
        signal,
        timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000)
      });
    },
    async delete(path, isDir, signal) {
      const cleanPath = cleanRemotePart(path, { allowEmpty: false });
      await remoteCommand(runtime, [isDir ? "purge" : "deletefile", target(cleanPath)], { signal });
    },
    async download(path, stagedPath, signal) {
      const cleanPath = cleanRemotePart(path, { allowEmpty: false });
      await remoteCommand(
        runtime,
        ["copyto", target(cleanPath), stagedPath, "--no-traverse"],
        { signal, timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000) }
      );
    },
    async upload(stagedPath, path, signal) {
      const source = await stagedFilePath(stagedPath);
      const cleanPath = cleanRemotePart(path, { allowEmpty: false });
      await remoteCommand(
        runtime,
        ["copyto", source, target(cleanPath), "--no-traverse"],
        { signal, timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000) }
      );
    }
  };
}

function validatedRange(start, end) {
  if (start === undefined && end === undefined) return null;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
  ) {
    throw new StorageError("文件读取范围无效", {
      code: "INVALID_STORAGE_RANGE",
      status: 416
    });
  }
  return { start, end };
}

export function storageProvider(row) {
  const config = backendConfig(row);
  if (config.driver === "local") {
    return {
      id: config.id,
      driver: "local",
      async health() {
        try {
          const info = await statfs(filesDir);
          return {
            state: "connected",
            freeBytes: info.bavail * info.bsize,
            totalBytes: info.blocks * info.bsize
          };
        } catch (error) {
          throw localFailure(error, "检查");
        }
      },
      async stat(key) {
        const path = localPath(key);
        await verifyParentInsideRoot(path, objectsDir, {
          allowMissing: true,
          code: "INVALID_STORAGE_KEY",
          status: 404,
          message: "本地存储路径无效"
        });
        const info = await regularFileInfo(path);
        return info ? { size: info.size, mtime: info.mtime, mtimeMs: info.mtimeMs } : null;
      },
      async commit(stagedPath, key) {
        const source = await stagedFilePath(stagedPath);
        const destination = localPath(key);
        try {
          await verifyParentInsideRoot(destination, objectsDir, {
            allowMissing: true,
            code: "INVALID_STORAGE_KEY",
            status: 404,
            message: "本地存储路径无效"
          });
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await verifyParentInsideRoot(destination, objectsDir, {
            code: "INVALID_STORAGE_KEY",
            status: 404,
            message: "本地存储路径无效"
          });
          await rename(source, destination);
        } catch (error) {
          throw localFailure(error, "写入");
        }
      },
      async open(key, { start, end } = {}) {
        const range = validatedRange(start, end);
        const path = localPath(key);
        await verifyParentInsideRoot(path, objectsDir, {
          allowMissing: true,
          code: "INVALID_STORAGE_KEY",
          status: 404,
          message: "本地存储路径无效"
        });
        if (!await regularFileInfo(path)) {
          throw new StorageError("文件内容不存在", {
            code: "FILE_MISSING",
            status: 404
          });
        }
        return {
          stream: createReadStream(path, {
            ...(range || {}),
            flags: fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
          }),
          completion: Promise.resolve(),
          cancel() {}
        };
      },
      async delete(key) {
        const path = localPath(key);
        try {
          await verifyParentInsideRoot(path, objectsDir, {
            allowMissing: true,
            code: "INVALID_STORAGE_KEY",
            status: 404,
            message: "本地存储路径无效"
          });
          await unlink(path);
        } catch (error) {
          if (error.code !== "ENOENT") throw localFailure(error, "删除");
        }
      }
    };
  }

  return {
    id: config.id,
    driver: config.driver,
    async health(signal) {
      const started = performance.now();
      await remoteCommand(config, ["lsjson", remoteTarget(config), "--stat"], { signal });
      return {
        state: "connected",
        latencyMs: Math.round(performance.now() - started)
      };
    },
    async stat(key, signal) {
      try {
        const result = await remoteCommand(
          config,
          ["lsjson", remoteTarget(config, key), "--stat"],
          { signal }
        );
        let parsed;
        try {
          parsed = JSON.parse(result.stdout || "{}");
        } catch (error) {
          throw new StorageError("远端存储返回无效的文件信息", {
            code: "REMOTE_RESPONSE_INVALID",
            status: 502,
            cause: error
          });
        }
        if (parsed?.IsDir) return null;
        const size = Number(parsed?.Size);
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new StorageError("远端存储返回无效的文件大小", {
            code: "REMOTE_RESPONSE_INVALID",
            status: 502
          });
        }
        const parsedTime = parsed.ModTime ? Date.parse(parsed.ModTime) : 0;
        const mtimeMs = Number.isFinite(parsedTime) ? parsedTime : 0;
        return { size, mtime: new Date(mtimeMs), mtimeMs };
      } catch (error) {
        if (error instanceof StorageError && error.code === "REMOTE_NOT_FOUND") return null;
        throw error;
      }
    },
    async commit(stagedPath, key, signal) {
      const source = await stagedFilePath(stagedPath);
      const temporaryKey = remoteTemporaryKey(key);
      let temporaryMayExist = false;
      try {
        // A timed-out copy may have created all or part of the object even
        // though rclone returned an error, so cleanup starts before transfer.
        temporaryMayExist = true;
        await remoteCommand(
          config,
          ["copyto", source, remoteTarget(config, temporaryKey), "--no-traverse"],
          { signal, timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000) }
        );
        await remoteCommand(
          config,
          [
            "moveto",
            remoteTarget(config, temporaryKey),
            remoteTarget(config, key),
            "--no-traverse"
          ],
          { signal, timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000) }
        );
        temporaryMayExist = false;
        try {
          await unlink(source);
        } catch (error) {
          if (error.code !== "ENOENT") throw localFailure(error, "清理暂存文件");
        }
      } finally {
        if (temporaryMayExist) {
          await remoteCommand(
            config,
            ["deletefile", remoteTarget(config, temporaryKey)],
            {
              timeoutMs: Math.min(remoteTimeoutMs, 15_000),
              priority: true
            }
          ).catch(() => {});
        }
      }
    },
    async open(key, { start, end, signal } = {}) {
      const range = validatedRange(start, end);
      const args = ["cat", remoteTarget(config, key)];
      if (range) {
        args.push(
          "--offset", String(range.start),
          "--count", String(range.end - range.start + 1)
        );
      }
      return remoteCommand(config, args, {
        signal,
        stream: true,
        timeoutMs: Math.max(remoteTimeoutMs, 30 * 60_000)
      });
    },
    async delete(key, signal) {
      try {
        await remoteCommand(config, ["deletefile", remoteTarget(config, key)], { signal });
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "REMOTE_NOT_FOUND") throw error;
      }
    }
  };
}

export async function testStorageConnection(configInput, secret = {}, signal) {
  const config = validateStorageConfig(configInput);
  if (config.driver === "local") {
    const testPath = join(stagingDir, `.health-${randomUUID()}`);
    const started = performance.now();
    const expected = "yunpaste-storage-health";
    try {
      await writeFile(testPath, expected, { mode: 0o600, flag: "wx" });
      const actual = await readFile(testPath, "utf8");
      if (actual !== expected) {
        throw new StorageError("本地存储读回校验失败", {
          code: "LOCAL_VERIFY_FAILED",
          status: 503
        });
      }
      return {
        state: "connected",
        latencyMs: Math.round(performance.now() - started)
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw localFailure(error, "连接测试");
    } finally {
      await unlink(testPath).catch(() => {});
    }
  }

  const runtimeConfig = {
    id: "connection-test",
    ...config,
    secret: validateStorageSecret(secret)
  };
  const healthKey = `.yunpaste-health/${randomUUID()}.txt`;
  const temporaryHealthKey = remoteTemporaryKey(healthKey);
  const localTemporary = createStagingPath(".txt");
  const expected = "yunpaste-storage-health";
  const started = performance.now();
  let temporaryMayExist = false;
  let remoteCreated = false;
  try {
    await writeFile(localTemporary, expected, { mode: 0o600, flag: "wx" });
    temporaryMayExist = true;
    await remoteCommand(
      runtimeConfig,
      [
        "copyto",
        localTemporary,
        remoteTarget(runtimeConfig, temporaryHealthKey),
        "--no-traverse"
      ],
      { signal }
    );
    await remoteCommand(
      runtimeConfig,
      [
        "moveto",
        remoteTarget(runtimeConfig, temporaryHealthKey),
        remoteTarget(runtimeConfig, healthKey),
        "--no-traverse"
      ],
      { signal }
    );
    temporaryMayExist = false;
    remoteCreated = true;
    const result = await remoteCommand(
      runtimeConfig,
      ["cat", remoteTarget(runtimeConfig, healthKey)],
      { signal, stdoutLimit: 1_024 }
    );
    if (result.stdout !== expected) {
      throw new StorageError("远端存储读回校验失败", {
        code: "REMOTE_VERIFY_FAILED",
        status: 503
      });
    }
    await remoteCommand(
      runtimeConfig,
      ["deletefile", remoteTarget(runtimeConfig, healthKey)],
      { signal }
    );
    remoteCreated = false;
    return {
      state: "connected",
      latencyMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw localFailure(error, "执行连接测试");
  } finally {
    if (temporaryMayExist) {
      await remoteCommand(
        runtimeConfig,
        ["deletefile", remoteTarget(runtimeConfig, temporaryHealthKey)],
        {
          timeoutMs: Math.min(remoteTimeoutMs, 15_000),
          priority: true
        }
      ).catch(() => {});
    }
    if (remoteCreated) {
      await remoteCommand(
        runtimeConfig,
        ["deletefile", remoteTarget(runtimeConfig, healthKey)],
        {
          timeoutMs: Math.min(remoteTimeoutMs, 15_000),
          priority: true
        }
      ).catch(() => {});
    }
    await remoteCommand(
      runtimeConfig,
      ["rmdir", remoteTarget(runtimeConfig, ".yunpaste-health")],
      {
        timeoutMs: Math.min(remoteTimeoutMs, 15_000),
        priority: true
      }
    ).catch(() => {});
    await unlink(localTemporary).catch(() => {});
  }
}

export function sanitizeStorageBackend(row) {
  const config = backendConfig(row);
  const { secret, ...safe } = config;
  return {
    ...safe,
    credentialsConfigured: Boolean(secret.password),
    configPath: "/config",
    filesPath: "/files"
  };
}

export { StorageError };
