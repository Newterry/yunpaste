import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  startTieYun
} from "../helpers/server-fixture.mjs";

test("旧版 schema 会在事务中迁移到当前版本", async () => {
  const dataDir = await createTestDataDir();
  let server;
  try {
    await mkdir(join(dataDir, "uploads"), { recursive: true });
    const legacy = new DatabaseSync(join(dataDir, "tieyun.db"));
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        quota INTEGER NOT NULL DEFAULT 2147483648,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE files (
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
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
    legacy.close();

    server = await startTieYun({ dataDir });
    const stopped = await server.stop("SIGTERM");
    assert.equal(stopped.code, 0, server.stderr);

    const migrated = new DatabaseSync(join(dataDir, "tieyun.db"));
    try {
      const version = migrated.prepare("PRAGMA user_version").get().user_version;
      const columns = new Set(
        migrated.prepare("PRAGMA table_info(files)").all().map((column) => column.name)
      );
      assert.equal(version, 14);
      assert.equal(columns.has("trashed_at"), true);
      assert.equal(columns.has("access_version"), true);
      assert.equal(columns.has("storage_backend_id"), true);
      assert.equal(columns.has("storage_state"), true);
      assert.equal(columns.has("content_hash"), true);
      assert.equal(columns.has("folder_id"), true);
      const userColumns = new Set(
        migrated.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
      );
      assert.equal(userColumns.has("avatar_preset"), true);
      assert.equal(
        migrated.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'folders'").get().count,
        1
      );
      assert.equal(
        migrated.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'user_webdav_connections'").get().count,
        1
      );
      assert.equal(
        migrated.prepare("SELECT user_id FROM system_owner WHERE singleton = 1").get().user_id,
        "user-admin"
      );
      assert.equal(
        migrated.prepare("SELECT COUNT(*) AS count FROM storage_backends").get().count,
        1
      );
      assert.equal(Object.values(migrated.prepare("PRAGMA quick_check").get())[0], "ok");
    } finally {
      migrated.close();
    }
  } finally {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  }
});

test("程序拒绝打开由更高版本创建的数据卷", async () => {
  const dataDir = await createTestDataDir();
  try {
    const future = new DatabaseSync(join(dataDir, "tieyun.db"));
    future.exec("PRAGMA user_version = 99");
    future.close();
    await assert.rejects(
      startTieYun({ dataDir }),
      /schema 版本 99 高于当前程序支持的 14/
    );
  } finally {
    await cleanupTestDataDir(dataDir);
  }
});
