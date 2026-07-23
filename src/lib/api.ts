import type {
  ConfigBackup, ConfigBackupSummary, FileItem, FolderCrumb, FolderItem, OverviewData, PersonalWebdav, PublicConfig,
  SecurityStatus, SettingsEnvelope, StorageBackend, StorageConfig, StorageHealth,
  SystemSettings, SystemStatus, Ticket, User, WebdavItem
} from "../types";

const TOKEN_KEY = "tieyun.token";
const UNAUTHORIZED_EVENT = "tieyun:unauthorized";
let memoryToken: string | null = null;

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY) || memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string) {
    memoryToken = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // The in-memory session still works when persistent storage is unavailable.
    }
  },
  clear() {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing else is required for an in-memory session.
    }
  }
};

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

function notifyUnauthorized() {
  if (!session.token) return;
  session.clear();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, signal: externalSignal, ...init } = options;
  const headers = new Headers(init.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = timeoutMs > 0
    ? window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : undefined;

  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: "same-origin"
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `请求失败 (${response.status})` }));
      if (response.status === 401 && !path.startsWith("/auth/login")) notifyUnauthorized();
      throw new Error(data.error || "请求失败");
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  } catch (error) {
    if (timedOut) throw new Error("请求超时，请检查网络后重试");
    throw error;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401) notifyUnauthorized();
  return response;
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export const api = {
  config: (signal?: AbortSignal) => request<{ config: PublicConfig }>("/config", { timeoutMs: 10_000, signal }),
  login: (account: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: account, password })
    }),
  register: (username: string, name: string, email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, name, email, password })
    }),
  me: (signal?: AbortSignal) => request<{ user: User }>("/auth/me", { signal }),
  updateProfile: (payload: { username?: string; name?: string; email?: string; currentPassword?: string }) =>
    request<{ user: User }>("/profile", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  updatePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/profile/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword })
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return request<{ user: User }>("/profile/avatar", {
      method: "POST",
      body: form
    });
  },
  setAvatarPreset: (preset: string) =>
    request<{ user: User }>("/profile/avatar/preset", {
      method: "POST",
      body: JSON.stringify({ preset })
    }),
  deleteAvatar: () =>
    request<{ user: User }>("/profile/avatar", { method: "DELETE" }),
  deleteProfile: (password: string) =>
    request<void>("/profile", {
      method: "DELETE",
      body: JSON.stringify({ password, confirmation: "DELETE" })
    }),
  overview: (params: { page: number; pageSize: number; filter: string }, signal?: AbortSignal) =>
    request<{ overview: OverviewData }>(`/overview?${new URLSearchParams({
      page: String(params.page), pageSize: String(params.pageSize), filter: params.filter
    }).toString()}`, { signal }),
  files: (params: URLSearchParams, signal?: AbortSignal) =>
    request<{
      files: FileItem[];
      folders: FolderItem[];
      breadcrumbs: FolderCrumb[];
      currentFolderId: string | null;
      page: number;
      pageSize: number;
      total: number;
      fileTotal: number;
      hasMore: boolean;
    }>(`/files?${params.toString()}`, { signal }),
  upload: (files: File[], folderId?: string | null, signal?: AbortSignal) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (folderId) form.append("folderId", folderId);
    return request<{ files: FileItem[]; usage: number }>("/files/upload", {
      method: "POST",
      body: form,
      headers: {
        "X-Upload-Bytes": String(files.reduce((sum, file) => sum + file.size, 0)),
        "X-Upload-Count": String(files.length)
      },
      timeoutMs: 0,
      signal
    });
  },
  createPaste: (payload: {
    title: string;
    content: string;
    format: string;
    expiresInDays?: number | null;
    folderId?: string | null;
  }, signal?: AbortSignal) =>
    request<{ file: FileItem; usage: number }>("/files/paste", {
      method: "POST",
      body: JSON.stringify(payload),
      signal
    }),
  patchFile: (id: string, payload: Partial<FileItem>, signal?: AbortSignal) =>
    request<{ file: FileItem }>(`/files/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      signal
    }),
  deleteFile: (id: string, signal?: AbortSignal) =>
    request<{ usage: number }>(`/files/${id}`, { method: "DELETE", signal }),
  createFolder: (name: string, parentId?: string | null) =>
    request<{ folder: FolderItem }>("/folders", {
      method: "POST",
      body: JSON.stringify({ name, parentId: parentId || null })
    }),
  patchFolder: (id: string, payload: Partial<FolderItem>) =>
    request<{ folder: FolderItem }>(`/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteFolder: (id: string) =>
    request<{ usage: number }>(`/folders/${id}`, { method: "DELETE" }),
  fileOperation: (payload: {
    action: "copy" | "move";
    fileIds: string[];
    folderIds: string[];
    targetFolderId?: string | null;
  }) => request<{ ok: true; usage: number }>("/file-operations", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 0
  }),
  fileAccess: (id: string, signal?: AbortSignal) =>
    request<{ rawUrl: string; downloadUrl: string; previewUrl: string }>(`/files/${id}/access`, {
      method: "POST",
      signal
    }),
  users: (signal?: AbortSignal) => request<{ users: User[] }>("/admin/users", { signal }),
  patchUser: (id: string, payload: Partial<User>) =>
    request<{ user: User }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  status: (signal?: AbortSignal) => request<{ status: SystemStatus }>("/admin/status", { signal }),
  settings: (signal?: AbortSignal) => request<SettingsEnvelope>("/settings", { signal }),
  saveSettings: (patch: Partial<SystemSettings>, revision: number) =>
    request<SettingsEnvelope>("/settings", {
      method: "PATCH",
      body: JSON.stringify({ patch, revision })
    }),
  version: () => request<{ version: string }>("/version"),
  exportSettings: (passphrase: string) => request<{ backup: ConfigBackup }>("/settings/backup/export", {
    method: "POST",
    body: JSON.stringify({ passphrase })
  }),
  validateSettingsBackup: (backup: ConfigBackup, passphrase: string) =>
    request<{ summary: ConfigBackupSummary }>("/settings/backup/validate", {
      method: "POST",
      body: JSON.stringify({ backup, passphrase })
    }),
  importSettings: (backup: ConfigBackup, passphrase: string, revision: number) =>
    request<SettingsEnvelope>("/settings/import", {
      method: "POST",
      body: JSON.stringify({ backup, passphrase, revision })
    }),
  storage: (signal?: AbortSignal) =>
    request<{ storage: StorageBackend }>("/admin/storage", { signal }),
  testStorage: (payload: { driver: StorageConfig["driver"]; config: StorageConfig; password?: string }) =>
    request<{ status: StorageHealth }>("/admin/storage/test", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 150_000
    }),
  saveStorage: (payload: { driver: StorageConfig["driver"]; config: StorageConfig; password?: string }) =>
    request<{ storage: StorageBackend }>("/admin/storage", {
      method: "PUT",
      body: JSON.stringify(payload),
      timeoutMs: 150_000
    }),
  security: (signal?: AbortSignal) =>
    request<SecurityStatus>("/admin/security", { signal }),
  webdav: (signal?: AbortSignal) =>
    request<{ webdav: PersonalWebdav; connections: PersonalWebdav[] }>("/webdav", { signal }),
  testWebdav: (config: StorageConfig, password?: string, connectionId?: string) =>
    request<{ status: StorageHealth; testProof: string }>("/webdav/test", {
      method: "POST",
      body: JSON.stringify({ config, password, connectionId }),
      timeoutMs: 150_000
    }),
  createWebdav: (name: string, config: StorageConfig, password?: string, testProof?: string) =>
    request<{ webdav: PersonalWebdav; status: StorageHealth }>("/webdav/connections", {
      method: "POST",
      body: JSON.stringify({ name, config, password, testProof }),
      timeoutMs: 150_000
    }),
  saveWebdav: (id: string, name: string, config: StorageConfig, password?: string, testProof?: string) =>
    request<{ webdav: PersonalWebdav; status: StorageHealth }>(`/webdav/connections/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, password, testProof }),
      timeoutMs: 150_000
    }),
  deleteWebdav: (id: string) => request<void>(`/webdav/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  webdavFiles: (connectionId: string, path = "", signal?: AbortSignal) =>
    request<{ items: WebdavItem[]; path: string }>(`/webdav/files?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(path)}`, { signal, timeoutMs: 150_000 }),
  createWebdavFolder: (connectionId: string, path: string) => request<{ ok: true }>("/webdav/folders", {
    method: "POST",
    body: JSON.stringify({ connectionId, path }),
    timeoutMs: 150_000
  }),
  uploadWebdavFiles: (connectionId: string, path: string, files: File[], signal?: AbortSignal) => {
    const form = new FormData();
    form.append("connectionId", connectionId);
    form.append("path", path);
    files.forEach((file) => form.append("files", file));
    return request<{ uploaded: { name: string; path: string; size: number }[] }>("/webdav/upload", {
      method: "POST",
      body: form,
      headers: {
        "X-Upload-Bytes": String(files.reduce((sum, file) => sum + file.size, 0)),
        "X-Upload-Count": String(files.length)
      },
      timeoutMs: 0,
      signal
    });
  },
  patchWebdavItem: (payload: { connectionId: string; action: "move" | "copy"; source: string; destination: string; isDir: boolean }) =>
    request<{ ok: true }>("/webdav/items", {
      method: "PATCH",
      body: JSON.stringify(payload),
      timeoutMs: 0
    }),
  deleteWebdavItem: (connectionId: string, path: string, isDir: boolean) => request<void>("/webdav/items", {
    method: "DELETE",
    body: JSON.stringify({ connectionId, path, isDir }),
    timeoutMs: 150_000
  }),
  exportWebdavFile: (connectionId: string, fileId: string, path: string) => request<{ ok: true }>("/webdav/export", {
    method: "POST",
    body: JSON.stringify({ connectionId, fileId, path }),
    timeoutMs: 0
  }),
  async downloadWebdavFile(connectionId: string, item: WebdavItem) {
    const response = await authenticatedFetch("/api/webdav/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, path: item.path })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "WebDAV 文件下载失败" }));
      throw new Error(data.error || "WebDAV 文件下载失败");
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = item.name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
  previewWebdavFile: (connectionId: string, item: WebdavItem, signal?: AbortSignal) =>
    authenticatedFetch("/api/webdav/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, path: item.path }),
      signal
    }),
  tickets: (signal?: AbortSignal) => request<{ tickets: Ticket[] }>("/tickets", { signal }),
  ticket: (id: string, signal?: AbortSignal) =>
    request<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}`, { signal }),
  createTicket: (subject: string, message: string) =>
    request<{ ticket: Ticket }>("/tickets", {
      method: "POST",
      body: JSON.stringify({ subject, message })
    }),
  replyTicket: (id: string, message: string) =>
    request<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message })
    }),
  patchTicket: (id: string, status: Ticket["status"]) =>
    request<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  publicShare: async (token: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}`, { signal });
    const data = await response.json().catch(() => ({ error: "共享链接不可用" }));
    if (!response.ok) throw new Error(data.error || "共享链接不可用");
    return data as { file: FileItem };
  },
  publicRawUrl: (token: string) => `/api/share/${encodeURIComponent(token)}/raw`,
  publicDownloadUrl: (token: string) => `/api/share/${encodeURIComponent(token)}/download`,
  raw: (file: FileItem, options: { signal?: AbortSignal; range?: string } = {}) =>
    authenticatedFetch(`/api/files/${file.id}/raw`, {
      signal: options.signal,
      headers: options.range ? { Range: options.range } : undefined
    }),
  async download(file: FileItem, signal?: AbortSignal) {
    const { downloadUrl } = await api.fileAccess(file.id, signal);
    if (signal?.aborted) return;
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = file.name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
};

export { UNAUTHORIZED_EVENT };
