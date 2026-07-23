import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun,
  waitFor
} from "../helpers/server-fixture.mjs";

function quickCheck(dataDir) {
  const database = new DatabaseSync(join(dataDir, "tieyun.db"));
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const result = database.prepare("PRAGMA quick_check").get();
    return Object.values(result)[0];
  } finally {
    database.close();
  }
}

describe("维护任务、优雅停机与数据库完整性", { concurrency: false }, () => {
  let dataDir;
  let server;
  let admin;
  let member;
  let oldTrash;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });

    const adminLogin = await loginAdmin(server);
    assert.equal(adminLogin.status, 200, adminLogin.text);
    admin = adminLogin.data;

    const registered = await registerUser(server, {
      name: "生命周期用户",
      email: "lifecycle@example.test"
    });
    assert.equal(registered.status, 201, registered.text);
    member = registered.data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("准备超过保留期的回收站文件", async () => {
    const settings = await server.requestJson("/api/settings", {
      method: "PUT",
      token: admin.token,
      json: { retentionDays: 1 }
    });
    assert.equal(settings.status, 200, settings.text);

    const uploaded = await server.upload(member.token, {
      name: "maintenance-old-trash.txt",
      bytes: Buffer.from("old trash should be purged")
    });
    assert.equal(uploaded.status, 201, uploaded.text);

    const trashed = await server.requestJson(`/api/files/${uploaded.data.files[0].id}`, {
      method: "PATCH",
      token: member.token,
      json: { is_trashed: 1 }
    });
    assert.equal(trashed.status, 200, trashed.text);
    oldTrash = trashed.data.file;

    const database = new DatabaseSync(join(dataDir, "tieyun.db"));
    try {
      database.exec("PRAGMA busy_timeout = 5000");
      oldTrash.stored_name = database.prepare("SELECT stored_name FROM files WHERE id = ?")
        .get(oldTrash.id).stored_name;
      database.prepare("UPDATE files SET trashed_at = ? WHERE id = ?").run(
        new Date(Date.now() - 2 * 86_400_000).toISOString(),
        oldTrash.id
      );
    } finally {
      database.close();
    }

    assert.equal(existsSync(join(dataDir, "uploads", oldTrash.stored_name)), true);
  });

  it("SIGTERM 以退出码 0 完成排空，并留下通过 quick_check 的数据库", async () => {
    const health = await server.requestJson("/health");
    assert.equal(health.status, 200, health.text);

    const stopped = await server.stop("SIGTERM");
    assert.equal(stopped.timedOut, false, server.stderr);
    assert.equal(stopped.code, 0, server.stderr);
    assert.equal(stopped.signal, null);
    assert.match(server.stdout, /received SIGTERM; draining connections/);
    assert.equal(quickCheck(dataDir), "ok");
  });

  it("同一数据目录重启后会话仍有效，并清理过期回收站文件", async () => {
    server = await startTieYun({ dataDir });

    const restoredSession = await server.requestJson("/api/auth/me", {
      token: member.token
    });
    assert.equal(restoredSession.status, 200, restoredSession.text);
    assert.equal(restoredSession.data.user.id, member.user.id);

    const cleaned = await waitFor(async () => {
      const trash = await server.requestJson(
        "/api/files?view=trash&q=maintenance-old-trash",
        { token: member.token }
      );
      return trash.status === 200 && trash.data.total === 0;
    }, { timeoutMs: 5_000, intervalMs: 75 });
    assert.equal(cleaned, true, "startup maintenance did not purge retained trash");

    assert.equal(existsSync(join(dataDir, "uploads", oldTrash.stored_name)), false);
    const access = await server.requestJson(`/api/files/${oldTrash.id}/access`, {
      method: "POST",
      token: member.token
    });
    assert.equal(access.status, 404);
  });

  it("SIGINT 也能优雅退出并保持 SQLite 完整", async () => {
    const stopped = await server.stop("SIGINT");
    assert.equal(stopped.timedOut, false, server.stderr);
    assert.equal(stopped.code, 0, server.stderr);
    assert.equal(stopped.signal, null);
    assert.match(server.stdout, /received SIGINT; draining connections/);
    assert.equal(quickCheck(dataDir), "ok");
  });
});
