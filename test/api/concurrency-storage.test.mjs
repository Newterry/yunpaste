import assert from "node:assert/strict";
import { readdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("并发存储保护", { concurrency: false }, () => {
  it("同一用户可以安全地并行上传多个文件", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      server = await startTieYun({ dataDir });
      const member = await registerUser(server, {
        name: "并行上传用户",
        email: "same-user-concurrency@example.test"
      });
      assert.equal(member.status, 201, member.text);
      const payloadA = Buffer.alloc(1024 * 1024, 0x31);
      const payloadB = Buffer.alloc(1024 * 1024, 0x32);
      const uploads = await Promise.all([
        server.upload(member.data.token, { name: "parallel-a.bin", bytes: payloadA }),
        server.upload(member.data.token, { name: "parallel-b.bin", bytes: payloadB })
      ]);
      assert.deepEqual(uploads.map((item) => item.status), [201, 201]);
      const me = await server.requestJson("/api/auth/me", { token: member.data.token });
      assert.equal(me.data.user.usage, payloadA.length + payloadB.length);
      const ready = await server.requestJson("/readyz");
      assert.equal(ready.data.reservedStorageBytes, 0);
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });

  it("不同用户的并发上传也不能突破全局磁盘安全余量", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      const volume = await statfs(dataDir);
      const freeBytes = volume.bavail * volume.bsize;
      server = await startTieYun({
        dataDir,
        extraEnv: { MIN_FREE_BYTES: String(freeBytes - 32 * 1024 ** 2) }
      });
      const [userA, userB] = await Promise.all([
        registerUser(server, { name: "并发用户甲", email: "disk-a@example.test" }),
        registerUser(server, { name: "并发用户乙", email: "disk-b@example.test" })
      ]);
      assert.equal(userA.status, 201, userA.text);
      assert.equal(userB.status, 201, userB.text);

      const payload = Buffer.alloc(20 * 1024 ** 2, 0x61);
      const uploads = await Promise.all([
        server.upload(userA.data.token, {
          name: "disk-a.bin",
          type: "application/octet-stream",
          bytes: payload
        }),
        server.upload(userB.data.token, {
          name: "disk-b.bin",
          type: "application/octet-stream",
          bytes: payload
        })
      ]);
      assert.deepEqual(
        uploads.map((result) => result.status).sort((left, right) => left - right),
        [201, 507]
      );
      const ready = await fetch(`${server.baseUrl}/readyz`);
      assert.equal(ready.status, 200, await ready.text());
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });

  it("上传途中降低用户配额会在提交前拒绝并清理文件", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      server = await startTieYun({ dataDir });
      const admin = await loginAdmin(server);
      const member = await registerUser(server, {
        name: "慢上传用户",
        email: "quota-race@example.test"
      });
      assert.equal(admin.status, 200, admin.text);
      assert.equal(member.status, 201, member.text);

      const raised = await server.requestJson(`/api/admin/users/${member.data.user.id}`, {
        method: "PATCH",
        token: admin.data.token,
        json: { quota: 25 * 1024 ** 2 }
      });
      assert.equal(raised.status, 200, raised.text);

      const boundary = `tieyun-${crypto.randomUUID()}`;
      const prefix = Buffer.from(
        `--${boundary}\r\n`
        + "Content-Disposition: form-data; name=\"files\"; filename=\"slow.bin\"\r\n"
        + "Content-Type: application/octet-stream\r\n\r\n"
      );
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
      const chunk = Buffer.alloc(1024 * 1024, 0x71);
      async function* multipartBody() {
        yield prefix;
        for (let index = 0; index < 20; index += 1) {
          yield chunk;
          await delay(35);
        }
        yield suffix;
      }

      const uploadPromise = fetch(`${server.baseUrl}/api/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${member.data.token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(prefix.length + 20 * chunk.length + suffix.length),
          "X-Upload-Bytes": String(20 * chunk.length)
        },
        body: Readable.from(multipartBody()),
        duplex: "half"
      });

      await delay(160);
      const lowered = await server.requestJson(`/api/admin/users/${member.data.user.id}`, {
        method: "PATCH",
        token: admin.data.token,
        json: { quota: 16 * 1024 ** 2 }
      });
      assert.equal(lowered.status, 200, lowered.text);

      const upload = await uploadPromise;
      assert.equal(upload.status, 413, await upload.text());
      const me = await server.requestJson("/api/auth/me", { token: member.data.token });
      assert.equal(me.data.user.usage, 0);
      assert.deepEqual(await readdir(join(dataDir, "uploads")), []);
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });
});
