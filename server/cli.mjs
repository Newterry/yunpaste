#!/usr/bin/env node
import { resolve } from "node:path";
import {
  databaseEncryptionStatus,
  encryptDatabaseFile
} from "./database.mjs";
import { databasePath } from "./paths.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const [, , group, command] = process.argv;

if (group !== "database" || !["status", "encrypt"].includes(command)) {
  process.stderr.write(
    "用法：\n"
    + "  node server/cli.mjs database status [--database /config/yunpaste.db]\n"
    + "  node server/cli.mjs database encrypt --key-file /run/secrets/database.key "
    + "[--database /config/yunpaste.db] [--keep-plaintext-backup]\n"
  );
  process.exitCode = 2;
} else {
  const path = resolve(option("--database") || databasePath);
  if (command === "status") {
    print({ database: path, ...databaseEncryptionStatus(path) });
  } else {
    const keyFile = option("--key-file");
    if (!keyFile) throw new Error("database encrypt 必须提供 --key-file");
    const result = encryptDatabaseFile({
      path,
      keyFile: resolve(keyFile),
      keepPlaintextBackup: process.argv.includes("--keep-plaintext-backup")
    });
    print({
      ok: true,
      database: result.path,
      encrypted: true,
      provider: result.provider,
      cipher: result.cipher,
      plaintextBackup: result.plaintextBackup,
      next: "启动服务时设置 DATABASE_KEY_FILE 为同一个密钥文件"
    });
  }
}
