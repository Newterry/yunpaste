import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("管理增强、保留期、分享与工单", { concurrency: false }, () => {
  let dataDir;
  let server;
  let admin;
  let member;
  let secondMember;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });
    admin = (await loginAdmin(server)).data;
    member = (await registerUser(server, {
      name: "管理增强用户",
      email: "management-member@example.test",
      password: "Member-Original-2026"
    })).data;
    secondMember = (await registerUser(server, {
      name: "角色测试用户",
      email: "role-member@example.test"
    })).data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("新用户固定为普通用户并默认获得 20GB 配额，可修改资料和密码", async () => {
    assert.equal(member.user.role, "member");
    assert.equal(member.user.quota, 20 * 1024 ** 3);

    const renamed = await server.requestJson("/api/profile", {
      method: "PATCH",
      token: member.token,
      json: { username: "management.member", name: "新的显示名称" }
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.data.user.name, "新的显示名称");
    assert.equal(renamed.data.user.username, "management.member");

    const avatar = await server.requestJson("/api/profile/avatar/preset", {
      method: "POST",
      token: member.token,
      json: { preset: "panda" }
    });
    assert.equal(avatar.status, 200, avatar.text);
    assert.equal(avatar.data.user.avatarUrl, "/api/avatar-presets/panda.png?v=3");
    assert.equal(avatar.data.user.avatar_preset, "panda");
    const presetImage = await fetch(`${server.baseUrl}/api/avatar-presets/panda.png`);
    assert.equal(presetImage.status, 200);
    assert.match(presetImage.headers.get("content-type") || "", /image\/png/);
    const presetBytes = new Uint8Array(await presetImage.arrayBuffer());
    assert.deepEqual([...presetBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const invalidAvatar = await server.requestJson("/api/profile/avatar/preset", {
      method: "POST",
      token: member.token,
      json: { preset: "../../not-a-preset" }
    });
    assert.equal(invalidAvatar.status, 400);

    const wrongPassword = await server.requestJson("/api/profile/password", {
      method: "PATCH",
      token: member.token,
      json: { currentPassword: "wrong-password", newPassword: "Member-New-2026" }
    });
    assert.equal(wrongPassword.status, 403);

    const changed = await server.requestJson("/api/profile/password", {
      method: "PATCH",
      token: member.token,
      json: {
        currentPassword: "Member-Original-2026",
        newPassword: "Member-New-2026"
      }
    });
    assert.equal(changed.status, 200, changed.text);

    const oldLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: "management-member@example.test", password: "Member-Original-2026" }
    });
    const newLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: "management-member@example.test", password: "Member-New-2026" }
    });
    const usernameLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: "management.member", password: "Member-New-2026" }
    });
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 200, newLogin.text);
    assert.equal(usernameLogin.status, 200, usernameLogin.text);
  });

  it("管理员可授权其他管理员，获授权管理员可以继续管理用户角色", async () => {
    const promoted = await server.requestJson(`/api/admin/users/${member.user.id}`, {
      method: "PATCH",
      token: admin.token,
      json: { role: "admin" }
    });
    assert.equal(promoted.status, 200, promoted.text);
    assert.equal(promoted.data.user.role, "admin");

    const changedByAdmin = await server.requestJson(`/api/admin/users/${secondMember.user.id}`, {
      method: "PATCH",
      token: member.token,
      json: { role: "admin" }
    });
    assert.equal(changedByAdmin.status, 200, changedByAdmin.text);
    assert.equal(changedByAdmin.data.user.role, "admin");
  });

  it("普通文件有保留期，收藏永久保留，分享令牌高熵且最长 7 天", async () => {
    const uploaded = await server.upload(member.token, {
      name: "retention-and-share.txt",
      bytes: "retention"
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];
    assert.ok(Date.parse(file.expires_at) > Date.now());

    const favorited = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: member.token,
      json: { is_favorite: 1 }
    });
    assert.equal(favorited.status, 200, favorited.text);
    assert.equal(favorited.data.file.expires_at, null);

    const unfavorited = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: member.token,
      json: { is_favorite: 0 }
    });
    assert.equal(unfavorited.status, 200, unfavorited.text);
    assert.ok(Date.parse(unfavorited.data.file.expires_at) > Date.now());

    const shareExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const shared = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: member.token,
      json: { is_shared: 1, share_expires_at: shareExpiry }
    });
    assert.equal(shared.status, 200, shared.text);
    assert.match(shared.data.file.share_token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(shared.data.file.share_expires_at, shareExpiry);

    const tooLong = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: member.token,
      json: { share_expires_at: new Date(Date.now() + 8 * 86_400_000).toISOString() }
    });
    assert.equal(tooLong.status, 400);

    const overview = await server.requestJson("/api/overview", { token: member.token });
    assert.equal(overview.status, 200, overview.text);
    assert.equal(overview.data.overview.totalFiles, 1);
    assert.equal(overview.data.overview.activeShares, 1);
  });

  it("概览最近内容支持服务端分页和类型筛选", async () => {
    for (let index = 0; index < 5; index += 1) {
      const uploaded = await server.upload(member.token, {
        name: `overview-${index}.txt`,
        bytes: `overview-${index}`
      });
      assert.equal(uploaded.status, 201, uploaded.text);
    }
    const image = await server.upload(member.token, {
      name: "overview-image.png",
      type: "image/png",
      bytes: Buffer.from("not-a-rendered-image")
    });
    assert.equal(image.status, 201, image.text);

    const first = await server.requestJson("/api/overview?page=1&pageSize=3&filter=all", { token: member.token });
    const second = await server.requestJson("/api/overview?page=2&pageSize=3&filter=all", { token: member.token });
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    assert.equal(first.data.overview.recent.length, 3);
    assert.equal(second.data.overview.recent.length, 3);
    assert.equal(first.data.overview.recentTotal, 7);
    assert.equal(second.data.overview.recentPage, 2);
    assert.equal(second.data.overview.recentPageSize, 3);
    assert.notDeepEqual(
      first.data.overview.recent.map((file) => file.id),
      second.data.overview.recent.map((file) => file.id)
    );

    const images = await server.requestJson("/api/overview?page=1&pageSize=5&filter=image", { token: member.token });
    assert.equal(images.status, 200, images.text);
    assert.equal(images.data.overview.recentTotal, 1);
    assert.equal(images.data.overview.recent[0].kind, "image");
  });

  it("用户可提交工单，管理员可回复和关闭，配置导出不包含凭据", async () => {
    const created = await server.requestJson("/api/tickets", {
      method: "POST",
      token: member.token,
      json: { subject: "预览问题", message: "PDF 预览需要帮助。" }
    });
    assert.equal(created.status, 201, created.text);
    const ticketId = created.data.ticket.id;

    const replied = await server.requestJson(`/api/tickets/${ticketId}/messages`, {
      method: "POST",
      token: admin.token,
      json: { message: "管理员已经收到，会继续排查。" }
    });
    assert.equal(replied.status, 201, replied.text);
    assert.equal(replied.data.ticket.messages.length, 2);

    const closed = await server.requestJson(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      token: admin.token,
      json: { status: "closed" }
    });
    assert.equal(closed.status, 200, closed.text);
    assert.equal(closed.data.ticket.status, "closed");

    const exported = await server.requestJson("/api/settings/export", { token: admin.token });
    assert.equal(exported.status, 200, exported.text);
    assert.equal(exported.data.format, "yunpaste-config");
    assert.equal(exported.data.storage.credentialsIncluded, false);
    assert.equal(JSON.stringify(exported.data).includes("password"), false);
  });
});
