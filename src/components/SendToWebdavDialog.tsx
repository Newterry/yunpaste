import { Cloud, Folder, LoaderCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, isAbortError } from "../lib/api";
import type { FileItem, PersonalWebdav, WebdavItem } from "../types";

export function SendToWebdavDialog({ files, onClose, onComplete, onToast }: {
  files: FileItem[];
  onClose: () => void;
  onComplete: () => void;
  onToast: (message: string) => void;
}) {
  const [connections, setConnections] = useState<PersonalWebdav[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<WebdavItem[]>([]);
  const [busy, setBusy] = useState(true);

  const browse = useCallback((id: string, nextPath: string) => {
    if (!id) return;
    setBusy(true);
    api.webdavFiles(id, nextPath).then(({ items }) => {
      setPath(nextPath);
      setFolders(items.filter((item) => item.isDir));
    }).catch((error) => onToast((error as Error).message)).finally(() => setBusy(false));
  }, [onToast]);

  useEffect(() => {
    const controller = new AbortController();
    api.webdav(controller.signal).then(({ connections: data }) => {
      setConnections(data);
      const id = data[0]?.id || "";
      setConnectionId(id);
      if (id) browse(id, ""); else setBusy(false);
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
      setBusy(false);
    });
    return () => controller.abort();
  }, [browse, onToast]);

  const send = async () => {
    if (!connectionId) return onToast("请先在个人设置中添加 WebDAV 连接");
    setBusy(true);
    try {
      for (const file of files) {
        const destination = [path, file.name].filter(Boolean).join("/");
        await api.exportWebdavFile(connectionId, file.id, destination);
      }
      onToast(`已将 ${files.length} 个文件发送到 WebDAV`);
      onComplete();
    } catch (error) {
      onToast((error as Error).message);
      setBusy(false);
    }
  };
  const crumbs = path.split("/").filter(Boolean);

  return <div className="modal-backdrop" role="presentation"><section className="modal destination-modal send-webdav-modal" role="dialog" aria-modal="true" aria-labelledby="send-webdav-title"><div className="modal__header"><div><h2 id="send-webdav-title">发送到 WebDAV</h2><p>将 {files.length} 个文件发送到指定连接和目录</p></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="send-webdav-connection"><label>连接<select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); browse(event.target.value, ""); }}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>{!connections.length && <button className="button button--secondary" disabled>尚未配置连接</button>}</div><div className="destination-path"><button onClick={() => browse(connectionId, "")}><Cloud />根目录</button>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><i>›</i><button onClick={() => browse(connectionId, crumbs.slice(0, index + 1).join("/"))}>{crumb}</button></span>)}</div><div className="destination-list">{busy ? <div className="panel-loading"><LoaderCircle className="spin" />读取远端目录…</div> : folders.length ? folders.map((folder) => <button key={folder.path} onClick={() => browse(connectionId, folder.path)}><Folder /><span><strong>{folder.name}</strong><small>进入此文件夹</small></span></button>) : <div className="overview-empty">此目录没有子文件夹</div>}</div><div className="modal__footer"><button className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" onClick={send} disabled={busy || !connectionId}>{busy ? <LoaderCircle className="spin" /> : <Send />}发送到这里</button></div></section></div>;
}
