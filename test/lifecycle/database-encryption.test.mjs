import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir, readFile, readdir, writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  cleanupTestDataDir,
  createTestDataDir,
  loginAdmin,
  projectRoot,
  startTieYun
} from "../helpers/server-fixture.mjs";

const execFile = promisify(execFileCallback);

test("数据库可离线加密，并在缺少或错误密钥时拒绝启动", async () => {
  const dataDir = await createTestDataDir();
  const configDir = join(dataDir, "config");
  const filesDir = join(dataDir, "files");
  const secretsDir = join(dataDir, "secrets");
  const databasePath = join(configDir, "yunpaste.db");
  const keyFile = join(secretsDir, "database.key");
  const wrongKeyFile = join(secretsDir, "wrong.key");
  let server;
  try {
    await Promise.all([
      mkdir(configDir, { recursive: true }),
      mkdir(filesDir, { recursive: true }),
      mkdir(secretsDir, { recursive: true })
    ]);
    await Promise.all([
      writeFile(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 }),
      writeFile(wrongKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 })
    ]);

    const layoutEnv = { CONFIG_DIR: configDir, FILES_DIR: filesDir };
    server = await startTieYun({ dataDir, extraEnv: layoutEnv });
    assert.equal((await loginAdmin(server)).status, 200);
    await assert.rejects(
      execFile(
        process.execPath,
        [
          "server/cli.mjs",
          "database",
          "encrypt",
          "--database",
          databasePath,
          "--key-file",
          keyFile
        ],
        {
          cwd: projectRoot,
          env: { ...process.env, ...layoutEnv, NODE_ENV: "test" }
        }
      ),
      /仍被服务占用或上次未正常关闭/
    );
    assert.equal((await server.stop("SIGTERM")).code, 0, server.stderr);
    server = null;

    const migrated = await execFile(
      process.execPath,
      [
        "server/cli.mjs",
        "database",
        "encrypt",
        "--database",
        databasePath,
        "--key-file",
        keyFile
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, ...layoutEnv, NODE_ENV: "test" }
      }
    );
    assert.match(migrated.stdout, /"encrypted": true/);
    assert.notEqual(
      (await readFile(databasePath)).subarray(0, 16).toString("utf8"),
      "SQLite format 3\0"
    );

    await assert.rejects(
      startTieYun({ dataDir, extraEnv: layoutEnv }),
      /数据库已加密，但未提供 DATABASE_KEY_FILE/
    );
    await assert.rejects(
      startTieYun({
        dataDir,
        extraEnv: { ...layoutEnv, DATABASE_KEY_FILE: wrongKeyFile }
      }),
      /数据库密钥错误或加密数据库已损坏/
    );

    server = await startTieYun({
      dataDir,
      extraEnv: { ...layoutEnv, DATABASE_KEY_FILE: keyFile }
    });
    const admin = await loginAdmin(server);
    assert.equal(admin.status, 200, admin.text);

    const security = await server.requestJson("/api/admin/security", {
      token: admin.data.token
    });
    assert.equal(security.status, 200, security.text);
    assert.equal(security.data.databaseEncryption.enabled, true);
    assert.equal(security.data.databaseEncryption.state, "ready");
    assert.equal(security.data.databaseEncryption.keySource, "file");

    const uploaded = await server.upload(admin.data.token, {
      name: "layout-proof.txt",
      bytes: Buffer.from("split layout proof", "utf8")
    });
    assert.equal(uploaded.status, 201, uploaded.text);
    const objectEntries = await readdir(join(filesDir, "objects"), { recursive: true });
    assert.equal(objectEntries.some((entry) => String(entry).endsWith(".txt")), true);
  } finally {
    await server?.stop();
    await cleanupTestDataDir(dataDir);
  }
});
