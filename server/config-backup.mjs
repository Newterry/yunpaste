import {
  createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const AAD = Buffer.from("yunpaste-config-backup:v2", "utf8");
const MAX_PASSPHRASE_BYTES = 256;
const MAX_PAYLOAD_BYTES = 256 * 1024;

function checkedPassphrase(value) {
  if (typeof value !== "string") throw new Error("请输入备份口令");
  const size = Buffer.byteLength(value);
  if (size < 12 || size > MAX_PASSPHRASE_BYTES) {
    throw new Error("备份口令须为 12–256 字节");
  }
  return value;
}

function decode(value, expectedLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`备份文件的${label}无效`);
  }
  const result = Buffer.from(value, "base64url");
  if (expectedLength && result.length !== expectedLength) throw new Error(`备份文件的${label}无效`);
  return result;
}

async function derive(passphrase, salt) {
  return scrypt(checkedPassphrase(passphrase), salt, 32, {
    N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
}

export async function encryptConfigBackup(payload, passphrase, metadata) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error("配置备份内容过大");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: "yunpaste-config-backup",
    schemaVersion: 2,
    appVersion: metadata.appVersion,
    exportedAt: metadata.exportedAt,
    encryption: {
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url")
    },
    payload: encrypted.toString("base64url"),
    coverage: metadata.coverage
  };
}

export async function decryptConfigBackup(document, passphrase) {
  if (
    !document || typeof document !== "object" || Array.isArray(document)
    || document.format !== "yunpaste-config-backup" || document.schemaVersion !== 2
    || document.encryption?.algorithm !== "aes-256-gcm" || document.encryption?.kdf !== "scrypt"
  ) throw new Error("不是受支持的云粘贴配置备份");
  try {
    const salt = decode(document.encryption.salt, 16, "盐值");
    const iv = decode(document.encryption.iv, 12, "随机向量");
    const tag = decode(document.encryption.tag, 16, "认证标签");
    const ciphertext = decode(document.payload, undefined, "加密内容");
    if (!ciphertext.length || ciphertext.length > MAX_PAYLOAD_BYTES) throw new Error("size");
    const key = await derive(passphrase, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    if (error?.message?.startsWith("备份口令须") || error?.message === "请输入备份口令") throw error;
    throw new Error("备份口令错误或文件已损坏");
  }
}
