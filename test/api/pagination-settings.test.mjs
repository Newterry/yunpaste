import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("分页与动态系统设置", { concurrency: false }, () => {
  let dataDir;
  let server;
  let admin;
  let member;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });

    const adminLogin = await loginAdmin(server);
    assert.equal(adminLogin.status, 200, adminLogin.text);
    admin = adminLogin.data;

    const registered = await registerUser(server, {
      name: "分页测试用户",
      email: "pagination@example.test"
    });
    assert.equal(registered.status, 201, registered.text);
    member = registered.data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("分页结果完整、无重复并具有稳定顺序", async () => {
    const prefix = `page-${crypto.randomUUID().slice(0, 8)}`;
    const createdIds = [];
    for (let index = 0; index < 13; index += 1) {
      const created = await server.requestJson("/api/files/paste", {
        method: "POST",
        token: member.token,
        json: {
          title: `${prefix}-${String(index).padStart(2, "0")}`,
          content: `pagination row ${index}`,
          format: "text"
        }
      });
      assert.equal(created.status, 201, created.text);
      createdIds.push(created.data.file.id);
    }

    const pages = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await server.requestJson(
        `/api/files?q=${encodeURIComponent(prefix)}&page=${page}&pageSize=5`,
        { token: member.token }
      );
      assert.equal(result.status, 200, result.text);
      assert.equal(result.data.page, page);
      assert.equal(result.data.pageSize, 5);
      assert.equal(result.data.total, 13);
      assert.equal(result.data.hasMore, page < 3);
      pages.push(result.data.files);
    }

    assert.deepEqual(pages.map((items) => items.length), [5, 5, 3]);
    const pagedIds = pages.flat().map((file) => file.id);
    assert.equal(new Set(pagedIds).size, 13);
    assert.deepEqual(new Set(pagedIds), new Set(createdIds));

    const fuzzy = prefix.replace("page", "pge");
    const fuzzyResult = await server.requestJson(
      `/api/files?q=${encodeURIComponent(fuzzy)}&pageSize=20`,
      { token: member.token }
    );
    assert.equal(fuzzyResult.status, 200, fuzzyResult.text);
    assert.equal(fuzzyResult.data.total, 13);

    const repeatedFirstPage = await server.requestJson(
      `/api/files?q=${encodeURIComponent(prefix)}&page=1&pageSize=5`,
      { token: member.token }
    );
    assert.deepEqual(
      repeatedFirstPage.data.files.map((file) => file.id),
      pages[0].map((file) => file.id)
    );

    const clamped = await server.requestJson(
      `/api/files?q=${encodeURIComponent(prefix)}&page=-5&pageSize=1000`,
      { token: member.token }
    );
    assert.equal(clamped.data.page, 1);
    assert.equal(clamped.data.pageSize, 100);
  });

  it("设置保存后立即影响注册、配置、上传类型和单文件上限", async () => {
    const nonAdmin = await server.requestJson("/api/settings", {
      token: member.token
    });
    assert.equal(nonAdmin.status, 403);

    const saved = await server.requestJson("/api/settings", {
      method: "PUT",
      token: admin.token,
      json: {
        siteName: "云粘贴回归测试",
        allowRegistration: false,
        maxUploadMb: 1,
        defaultExpiryDays: 2,
        allowedTypes: " text, text ",
        retentionDays: 1
      }
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.data.settings.siteName, "云粘贴回归测试");
    assert.equal(saved.data.settings.allowRegistration, false);
    assert.equal(saved.data.settings.maxUploadMb, 1);
    assert.equal(saved.data.settings.allowedTypes, "text");

    const config = await server.requestJson("/api/config");
    assert.equal(config.status, 200, config.text);
    assert.equal(config.data.config.siteName, "云粘贴回归测试");
    assert.equal(config.data.config.allowRegistration, false);
    assert.equal(config.data.config.maxUploadMb, 1);
    assert.equal(config.data.config.allowedTypes, "text");

    const blockedRegistration = await registerUser(server, {
      name: "被阻止用户",
      email: "registration-blocked@example.test"
    });
    assert.equal(blockedRegistration.status, 403);

    const beforeRejectedUploads = await readdir(join(dataDir, "uploads"));
    const rejectedImage = await server.upload(member.token, {
      name: "not-allowed.png",
      type: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
    });
    assert.equal(rejectedImage.status, 415, rejectedImage.text);

    const oversized = await server.upload(member.token, {
      name: "too-large.txt",
      type: "text/plain",
      bytes: Buffer.alloc(1024 * 1024 + 1, 0x61)
    });
    assert.equal(oversized.status, 413, oversized.text);
    const afterRejectedUploads = await readdir(join(dataDir, "uploads"));
    assert.deepEqual(
      [...afterRejectedUploads].sort(),
      [...beforeRejectedUploads].sort(),
      "rejected uploads must not leave temporary files"
    );

    const accepted = await server.upload(member.token, {
      name: "allowed.txt",
      type: "text/plain",
      bytes: Buffer.from("allowed after dynamic settings update")
    });
    assert.equal(accepted.status, 201, accepted.text);
  });

  it("默认过期时间动态生效，非法设置不会覆盖有效值", async () => {
    const before = Date.now();
    const created = await server.requestJson("/api/files/paste", {
      method: "POST",
      token: member.token,
      json: {
        title: "default-expiry",
        content: "uses the configured default",
        format: "text"
      }
    });
    const after = Date.now();
    assert.equal(created.status, 201, created.text);
    const expiry = Date.parse(created.data.file.expires_at);
    assert.ok(expiry >= before + 2 * 86_400_000 - 2_000);
    assert.ok(expiry <= after + 2 * 86_400_000 + 2_000);

    const invalidPaste = await server.requestJson("/api/files/paste", {
      method: "POST",
      token: member.token,
      json: { title: "invalid", content: { nested: true }, expiresInDays: "2" }
    });
    assert.equal(invalidPaste.status, 400);

    const invalid = await server.requestJson("/api/settings", {
      method: "PUT",
      token: admin.token,
      json: { maxUploadMb: 0 }
    });
    assert.equal(invalid.status, 400);

    for (const invalidPayload of [
      { allowRegistration: "false" },
      { maxUploadMb: "2" },
      { allowedTypes: ["text"] },
      { unknownSetting: true }
    ]) {
      const invalidType = await server.requestJson("/api/settings", {
        method: "PUT",
        token: admin.token,
        json: invalidPayload
      });
      assert.equal(invalidType.status, 400, JSON.stringify(invalidPayload));
    }

    const unchanged = await server.requestJson("/api/config");
    assert.equal(unchanged.data.config.maxUploadMb, 1);

    const reopened = await server.requestJson("/api/settings", {
      method: "PUT",
      token: admin.token,
      json: { allowRegistration: true }
    });
    assert.equal(reopened.status, 200, reopened.text);

    const newlyRegistered = await registerUser(server, {
      name: "重新开放用户",
      email: "registration-reopened@example.test"
    });
    assert.equal(newlyRegistered.status, 201, newlyRegistered.text);
  });
});
