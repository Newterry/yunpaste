import { mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(fileURLToPath(import.meta.url));
export const rootDir = join(serverDir, "..");

const legacyDataDir = String(process.env.DATA_DIR || "").trim();
const configuredConfigDir = String(process.env.CONFIG_DIR || "").trim();
const configuredFilesDir = String(process.env.FILES_DIR || "").trim();

export const legacyLayout = Boolean(
  legacyDataDir && !configuredConfigDir && !configuredFilesDir
);
export const configDir = resolve(
  configuredConfigDir || legacyDataDir || join(rootDir, "config")
);
export const filesDir = resolve(
  configuredFilesDir
    || (legacyDataDir ? join(legacyDataDir, "uploads") : join(rootDir, "files"))
);

if (!legacyLayout) {
  const configPrefix = `${configDir}${sep}`;
  const filesPrefix = `${filesDir}${sep}`;
  if (
    configDir === filesDir
    || configDir.startsWith(filesPrefix)
    || filesDir.startsWith(configPrefix)
  ) {
    throw new Error("CONFIG_DIR 与 FILES_DIR 必须是两个互不包含的独立目录");
  }
}

export const databasePath = join(
  configDir,
  legacyLayout ? "tieyun.db" : "yunpaste.db"
);
export const objectsDir = legacyLayout ? filesDir : join(filesDir, "objects");
export const stagingDir = legacyLayout ? filesDir : join(filesDir, "staging");

mkdirSync(configDir, { recursive: true, mode: 0o700 });
mkdirSync(filesDir, { recursive: true, mode: 0o700 });
mkdirSync(objectsDir, { recursive: true, mode: 0o700 });
mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

// Compatibility exports for one release. New code should use configDir/filesDir.
export const dataDir = configDir;
export const uploadDir = objectsDir;
