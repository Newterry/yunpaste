import Database from "better-sqlite3-multiple-ciphers";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, openSync,
  readFileSync, readSync, renameSync, statSync, unlinkSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { databasePath } from "./paths.mjs";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

function normalizeKeyMaterial(value, source) {
  let material = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const asText = material.toString("utf8").trim();
  if (/^[a-f0-9]{64}$/i.test(asText)) material = Buffer.from(asText, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(asText)) material = Buffer.from(asText, "base64");
  else if (!Buffer.isBuffer(value)) material = Buffer.from(asText, "utf8");
  if (material.byteLength < 32) {
    throw new Error(`${source} 必须提供至少 32 字节的数据库加密密钥`);
  }
  return createHash("sha256").update(material).digest("hex");
}

export function loadDatabaseKey({
  keyFile = process.env.DATABASE_KEY_FILE,
  keyValue = process.env.DATABASE_KEY
} = {}) {
  if (keyFile) {
    const path = resolve(String(keyFile));
    return {
      hex: normalizeKeyMaterial(readFileSync(path), "DATABASE_KEY_FILE"),
      source: "file",
      path
    };
  }
  if (keyValue) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境数据库密钥只能通过 DATABASE_KEY_FILE 提供");
    }
    return {
      hex: normalizeKeyMaterial(String(keyValue), "DATABASE_KEY"),
      source: "environment"
    };
  }
  return null;
}

export function databaseFileEncrypted(path = databasePath) {
  if (!existsSync(path) || statSync(path).size === 0) return false;
  const header = Buffer.alloc(SQLITE_HEADER.length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  return !header.equals(SQLITE_HEADER);
}

function applyCipher(db, keyHex) {
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key="x'${keyHex}'"`);
}

function verifyReadable(db) {
  db.prepare("SELECT count(*) AS count FROM sqlite_master").get();
}

export function openDatabase(path = databasePath) {
  const key = loadDatabaseKey();
  const existed = existsSync(path) && statSync(path).size > 0;
  const encrypted = existed && databaseFileEncrypted(path);
  if (encrypted && !key) {
    throw new Error(
      "数据库已加密，但未提供 DATABASE_KEY_FILE；为防止创建空库，程序已拒绝启动"
    );
  }
  if (existed && !encrypted && key) {
    throw new Error(
      "检测到明文数据库与加密密钥；请先停机运行 `npm run db:encrypt -- --key-file <路径>` 完成安全迁移"
    );
  }

  const db = new Database(path, { timeout: 5000 });
  try {
    if (key) applyCipher(db, key.hex);
    verifyReadable(db);
    chmodSync(path, 0o600);
  } catch (error) {
    db.close();
    if (encrypted) {
      throw new Error("数据库密钥错误或加密数据库已损坏，程序已拒绝启动", {
        cause: error
      });
    }
    throw error;
  }
  return {
    db,
    encryption: {
      enabled: Boolean(key),
      provider: key ? "SQLite3MultipleCiphers" : null,
      cipher: key ? "SQLCipher legacy 4 / AES-256" : null,
      keySource: key?.source || null
    }
  };
}

function syncPath(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function encryptDatabaseFile({
  path = databasePath,
  keyFile,
  keepPlaintextBackup = false
} = {}) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`数据库不存在：${path}`);
  }
  if (databaseFileEncrypted(path)) throw new Error("数据库已经处于加密状态");
  if (existsSync(`${path}-shm`)) {
    throw new Error(
      "检测到数据库仍被服务占用或上次未正常关闭；请先停止云粘贴并确认进程退出后再加密"
    );
  }
  const key = loadDatabaseKey({ keyFile, keyValue: null });
  if (!key) throw new Error("必须通过 --key-file 提供数据库加密密钥");

  let source = new Database(path, { timeout: 5000 });
  const check = source.pragma("quick_check", { simple: true });
  if (check !== "ok") {
    source.close();
    throw new Error(`明文数据库完整性检查失败：${check}`);
  }
  source.pragma("wal_checkpoint(TRUNCATE)");
  source.close();
  source = null;

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const temporary = `${path}.encrypting-${stamp}`;
  const plaintextBackup = `${path}.plaintext-recovery-${stamp}`;
  copyFileSync(path, temporary);
  chmodSync(temporary, 0o600);

  try {
    const candidate = new Database(temporary, { timeout: 5000 });
    candidate.pragma("cipher='sqlcipher'");
    candidate.pragma("legacy=4");
    candidate.pragma(`rekey="x'${key.hex}'"`);
    candidate.close();

    const encrypted = new Database(temporary, { timeout: 5000, readonly: true });
    applyCipher(encrypted, key.hex);
    verifyReadable(encrypted);
    const encryptedCheck = encrypted.pragma("quick_check", { simple: true });
    encrypted.close();
    if (encryptedCheck !== "ok") {
      throw new Error(`加密数据库完整性检查失败：${encryptedCheck}`);
    }
    if (!databaseFileEncrypted(temporary)) {
      throw new Error("加密迁移未生成加密文件头");
    }

    syncPath(temporary);
    renameSync(path, plaintextBackup);
    chmodSync(plaintextBackup, 0o600);
    renameSync(temporary, path);
    syncPath(path);
    syncPath(dirname(path));
    if (!keepPlaintextBackup) unlinkSync(plaintextBackup);
    return {
      path,
      plaintextBackup: keepPlaintextBackup ? plaintextBackup : null,
      provider: "SQLite3MultipleCiphers",
      cipher: "SQLCipher legacy 4 / AES-256"
    };
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (!existsSync(path) && existsSync(plaintextBackup)) {
      renameSync(plaintextBackup, path);
    }
    throw error;
  }
}

export function databaseEncryptionStatus(path = databasePath) {
  const encrypted = databaseFileEncrypted(path);
  const key = loadDatabaseKey();
  return {
    enabled: encrypted,
    state: encrypted ? (key ? "ready" : "key-required") : (key ? "migration-required" : "disabled"),
    provider: encrypted ? "SQLite3MultipleCiphers" : null,
    cipher: encrypted ? "SQLCipher legacy 4 / AES-256" : null,
    keySource: key?.source || null
  };
}
