import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir, createTestDataDir, loginAdmin, registerUser, startTieYun
} from "../helpers/server-fixture.mjs";

describe("文件管理器、账号生命周期与 WebDAV 浏览边界", { concurrency: false }, () => {
  let dataDir;
  let server;
  let adminToken;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });
    adminToken = (await loginAdmin(server)).data.token;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("文件夹、移动和递归复制始终限定在当前用户", async () => {
    const owner = await registerUser(server, { email: "folders-owner@example.test" });
    const stranger = await registerUser(server, { email: "folders-stranger@example.test" });
    const ownerToken = owner.data.token;

    const root = await server.requestJson("/api/folders", {
      method: "POST", token: ownerToken, json: { name: "项目资料" }
    });
    assert.equal(root.status, 201, root.text);
    const rootId = root.data.folder.id;
    const child = await server.requestJson("/api/folders", {
      method: "POST", token: ownerToken, json: { name: "图片", parentId: rootId }
    });
    assert.equal(child.status, 201, child.text);

    const paste = await server.requestJson("/api/files/paste", {
      method: "POST",
      token: ownerToken,
      json: { title: "project-plan", content: "folder-private", format: "text", folderId: child.data.folder.id }
    });
    assert.equal(paste.status, 201, paste.text);

    const childList = await server.requestJson(`/api/files?folderId=${child.data.folder.id}`, { token: ownerToken });
    assert.equal(childList.status, 200, childList.text);
    assert.equal(childList.data.files.length, 1);
    assert.deepEqual(childList.data.breadcrumbs.map((crumb) => crumb.name), ["项目资料", "图片"]);

    const invisible = await server.requestJson(`/api/files?folderId=${child.data.folder.id}`, { token: stranger.data.token });
    assert.equal(invisible.status, 404, invisible.text);
    const patchAttempt = await server.requestJson(`/api/folders/${rootId}`, {
      method: "PATCH", token: stranger.data.token, json: { name: "越权" }
    });
    assert.equal(patchAttempt.status, 404, patchAttempt.text);

    const copied = await server.requestJson("/api/file-operations", {
      method: "POST",
      token: ownerToken,
      json: { action: "copy", fileIds: [], folderIds: [rootId], targetFolderId: null }
    });
    assert.equal(copied.status, 201, copied.text);
    const rootList = await server.requestJson("/api/files", { token: ownerToken });
    assert.equal(rootList.status, 200, rootList.text);
    assert.equal(rootList.data.folders.length, 2);
    assert(rootList.data.folders.some((folder) => folder.name.includes("副本")));

    const moved = await server.requestJson("/api/file-operations", {
      method: "POST",
      token: ownerToken,
      json: { action: "move", fileIds: [paste.data.file.id], folderIds: [], targetFolderId: null }
    });
    assert.equal(moved.status, 200, moved.text);
    const search = await server.requestJson("/api/files?q=prjct", { token: ownerToken });
    assert.equal(search.status, 200, search.text);
    assert(search.data.files.some((file) => file.name === "project-plan.txt"));
  });

  it("用户可修改邮箱和注销自己，管理员可删除其他账号", async () => {
    const member = await registerUser(server, { email: "old-email@example.test", password: "Member-Test-2026" });
    const changed = await server.requestJson("/api/profile", {
      method: "PATCH",
      token: member.data.token,
      json: { email: "new-email@example.test", currentPassword: "Member-Test-2026" }
    });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.data.user.email, "new-email@example.test");
    const login = await server.requestJson("/api/auth/login", {
      method: "POST", json: { email: "new-email@example.test", password: "Member-Test-2026" }
    });
    assert.equal(login.status, 200, login.text);

    const deleted = await server.requestJson(`/api/admin/users/${member.data.user.id}`, {
      method: "DELETE", token: adminToken
    });
    assert.equal(deleted.status, 204, deleted.text);
    assert.equal((await server.requestJson("/api/auth/me", { token: login.data.token })).status, 401);

    const self = await registerUser(server, { email: "self-delete@example.test", password: "Member-Test-2026" });
    const selfDeleted = await server.requestJson("/api/profile", {
      method: "DELETE",
      token: self.data.token,
      json: { password: "Member-Test-2026", confirmation: "DELETE" }
    });
    assert.equal(selfDeleted.status, 204, selfDeleted.text);
    assert.equal((await server.requestJson("/api/auth/me", { token: self.data.token })).status, 401);
  });

  it("未启用个人 WebDAV 时文件浏览明确提示先保存启用", async () => {
    const member = await registerUser(server, { email: "webdav-browser@example.test" });
    const settings = await server.requestJson("/api/webdav", { token: member.data.token });
    assert.equal(settings.status, 200, settings.text);
    assert.deepEqual(settings.data.connections, []);
    const result = await server.requestJson("/api/webdav/files", { token: member.data.token });
    assert.equal(result.status, 409, result.text);
    assert.match(result.data.error, /保存并启用/);
    const missing = await server.requestJson("/api/webdav/files?connectionId=missing-connection", { token: member.data.token });
    assert.equal(missing.status, 404, missing.text);
    assert.match(missing.data.error, /连接不存在/);
  });
});
