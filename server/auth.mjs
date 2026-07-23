import jwt from "jsonwebtoken";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { configDir, db, isSystemOwner, publicUser } from "./db.mjs";

const secretPath = join(configDir, ".jwt-secret");
if (!existsSync(secretPath)) {
  writeFileSync(secretPath, randomBytes(64).toString("hex"), { mode: 0o600 });
}
const secret = process.env.JWT_SECRET_FILE
  ? readFileSync(process.env.JWT_SECRET_FILE, "utf8").trim()
  : process.env.JWT_SECRET || readFileSync(secretPath, "utf8").trim();
if (!secret || (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32)) {
  throw new Error("生产环境会话签名密钥必须至少为 32 字节");
}
const issuer = "tieyun";
const sessionTtl = process.env.SESSION_TTL || "7d";
if (!/^[1-9]\d*[smhd]$/.test(sessionTtl)) {
  throw new Error("SESSION_TTL 必须使用正整数加 s、m、h 或 d，例如 7d");
}

export function signUser(user) {
  return jwt.sign({ sub: user.id, type: "session" }, secret, {
    algorithm: "HS256",
    audience: "tieyun-web",
    expiresIn: sessionTtl,
    issuer
  });
}

export function signFileAccess(file, user) {
  return jwt.sign({
    sub: user.id,
    fid: file.id,
    trashed: Boolean(file.is_trashed),
    rev: Number(file.access_version || 0),
    type: "file-access"
  }, secret, {
    algorithm: "HS256",
    audience: "tieyun-file",
    expiresIn: "10m",
    issuer
  });
}

export function verifyFileAccess(token) {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience: "tieyun-file",
    issuer
  });
  if (
    payload.type !== "file-access"
    || typeof payload.fid !== "string"
    || typeof payload.trashed !== "boolean"
    || !Number.isSafeInteger(payload.rev)
  ) {
    throw new Error("invalid file access token");
  }
  return payload;
}

export function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "请先登录" });
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: "tieyun-web",
      issuer
    });
    if (payload.type !== "session") throw new Error("invalid session token");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "账户不可用" });
    }
    req.user = publicUser(user, { withUsage: false });
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  next();
}

export function primaryAdminOnly(req, res, next) {
  if (!req.user || !isSystemOwner(req.user.id)) {
    return res.status(403).json({ error: "该操作仅限主管理员" });
  }
  next();
}
