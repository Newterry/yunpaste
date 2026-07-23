import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("主管理员、设置并发与存储安全", { concurrency: false }, () => {
  it("只有主管理员能改名，设置修订号会阻止并发覆盖", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      server = await startTieYun({ dataDir });
      const primary = await loginAdmin(server);
      const secondary = await registerUser(server, {
        name: "第二管理员",
        email: "secondary-admin@example.test"
      });
      assert.equal(primary.status, 200, primary.text);
      assert.equal(primary.data.user.isPrimaryAdmin, true);
      assert.equal(secondary.status, 201, secondary.text);

      const promoted = await server.requestJson(`/api/admin/users/${secondary.data.user.id}`, {
        method: "PATCH",
        token: primary.data.token,
        json: { role: "admin" }
      });
      assert.equal(promoted.status, 200, promoted.text);
      assert.equal(promoted.data.user.role, "admin");
      assert.equal(promoted.data.user.isPrimaryAdmin, false);

      const primarySettings = await server.requestJson("/api/settings", {
        token: primary.data.token
      });
      const secondarySettings = await server.requestJson("/api/settings", {
        token: secondary.data.token
      });
      assert.equal(primarySettings.data.permissions.canRenameSite, true);
      assert.equal(secondarySettings.data.permissions.canRenameSite, false);
      assert.equal(primarySettings.data.revision, secondarySettings.data.revision);

      const forbiddenRename = await server.requestJson("/api/settings", {
        method: "PATCH",
        token: secondary.data.token,
        json: {
          revision: secondarySettings.data.revision,
          patch: { siteName: "不应生效的名称" }
        }
      });
      assert.equal(forbiddenRename.status, 403, forbiddenRename.text);

      const secondaryUpdate = await server.requestJson("/api/settings", {
        method: "PATCH",
        token: secondary.data.token,
        json: {
          revision: secondarySettings.data.revision,
          patch: { siteSubtitle: "由第二管理员安全更新" }
        }
      });
      assert.equal(secondaryUpdate.status, 200, secondaryUpdate.text);

      const stalePrimaryUpdate = await server.requestJson("/api/settings", {
        method: "PATCH",
        token: primary.data.token,
        json: {
          revision: primarySettings.data.revision,
          patch: { siteName: "过期版本不应覆盖" }
        }
      });
      assert.equal(stalePrimaryUpdate.status, 409, stalePrimaryUpdate.text);

      const renamed = await server.requestJson("/api/settings", {
        method: "PATCH",
        token: primary.data.token,
        json: {
          revision: secondaryUpdate.data.revision,
          patch: { siteName: "云粘贴团队版" }
        }
      });
      assert.equal(renamed.status, 200, renamed.text);
      assert.equal(renamed.data.settings.siteName, "云粘贴团队版");
      assert.equal(renamed.data.settings.siteSubtitle, "由第二管理员安全更新");

      const primaryDemotion = await server.requestJson(
        `/api/admin/users/${primary.data.user.id}`,
        {
          method: "PATCH",
          token: primary.data.token,
          json: { role: "member" }
        }
      );
      assert.equal(primaryDemotion.status, 400, primaryDemotion.text);

      const secondaryRoleChange = await server.requestJson(
        `/api/admin/users/${primary.data.user.id}`,
        {
          method: "PATCH",
          token: secondary.data.token,
          json: { role: "member" }
        }
      );
      assert.equal(secondaryRoleChange.status, 403, secondaryRoleChange.text);
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });

  it("管理接口返回脱敏存储配置和真实数据库加密状态", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      server = await startTieYun({ dataDir });
      const primary = await loginAdmin(server);

      const storage = await server.requestJson("/api/admin/storage", {
        token: primary.data.token
      });
      assert.equal(storage.status, 200, storage.text);
      assert.equal(storage.data.storage.driver, "local");
      assert.equal(storage.data.storage.credentialsConfigured, false);
      assert.deepEqual(storage.data.storage.paths, {
        configDir: "/config",
        filesDir: "/files"
      });
      assert.equal(storage.data.storage.status.state, "connected");
      assert.equal(JSON.stringify(storage.data).includes("password"), false);

      const tested = await server.requestJson("/api/admin/storage/test", {
        method: "POST",
        token: primary.data.token,
        json: { driver: "local", config: {} }
      });
      assert.equal(tested.status, 200, tested.text);
      assert.equal(tested.data.status.state, "connected");

      const saved = await server.requestJson("/api/admin/storage", {
        method: "PUT",
        token: primary.data.token,
        json: { driver: "local", config: {} }
      });
      assert.equal(saved.status, 200, saved.text);
      assert.equal(saved.data.storage.driver, "local");

      const insecureWebDav = await server.requestJson("/api/admin/storage/test", {
        method: "POST",
        token: primary.data.token,
        json: {
          driver: "webdav",
          config: { url: "http://dav.example.test/", vendor: "other" }
        }
      });
      assert.equal(insecureWebDav.status, 400, insecureWebDav.text);

      const incompleteSmb = await server.requestJson("/api/admin/storage/test", {
        method: "POST",
        token: primary.data.token,
        json: {
          driver: "smb",
          config: { host: "nas.example.test", share: "documents", username: "" }
        }
      });
      assert.equal(incompleteSmb.status, 400, incompleteSmb.text);

      const security = await server.requestJson("/api/admin/security", {
        token: primary.data.token
      });
      assert.equal(security.status, 200, security.text);
      assert.equal(security.data.databaseEncryption.enabled, false);
      assert.equal(security.data.databaseEncryption.state, "disabled");
      assert.equal(security.data.jwtSecret.managed, true);
      assert.equal(security.data.filesEncrypted, false);
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });
});
