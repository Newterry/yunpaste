import {
  Check, ChevronDown, Cloud, Database, Download, FileJson, FolderCog, HardDrive, KeyRound,
  Link2, LockKeyhole, Network, RefreshCw, Save, Server, Settings2,
  ShieldCheck, Star, Trash2, Upload, UsersRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AdminTab, ConfigBackup, ConfigBackupSummary, PublicConfig, SecurityStatus, SettingsPermissions, StorageBackend,
  StorageConfig, StorageDriver, StorageHealth, SystemSettings, SystemStatus, User
} from "../types";
import { api, isAbortError } from "../lib/api";
import { formatBytes, formatDate, initials } from "../lib/format";

type StorageOperation = "test" | "save";

const defaultPermissions: SettingsPermissions = {
  canRenameSite: false,
  canManageStorage: true,
  canManageEncryption: false
};

const defaultStorageHealth: StorageHealth = {
  state: "unknown"
};

export function AdminPanel({
  currentUser, activeTab, onTabChange, onToast, onSettingsChange, onCurrentUserChange, demoMode = false
}: {
  currentUser: User;
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onToast: (message: string) => void;
  onSettingsChange: (config: PublicConfig) => void;
  onCurrentUserChange: (user: User) => void;
  demoMode?: boolean;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<SystemSettings>();
  const [savedSettings, setSavedSettings] = useState<SystemSettings>();
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [permissions, setPermissions] = useState<SettingsPermissions>({
    ...defaultPermissions,
    canRenameSite: currentUser.isPrimaryAdmin
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SystemStatus>();
  const [storage, setStorage] = useState<StorageBackend>();
  const [storageDraft, setStorageDraft] = useState<StorageConfig>({ driver: "local" });
  const [storagePassword, setStoragePassword] = useState("");
  const [storageOperation, setStorageOperation] = useState<StorageOperation>();
  const [storageTest, setStorageTest] = useState<StorageHealth>();
  const [storageError, setStorageError] = useState("");
  const [security, setSecurity] = useState<SecurityStatus>();
  const [securityError, setSecurityError] = useState("");
  const [appVersion, setAppVersion] = useState("development");

  useEffect(() => {
    if (demoMode) {
      const demoSettings: SystemSettings = {
        siteName: "云粘贴",
        siteSubtitle: "把灵感与文件，安全地放在一起",
        allowRegistration: true,
        maxUploadMb: 2048,
        defaultExpiryDays: 30,
        defaultShareDays: 7,
        defaultUserQuotaGb: 20,
        maxFilesPerUpload: 20,
        allowedTypes: "text,image,video,audio,document,archive,other",
        retentionDays: 30,
        expiryWarningDays: 7,
        allowPersonalWebdav: true,
        allowTickets: true
      };
      setUsers([
        { ...currentUser, isPrimaryAdmin: true },
        {
          id: "demo-user-2", username: "xiaoman", name: "林小满", email: "xiaoman@example.com", role: "admin",
          status: "active", isPrimaryAdmin: false, quota: 5 * 1024 ** 3, usage: 1.4 * 1024 ** 3,
          created_at: "2026-05-12T03:00:00.000Z", last_seen_at: "2026-07-17T05:20:00.000Z"
        },
        {
          id: "demo-user-3", username: "zhouyuan", name: "周远", email: "zhouyuan@example.com", role: "member",
          status: "active", isPrimaryAdmin: false, quota: 2 * 1024 ** 3, usage: 680 * 1024 ** 2,
          created_at: "2026-06-02T03:00:00.000Z", last_seen_at: "2026-07-16T10:30:00.000Z"
        }
      ]);
      setSettings(demoSettings);
      setSavedSettings(demoSettings);
      setSettingsRevision(1);
      setPermissions({
        canRenameSite: true,
        canManageStorage: true,
        canManageEncryption: true
      });
      setStatus({
        healthy: true,
        uptimeSeconds: 86_400,
        users: 3,
        files: 6,
        storedBytes: 2.1 * 1024 ** 3,
        storageFreeBytes: 80 * 1024 ** 3
      });
      const demoStorage: StorageBackend = {
        driver: "local",
        label: "本地文件系统",
        config: { driver: "local" },
        credentialsConfigured: false,
        status: { state: "connected", latencyMs: 2, lastCheckedAt: new Date().toISOString() },
        paths: { configDir: "/config", filesDir: "/files" }
      };
      setStorage(demoStorage);
      setStorageDraft(demoStorage.config);
      setStorageTest(demoStorage.status);
      setSecurity({
        databaseEncryption: {
          enabled: true,
          state: "encrypted",
          provider: "SQLite3 Multiple Ciphers",
          cipher: "SQLCipher / AES-256",
          keySource: "外部密钥文件"
        },
        jwtSecret: { managed: true },
        filesEncrypted: false
      });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setStorageError("");
    setSecurityError("");
    Promise.allSettled([
      api.users(controller.signal),
      api.settings(controller.signal),
      api.status(controller.signal),
      api.storage(controller.signal),
      api.security(controller.signal),
      api.version()
    ]).then(([userResult, settingsResult, statusResult, storageResult, securityResult, versionResult]) => {
      if (controller.signal.aborted) return;
      if (userResult.status === "fulfilled") setUsers(userResult.value.users);
      if (settingsResult.status === "fulfilled") {
        const envelope = settingsResult.value;
        setSettings(envelope.settings);
        setSavedSettings(envelope.settings);
        setSettingsRevision(envelope.revision);
        setPermissions(envelope.permissions || {
          ...defaultPermissions,
          canRenameSite: currentUser.isPrimaryAdmin
        });
      }
      if (statusResult.status === "fulfilled") setStatus(statusResult.value.status);
      if (storageResult.status === "fulfilled") {
        setStorage(storageResult.value.storage);
        setStorageDraft({
          ...storageResult.value.storage.config,
          driver: storageResult.value.storage.driver
        });
        setStorageTest(storageResult.value.storage.status);
      } else if (!isAbortError(storageResult.reason)) {
        setStorageError((storageResult.reason as Error).message);
      }
      if (securityResult.status === "fulfilled") {
        setSecurity(securityResult.value);
      } else if (!isAbortError(securityResult.reason)) {
        setSecurityError((securityResult.reason as Error).message);
      }
      if (versionResult.status === "fulfilled") setAppVersion(versionResult.value.version);
      const essentialFailures = [userResult, settingsResult, statusResult]
        .filter((result) => result.status === "rejected" && !isAbortError(result.reason));
      if (essentialFailures.length) {
        setLoadError(true);
        onToast("管理数据仅载入了一部分，请重试");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [demoMode, currentUser.id, currentUser.isPrimaryAdmin, onToast, reloadKey]);

  const patchUser = async (user: User, patch: Partial<User>) => {
    if (user.isPrimaryAdmin && ("role" in patch || "status" in patch)) {
      onToast("主管理员的角色和状态受系统保护");
      return;
    }
    if (demoMode) {
      const updated = { ...user, ...patch };
      setUsers((items) => items.map((item) => item.id === user.id ? updated : item));
      if (updated.id === currentUser.id) onCurrentUserChange(updated);
      onToast("用户设置已更新");
      return;
    }
    try {
      const { user: updated } = await api.patchUser(user.id, patch);
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
      if (updated.id === currentUser.id) onCurrentUserChange(updated);
      onToast("用户设置已更新");
    } catch (error) {
      onToast((error as Error).message);
    }
  };

  const deleteUser = async (user: User) => {
    if (user.id === currentUser.id || user.isPrimaryAdmin) return;
    if (!window.confirm(`确定删除账号“${user.name}”吗？该用户的全部文件和配置都会永久删除。`)) return;
    if (demoMode) {
      setUsers((items) => items.filter((item) => item.id !== user.id));
      onToast("用户已删除");
      return;
    }
    try {
      await api.deleteUser(user.id);
      setUsers((items) => items.filter((item) => item.id !== user.id));
      onToast("用户及其私有数据已删除");
    } catch (error) {
      onToast((error as Error).message);
    }
  };

  const saveSettings = async () => {
    if (!settings || !savedSettings) return;
    const patch = changedSettings(savedSettings, settings);
    if (!permissions.canRenameSite) delete patch.siteName;
    if (Object.keys(patch).length === 0) {
      onToast("没有需要保存的更改");
      return;
    }
    const submitted = settings;
    if (demoMode) {
      setSavedSettings(settings);
      setSettingsRevision((revision) => revision + 1);
      onSettingsChange(settings);
      onToast("系统设置已保存");
      return;
    }
    setSaving(true);
    try {
      const data = await api.saveSettings(patch, settingsRevision);
      setSettings((current) => current === submitted ? data.settings : current);
      setSavedSettings(data.settings);
      setSettingsRevision(data.revision);
      setPermissions(data.permissions);
      onSettingsChange(data.settings);
      onToast("系统设置已保存");
    } catch (error) {
      const message = (error as Error).message;
      if (/冲突|已更新|版本/.test(message)) {
        try {
          const latest = await api.settings();
          setSettings(latest.settings);
          setSavedSettings(latest.settings);
          setSettingsRevision(latest.revision);
          setPermissions(latest.permissions);
          onSettingsChange(latest.settings);
          onToast("设置已被其他管理员更新，已载入最新版本");
        } catch {
          onToast(message);
        }
      } else {
        onToast(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const exportConfig = async (passphrase: string) => {
    if (demoMode) throw new Error("演示模式不生成真实加密备份");
    const { backup } = await api.exportSettings(passphrase);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `yunpaste-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    onToast("加密配置备份已导出");
  };

  const validateConfig = (backup: ConfigBackup, passphrase: string) => {
    if (demoMode) throw new Error("演示模式不验证真实备份");
    return api.validateSettingsBackup(backup, passphrase).then(({ summary }) => summary);
  };

  const importConfig = async (backup: ConfigBackup, passphrase: string) => {
    if (demoMode) throw new Error("演示模式不执行恢复");
    const result = await api.importSettings(backup, passphrase, settingsRevision);
    setSettings(result.settings);
    setSavedSettings(result.settings);
    setSettingsRevision(result.revision);
    onSettingsChange(result.settings);
    const nextStorage = await api.storage();
    setStorage(nextStorage.storage);
    setStorageDraft(nextStorage.storage.config);
    onToast("配置与全局存储设置已恢复");
  };

  const selectStorageDriver = (driver: StorageDriver) => {
    setStorageTest(undefined);
    setStoragePassword("");
    if (driver === "local") {
      setStorageDraft({ driver });
      return;
    }
    if (driver === "webdav") {
      setStorageDraft((current) => current.driver === driver ? current : {
        driver,
        url: "https://",
        vendor: "other",
        username: "",
        basePath: "yunpaste",
        allowInsecure: false
      });
      return;
    }
    setStorageDraft((current) => current.driver === driver ? current : {
      driver,
      host: "",
      port: 445,
      share: "",
      username: "",
      domain: "WORKGROUP",
      basePath: "yunpaste"
    });
  };

  const storagePayload = () => ({
    driver: storageDraft.driver,
    config: storageDraft,
    ...(storagePassword ? { password: storagePassword } : {})
  });

  const testStorage = async () => {
    setStorageOperation("test");
    setStorageError("");
    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 360));
        const next = {
          state: "connected" as const,
          latencyMs: storageDraft.driver === "local" ? 2 : 48,
          lastCheckedAt: new Date().toISOString()
        };
        setStorageTest(next);
        onToast("存储连接测试成功");
        return;
      }
      const data = await api.testStorage(storagePayload());
      setStorageTest(data.status);
      onToast("存储连接测试成功");
    } catch (error) {
      const message = (error as Error).message;
      setStorageTest({ state: "unavailable", message });
      setStorageError(message);
      onToast(message);
    } finally {
      setStorageOperation(undefined);
    }
  };

  const saveStorage = async () => {
    setStorageOperation("save");
    setStorageError("");
    try {
      if (demoMode) {
        const next: StorageBackend = {
          driver: storageDraft.driver,
          label: storageLabel(storageDraft.driver),
          config: storageDraft,
          credentialsConfigured: storageDraft.driver !== "local",
          status: storageTest || defaultStorageHealth,
          paths: storage?.paths || { configDir: "/config", filesDir: "/files" }
        };
        setStorage(next);
        setStoragePassword("");
        onToast("存储后端已保存");
        return;
      }
      const data = await api.saveStorage(storagePayload());
      setStorage(data.storage);
      setStorageDraft({ ...data.storage.config, driver: data.storage.driver });
      setStoragePassword("");
      setStorageTest(data.storage.status);
      onToast("存储后端已保存，新文件将写入此后端");
    } catch (error) {
      const message = (error as Error).message;
      setStorageError(message);
      onToast(message);
    } finally {
      setStorageOperation(undefined);
    }
  };

  const selectTab = (next: AdminTab) => {
    onTabChange(next);
    window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".admin-panel");
      if (panel) panel.scrollTop = 0;
    });
  };

  const totalUsage = users.reduce((sum, user) => sum + user.usage, 0);

  return (
    <section className="admin-panel" data-admin-tab={activeTab}>
      <div className="admin-heading">
        <div><h1>管理中心</h1><p>管理成员、存储策略与系统安全</p></div>
        <div className={`system-health ${status && !status.healthy ? "is-unhealthy" : ""}`}>
          <i />
          <span>
            <strong>{status?.healthy ? "系统运行正常" : status ? "存储空间低于安全余量" : "正在读取系统状态"}</strong>
            <small>{status ? `已连续运行 ${formatUptime(status.uptimeSeconds)}` : "正在执行健康检查"}</small>
          </span>
        </div>
      </div>

      <div className="admin-summary">
        <div><span><UsersRound /></span><p><small>用户总数</small><strong>{users.length}</strong><em>{users.filter((user) => user.status === "active").length} 位活跃</em></p></div>
        <div><span><HardDrive /></span><p><small>已用存储</small><strong>{formatBytes(status?.storedBytes ?? totalUsage)}</strong><em>{status ? `剩余 ${formatBytes(status.storageFreeBytes)}` : "正在读取数据卷"}</em></p></div>
        <div><span><ShieldCheck /></span><p><small>服务状态</small><strong>{status?.healthy ? "健康" : status ? "需处理" : "检查中"}</strong><em>{status ? `${status.files} 个文件受管` : "等待健康数据"}</em></p></div>
      </div>

      <div className="admin-layout">
        <nav className="admin-nav" aria-label="管理设置">
          <button type="button" className={activeTab === "users" ? "is-active" : ""} onClick={() => selectTab("users")} aria-current={activeTab === "users" ? "page" : undefined}><UsersRound />用户管理</button>
          <button type="button" className={activeTab === "general" ? "is-active" : ""} onClick={() => selectTab("general")} aria-current={activeTab === "general" ? "page" : undefined}><Settings2 />常规设置</button>
          <button type="button" className={activeTab === "storage" ? "is-active" : ""} onClick={() => selectTab("storage")} aria-current={activeTab === "storage" ? "page" : undefined}><Database />存储与保留</button>
          <button type="button" className={activeTab === "security" ? "is-active" : ""} onClick={() => selectTab("security")} aria-current={activeTab === "security" ? "page" : undefined}><LockKeyhole />系统安全</button>
          <button type="button" className={activeTab === "config" ? "is-active" : ""} onClick={() => selectTab("config")} aria-current={activeTab === "config" ? "page" : undefined}><FileJson />版本与配置</button>
        </nav>
        <div className="admin-content">
          {loading ? <div className="admin-loading"><RefreshCw className="spin" />正在读取系统设置…</div> : null}
          {!loading && loadError ? (
            <div className="admin-loading admin-loading--error">
              部分管理数据载入失败
              <button className="button button--secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw />重试</button>
            </div>
          ) : null}
          {!loading && activeTab === "users" && <UserManager users={users} currentUser={currentUser} onPatch={patchUser} onDelete={deleteUser} />}
          {!loading && settings && activeTab === "general" && (
            <GeneralSettings value={settings} permissions={permissions} onChange={setSettings} />
          )}
          {!loading && settings && activeTab === "storage" && (
            <StorageSettings
              value={settings}
              onChange={setSettings}
              usage={totalUsage}
              storage={storage}
              draft={storageDraft}
              password={storagePassword}
              testStatus={storageTest}
              error={storageError}
              operation={storageOperation}
              canManage={permissions.canManageStorage}
              onDriver={selectStorageDriver}
              onDraft={setStorageDraft}
              onPassword={setStoragePassword}
              onTest={testStorage}
              onSave={saveStorage}
            />
          )}
          {!loading && activeTab === "security" && (
            <SecuritySettings value={security} error={securityError} />
          )}
          {!loading && activeTab === "config" && (
            <ConfigTools
              version={appVersion}
              canManage={currentUser.isPrimaryAdmin}
              onExport={exportConfig}
              onValidate={validateConfig}
              onImport={importConfig}
              onToast={onToast}
            />
          )}
          {!loading && (activeTab === "general" || activeTab === "storage") && (
            <div className="admin-save">
              <span>{activeTab === "general" ? "更改会应用到所有用户。" : "此按钮仅保存上传与保留策略。"}</span>
              <button className="button button--primary" onClick={saveSettings} disabled={saving}>
                <Save />{saving ? "正在保存…" : activeTab === "general" ? "保存常规设置" : "保存保留策略"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function UserManager({
  users, currentUser, onPatch, onDelete
}: {
  users: User[];
  currentUser: User;
  onPatch: (user: User, patch: Partial<User>) => void;
  onDelete: (user: User) => void;
}) {
  return (
    <div className="admin-section">
      <div className="admin-section__title"><div><h2>用户管理</h2><p>查看成员状态、角色与存储配额。</p></div></div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>用户</th><th>角色</th><th>存储</th><th>最后活跃</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((user) => {
              const protectedUser = user.isPrimaryAdmin;
              const isSelf = user.id === currentUser.id;
              return (
                <tr key={user.id}>
                  <td>
                    <span className="user-cell">
                      <i className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</i>
                      <span>
                        <strong>
                          {user.name}
                          {isSelf ? <em>你</em> : null}
                          {protectedUser ? <PrimaryAdminBadge /> : null}
                        </strong>
                        <small>{user.email}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span
                      className="select-wrap select-wrap--table"
                      title={
                        protectedUser
                          ? "主管理员角色受系统保护"
                          : "管理员可以调整非主管理员账户的角色"
                      }
                    >
                      <select
                        value={user.role}
                        onChange={(event) => onPatch(user, { role: event.target.value as User["role"] })}
                        disabled={isSelf || protectedUser}
                        aria-label={`${user.name} 的角色`}
                      >
                        <option value="admin">管理员</option>
                        <option value="member">普通用户</option>
                      </select>
                      <ChevronDown />
                    </span>
                  </td>
                  <td><QuotaEditor user={user} onPatch={onPatch} /></td>
                  <td>{formatDate(user.last_seen_at)}</td>
                  <td>
                    <button
                      className={`status-button ${user.status === "active" ? "is-active" : ""}`}
                      onClick={() => onPatch(user, { status: user.status === "active" ? "disabled" : "active" })}
                      disabled={
                        isSelf
                        || protectedUser
                      }
                      title={protectedUser ? "主管理员不能被停用" : undefined}
                    >
                      <i />{user.status === "active" ? "正常" : "停用"}
                    </button>
                  </td>
                  <td><button className="icon-button admin-delete-user" onClick={() => onDelete(user)} disabled={isSelf || protectedUser} title={protectedUser ? "主管理员不能被删除" : isSelf ? "请在个人设置中注销自己" : "删除账号"}><Trash2 /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PrimaryAdminBadge() {
  return <em className="primary-admin-badge"><Star />主管理员</em>;
}

function GeneralSettings({
  value, permissions, onChange
}: {
  value: SystemSettings;
  permissions: SettingsPermissions;
  onChange: (value: SystemSettings) => void;
}) {
  return (
    <div className="admin-section settings-form">
      <div className="admin-section__title">
        <div><h2>常规设置</h2><p>配置站点名称和新用户访问策略。</p></div>
        {permissions.canRenameSite ? <span className="owner-capability"><Star />主管理员权限</span> : null}
      </div>
      <div className="settings-group">
        <label>
          <span>
            <strong>站点名称</strong>
            <small id="site-name-permission">
              {permissions.canRenameSite ? "显示在登录页和侧边栏；仅主管理员可以修改。" : "仅主管理员可以修改站点名称。"}
            </small>
          </span>
          <input
            value={value.siteName}
            onChange={(event) => onChange({ ...value, siteName: event.target.value })}
            readOnly={!permissions.canRenameSite}
            aria-describedby="site-name-permission"
            maxLength={60}
          />
        </label>
        <label>
          <span><strong>站点副标题</strong><small>向用户介绍这个空间。</small></span>
          <input value={value.siteSubtitle} onChange={(event) => onChange({ ...value, siteSubtitle: event.target.value })} maxLength={160} />
        </label>
        <SettingSwitch
          label="开放用户注册"
          detail="允许访客通过登录页创建新账户。"
          value={value.allowRegistration}
          onChange={(next) => onChange({ ...value, allowRegistration: next })}
        />
        <SettingSwitch
          label="启用个人 WebDAV"
          detail="允许每个用户配置自己独立的 WebDAV；与全局存储后端互不影响。"
          value={value.allowPersonalWebdav}
          onChange={(next) => onChange({ ...value, allowPersonalWebdav: next })}
        />
        <SettingSwitch
          label="启用工单系统"
          detail="允许普通用户向管理员提交问题并接收回复。"
          value={value.allowTickets}
          onChange={(next) => onChange({ ...value, allowTickets: next })}
        />
      </div>
    </div>
  );
}

function StorageSettings({
  value, onChange, usage, storage, draft, password, testStatus, error,
  operation, canManage, onDriver, onDraft, onPassword, onTest, onSave
}: {
  value: SystemSettings;
  onChange: (value: SystemSettings) => void;
  usage: number;
  storage?: StorageBackend;
  draft: StorageConfig;
  password: string;
  testStatus?: StorageHealth;
  error: string;
  operation?: StorageOperation;
  canManage: boolean;
  onDriver: (driver: StorageDriver) => void;
  onDraft: (value: StorageConfig) => void;
  onPassword: (value: string) => void;
  onTest: () => void;
  onSave: () => void;
}) {
  const activeStatus = testStatus
    || (storage?.driver === draft.driver ? storage.status : defaultStorageHealth);
  const controlsDisabled = !canManage || operation !== undefined;
  return (
    <div className="admin-section settings-form">
      <div className="admin-section__title">
        <div><h2>存储后端</h2><p>在本地文件系统、WebDAV 与 SMB 之间选择；已有文件仍保留在原后端。</p></div>
        <StorageState status={activeStatus} />
      </div>

      <div className="storage-driver-grid" role="radiogroup" aria-label="存储后端">
        <StorageDriverButton
          driver="local"
          selected={draft.driver === "local"}
          icon={<HardDrive />}
          label="本地存储"
          detail="直接使用 /files"
          onSelect={onDriver}
          disabled={controlsDisabled}
        />
        <StorageDriverButton
          driver="webdav"
          selected={draft.driver === "webdav"}
          icon={<Cloud />}
          label="WebDAV"
          detail="兼容常见网盘与 NAS"
          onSelect={onDriver}
          disabled={controlsDisabled}
        />
        <StorageDriverButton
          driver="smb"
          selected={draft.driver === "smb"}
          icon={<Network />}
          label="SMB"
          detail="连接局域网文件共享"
          onSelect={onDriver}
          disabled={controlsDisabled}
        />
      </div>

      <div className="storage-config-card">
        {draft.driver === "local" ? (
          <div className="storage-local-copy">
            <span><Server /></span>
            <div>
              <strong>服务器本地持久化目录</strong>
              <p>无需额外凭据，文件按分片目录写入 <code>{storage?.paths?.filesDir || "/files"}</code>。</p>
            </div>
          </div>
        ) : null}

        {draft.driver === "webdav" ? (
          <div className="storage-fields">
            <label className="storage-field--wide">
              <span><strong>WebDAV 地址</strong><small>建议使用 HTTPS，不要在 URL 中嵌入凭据。</small></span>
              <input
                type="url"
                value={draft.url || ""}
                onChange={(event) => onDraft({ ...draft, url: event.target.value })}
                placeholder="https://dav.example.com/remote.php/dav/files/user/"
                disabled={controlsDisabled}
              />
            </label>
            <label>
              <span><strong>服务类型</strong><small>用于选择兼容模式。</small></span>
              <span className="select-wrap">
                <select
                  value={draft.vendor || "other"}
                  onChange={(event) => onDraft({ ...draft, vendor: event.target.value as StorageConfig["vendor"] })}
                  disabled={controlsDisabled}
                >
                  <option value="other">标准 WebDAV</option>
                  <option value="fastmail">Fastmail</option>
                  <option value="nextcloud">Nextcloud</option>
                  <option value="owncloud">ownCloud</option>
                  <option value="infinitescale">Infinite Scale</option>
                  <option value="sharepoint">SharePoint</option>
                  <option value="sharepoint-ntlm">SharePoint NTLM</option>
                  <option value="rclone">rclone WebDAV</option>
                </select>
                <ChevronDown />
              </span>
            </label>
            <StorageCredentialFields
              draft={draft}
              password={password}
              credentialsConfigured={storage?.driver === "webdav" && storage.credentialsConfigured}
              disabled={controlsDisabled}
              onDraft={onDraft}
              onPassword={onPassword}
            />
            <label>
              <span><strong>远端基础目录</strong><small>留空则使用远端根目录。</small></span>
              <input value={draft.basePath || ""} onChange={(event) => onDraft({ ...draft, basePath: event.target.value })} placeholder="yunpaste" disabled={controlsDisabled} />
            </label>
            <SettingSwitch
              label="允许不安全 HTTP"
              detail="仅适用于可信局域网；公网环境应保持关闭。"
              value={draft.allowInsecure === true}
              onChange={(next) => onDraft({ ...draft, allowInsecure: next })}
              disabled={controlsDisabled}
              compact
            />
          </div>
        ) : null}

        {draft.driver === "smb" ? (
          <div className="storage-fields">
            <label>
              <span><strong>服务器地址</strong><small>主机名或 IP 地址。</small></span>
              <input value={draft.host || ""} onChange={(event) => onDraft({ ...draft, host: event.target.value })} placeholder="nas.local" disabled={controlsDisabled} />
            </label>
            <label>
              <span><strong>端口</strong><small>SMB 默认端口为 445。</small></span>
              <input type="number" min="1" max="65535" value={draft.port ?? 445} onChange={(event) => onDraft({ ...draft, port: Number(event.target.value) })} disabled={controlsDisabled} />
            </label>
            <label>
              <span><strong>共享名称</strong><small>只填写共享名，不含斜杠。</small></span>
              <input value={draft.share || ""} onChange={(event) => onDraft({ ...draft, share: event.target.value })} placeholder="documents" disabled={controlsDisabled} />
            </label>
            <label>
              <span><strong>域 / 工作组</strong><small>通常为 WORKGROUP。</small></span>
              <input value={draft.domain || ""} onChange={(event) => onDraft({ ...draft, domain: event.target.value })} placeholder="WORKGROUP" disabled={controlsDisabled} />
            </label>
            <StorageCredentialFields
              draft={draft}
              password={password}
              credentialsConfigured={storage?.driver === "smb" && storage.credentialsConfigured}
              disabled={controlsDisabled}
              onDraft={onDraft}
              onPassword={onPassword}
            />
            <label>
              <span><strong>远端基础目录</strong><small>共享内用于保存文件的子目录。</small></span>
              <input value={draft.basePath || ""} onChange={(event) => onDraft({ ...draft, basePath: event.target.value })} placeholder="yunpaste" disabled={controlsDisabled} />
            </label>
          </div>
        ) : null}

        {draft.driver !== "local" ? (
          <div className="storage-secret-note">
            <KeyRound />
            <span>
              <strong>密码不会回显</strong>
              <small>{storage?.driver === draft.driver && storage.credentialsConfigured ? "已保存凭据；留空会继续使用现有密码。" : "凭据将加密保存，连接测试和保存时使用。"}</small>
            </span>
          </div>
        ) : null}

        {error ? <div className="form-error storage-error" role="alert">{error}</div> : null}
        <div className="storage-actions">
          <StorageState status={activeStatus} verbose />
          <button className="button button--secondary" onClick={onTest} disabled={!canManage || operation !== undefined}>
            <RefreshCw className={operation === "test" ? "spin" : ""} />
            {operation === "test" ? "正在测试…" : "测试连接"}
          </button>
          <button className="button button--primary" onClick={onSave} disabled={!canManage || operation !== undefined}>
            <Save />{operation === "save" ? "正在保存…" : "保存存储后端"}
          </button>
        </div>
      </div>

      {storage?.paths ? (
        <div className="storage-paths">
          <FolderCog />
          <span><small>配置映射</small><code>{storage.paths.configDir}</code></span>
          <span><small>文件映射</small><code>{storage.paths.filesDir}</code></span>
        </div>
      ) : null}

      <div className="admin-section__title admin-section__title--sub">
        <div><h2>上传与保留策略</h2><p>限制单次上传，并定义自动清理周期。</p></div>
      </div>
      <div className="settings-group settings-group--split">
        <label><span><strong>单文件上传上限</strong><small>单位：MB</small></span><input type="number" min="1" max="10240" step="1" value={value.maxUploadMb} onChange={(event) => onChange({ ...value, maxUploadMb: Number(event.target.value) })} /></label>
        <label><span><strong>单次上传数量</strong><small>1–100 个文件</small></span><input type="number" min="1" max="100" step="1" value={value.maxFilesPerUpload} onChange={(event) => onChange({ ...value, maxFilesPerUpload: Number(event.target.value) })} /></label>
        <label><span><strong>默认过期时间</strong><small>单位：天；收藏内容不受此限制</small></span><input type="number" min="1" max="3650" step="1" value={value.defaultExpiryDays} onChange={(event) => onChange({ ...value, defaultExpiryDays: Number(event.target.value) })} /></label>
        <label><span><strong>默认分享有效期</strong><small>最长 7 天</small></span><input type="number" min="1" max="7" step="1" value={value.defaultShareDays} onChange={(event) => onChange({ ...value, defaultShareDays: Number(event.target.value) })} /></label>
        <label><span><strong>新用户默认配额</strong><small>单位：GB</small></span><input type="number" min="1" max="10240" step="1" value={value.defaultUserQuotaGb} onChange={(event) => onChange({ ...value, defaultUserQuotaGb: Number(event.target.value) })} /></label>
        <label><span><strong>回收站保留期</strong><small>单位：天</small></span><input type="number" min="1" max="3650" step="1" value={value.retentionDays} onChange={(event) => onChange({ ...value, retentionDays: Number(event.target.value) })} /></label>
        <label><span><strong>到期提醒提前量</strong><small>3–15 天；用于概览提醒</small></span><input type="number" min="3" max="15" step="1" value={value.expiryWarningDays} onChange={(event) => onChange({ ...value, expiryWarningDays: Number(event.target.value) })} /></label>
        <label><span><strong>允许的文件类别</strong><small>用逗号分隔 · 当前已用 {formatBytes(usage)}</small></span><input value={value.allowedTypes} onChange={(event) => onChange({ ...value, allowedTypes: event.target.value })} /></label>
      </div>
    </div>
  );
}

function StorageCredentialFields({
  draft, password, credentialsConfigured, disabled, onDraft, onPassword
}: {
  draft: StorageConfig;
  password: string;
  credentialsConfigured?: boolean;
  disabled: boolean;
  onDraft: (value: StorageConfig) => void;
  onPassword: (value: string) => void;
}) {
  return (
    <>
      <label>
        <span>
          <strong>用户名</strong>
          <small>{draft.driver === "smb" ? "SMB 必填；来宾账户可填写 guest。" : "远端存储账户。"}</small>
        </span>
        <input
          autoComplete="off"
          value={draft.username || ""}
          onChange={(event) => onDraft({ ...draft, username: event.target.value })}
          placeholder="storage-user"
          disabled={disabled}
          required={draft.driver === "smb"}
        />
      </label>
      <label>
        <span><strong>密码</strong><small>{credentialsConfigured ? "已安全保存；留空则保持不变。" : "不会在页面或接口中回显。"}</small></span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          placeholder={credentialsConfigured ? "••••••••（已保存）" : "请输入远端密码"}
          disabled={disabled}
        />
      </label>
    </>
  );
}

function StorageDriverButton({
  driver, selected, icon, label, detail, onSelect, disabled
}: {
  driver: StorageDriver;
  selected: boolean;
  icon: React.ReactNode;
  label: string;
  detail: string;
  onSelect: (driver: StorageDriver) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={selected ? "is-selected" : ""}
      onClick={() => onSelect(driver)}
      disabled={disabled}
    >
      <span>{icon}</span>
      <strong>{label}</strong>
      <small>{detail}</small>
      {selected ? <Check className="storage-driver-check" /> : null}
    </button>
  );
}

function StorageState({ status, verbose = false }: { status: StorageHealth; verbose?: boolean }) {
  const labels: Record<StorageHealth["state"], string> = {
    connected: "连接正常",
    degraded: "连接较慢",
    unavailable: "连接不可用",
    error: "连接不可用",
    unknown: "尚未检测"
  };
  const detail = [
    status.latencyMs !== undefined ? `${status.latencyMs} ms` : "",
    status.lastCheckedAt ? `检测于 ${formatDate(status.lastCheckedAt)}` : ""
  ].filter(Boolean).join(" · ");
  return (
    <span className={`storage-state storage-state--${status.state}`}>
      <i />
      <span>
        <strong>{labels[status.state]}</strong>
        {verbose && (status.message || detail) ? <small>{status.message || detail}</small> : null}
      </span>
    </span>
  );
}

function SecuritySettings({ value, error }: { value?: SecurityStatus; error: string }) {
  if (!value) {
    return (
      <div className="admin-section settings-form">
        <div className="admin-section__title"><div><h2>系统安全</h2><p>查看数据库与会话密钥的真实保护状态。</p></div></div>
        <div className="admin-loading admin-loading--error">{error || "暂时无法读取安全状态"}</div>
      </div>
    );
  }
  const encryption = value.databaseEncryption;
  return (
    <div className="admin-section settings-form">
      <div className="admin-section__title"><div><h2>系统安全</h2><p>此页面只显示运行时真实状态，不展示任何密钥内容。</p></div></div>
      <div className={`security-banner security-banner--database ${encryption.enabled ? "is-enabled" : "is-disabled"}`}>
        <Database />
        <div>
          <strong>{encryption.enabled ? "数据库加密已启用" : "数据库加密尚未启用"}</strong>
          <p>
            {encryption.enabled
              ? "用户、文件索引与系统设置所在的数据库文件已加密。"
              : "数据库当前仍为明文文件；请由服务器主管理员完成离线加密与密钥文件配置。"}
          </p>
          <span className="security-facts">
            <em>状态：{securityStateLabel(encryption.state)}</em>
            {encryption.provider ? <em>提供方：{encryption.provider}</em> : null}
            {encryption.cipher ? <em>算法：{encryption.cipher}</em> : null}
            {encryption.keySource ? <em>密钥来源：{keySourceLabel(encryption.keySource)}</em> : null}
          </span>
        </div>
        {encryption.enabled ? <Check /> : <LockKeyhole />}
      </div>
      <div className="settings-group">
        <div className="audit-row">
          <span><KeyRound /><span><strong>持久化会话签名密钥</strong><small>容器重启不会导致用户意外退出，密钥内容不会通过管理接口返回。</small></span></span>
          <em>{value.jwtSecret.managed ? "已托管" : "需检查"}</em>
        </div>
        <div className="audit-row">
          <span><Link2 /><span><strong>可撤销共享链接</strong><small>关闭共享后旧链接立即失效；重新开启会生成新令牌。</small></span></span>
          <em>已开启</em>
        </div>
        <div className="audit-row">
          <span><ShieldCheck /><span><strong>文件内容加密</strong><small>数据库加密不等于文件加密；如有需要，请在宿主机或远端存储层启用磁盘加密。</small></span></span>
          <em className={value.filesEncrypted ? "" : "is-warning"}>{value.filesEncrypted ? "已启用" : "由存储层负责"}</em>
        </div>
      </div>
    </div>
  );
}

function ConfigTools({
  version, canManage, onExport, onValidate, onImport, onToast
}: {
  version: string;
  canManage: boolean;
  onExport: (passphrase: string) => Promise<void>;
  onValidate: (backup: ConfigBackup, passphrase: string) => Promise<ConfigBackupSummary>;
  onImport: (backup: ConfigBackup, passphrase: string) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [backup, setBackup] = useState<ConfigBackup>();
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<ConfigBackupSummary>();
  const [busy, setBusy] = useState<"export" | "validate" | "restore">();
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const exportBackup = async () => {
    if (exportPassphrase.length < 12) return onToast("备份口令至少需要 12 个字符");
    if (exportPassphrase !== exportConfirm) return onToast("两次输入的备份口令不一致");
    setBusy("export");
    try {
      await onExport(exportPassphrase);
      setExportPassphrase("");
      setExportConfirm("");
    } catch (error) { onToast((error as Error).message); } finally { setBusy(undefined); }
  };

  const selectBackup = async (file: File) => {
    setSummary(undefined);
    setBackup(undefined);
    setFileName(file.name);
    if (file.size > 1024 * 1024) return onToast("备份文件不能超过 1 MB");
    try {
      const document = JSON.parse(await file.text()) as ConfigBackup;
      if (document.format !== "yunpaste-config-backup" || document.schemaVersion !== 2) throw new Error("不是受支持的云粘贴加密备份");
      setBackup(document);
    } catch (error) { onToast((error as Error).message || "备份文件无效"); }
  };

  const validate = async () => {
    if (!backup) return onToast("请先选择备份文件");
    setBusy("validate");
    try {
      const result = await onValidate(backup, importPassphrase);
      setSummary(result);
      onToast("备份校验通过，可以安全恢复");
    } catch (error) { setSummary(undefined); onToast((error as Error).message); } finally { setBusy(undefined); }
  };

  const restore = async () => {
    if (!backup || !summary) return onToast("请先验证备份");
    if (!window.confirm(`恢复“${summary.siteName}”的配置？当前系统设置与全局存储连接将被替换。`)) return;
    setBusy("restore");
    try {
      await onImport(backup, importPassphrase);
      setSummary(undefined);
      setBackup(undefined);
      setFileName("");
      setImportPassphrase("");
    } catch (error) { onToast((error as Error).message); } finally { setBusy(undefined); }
  };

  return (
    <div className="admin-section config-center">
      <div className="admin-section__title"><div><h2>版本与配置</h2><p>分步导出、校验并恢复系统关键配置。</p></div></div>
      <div className="config-overview">
        <div className="version-panel"><span className="version-panel__icon"><FileJson /></span><div><small>当前运行版本</small><strong>云粘贴 v{version}</strong><p>备份格式 v2 · AES-256-GCM 加密 · scrypt 密钥派生</p></div><em><Check />运行中</em></div>
        <div className="backup-coverage"><strong>配置备份范围</strong><span><Check />系统设置</span><span><Check />全局 WebDAV / SMB 配置与加密凭据</span><span><Check />存储后端标识</span></div>
      </div>

      {!canManage && <div className="storage-secret-note"><ShieldCheck /><span><strong>仅主管理员可操作</strong><small>完整配置包含全局存储凭据，普通管理员不能导出或恢复。</small></span></div>}

      <div className="backup-workflows">
        <section className="backup-workflow">
          <header><span>1</span><div><h3>导出加密备份</h3><p>口令只用于本次加密，不会保存到服务器。</p></div></header>
          <div className="backup-fields backup-fields--export">
            <label className="field"><span>备份口令</span><input type="password" minLength={12} maxLength={256} value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} autoComplete="new-password" disabled={!canManage} placeholder="至少 12 个字符" /></label>
            <label className="field"><span>再次输入口令</span><input type="password" minLength={12} maxLength={256} value={exportConfirm} onChange={(event) => setExportConfirm(event.target.value)} autoComplete="new-password" disabled={!canManage} placeholder="再次输入相同口令" /></label>
          </div>
          <button className="button button--secondary" onClick={exportBackup} disabled={!canManage || Boolean(busy)}><Download />{busy === "export" ? "正在加密…" : "下载加密备份"}</button>
        </section>

        <section className="backup-workflow backup-workflow--restore">
          <header><span>2</span><div><h3>验证与恢复</h3><p>系统会先解密并校验全部字段，验证不会修改任何设置。</p></div></header>
          <div className="backup-fields backup-fields--restore">
            <button className="backup-file-picker" type="button" disabled={!canManage || Boolean(busy)} onClick={() => backupInputRef.current?.click()}><Upload /><span><strong>{fileName || "从本机选择 .json 备份文件"}</strong><small>{backup ? "文件结构已识别，等待口令验证" : "打开系统文件选择器 · 最大 1 MB"}</small></span></button>
            <input ref={backupInputRef} className="sr-only" tabIndex={-1} type="file" accept="application/json,.json" disabled={!canManage || Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectBackup(file); event.target.value = ""; }} />
            <label className="field"><span>备份口令</span><input type="password" minLength={12} maxLength={256} value={importPassphrase} onChange={(event) => { setImportPassphrase(event.target.value); setSummary(undefined); }} autoComplete="current-password" disabled={!canManage} placeholder="输入导出时使用的口令" /></label>
          </div>
          {summary && <div className="backup-validation"><Check /><span><strong>备份验证通过</strong><small>{summary.siteName} · {summary.storageLabel} · {summary.settingsCount} 项设置 · {new Date(summary.exportedAt).toLocaleString("zh-CN")}</small></span></div>}
          <div className="config-actions"><button className="button button--secondary" onClick={validate} disabled={!canManage || !backup || Boolean(busy)}><ShieldCheck />{busy === "validate" ? "正在验证…" : "先验证备份"}</button><button className="button button--primary" onClick={restore} disabled={!canManage || !summary || Boolean(busy)}><Upload />{busy === "restore" ? "正在恢复…" : "开始恢复"}</button></div>
        </section>
      </div>

      <div className="backup-volume-note"><HardDrive /><span><strong>要实现整机完美恢复，还需备份 Docker 映射目录</strong><small><code>/config</code> 保存数据库和密钥，<code>/files</code> 保存本地文件内容。配置备份不会包含用户账号、用户文件或个人 WebDAV，以保护隐私并控制备份体积。</small></span></div>
      <div className="storage-secret-note"><ShieldCheck /><span><strong>恢复保护</strong><small>恢复使用设置修订号防止覆盖其他管理员的新改动；口令错误、文件篡改或字段异常都会在写入前拒绝。</small></span></div>
    </div>
  );
}

function SettingSwitch({
  label, detail, value, onChange, disabled = false, compact = false
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`setting-switch ${compact ? "setting-switch--compact" : ""}`}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <button
        type="button"
        className={`switch ${value ? "is-on" : ""}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
      >
        <i />
      </button>
    </div>
  );
}

function QuotaEditor({
  user, onPatch
}: {
  user: User;
  onPatch: (user: User, patch: Partial<User>) => void;
}) {
  const [quotaGb, setQuotaGb] = useState((user.quota / 1024 ** 3).toFixed(1));
  useEffect(() => setQuotaGb((user.quota / 1024 ** 3).toFixed(1)), [user.quota]);
  const save = () => {
    const quota = Math.round(Number(quotaGb) * 1024 ** 3);
    if (Number.isFinite(quota) && quota >= 16 * 1024 ** 2 && quota !== user.quota) {
      onPatch(user, { quota });
    } else {
      setQuotaGb((user.quota / 1024 ** 3).toFixed(1));
    }
  };
  const percent = user.quota > 0 ? Math.min(100, user.usage / user.quota * 100) : 100;
  return (
    <span className="usage-cell">
      <span><i style={{ width: `${percent}%` }} /></span>
      <small>
        {formatBytes(user.usage)} /{" "}
        <label className="quota-input">
          <input
            type="number"
            min="0.016"
            max="102400"
            step="0.1"
            value={quotaGb}
            onChange={(event) => setQuotaGb(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            aria-label={`${user.name} 的配额（GB）`}
          />{" "}
          GB
        </label>
      </small>
    </span>
  );
}

function changedSettings(previous: SystemSettings, current: SystemSettings) {
  const patch: Partial<SystemSettings> = {};
  (Object.keys(current) as Array<keyof SystemSettings>).forEach((key) => {
    if (current[key] !== previous[key]) {
      Object.assign(patch, { [key]: current[key] });
    }
  });
  return patch;
}

function storageLabel(driver: StorageDriver) {
  if (driver === "webdav") return "WebDAV";
  if (driver === "smb") return "SMB 网络共享";
  return "本地文件系统";
}

function securityStateLabel(state: string) {
  const labels: Record<string, string> = {
    ready: "已就绪",
    encrypted: "已加密",
    "key-required": "需要密钥",
    "migration-required": "等待加密迁移",
    disabled: "未启用"
  };
  return labels[state] || state;
}

function keySourceLabel(source: string) {
  if (source === "file") return "外部密钥文件";
  if (source === "environment") return "运行环境";
  return source;
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86_400)} 天`;
}
