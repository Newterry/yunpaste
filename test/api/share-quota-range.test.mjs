import assert from "node:assert/strict";
import { readdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("共享、Range 流与回收站配额", { concurrency: false }, () => {
  let dataDir;
  let server;
  let owner;
  let otherUser;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });

    const ownerRegistration = await registerUser(server, {
      name: "文件所有者",
      email: "share-owner@example.test"
    });
    assert.equal(ownerRegistration.status, 201, ownerRegistration.text);
    owner = ownerRegistration.data;

    const otherRegistration = await registerUser(server, {
      name: "其他用户",
      email: "share-other@example.test"
    });
    assert.equal(otherRegistration.status, 201, otherRegistration.text);
    otherUser = otherRegistration.data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("移入回收站不释放配额，永久删除才释放", async () => {
    const before = await server.requestJson("/api/auth/me", { token: owner.token });
    assert.equal(before.status, 200, before.text);
    const initialUsage = before.data.user.usage;

    const content = Buffer.alloc(4096, 0x71);
    const uploaded = await server.upload(owner.token, {
      name: "quota-trash.txt",
      bytes: content
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];
    assert.equal(uploaded.data.usage, initialUsage + content.byteLength);

    const trashed = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_trashed: 1 }
    });
    assert.equal(trashed.status, 200, trashed.text);
    assert.ok(trashed.data.file.trashed_at);

    const afterTrash = await server.requestJson("/api/auth/me", { token: owner.token });
    assert.equal(afterTrash.data.user.usage, initialUsage + content.byteLength);

    const trashList = await server.requestJson("/api/files?view=trash&q=quota-trash", {
      token: owner.token
    });
    assert.equal(trashList.data.total, 1);

    const deleted = await server.requestJson(`/api/files/${file.id}`, {
      method: "DELETE",
      token: owner.token
    });
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.data.usage, initialUsage);

    const afterDelete = await server.requestJson("/api/auth/me", { token: owner.token });
    assert.equal(afterDelete.data.user.usage, initialUsage);
  });

  it("公共分享支持字节 Range，且不泄露内部存储字段", async () => {
    const content = Buffer.from("0123456789-共享范围测试", "utf8");
    const uploaded = await server.upload(owner.token, {
      name: "range-share.txt",
      bytes: content
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];

    const shared = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_shared: 1 }
    });
    assert.equal(shared.status, 200, shared.text);
    const shareToken = shared.data.file.share_token;
    assert.ok(shareToken);

    const metadata = await server.requestJson(`/api/share/${shareToken}`);
    assert.equal(metadata.status, 200, metadata.text);
    for (const field of [
      "id", "stored_name", "owner_id", "owner_email", "share_token", "access_version", "trashed_at"
    ]) {
      assert.equal(Object.hasOwn(metadata.data.file, field), false, `${field} must stay private`);
    }

    const ranged = await fetch(`${server.baseUrl}/api/share/${shareToken}/raw`, {
      headers: { Range: "bytes=2-5" }
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("accept-ranges"), "bytes");
    assert.equal(ranged.headers.get("content-range"), `bytes 2-5/${content.byteLength}`);
    assert.equal(ranged.headers.get("content-length"), "4");
    assert.equal(Buffer.from(await ranged.arrayBuffer()).toString("utf8"), "2345");

    const invalidRange = await fetch(`${server.baseUrl}/api/share/${shareToken}/raw`, {
      headers: { Range: "bytes=99999-100000" }
    });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), `bytes */${content.byteLength}`);

    const download = await fetch(`${server.baseUrl}/api/share/${shareToken}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") || "", /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);

    const otherRaw = await fetch(`${server.baseUrl}/api/files/${file.id}/raw`, {
      headers: { Authorization: `Bearer ${otherUser.token}` }
    });
    assert.equal(otherRaw.status, 404);
  });

  it("短期文件访问凭据支持 Range，并受文件过期状态约束", async () => {
    const uploaded = await server.upload(owner.token, {
      name: "access-token.txt",
      bytes: Buffer.from("abcdefghij", "utf8")
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];

    const access = await server.requestJson(`/api/files/${file.id}/access`, {
      method: "POST",
      token: owner.token
    });
    assert.equal(access.status, 200, access.text);
    assert.match(access.data.rawUrl, /^\/api\/file-access\//);
    assert.match(access.data.previewUrl, /^\/api\/file-access\/.+\/preview$/);

    const unsupportedPreview = await fetch(`${server.baseUrl}${access.data.previewUrl}`);
    assert.equal(unsupportedPreview.status, 415);

    const ranged = await fetch(`${server.baseUrl}${access.data.rawUrl}`, {
      headers: { Range: "bytes=1-3" }
    });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "bcd");

    const shared = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_shared: 1 }
    });
    const token = shared.data.file.share_token;

    const expired = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { expires_at: new Date(Date.now() - 60_000).toISOString() }
    });
    assert.equal(expired.status, 200, expired.text);

    const publicMetadata = await server.requestJson(`/api/share/${token}`);
    assert.equal(publicMetadata.status, 404);

    const publicRaw = await fetch(`${server.baseUrl}/api/share/${token}/raw`);
    assert.equal(publicRaw.status, 404);

    const ownerRaw = await fetch(`${server.baseUrl}/api/files/${file.id}/raw`, {
      headers: { Authorization: `Bearer ${owner.token}` }
    });
    assert.equal(ownerRaw.status, 410);

    const expiredAccess = await fetch(`${server.baseUrl}${access.data.rawUrl}`);
    assert.equal(expiredAccess.status, 404);
  });

  it("PDF 访问凭据返回可嵌入的同源预览响应", async () => {
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF", "utf8");
    const uploaded = await server.upload(owner.token, { name: "inline-preview.pdf", bytes });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];
    const access = await server.requestJson(`/api/files/${file.id}/access`, {
      method: "POST",
      token: owner.token
    });
    assert.equal(access.status, 200, access.text);

    const preview = await fetch(`${server.baseUrl}${access.data.rawUrl}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "application/pdf");
    assert.match(preview.headers.get("content-disposition") || "", /^inline;/);
    assert.equal(preview.headers.get("content-security-policy"), null);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  });

  it("存储文件被替换为符号链接时拒绝签发和读取直链", async () => {
    const uploadDir = join(dataDir, "uploads");
    const beforeEntries = new Set(await readdir(uploadDir));
    const uploaded = await server.upload(owner.token, {
      name: "symlink-guard.txt",
      bytes: Buffer.from("expected-upload-content", "utf8")
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];

    const storedName = (await readdir(uploadDir)).find((name) => !beforeEntries.has(name));
    assert.ok(storedName, "上传后应产生一个新的存储文件");
    const storedPath = join(uploadDir, storedName);
    await unlink(storedPath);
    await symlink("/etc/hosts", storedPath);

    const access = await server.requestJson(`/api/files/${file.id}/access`, {
      method: "POST",
      token: owner.token
    });
    assert.equal(access.status, 404);

    const raw = await fetch(`${server.baseUrl}/api/files/${file.id}/raw`, {
      headers: { Authorization: `Bearer ${owner.token}` }
    });
    assert.equal(raw.status, 404);
  });

  it("文件移入回收站或恢复时会撤销此前签发的直链", async () => {
    const uploaded = await server.upload(owner.token, {
      name: "access-revision.txt",
      bytes: Buffer.from("revision-bound-access", "utf8")
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const file = uploaded.data.files[0];

    const normalAccess = await server.requestJson(`/api/files/${file.id}/access`, {
      method: "POST",
      token: owner.token
    });
    assert.equal(normalAccess.status, 200, normalAccess.text);
    assert.equal((await fetch(`${server.baseUrl}${normalAccess.data.rawUrl}`)).status, 200);

    const trashed = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_trashed: 1 }
    });
    assert.equal(trashed.status, 200, trashed.text);
    assert.equal((await fetch(`${server.baseUrl}${normalAccess.data.rawUrl}`)).status, 404);

    const trashAccess = await server.requestJson(`/api/files/${file.id}/access`, {
      method: "POST",
      token: owner.token
    });
    assert.equal(trashAccess.status, 404, trashAccess.text);

    const restored = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_trashed: 0 }
    });
    assert.equal(restored.status, 200, restored.text);
    assert.equal((await fetch(`${server.baseUrl}${normalAccess.data.rawUrl}`)).status, 404);
  });

  it("关闭共享会立即撤销所有公共端点", async () => {
    const uploaded = await server.upload(owner.token, {
      name: "revoked-share.txt",
      bytes: Buffer.from("revocable")
    });
    const file = uploaded.data.files[0];
    const enabled = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_shared: 1 }
    });
    const token = enabled.data.file.share_token;
    const enabledAgain = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_shared: true }
    });
    assert.equal(enabledAgain.status, 200, enabledAgain.text);
    assert.equal(enabledAgain.data.file.share_token, token, "重复开启共享不应静默旋转链接");

    const disabled = await server.requestJson(`/api/files/${file.id}`, {
      method: "PATCH",
      token: owner.token,
      json: { is_shared: 0 }
    });
    assert.equal(disabled.status, 200, disabled.text);
    assert.equal(disabled.data.file.share_token, null);

    for (const suffix of ["", "/raw", "/download"]) {
      const response = await fetch(`${server.baseUrl}/api/share/${token}${suffix}`);
      assert.equal(response.status, 404);
    }
  });
});
