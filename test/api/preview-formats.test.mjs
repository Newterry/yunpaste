import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  registerUser,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("扩展预览格式识别", { concurrency: false }, () => {
  let dataDir;
  let server;
  let user;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({ dataDir });
    const registered = await registerUser(server, {
      name: "预览测试用户",
      email: "preview-formats@example.test"
    });
    assert.equal(registered.status, 201, registered.text);
    user = registered.data;
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  for (const [name, expectedKind] of [
    ["analysis.jsonl", "text"],
    ["database.sql", "text"],
    ["settings.toml", "text"],
    ["workbook.xlsm", "document"],
    ["slides.ppsx", "document"],
    ["diagram.vsdx", "document"]
  ]) {
    it(`${name} 被识别为 ${expectedKind}`, async () => {
      const uploaded = await server.upload(user.token, {
        name,
        type: "application/octet-stream",
        bytes: Buffer.from("preview fixture", "utf8")
      });
      assert.equal(uploaded.status, 201, uploaded.text);
      assert.equal(uploaded.data.files[0].kind, expectedKind);
    });
  }
});
