import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("认证与用户数据隔离", { concurrency: false }, () => {
  let dataDir;
  let server;
  let admin;
  let userA;
  let userB;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });

    const adminLogin = await loginAdmin(server);
    assert.equal(adminLogin.status, 200, adminLogin.text);
    admin = adminLogin.data;

    const registeredA = await registerUser(server, {
      name: "隔离用户 A",
      email: "isolation-a@example.test"
    });
    assert.equal(registeredA.status, 201, registeredA.text);
    userA = registeredA.data;

    const registeredB = await registerUser(server, {
      name: "隔离用户 B",
      email: "isolation-b@example.test"
    });
    assert.equal(registeredB.status, 201, registeredB.text);
    userB = registeredB.data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("注册、登录和会话响应不泄露密码字段", async () => {
    assert.ok(userA.token);
    assert.equal(userA.user.role, "member");
    assert.equal(Object.hasOwn(userA.user, "password_hash"), false);

    const wrongLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: "isolation-a@example.test", password: "not-the-password" }
    });
    assert.equal(wrongLogin.status, 401);

    const me = await server.requestJson("/api/auth/me", { token: userA.token });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.data.user.id, userA.user.id);
    assert.equal(Object.hasOwn(me.data.user, "password_hash"), false);

    const missingToken = await server.requestJson("/api/files");
    assert.equal(missingToken.status, 401);

    const malformedLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: ["isolation-a@example.test"], password: {} }
    });
    assert.equal(malformedLogin.status, 400);

    const unknownApi = await server.requestJson("/api/does-not-exist");
    assert.equal(unknownApi.status, 404);
    assert.equal(unknownApi.data.error, "API 端点不存在");
  });

  it("停用账户会立即使已有会话失效，重新启用后恢复", async () => {
    const disabled = await server.requestJson(`/api/admin/users/${userB.user.id}`, {
      method: "PATCH",
      token: admin.token,
      json: { status: "disabled" }
    });
    assert.equal(disabled.status, 200, disabled.text);
    assert.equal(disabled.data.user.status, "disabled");

    const denied = await server.requestJson("/api/auth/me", { token: userB.token });
    assert.equal(denied.status, 401);

    const enabled = await server.requestJson(`/api/admin/users/${userB.user.id}`, {
      method: "PATCH",
      token: admin.token,
      json: { status: "active" }
    });
    assert.equal(enabled.status, 200, enabled.text);

    const restored = await server.requestJson("/api/auth/me", { token: userB.token });
    assert.equal(restored.status, 200, restored.text);
  });

  it("共享文件仍保持登录用户之间的数据隔离", async () => {
    const payload = Buffer.from("private bytes owned by user A", "utf8");
    const uploaded = await server.upload(userA.token, {
      name: "user-a-private.txt",
      bytes: payload
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];

    const shared = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: userA.token,
      json: { is_shared: 1 }
    });
    assert.equal(shared.status, 200, shared.text);
    assert.ok(shared.data.file.share_token);

    const ownList = await server.requestJson("/api/files?q=user-a-private", {
      token: userA.token
    });
    assert.equal(ownList.status, 200, ownList.text);
    assert.deepEqual(ownList.data.files.map((item) => item.id), [file.id]);

    const otherList = await server.requestJson("/api/files?q=user-a-private", {
      token: userB.token
    });
    assert.equal(otherList.status, 200, otherList.text);
    assert.equal(otherList.data.total, 0);
    assert.deepEqual(otherList.data.files, []);

    const attempts = [
      server.requestJson(`/api/files/${file.id}`, {
        method: "PATCH",
        token: userB.token,
        json: { name: "should-not-change.txt" }
      }),
      server.requestJson(`/api/files/${file.id}`, {
        method: "DELETE",
        token: userB.token
      }),
      server.requestJson(`/api/files/${file.id}/access`, {
        method: "POST",
        token: userB.token
      })
    ];
    const [patchAttempt, deleteAttempt, accessAttempt] = await Promise.all(attempts);
    assert.equal(patchAttempt.status, 404);
    assert.equal(deleteAttempt.status, 404);
    assert.equal(accessAttempt.status, 404);

    const rawAttempt = await fetch(`${server.baseUrl}/api/files/${file.id}/raw`, {
      headers: { Authorization: `Bearer ${userB.token}` }
    });
    assert.equal(rawAttempt.status, 404);

    const downloadAttempt = await fetch(`${server.baseUrl}/api/files/${file.id}/download`, {
      headers: { Authorization: `Bearer ${userB.token}` }
    });
    assert.equal(downloadAttempt.status, 404);

    const stillOwned = await server.requestJson(`/api/files?q=user-a-private`, {
      token: userA.token
    });
    assert.equal(stillOwned.data.total, 1);
    assert.equal(stillOwned.data.files[0].name, "user-a-private.txt");

    const invalidBoolean = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: userA.token,
      json: { is_shared: "false" }
    });
    assert.equal(invalidBoolean.status, 400);
  });

  it("管理员也不能查看成员文件或通过范围参数绕过隔离", async () => {
    const ownScope = await server.requestJson("/api/files?q=user-a-private", {
      token: admin.token
    });
    assert.equal(ownScope.status, 200, ownScope.text);
    assert.equal(ownScope.data.total, 0);

    const allUsers = await server.requestJson(
      "/api/files?q=user-a-private&scope=all-users",
      { token: admin.token }
    );
    assert.equal(allUsers.status, 200, allUsers.text);
    assert.equal(allUsers.data.total, 0);

    const memberFiles = await server.requestJson("/api/files?q=user-a-private", {
      token: userA.token
    });
    const memberFileId = memberFiles.data.files[0].id;
    const adminAccess = await server.requestJson(`/api/files/${memberFileId}/access`, {
      method: "POST",
      token: admin.token
    });
    assert.equal(adminAccess.status, 404);

    const forgedScope = await server.requestJson(
      "/api/files?q=user-a-private&scope=all-users",
      { token: userB.token }
    );
    assert.equal(forgedScope.status, 200, forgedScope.text);
    assert.equal(forgedScope.data.total, 0);
  });
});
