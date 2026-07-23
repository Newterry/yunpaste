import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { openDatabase } from "./database.mjs";
import {
  configDir, dataDir, databasePath, filesDir, legacyLayout, objectsDir,
  rootDir, stagingDir, uploadDir
} from "./paths.mjs";

export {
  configDir, dataDir, databasePath, filesDir, legacyLayout, objectsDir,
  rootDir, stagingDir, uploadDir
};
mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

const openedDatabase = openDatabase();
export const db = openedDatabase.db;
export const databaseEncryption = openedDatabase.encryption;
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA journal_size_limit = 67108864;
`);

const SCHEMA_VERSION = 14;
export const DEFAULT_USER_QUOTA = 20 * 1024 * 1024 * 1024;

function migrationUsername(row, used) {
  const candidates = [
    String(row.email || "").includes("@") ? String(row.email).split("@")[0] : row.email,
    row.name,
    `user-${String(row.id || "").slice(0, 8)}`
  ];
  let base = "";
  for (const candidate of candidates) {
    const normalized = String(candidate || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 32);
    if (normalized.length >= 3) {
      base = normalized;
      break;
    }
  }
  if (!base) base = `user-${randomBytes(4).toString("hex")}`;
  let username = base;
  let suffix = 2;
  while (used.has(username.toLowerCase())) {
    const ending = `-${suffix}`;
    username = `${base.slice(0, 32 - ending.length)}${ending}`;
    suffix += 1;
  }
  used.add(username.toLowerCase());
  return username;
}

function migrate() {
  const current = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `数据卷 schema 版本 ${current} 高于当前程序支持的 ${SCHEMA_VERSION}；请使用匹配的较新镜像或恢复升级前备份`
    );
  }
  if (current === SCHEMA_VERSION) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (current < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          status TEXT NOT NULL DEFAULT 'active',
          quota INTEGER NOT NULL DEFAULT 21474836480,
          created_at TEXT NOT NULL,
          last_seen_at TEXT
        );

        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL,
          is_shared INTEGER NOT NULL DEFAULT 0,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          is_trashed INTEGER NOT NULL DEFAULT 0,
          share_token TEXT UNIQUE,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }

    if (current < 2) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
        CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
        CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_owner_state_updated
          ON files(owner_id, is_trashed, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_trash_cleanup
          ON files(is_trashed, updated_at);
        CREATE INDEX IF NOT EXISTS idx_files_expiry
          ON files(expires_at) WHERE expires_at IS NOT NULL;
      `);
    }

    if (current < 3) {
      const columns = new Set(db.prepare("PRAGMA table_info(files)").all().map((column) => column.name));
      if (!columns.has("trashed_at")) db.exec("ALTER TABLE files ADD COLUMN trashed_at TEXT");
      db.exec(`
        UPDATE files SET trashed_at = updated_at
        WHERE is_trashed = 1 AND trashed_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_files_trashed_at
          ON files(trashed_at) WHERE is_trashed = 1;
      `);
    }

    if (current < 4) {
      const columns = new Set(db.prepare("PRAGMA table_info(files)").all().map((column) => column.name));
      if (!columns.has("access_version")) {
        db.exec("ALTER TABLE files ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0");
      }
    }

    if (current < 5) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_owner (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL UNIQUE
            REFERENCES users(id) ON DELETE RESTRICT,
          updated_at TEXT NOT NULL
        );
      `);
    }

    if (current < 6) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO settings_state (singleton, revision, updated_at)
        VALUES (1, 1, CURRENT_TIMESTAMP);
      `);
    }

    if (current < 7) {
      const columns = new Set(db.prepare("PRAGMA table_info(files)").all().map((column) => column.name));
      if (!columns.has("storage_backend_id")) {
        db.exec("ALTER TABLE files ADD COLUMN storage_backend_id TEXT NOT NULL DEFAULT 'local'");
      }
      if (!columns.has("storage_state")) {
        db.exec("ALTER TABLE files ADD COLUMN storage_state TEXT NOT NULL DEFAULT 'ready'");
      }
      if (!columns.has("content_hash")) {
        db.exec("ALTER TABLE files ADD COLUMN content_hash TEXT");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS storage_backends (
          id TEXT PRIMARY KEY,
          driver TEXT NOT NULL CHECK (driver IN ('local', 'webdav', 'smb')),
          label TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          secret_cipher TEXT,
          is_active INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_one_active
          ON storage_backends(is_active) WHERE is_active = 1;
        INSERT OR IGNORE INTO storage_backends
          (id, driver, label, config_json, secret_cipher, is_active, created_at, updated_at)
        VALUES ('local', 'local', '本地文件目录', '{}', NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        CREATE TABLE IF NOT EXISTS storage_reservations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          bytes INTEGER NOT NULL CHECK (bytes >= 0),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_storage_reservations_user
          ON storage_reservations(user_id, expires_at);
        CREATE INDEX IF NOT EXISTS idx_storage_reservations_expiry
          ON storage_reservations(expires_at);
        CREATE INDEX IF NOT EXISTS idx_files_storage_backend
          ON files(storage_backend_id, storage_state);
      `);
    }

    if (current < 8) {
      const userColumns = new Set(
        db.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
      );
      if (!userColumns.has("avatar_mime")) {
        db.exec("ALTER TABLE users ADD COLUMN avatar_mime TEXT");
      }
      if (!userColumns.has("avatar_data")) {
        db.exec("ALTER TABLE users ADD COLUMN avatar_data BLOB");
      }
      if (!userColumns.has("avatar_updated_at")) {
        db.exec("ALTER TABLE users ADD COLUMN avatar_updated_at TEXT");
      }

      const fileColumns = new Set(
        db.prepare("PRAGMA table_info(files)").all().map((column) => column.name)
      );
      if (!fileColumns.has("share_expires_at")) {
        db.exec("ALTER TABLE files ADD COLUMN share_expires_at TEXT");
      }

      db.exec(`
        UPDATE users SET quota = 21474836480
        WHERE quota IN (2147483648, 10737418240);

        CREATE INDEX IF NOT EXISTS idx_files_share_expiry
          ON files(share_expires_at) WHERE share_expires_at IS NOT NULL;

        CREATE TABLE IF NOT EXISTS user_webdav (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          config_json TEXT NOT NULL DEFAULT '{}',
          secret_cipher TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tickets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'closed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_user_updated
          ON tickets(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tickets_status_updated
          ON tickets(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ticket_messages (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created
          ON ticket_messages(ticket_id, created_at ASC);
      `);
    }

    if (current < 9) {
      const shareExpiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const sharedFiles = db.prepare(`
        SELECT id FROM files WHERE is_shared = 1
      `).all();
      const rotateShare = db.prepare(`
        UPDATE files
        SET share_token = ?, share_expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      for (const file of sharedFiles) {
        rotateShare.run(randomBytes(32).toString("base64url"), shareExpiry, file.id);
      }
    }

    if (current < 10) {
      const userColumns = new Set(
        db.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
      );
      if (!userColumns.has("username")) {
        db.exec("ALTER TABLE users ADD COLUMN username TEXT");
      }
      const used = new Set();
      const setUsername = db.prepare("UPDATE users SET username = ? WHERE id = ?");
      for (const user of db.prepare("SELECT id, name, email, username FROM users ORDER BY created_at, id").all()) {
        const existing = String(user.username || "").normalize("NFKC").trim().toLowerCase();
        const username = existing && !used.has(existing)
          ? existing
          : migrationUsername(user, used);
        used.add(username.toLowerCase());
        setUsername.run(username, user.id);
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
          ON users(username COLLATE NOCASE);
        UPDATE files
        SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')
        WHERE is_favorite = 0 AND expires_at IS NULL;
      `);
    }

    if (current < 11) {
      db.exec(`
        UPDATE files
        SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
        WHERE expires_at IS NOT NULL AND expires_at NOT LIKE '%T%';
      `);
    }

    if (current < 12) {
      const fileColumns = new Set(
        db.prepare("PRAGMA table_info(files)").all().map((column) => column.name)
      );
      if (!fileColumns.has("folder_id")) {
        db.exec("ALTER TABLE files ADD COLUMN folder_id TEXT");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          is_trashed INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT,
          trashed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_folders_owner_parent
          ON folders(owner_id, parent_id, is_trashed, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_folders_expiry
          ON folders(expires_at) WHERE expires_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_files_owner_folder
          ON files(owner_id, folder_id, is_trashed, updated_at DESC);
      `);
    }

    if (current < 13) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_webdav_connections (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          secret_cipher TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_user_webdav_connections_user_updated
          ON user_webdav_connections(user_id, updated_at DESC);
        INSERT OR IGNORE INTO user_webdav_connections
          (id, user_id, name, config_json, secret_cipher, enabled, created_at, updated_at)
        SELECT 'legacy-' || user_id, user_id, '个人 WebDAV', config_json,
          secret_cipher, enabled, created_at, updated_at
        FROM user_webdav
        WHERE enabled = 1;
      `);
    }

    if (current < 14) {
      const userColumns = new Set(
        db.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
      );
      if (!userColumns.has("avatar_preset")) {
        db.exec("ALTER TABLE users ADD COLUMN avatar_preset TEXT");
      }
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

migrate();

const now = () => new Date().toISOString();
const isProduction = process.env.NODE_ENV === "production";
const defaultAdminEmail = "admin@tieyun.local";
const defaultAdminPassword = "TieYun@2026";
const allowInsecureAdminCredentials = process.env.ALLOW_INSECURE_ADMIN_CREDENTIALS === "true";

const userCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count);
if (userCount === 0) {
  const adminEmail = String(process.env.ADMIN_EMAIL || defaultAdminEmail).trim().toLowerCase();
  const adminPassword = String(
    process.env.ADMIN_PASSWORD_FILE
      ? readFileSync(process.env.ADMIN_PASSWORD_FILE, "utf8").trim()
      : process.env.ADMIN_PASSWORD || defaultAdminPassword
  );
  if (Buffer.byteLength(adminPassword) > 72) {
    throw new Error("首次管理员密码不能超过 72 字节");
  }
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) && adminEmail.length <= 254;
  const isValidLocalAccount = /^[a-z0-9._-]{1,64}$/.test(adminEmail);
  if (!isValidEmail && !(allowInsecureAdminCredentials && isValidLocalAccount)) {
    throw new Error("ADMIN_EMAIL 必须是有效邮箱；仅在显式允许不安全凭据时可使用本地账号");
  }
  if (Buffer.byteLength(adminPassword) === 0) {
    throw new Error("首次管理员密码不能为空");
  }
  if (
    isProduction
    && !allowInsecureAdminCredentials
    && (
      (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_FILE)
      || adminPassword === defaultAdminPassword
      || Buffer.byteLength(adminPassword) < 12
    )
  ) {
    throw new Error("首次生产部署必须通过 ADMIN_PASSWORD 设置至少 12 字节且非默认值的管理员密码");
  }

  db.prepare(`
    INSERT INTO users
      (id, username, name, email, password_hash, role, status, quota, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?)
  `).run(
    "user-admin",
    (
      (adminEmail.includes("@") ? adminEmail.split("@")[0] : adminEmail)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .slice(0, 32)
      || "admin"
    ),
    "管理员",
    adminEmail,
    bcrypt.hashSync(adminPassword, 12),
    DEFAULT_USER_QUOTA,
    now(),
    now()
  );
}

const ownerRow = db.prepare("SELECT user_id FROM system_owner WHERE singleton = 1").get();
if (!ownerRow) {
  const candidate = db.prepare(`
    SELECT id FROM users
    WHERE role = 'admin' AND status = 'active'
    ORDER BY CASE WHEN id = 'user-admin' THEN 0 ELSE 1 END, created_at ASC, id ASC
    LIMIT 1
  `).get();
  if (!candidate) {
    throw new Error("数据库中没有可用管理员，无法确定唯一主管理员");
  }
  db.prepare(`
    INSERT INTO system_owner (singleton, user_id, updated_at) VALUES (1, ?, ?)
  `).run(candidate.id, now());
}
const activeOwner = db.prepare(`
  SELECT u.id FROM system_owner o
  JOIN users u ON u.id = o.user_id
  WHERE o.singleton = 1 AND u.role = 'admin' AND u.status = 'active'
`).get();
if (!activeOwner) {
  throw new Error("主管理员账户不存在、已停用或不再是管理员；请先恢复数据库");
}
db.exec(`
  CREATE TRIGGER IF NOT EXISTS protect_system_owner
  BEFORE UPDATE OF role, status ON users
  WHEN OLD.id = (SELECT user_id FROM system_owner WHERE singleton = 1)
    AND (NEW.role <> 'admin' OR NEW.status <> 'active')
  BEGIN
    SELECT RAISE(ABORT, 'system owner must remain an active admin');
  END;
`);

export const defaultSettings = Object.freeze({
  siteName: "云粘贴",
  siteSubtitle: "把灵感与文件，安全地放在一起",
  allowRegistration: true,
  maxUploadMb: 2048,
  defaultExpiryDays: 30,
  defaultShareDays: 7,
  defaultUserQuotaGb: 20,
  maxFilesPerUpload: 20,
  allowedTypes: "text,image,video,audio,document,archive,other",
  retentionDays: 30,
  expiryWarningDays: 7,
  allowPersonalWebdav: true,
  allowTickets: true
});

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), now());
}

const legacySiteName = db.prepare("SELECT value FROM settings WHERE key = 'siteName'").get();
if (legacySiteName?.value === JSON.stringify("贴云")) {
  db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'siteName'")
    .run(JSON.stringify(defaultSettings.siteName), now());
}

// Upgrade the original default so existing installations continue accepting generic files.
const legacyAllowed = db.prepare("SELECT value FROM settings WHERE key = 'allowedTypes'").get();
if (legacyAllowed?.value === JSON.stringify("text,image,video,audio,document,archive")) {
  db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'allowedTypes'")
    .run(JSON.stringify(defaultSettings.allowedTypes), now());
}

const shouldSeedDemo = !isProduction && process.env.SEED_DEMO_DATA !== "false";

if (shouldSeedDemo) {
  const demoAsset = join(rootDir, "public", "assets", "summer-wander.webp");
  const demoStored = "demo-summer-wander.webp";
  const posterPath = join(uploadDir, demoStored);
  if (existsSync(demoAsset) && !existsSync(posterPath)) copyFileSync(demoAsset, posterPath);

  const demoText = {
    "demo-product-release.md": "# 云粘贴 1.0 发布说明\n\n欢迎使用云粘贴。这个版本带来了多格式预览、团队空间、安全共享链接与更可靠的文件管理体验。\n\n- 支持文本、图片、音视频与 PDF\n- 支持多用户和权限管理\n- 支持 Docker 持久化部署\n",
    "demo-api-note.txt": "这是一个受保护的示例文本文件。\n请勿在真实环境中通过粘贴板传递长期有效的密钥。"
  };
  for (const [storedName, content] of Object.entries(demoText)) {
    const path = join(uploadDir, storedName);
    if (!existsSync(path)) writeFileSync(path, content, "utf8");
  }

  const demoFiles = [
    ["demo-md", "产品发布说明.md", "demo-product-release.md", "text/markdown", "text", 1, 0],
    ["demo-poster", "夏日活动主视觉.webp", demoStored, "image/webp", "image", 1, 1],
    ["demo-txt", "API 临时凭据.txt", "demo-api-note.txt", "text/plain", "text", 0, 0]
  ];
  const seedFile = db.prepare(`
    INSERT OR IGNORE INTO files
    (id, owner_id, name, stored_name, mime, size, kind, is_shared, is_favorite, share_token, created_at, updated_at)
    VALUES (?, 'user-admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [id, name, storedName, mimeType, kind, shared, favorite] of demoFiles) {
    const path = join(uploadDir, storedName);
    if (!existsSync(path)) continue;
    seedFile.run(
      id,
      name,
      storedName,
      mimeType,
      statSync(path).size,
      kind,
      shared,
      favorite,
      shared ? randomUUID().replaceAll("-", "").slice(0, 16) : null,
      now(),
      now()
    );
  }
}

// Old releases inserted metadata-only demo rows. They are not useful in a real file manager.
for (const id of ["demo-video", "demo-audio", "demo-pdf"]) {
  const row = db.prepare("SELECT stored_name FROM files WHERE id = ?").get(id);
  if (row && !existsSync(join(uploadDir, row.stored_name))) {
    db.prepare("DELETE FROM files WHERE id = ?").run(id);
  }
}

let settingsCache;

export function invalidateSettingsCache() {
  settingsCache = undefined;
}

function validStoredSetting(key, value) {
  if (typeof value !== typeof defaultSettings[key]) return false;
  if (key === "siteName") return value.trim().length >= 1 && value.length <= 60;
  if (key === "siteSubtitle") return value.length <= 160;
  if (key === "allowRegistration") return true;
  if (key === "allowPersonalWebdav" || key === "allowTickets") return true;
  if (key === "maxUploadMb") return Number.isInteger(value) && value >= 1 && value <= 10_240;
  if (key === "maxFilesPerUpload") return Number.isInteger(value) && value >= 1 && value <= 100;
  if (key === "defaultUserQuotaGb") return Number.isInteger(value) && value >= 1 && value <= 10_240;
  if (key === "defaultShareDays") return Number.isInteger(value) && value >= 1 && value <= 7;
  if (key === "defaultExpiryDays" || key === "retentionDays") {
    return Number.isInteger(value) && value >= 1 && value <= 3650;
  }
  if (key === "expiryWarningDays") return Number.isInteger(value) && value >= 3 && value <= 15;
  if (key === "allowedTypes") {
    const validKinds = new Set(["text", "image", "video", "audio", "document", "archive", "other"]);
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    return values.length > 0 && values.every((item) => validKinds.has(item));
  }
  return false;
}

export function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...defaultSettings };
    for (const row of db.prepare("SELECT key, value FROM settings").all()) {
      if (!(row.key in defaultSettings)) continue;
      try {
        const value = JSON.parse(row.value);
        if (validStoredSetting(row.key, value)) settingsCache[row.key] = value;
      } catch {
        // Keep the safe default when a manually edited setting is malformed.
      }
    }
  }
  return { ...settingsCache };
}

export function getSettingsRevision() {
  return Number(
    db.prepare("SELECT revision FROM settings_state WHERE singleton = 1").get()?.revision || 1
  );
}

export function getSystemOwnerId() {
  return db.prepare("SELECT user_id FROM system_owner WHERE singleton = 1").get()?.user_id || null;
}

export function isSystemOwner(userId) {
  return Boolean(userId && userId === getSystemOwnerId());
}

export function getUserUsage(userId) {
  // Trashed files still occupy the data volume and must count against quota.
  return Number(db.prepare(
    "SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE owner_id = ?"
  ).get(userId).total);
}

export function publicUser(row, { withUsage = true } = {}) {
  if (!row) return null;
  const {
    password_hash: _passwordHash,
    avatar_data: _avatarData,
    usage: joinedUsage,
    is_primary_admin: joinedPrimaryAdmin,
    ...safe
  } = row;
  const primaryAdmin = joinedPrimaryAdmin === undefined
    ? isSystemOwner(row.id)
    : Boolean(joinedPrimaryAdmin);
  const avatarUrl = row.avatar_mime
    ? `/api/users/${encodeURIComponent(row.id)}/avatar?v=${encodeURIComponent(row.avatar_updated_at || "")}`
    : row.avatar_preset
      ? `/api/avatar-presets/${encodeURIComponent(row.avatar_preset)}.png?v=3`
      : null;
  if (!withUsage) return { ...safe, avatarUrl, isPrimaryAdmin: primaryAdmin };
  return {
    ...safe,
    avatarUrl,
    isPrimaryAdmin: primaryAdmin,
    usage: joinedUsage === undefined ? getUserUsage(row.id) : Number(joinedUsage)
  };
}

export function listUsersWithUsage() {
  return db.prepare(`
    SELECT u.*, CASE WHEN o.user_id IS NULL THEN 0 ELSE 1 END AS is_primary_admin,
      COALESCE(SUM(f.size), 0) AS usage
    FROM users u
    LEFT JOIN files f ON f.owner_id = u.id
    LEFT JOIN system_owner o ON o.user_id = u.id
    GROUP BY u.id, o.user_id
    ORDER BY u.created_at DESC
  `).all().map((row) => publicUser(row));
}

export function closeDatabase() {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}
