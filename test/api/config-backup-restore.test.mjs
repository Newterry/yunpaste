import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanupTestDataDir, createTestDataDir, loginAdmin, startTieYun
} from "../helpers/server-fixture.mjs";
import { decryptConfigBackup, encryptConfigBackup } from "../../server/config-backup.mjs";

describe("加密配置备份与恢复", { concurrency: false }, () => {
  it("加密载荷不会泄露凭据，篡改或错误口令无法解密", async () => {
    const passphrase = "correct-horse-battery-staple";
    const payload = {
      settings: { siteName: "机密站点" },
      storage: { driver: "webdav", password: "remote-secret-2026" }
    };
    const backup = await encryptConfigBackup(payload, passphrase, {
      appVersion: "test",
      exportedAt: new Date().toISOString(),
      coverage: { settings: true, globalStorage: true, globalStorageCredential: true, users: false, files: false, personalWebdav: false }
    });
    const serialized = JSON.stringify(backup);
    assert.equal(serialized.includes("remote-secret-2026"), false);
    assert.equal(serialized.includes("机密站点"), false);
    assert.deepEqual(await decryptConfigBackup(backup, passphrase), payload);
    await assert.rejects(() => decryptConfigBackup(backup, "wrong-password-value"), /口令错误|损坏/);
    await assert.rejects(() => decryptConfigBackup({ ...backup, payload: `${backup.payload.slice(0, -2)}aa` }, passphrase), /口令错误|损坏/);
  });

  it("先验证后恢复完整设置，并拒绝错误口令、篡改和过期修订号", async () => {
    const dataDir = await createTestDataDir();
    let server;
    try {
      server = await startTieYun({ dataDir });
      const admin = await loginAdmin(server);
      const token = admin.data.token;
      const initial = await server.requestJson("/api/settings", { token });

      const prepared = await server.requestJson("/api/settings", {
        method: "PATCH", token,
        json: { revision: initial.data.revision, patch: { siteSubtitle: "需要恢复的配置", expiryWarningDays: 9 } }
      });
      assert.equal(prepared.status, 200, prepared.text);

      const exported = await server.requestJson("/api/settings/backup/export", {
        method: "POST", token, json: { passphrase: "Backup-Passphrase-2026" }
      });
      assert.equal(exported.status, 200, exported.text);
      const backup = exported.data.backup;
      assert.equal(backup.format, "yunpaste-config-backup");
      assert.equal(backup.schemaVersion, 2);
      assert.equal(JSON.stringify(backup).includes("需要恢复的配置"), false);

      const changed = await server.requestJson("/api/settings", {
        method: "PATCH", token,
        json: { revision: prepared.data.revision, patch: { siteSubtitle: "恢复前的临时改动", expiryWarningDays: 3 } }
      });
      assert.equal(changed.status, 200, changed.text);

      const wrongPassword = await server.requestJson("/api/settings/backup/validate", {
        method: "POST", token, json: { backup, passphrase: "Wrong-Passphrase-2026" }
      });
      assert.equal(wrongPassword.status, 400, wrongPassword.text);

      const tampered = { ...backup, payload: `${backup.payload.slice(0, -2)}aa` };
      const invalid = await server.requestJson("/api/settings/backup/validate", {
        method: "POST", token, json: { backup: tampered, passphrase: "Backup-Passphrase-2026" }
      });
      assert.equal(invalid.status, 400, invalid.text);

      const afterValidationFailure = await server.requestJson("/api/settings", { token });
      assert.equal(afterValidationFailure.data.settings.siteSubtitle, "恢复前的临时改动");

      const validated = await server.requestJson("/api/settings/backup/validate", {
        method: "POST", token, json: { backup, passphrase: "Backup-Passphrase-2026" }
      });
      assert.equal(validated.status, 200, validated.text);
      assert.equal(validated.data.summary.siteName, "云粘贴");
      assert.equal(validated.data.summary.storageDriver, "local");

      const concurrent = await server.requestJson("/api/settings", {
        method: "PATCH", token,
        json: { revision: changed.data.revision, patch: { allowRegistration: false } }
      });
      assert.equal(concurrent.status, 200, concurrent.text);
      const staleRestore = await server.requestJson("/api/settings/import", {
        method: "POST", token,
        json: { backup, passphrase: "Backup-Passphrase-2026", revision: changed.data.revision }
      });
      assert.equal(staleRestore.status, 409, staleRestore.text);

      const restored = await server.requestJson("/api/settings/import", {
        method: "POST", token,
        json: { backup, passphrase: "Backup-Passphrase-2026", revision: concurrent.data.revision }
      });
      assert.equal(restored.status, 200, restored.text);
      assert.equal(restored.data.settings.siteSubtitle, "需要恢复的配置");
      assert.equal(restored.data.settings.expiryWarningDays, 9);
      assert.equal(restored.data.settings.allowRegistration, true);

      const overview = await server.requestJson("/api/overview", { token });
      assert.equal(overview.status, 200, overview.text);
      assert.equal(overview.data.overview.expiryWarningDays, 9);
      const storage = await server.requestJson("/api/admin/storage", { token });
      assert.equal(storage.data.storage.driver, "local");
    } finally {
      await server?.stop();
      await cleanupTestDataDir(dataDir);
    }
  });
});
