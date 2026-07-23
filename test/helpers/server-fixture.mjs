import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const adminEmail = "admin@test.tieyun.local";
export const adminPassword = "TieYun-Test-Admin-2026";

export async function createTestDataDir() {
  return mkdtemp(join(tmpdir(), "tieyun-api-test-"));
}

export async function cleanupTestDataDir(dataDir) {
  if (!dataDir) return;
  await rm(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 75
  });
}

export async function startTieYun({ dataDir, extraEnv = {} } = {}) {
  const ownedDataDir = dataDir || await createTestDataDir();
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      DATA_DIR: ownedDataDir,
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      JWT_SECRET: "tieyun-node-test-secret-with-sufficient-entropy-2026",
      SEED_DEMO_DATA: "false",
      MIN_FREE_BYTES: String(64 * 1024 ** 2),
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  const actualPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`TieYun startup timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000);

    const onData = () => {
      const match = stdout.match(/TieYun API listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve(Number(match[1]));
    };

    child.stdout.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(
        `TieYun exited before listening (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ));
    });
  }).catch(async (error) => {
    if (child.exitCode === null) child.kill("SIGKILL");
    await exitPromise;
    throw error;
  });

  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const fixture = {
    child,
    dataDir: ownedDataDir,
    baseUrl,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    async requestJson(path, {
      method = "GET",
      token,
      json,
      headers = {}
    } = {}) {
      const requestHeaders = new Headers(headers);
      if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
      let body;
      if (json !== undefined) {
        requestHeaders.set("Content-Type", "application/json");
        body = JSON.stringify(json);
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body
      });
      const text = await response.text();
      let data;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
      }
      return { response, status: response.status, data, text };
    },
    async upload(token, {
      name = "fixture.txt",
      type = "text/plain",
      bytes = Buffer.from("fixture")
    } = {}) {
      const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const form = new FormData();
      form.append("files", new Blob([content], { type }), name);
      const response = await fetch(`${baseUrl}/api/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Upload-Bytes": String(content.byteLength)
        },
        body: form
      });
      const text = await response.text();
      let data;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
      }
      return { response, status: response.status, data, text, bytes: content };
    },
    async stop(signal = "SIGTERM", timeoutMs = 10_000) {
      if (child.exitCode !== null || child.signalCode !== null) return exitPromise;
      child.kill(signal);
      let timeout;
      const timed = new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      });
      const result = await Promise.race([exitPromise, timed]);
      clearTimeout(timeout);
      if (result?.timedOut) {
        child.kill("SIGKILL");
        const forced = await exitPromise;
        return { ...forced, timedOut: true };
      }
      return { ...result, timedOut: false };
    }
  };

  const health = await waitFor(async () => {
    try {
      const response = await fetch(`${baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeoutMs: 5_000 });
  if (!health) {
    await fixture.stop("SIGKILL", 1_000);
    throw new Error(`TieYun did not become healthy.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return fixture;
}

export async function registerUser(fixture, {
  name = "测试用户",
  email = `user-${crypto.randomUUID()}@example.test`,
  password = "Member-Test-2026"
} = {}) {
  return fixture.requestJson("/api/auth/register", {
    method: "POST",
    json: { name, email, password }
  });
}

export async function loginAdmin(fixture) {
  return fixture.requestJson("/api/auth/login", {
    method: "POST",
    json: { email: adminEmail, password: adminPassword }
  });
}

export async function waitFor(predicate, {
  timeoutMs = 5_000,
  intervalMs = 50
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
