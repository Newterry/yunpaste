import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  startTieYun
} from "../helpers/server-fixture.mjs";

describe("生产静态资源与缓存策略", { concurrency: false }, () => {
  let dataDir;
  let server;

  before(async () => {
    dataDir = await createTestDataDir();
    server = await startTieYun({
      dataDir,
      extraEnv: { NODE_ENV: "production" }
    });
  });

  after(async () => {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  });

  it("缺失资源返回 404，客户端路由仍回退到应用首页", async () => {
    const missingAsset = await fetch(`${server.baseUrl}/assets/missing.js.map`);
    assert.equal(missingAsset.status, 404);
    assert.equal(await missingAsset.text(), "Not found");

    const clientRoute = await fetch(`${server.baseUrl}/share/example-token`);
    assert.equal(clientRoute.status, 200);
    assert.match(clientRoute.headers.get("content-type") || "", /^text\/html/);
    assert.equal(clientRoute.headers.get("cache-control"), "no-store, max-age=0, must-revalidate");
  });

  it("API 响应禁止缓存，带哈希资源使用长期不可变缓存", async () => {
    const api = await fetch(`${server.baseUrl}/api/auth/me`);
    assert.equal(api.status, 401);
    assert.equal(api.headers.get("cache-control"), "no-store");

    const index = await fetch(`${server.baseUrl}/`);
    const html = await index.text();
    const scriptPath = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
    assert.ok(scriptPath, "生产首页应引用带哈希的脚本");

    const script = await fetch(`${server.baseUrl}${scriptPath}`);
    assert.equal(script.status, 200);
    assert.equal(
      script.headers.get("cache-control"),
      "public, max-age=31536000, immutable"
    );
  });

  it("手机独立模式所需的清单、图标和服务工作线程均可访问", async () => {
    const manifestResponse = await fetch(`${server.baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/#overview");
    assert(manifest.icons.some((icon) => icon.src === "/apple-touch-icon.png"));

    const icon = await fetch(`${server.baseUrl}/apple-touch-icon.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") || "", /^image\/png/);

    const worker = await fetch(`${server.baseUrl}/sw.js`);
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get("content-type") || "", /javascript/);

    const avatarSprite = await fetch(`${server.baseUrl}/assets/cute-animal-avatars-v1.webp`);
    assert.equal(avatarSprite.status, 200);
    assert.match(avatarSprite.headers.get("content-type") || "", /^image\/webp/);
  });
});
