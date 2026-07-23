import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  startTieYun
} from "../helpers/server-fixture.mjs";

test("显式测试开关允许本地管理员账号和短密码", async () => {
  const dataDir = await createTestDataDir();
  let server;
  try {
    server = await startTieYun({
      dataDir,
      extraEnv: {
        ADMIN_EMAIL: "admin",
        ADMIN_PASSWORD: "admin",
        ALLOW_INSECURE_ADMIN_CREDENTIALS: "true"
      }
    });
    const login = await server.requestJson("/api/auth/login", {
      method: "POST",
      json: { email: "admin", password: "admin" }
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.email, "admin");
    assert.equal(login.data.user.role, "admin");
  } finally {
    if (server) await server.stop();
    await cleanupTestDataDir(dataDir);
  }
});
