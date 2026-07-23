import {
  createCipheriv, createDecipheriv, createHash, randomBytes
} from "node:crypto";
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync,
  linkSync, openSync, readFileSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { configDir } from "./paths.mjs";

const generatedSecretPath = join(configDir, ".storage-secret");
const maximumCiphertextBytes = 96 * 1024;
const maximumPlaintextBytes = 64 * 1024;

function createManagedKey(path) {
  try {
    lstatSync(path);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    writeFileSync(descriptor, randomBytes(32));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // A hard link publishes only a complete, fsynced key and fails rather
    // than replacing the winner when multiple processes start together.
    try {
      linkSync(temporaryPath, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  // Persist the directory entry when the platform supports directory fsync.
  let directoryDescriptor;
  try {
    directoryDescriptor = openSync(dirname(path), constants.O_RDONLY);
    fsyncSync(directoryDescriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(error.code)) throw error;
  } finally {
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}

function readKey(path, { managed }) {
  let descriptor;
  try {
    const noFollow = constants.O_NOFOLLOW || 0;
    if (!noFollow && lstatSync(path).isSymbolicLink()) {
      throw new Error("存储凭据加密密钥不能是符号链接");
    }
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error("存储凭据加密密钥必须是普通文件");
    if (info.size > 1024 * 1024) throw new Error("存储凭据加密密钥文件过大");
    if (managed && process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      fchmodSync(descriptor, 0o600);
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function keyMaterial() {
  const configured = String(process.env.STORAGE_SECRET_FILE || "").trim();
  const path = configured ? resolve(configured) : generatedSecretPath;
  if (!configured) createManagedKey(path);

  let material;
  try {
    material = readKey(path, { managed: !configured });
  } catch (error) {
    if (configured && error.code === "ENOENT") {
      throw new Error(`STORAGE_SECRET_FILE 不存在：${path}`, { cause: error });
    }
    throw error;
  }
  if (material.byteLength < 32) {
    throw new Error("存储凭据加密密钥必须至少为 32 字节");
  }
  return createHash("sha256").update(material).digest();
}

let cachedKey;
function encryptionKey() {
  cachedKey ||= keyMaterial();
  return cachedKey;
}

export function sealSecret(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("存储凭据必须是对象");
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new TypeError("存储凭据无法序列化");
  const plaintext = Buffer.from(serialized, "utf8");
  if (plaintext.byteLength > maximumPlaintextBytes) {
    throw new RangeError("存储凭据内容过大");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function openSecret(ciphertext) {
  if (!ciphertext) return {};
  const encoded = String(ciphertext);
  if (Buffer.byteLength(encoded, "utf8") > maximumCiphertextBytes) {
    throw new Error("存储凭据密文过大");
  }
  const parts = encoded.split(".");
  if (
    parts.length !== 4
    || parts[0] !== "v1"
    || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw new Error("存储凭据密文格式无效");
  }
  const [, ivText, tagText, encryptedText] = parts;
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const encrypted = Buffer.from(encryptedText, "base64url");
  if (iv.byteLength !== 12 || tag.byteLength !== 16 || encrypted.byteLength > maximumPlaintextBytes) {
    throw new Error("存储凭据密文格式无效");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("存储凭据内容无效");
    }
    return parsed;
  } catch (error) {
    throw new Error("存储凭据无法解密或内容已损坏", { cause: error });
  }
}
