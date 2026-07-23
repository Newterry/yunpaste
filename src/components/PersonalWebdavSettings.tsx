import {
  CheckCircle2, Cloud, KeyRound, Link2, LoaderCircle, Pencil, Plus, Save,
  Server, ShieldCheck, Trash2, Wifi
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, isAbortError } from "../lib/api";
import type { PersonalWebdav, StorageConfig, StorageHealth } from "../types";

const emptyConfig: StorageConfig = {
  driver: "webdav", url: "", vendor: "other", username: "", basePath: "", allowInsecure: false
};

export function PersonalWebdavSettings({ onToast, onChanged }: {
  onToast: (message: string) => void;
  onChanged?: (webdav?: PersonalWebdav) => void;
}) {
  const [connections, setConnections] = useState<PersonalWebdav[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("我的 WebDAV");
  const [config, setConfig] = useState<StorageConfig>(emptyConfig);
  const [password, setPassword] = useState("");
  const [health, setHealth] = useState<StorageHealth>();
  const [testProof, setTestProof] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "delete">();

  const edit = useCallback((connection?: PersonalWebdav) => {
    setEditingId(connection?.id);
    setName(connection?.name || "我的 WebDAV");
    setConfig({ ...emptyConfig, ...(connection?.config || {}), driver: "webdav" });
    setPassword("");
    setHealth(undefined);
    setTestProof("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.webdav(controller.signal).then(({ connections: data }) => {
      setConnections(data);
      edit(data[0]);
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoaded(true);
    });
    return () => controller.abort();
  }, [edit, onToast]);

  const current = connections.find((item) => item.id === editingId);

  const test = async () => {
    setBusy("test");
    try {
      const { status, testProof: proof } = await api.testWebdav(config, password || undefined, editingId);
      setHealth(status);
      setTestProof(proof);
      onToast("连接测试成功；保存后即可管理远端文件");
    } catch (error) {
      setHealth({ state: "error", message: (error as Error).message });
      onToast((error as Error).message);
    } finally { setBusy(undefined); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    try {
      const result = editingId
        ? await api.saveWebdav(editingId, name, config, password || undefined, testProof || undefined)
        : await api.createWebdav(name, config, password || undefined, testProof || undefined);
      setConnections((items) => {
        const next = items.some((item) => item.id === result.webdav.id)
          ? items.map((item) => item.id === result.webdav.id ? result.webdav : item)
          : [result.webdav, ...items];
        return next;
      });
      setEditingId(result.webdav.id);
      setConfig({ ...emptyConfig, ...result.webdav.config, driver: "webdav" });
      setHealth(result.status);
      setPassword("");
      setTestProof("");
      onChanged?.(result.webdav);
      onToast(editingId ? "WebDAV 连接已更新" : "WebDAV 连接已添加");
    } catch (error) { onToast((error as Error).message); } finally { setBusy(undefined); }
  };

  const remove = async () => {
    if (!editingId || !window.confirm(`移除“${current?.name || name}”？远端文件不会被删除。`)) return;
    setBusy("delete");
    try {
      await api.deleteWebdav(editingId);
      const next = connections.filter((item) => item.id !== editingId);
      setConnections(next);
      edit(next[0]);
      onChanged?.(next[0]);
      onToast("WebDAV 连接已移除");
    } catch (error) { onToast((error as Error).message); } finally { setBusy(undefined); }
  };

  return <section id="personal-webdav-settings" className="settings-section profile-card-large personal-webdav-settings">
    <div className="settings-section__title"><Cloud /><span><h2>个人 WebDAV</h2><p>可添加多个独立连接，远端文件只对你可见</p></span></div>
    <div className="integration-notice"><ShieldCheck /><span>每条连接的凭据均加密保存；管理员无法查看密码或远端文件。</span></div>
    {!loaded ? <div className="panel-loading"><LoaderCircle className="spin" />正在读取连接设置…</div> : <div className="webdav-settings-layout">
      <aside className="webdav-connection-list">
        <div><strong>已保存连接</strong><span>{connections.length} / 20</span></div>
        {connections.map((connection) => <button type="button" key={connection.id} className={editingId === connection.id ? "is-active" : ""} onClick={() => edit(connection)}>
          <Server /><span><strong>{connection.name}</strong><small>{connection.config.url || "未设置地址"}</small></span><Pencil />
        </button>)}
        <button type="button" className="webdav-add-connection" onClick={() => edit()}><Plus />添加连接</button>
      </aside>
      <form className="webdav-form" onSubmit={save}>
        <div className="webdav-editor-title"><span><strong>{editingId ? "编辑连接" : "添加连接"}</strong><small>{editingId ? "修改后需重新通过连接测试" : "最多可保存 20 个连接"}</small></span>{current?.enabled && <i><CheckCircle2 />已启用</i>}</div>
        <div className="field-grid">
          <label className="field"><span>连接名称</span><input value={name} onChange={(event) => { setName(event.target.value); setTestProof(""); }} maxLength={60} placeholder="例如：家庭 NAS" required /></label>
          <label className="field field--wide"><span>WebDAV 地址</span><div className="field-with-icon"><Link2 /><input type="url" value={config.url || ""} onChange={(event) => { setConfig((value) => ({ ...value, url: event.target.value })); setTestProof(""); }} placeholder="https://dav.example.com/remote.php/dav/files/user/" required /></div></label>
          <label className="field"><span>服务类型</span><select value={config.vendor || "other"} onChange={(event) => { setConfig((value) => ({ ...value, vendor: event.target.value as StorageConfig["vendor"] })); setTestProof(""); }}><option value="other">通用 WebDAV</option><option value="nextcloud">Nextcloud</option><option value="owncloud">ownCloud</option><option value="fastmail">Fastmail</option><option value="sharepoint">SharePoint</option><option value="rclone">rclone</option></select></label>
          <label className="field"><span>用户名</span><input value={config.username || ""} onChange={(event) => { setConfig((value) => ({ ...value, username: event.target.value })); setTestProof(""); }} autoComplete="username" /></label>
          <label className="field"><span>密码 / 应用密码</span><div className="field-with-icon"><KeyRound /><input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setTestProof(""); }} placeholder={current?.credentialsConfigured ? "已保存，留空保持不变" : "请输入密码"} autoComplete="new-password" /></div></label>
          <label className="field"><span>远端根目录（可选）</span><input value={config.basePath || ""} onChange={(event) => { setConfig((value) => ({ ...value, basePath: event.target.value })); setTestProof(""); }} placeholder="YunPaste" /></label>
        </div>
        {health && <div className={`connection-result ${health.state === "connected" ? "is-success" : "is-error"}`}>{health.state === "connected" ? <CheckCircle2 /> : <Wifi />}<span><strong>{health.state === "connected" ? "测试成功" : "连接失败"}</strong><small>{health.message || (health.latencyMs ? `${health.latencyMs} ms` : "连接可用")}</small></span></div>}
        <div className="form-actions webdav-actions"><span>{current?.updatedAt ? `上次保存：${new Date(current.updatedAt).toLocaleString("zh-CN")}` : "测试不会自动保存连接"}</span><div>{editingId && <button type="button" className="button button--ghost danger-text" onClick={remove} disabled={Boolean(busy)}>{busy === "delete" ? <LoaderCircle className="spin" /> : <Trash2 />}移除</button>}<button type="button" className="button button--secondary" onClick={test} disabled={Boolean(busy)}>{busy === "test" ? <LoaderCircle className="spin" /> : <Wifi />}测试连接</button><button type="submit" className="button button--primary" disabled={Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin" /> : <Save />}{editingId ? "保存修改" : "添加连接"}</button></div></div>
      </form>
    </div>}
  </section>;
}
