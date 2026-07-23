import { ChevronRight, Folder, FolderOpen, LoaderCircle, Move, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isAbortError } from "../lib/api";
import type { FolderCrumb, FolderItem } from "../types";

export function DestinationPicker({ mode, count, onConfirm, onClose, onToast }: {
  mode: "copy" | "move";
  count: number;
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "files", page: "1", pageSize: "1", sort: "name", order: "asc" });
    if (folderId) params.set("folderId", folderId);
    setLoading(true);
    api.files(params, controller.signal).then((result) => {
      setFolders(result.folders);
      setBreadcrumbs(result.breadcrumbs);
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [folderId, onToast]);

  return <div className="modal-backdrop destination-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="destination-dialog" role="dialog" aria-modal="true" aria-labelledby="destination-title">
      <header><span><Move /><div><h2 id="destination-title">{mode === "copy" ? "复制到" : "移动到"}</h2><p>为已选择的 {count} 项指定目标文件夹</p></div></span><button className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></header>
      <nav className="destination-crumbs" aria-label="目标路径"><button onClick={() => setFolderId(null)}><FolderOpen />我的文件</button>{breadcrumbs.map((crumb) => <span key={crumb.id}><ChevronRight /><button onClick={() => setFolderId(crumb.id)}>{crumb.name}</button></span>)}</nav>
      <div className="destination-list">{loading ? <div className="panel-loading"><LoaderCircle className="spin" />正在读取文件夹…</div> : folders.length ? folders.map((folder) => <button key={folder.id} onDoubleClick={() => setFolderId(folder.id)} onClick={() => setFolderId(folder.id)}><Folder /><span><strong>{folder.name}</strong><small>打开文件夹</small></span><ChevronRight /></button>) : <div className="destination-empty"><FolderOpen /><span>这里没有子文件夹</span></div>}</div>
      <footer><span>当前目标：<strong>{breadcrumbs.at(-1)?.name || "我的文件"}</strong></span><div><button className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" onClick={() => onConfirm(folderId)}>{mode === "copy" ? "复制到这里" : "移动到这里"}</button></div></footer>
    </section>
  </div>;
}
