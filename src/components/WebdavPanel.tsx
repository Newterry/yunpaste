import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight,
  Clipboard, ClipboardPaste, Cloud, Copy, Download, File, Folder, FolderOpen, FolderPlus,
  Grid2X2, Images, LayoutList, LoaderCircle, MoreHorizontal, Move, Pencil,
  RefreshCw, Search, Settings2, ShieldCheck, Trash2, UploadCloud, X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isAbortError } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import type { PersonalWebdav, WebdavItem } from "../types";
import { WebdavPreviewPanel } from "./PreviewPanel";

type RemoteLayout = "list" | "grid" | "gallery";
type RemoteSort = "name" | "size" | "modified";

function joinPath(...parts: string[]) {
  return parts.flatMap((part) => part.split("/")).filter(Boolean).join("/");
}

export function WebdavPanel({ onToast, onConfigure, onOpenMyFiles }: {
  onToast: (message: string) => void;
  onConfigure: () => void;
  onOpenMyFiles: () => void;
}) {
  const [connections, setConnections] = useState<PersonalWebdav[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"files" | "operation">();
  const [items, setItems] = useState<WebdavItem[]>([]);
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<RemoteLayout>("list");
  const [sort, setSort] = useState<RemoteSort>("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<"copy" | "move">();
  const [clipboard, setClipboard] = useState<{ connectionId: string; mode: "copy" | "move"; items: WebdavItem[] }>();
  const [detail, setDetail] = useState<WebdavItem>();
  const uploadInput = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback((nextPath = path, id = connectionId) => {
    if (!id) return () => {};
    const controller = new AbortController();
    setBusy("files");
    api.webdavFiles(id, nextPath, controller.signal).then((result) => {
      setItems(result.items);
      setPath(result.path);
      setSelected(new Set());
      setPage(1);
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(undefined);
    });
    return () => controller.abort();
  }, [connectionId, onToast, path]);

  useEffect(() => {
    const controller = new AbortController();
    api.webdav(controller.signal).then(({ connections: data }) => {
      setConnections(data);
      setConnectionId(data[0]?.id || "");
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoaded(true);
    });
    return () => controller.abort();
  }, [onToast]);

  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    setBusy("files");
    api.webdavFiles(connectionId, "", controller.signal).then((result) => {
      setItems(result.items);
      setPath(result.path);
      setSelected(new Set());
      setPage(1);
    }).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(undefined);
    });
    return () => controller.abort();
  }, [connectionId, onToast]);

  const shown = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
    const filtered = normalized
      ? items.filter((item) => item.name.normalize("NFKC").toLocaleLowerCase("zh-CN").includes(normalized))
      : items;
    return [...filtered].sort((a, b) => {
      let result = sort === "size" ? a.size - b.size
        : sort === "modified" ? Date.parse(a.modifiedAt || "") - Date.parse(b.modifiedAt || "")
          : a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
      if (a.isDir !== b.isDir) result = a.isDir ? -1 : 1;
      return order === "asc" ? result : -result;
    });
  }, [items, order, query, sort]);
  const pageItems = shown.slice((page - 1) * pageSize, page * pageSize);
  const selectedItems = items.filter((item) => selected.has(item.path));
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = connections.find((item) => item.id === connectionId);

  const runOperation = async (operation: () => Promise<unknown>, message: string) => {
    setBusy("operation");
    try {
      await operation();
      loadFiles(path, connectionId);
      onToast(message);
    } catch (error) {
      onToast((error as Error).message);
      setBusy(undefined);
    }
  };
  const createFolder = () => {
    const name = window.prompt("输入 WebDAV 文件夹名称", "新建文件夹")?.trim();
    if (name) void runOperation(() => api.createWebdavFolder(connectionId, joinPath(path, name)), "WebDAV 文件夹已创建");
  };
  const rename = (item: WebdavItem) => {
    const name = window.prompt("输入新名称", item.name)?.trim();
    if (!name || name === item.name) return;
    void runOperation(() => api.patchWebdavItem({ connectionId, action: "move", source: item.path, destination: joinPath(path, name), isDir: item.isDir }), "WebDAV 项目已重命名");
  };
  const remove = (targets: WebdavItem[]) => {
    if (!targets.length || !window.confirm(`确定永久删除 ${targets.length} 个远端项目吗？`)) return;
    void runOperation(async () => {
      for (const item of targets) await api.deleteWebdavItem(connectionId, item.path, item.isDir);
    }, "WebDAV 项目已删除");
  };
  const downloadItems = async (targets: WebdavItem[]) => {
    const files = targets.filter((item) => !item.isDir);
    if (!files.length) return onToast("请选择要下载的文件");
    try {
      for (const item of files) await api.downloadWebdavFile(connectionId, item);
      onToast(`已开始下载 ${files.length} 个文件`);
    } catch (error) { onToast((error as Error).message); }
  };
  const uploadLocalFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy("operation");
    try {
      const result = await api.uploadWebdavFiles(connectionId, path, files);
      loadFiles(path, connectionId);
      onToast(`已上传 ${result.uploaded.length} 个文件到 WebDAV`);
    } catch (error) {
      onToast((error as Error).message);
      setBusy(undefined);
    }
  };
  const toggle = (item: WebdavItem) => setSelected((value) => {
    const next = new Set(value);
    if (next.has(item.path)) next.delete(item.path); else next.add(item.path);
    return next;
  });
  const selectPage = () => {
    const everySelected = pageItems.length > 0 && pageItems.every((item) => selected.has(item.path));
    setSelected((value) => {
      const next = new Set(value);
      pageItems.forEach((item) => everySelected ? next.delete(item.path) : next.add(item.path));
      return next;
    });
  };
  const copyToClipboard = (mode: "copy" | "move", targets = selectedItems) => {
    if (!targets.length) return;
    setClipboard({ connectionId, mode, items: targets });
    setSelected(new Set());
    onToast(mode === "copy" ? `已复制 ${targets.length} 个远端项目` : `已剪切 ${targets.length} 个远端项目`);
  };
  const pasteClipboard = () => {
    if (!clipboard?.items.length) return;
    if (clipboard.connectionId !== connectionId) return onToast("请切换回原 WebDAV 连接后再粘贴");
    void runOperation(async () => {
      for (const item of clipboard.items) {
        await api.patchWebdavItem({ connectionId, action: clipboard.mode, source: item.path, destination: joinPath(path, item.name), isDir: item.isDir });
      }
      if (clipboard.mode === "move") setClipboard(undefined);
    }, clipboard.mode === "copy" ? "远端项目已粘贴" : "远端项目已移动");
  };
  const open = (item: WebdavItem) => item.isDir ? loadFiles(item.path, connectionId) : setDetail(item);
  const crumbs = path.split("/").filter(Boolean);

  if (!loaded) return <div className="panel-loading"><LoaderCircle className="spin" />正在载入个人 WebDAV…</div>;

  return <section className="settings-page webdav-page webdav-workspace">
    <div className="page-heading"><div><h1>个人 WebDAV</h1><p>在多个远端空间之间切换，并像“我的文件”一样整理内容。</p></div><div className="page-heading__actions">{connections.length > 0 && <label className="webdav-connection-switch"><Cloud /><span>当前连接</span><select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>}<button type="button" className="button button--secondary" onClick={onConfigure}><Settings2 />连接设置</button></div></div>
    <div className="integration-notice"><ShieldCheck /><span>连接和远端内容按用户完全隔离；管理员无法查看。</span></div>

    {!connections.length ? <div className="webdav-setup-empty"><Cloud /><h2>添加你的第一个 WebDAV</h2><p>可保存多个连接，完成测试后即可在这里管理远端文件。</p><button className="button button--primary" onClick={onConfigure}><Settings2 />前往个人设置</button></div> : <section className="settings-section webdav-browser">
      <div className="webdav-manager-head"><div><FolderOpen /><span><h2>{current?.name}</h2><p>{current?.config.url}</p></span></div><div><button className="button button--primary" onClick={() => uploadInput.current?.click()} disabled={Boolean(busy)}><UploadCloud />上传本地文件</button><button className="button button--secondary" onClick={onOpenMyFiles}><FolderOpen />打开我的文件</button><button className="button button--secondary" onClick={createFolder} disabled={Boolean(busy)}><FolderPlus />新建文件夹</button><button className="icon-button" onClick={() => loadFiles(path, connectionId)} disabled={Boolean(busy)} title="刷新"><RefreshCw className={busy === "files" ? "spin" : ""} /></button><input ref={uploadInput} hidden type="file" multiple onChange={(event) => { void uploadLocalFiles(Array.from(event.target.files || [])); event.target.value = ""; }} /></div></div>
      <div className="webdav-path"><button onClick={() => loadFiles("", connectionId)}><Cloud />根目录</button>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><i>›</i><button onClick={() => loadFiles(crumbs.slice(0, index + 1).join("/"), connectionId)}>{crumb}</button></span>)}</div>
      {clipboard && <div className="clipboard-banner"><Clipboard /><span>{clipboard.mode === "copy" ? "已复制" : "已剪切"} {clipboard.items.length} 个 WebDAV 项目</span><button className="button button--secondary" onClick={pasteClipboard} disabled={Boolean(busy)}><ClipboardPaste />粘贴到当前文件夹</button><button className="icon-button" onClick={() => setClipboard(undefined)} aria-label="清除 WebDAV 剪贴板"><X /></button></div>}
      <div className="webdav-toolbar">
        <label className="webdav-search"><Search /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索当前文件夹…" /></label>
        <div className="webdav-toolbar__right"><button className="button button--ghost webdav-select-page" onClick={selectPage}>{pageItems.length > 0 && pageItems.every((item) => selected.has(item.path)) ? "取消全选" : "全选当前页"}</button><div className="view-switch view-switch--inline"><button className={layout === "list" ? "is-active" : ""} onClick={() => setLayout("list")} title="列表视图"><LayoutList /></button><button className={layout === "grid" ? "is-active" : ""} onClick={() => setLayout("grid")} title="网格视图"><Grid2X2 /></button><button className={layout === "gallery" ? "is-active" : ""} onClick={() => setLayout("gallery")} title="图片视图"><Images /></button></div><label className="manager-sort">排序<select value={sort} onChange={(event) => setSort(event.target.value as RemoteSort)}><option value="name">名称</option><option value="size">大小</option><option value="modified">修改时间</option></select></label><button className="icon-button" onClick={() => setOrder((value) => value === "asc" ? "desc" : "asc")} title="切换排序方向">{order === "asc" ? <ArrowUp /> : <ArrowDown />}</button></div>
      </div>
      {path && <button className="webdav-up" onClick={() => loadFiles(crumbs.slice(0, -1).join("/"), connectionId)}><ArrowLeft />返回上一级</button>}
      {busy === "files" && !items.length ? <div className="panel-loading"><LoaderCircle className="spin" />正在读取 WebDAV 目录…</div> : pageItems.length ? layout === "list" ? <div className="webdav-file-list webdav-manager-list"><div className="webdav-file-list__head"><span>名称</span><span>大小</span><span>修改时间</span><span>操作</span></div>{pageItems.map((item) => <WebdavRow key={item.path} item={item} selected={selected.has(item.path)} onSelect={() => toggle(item)} onOpen={() => open(item)} onDownload={() => downloadItems([item])} onRename={() => rename(item)} onCopy={() => { setSelected(new Set([item.path])); setDestination("copy"); }} onMove={() => { setSelected(new Set([item.path])); setDestination("move"); }} onClipboardCopy={() => copyToClipboard("copy", [item])} onClipboardMove={() => copyToClipboard("move", [item])} onDelete={() => remove([item])} />)}</div> : <div className={`webdav-grid ${layout === "gallery" ? "is-gallery" : ""}`}>{pageItems.map((item) => <WebdavCard key={item.path} item={item} selected={selected.has(item.path)} onSelect={() => toggle(item)} onOpen={() => open(item)} onMore={() => setDetail(item)} />)}</div> : <div className="overview-empty">{query ? "没有匹配的远端项目。" : "这个 WebDAV 文件夹是空的。"}</div>}
      {shown.length > 0 && <div className="file-pagination"><span>共 {shown.length} 项</span><div><button className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft /></button><strong>{page} / {pages}</strong><button className="icon-button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page >= pages}><ChevronRight /></button></div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} 项</option>)}</select></label></div>}
    </section>}
    {selectedItems.length > 0 && <div className="selection-bar webdav-selection-bar"><strong>已选择 {selectedItems.length} 项</strong>{selectedItems.length === 1 && <><button onClick={() => open(selectedItems[0])}><FolderOpen />打开</button><button onClick={() => rename(selectedItems[0])}><Pencil />重命名</button></>}<button onClick={() => setDestination("copy")}><Copy />复制到</button><button onClick={() => setDestination("move")}><Move />移动到</button><button onClick={() => copyToClipboard("copy")}><Clipboard />复制</button><button onClick={() => copyToClipboard("move")}><Move />剪切</button><button onClick={() => downloadItems(selectedItems)}><Download />下载</button><button className="danger" onClick={() => remove(selectedItems)}><Trash2 />删除</button><button className="selection-bar__close" onClick={() => setSelected(new Set())}><X /></button></div>}
    {destination && <WebdavDestination connectionId={connectionId} mode={destination} targets={selectedItems} onClose={() => setDestination(undefined)} onDone={() => { setDestination(undefined); loadFiles(path, connectionId); onToast(destination === "copy" ? "远端项目已复制" : "远端项目已移动"); }} onToast={onToast} />}
    {detail && !detail.isDir && <WebdavPreviewPanel connectionId={connectionId} item={detail} onClose={() => setDetail(undefined)} onDownload={() => void downloadItems([detail])} />}
    {detail?.isDir && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(undefined); }}><section className="modal remote-detail-modal" role="dialog" aria-modal="true" aria-labelledby="remote-detail-title"><div className="modal__header"><div><h2 id="remote-detail-title">{detail.name}</h2><p>远端文件夹</p></div><button className="icon-button" onClick={() => setDetail(undefined)}><X /></button></div><div className="remote-detail-body"><Folder /><dl><div><dt>完整路径</dt><dd>{detail.path}</dd></div><div><dt>修改时间</dt><dd>{detail.modifiedAt ? formatDate(detail.modifiedAt) : "—"}</dd></div></dl></div><div className="modal__footer remote-detail-actions"><button className="button button--primary" onClick={() => { open(detail); setDetail(undefined); }}><FolderOpen />打开</button><button className="button button--secondary" onClick={() => { rename(detail); setDetail(undefined); }}><Pencil />重命名</button><button className="button button--secondary" onClick={() => { setSelected(new Set([detail.path])); setDetail(undefined); setDestination("copy"); }}><Copy />复制到</button><button className="button button--secondary" onClick={() => { setSelected(new Set([detail.path])); setDetail(undefined); setDestination("move"); }}><Move />移动到</button><button className="button button--ghost danger-text" onClick={() => { remove([detail]); setDetail(undefined); }}><Trash2 />删除</button></div></section></div>}
  </section>;
}

function WebdavRow({ item, selected, onSelect, onOpen, onDownload, onRename, onCopy, onMove, onClipboardCopy, onClipboardMove, onDelete }: {
  item: WebdavItem; selected: boolean; onSelect: () => void; onOpen: () => void; onDownload: () => void; onRename: () => void; onCopy: () => void; onMove: () => void; onClipboardCopy: () => void; onClipboardMove: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return <div className={`webdav-file-row ${selected ? "is-selected" : ""} ${menu ? "has-open-menu" : ""}`} onDoubleClick={onOpen} onContextMenu={(event) => { event.preventDefault(); setMenu(true); }}><span className="webdav-file-name"><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={onSelect}>{selected && <Check />}</button><button onClick={onOpen}>{item.isDir ? <Folder /> : <File />}<span><strong>{item.name}</strong><small>{item.isDir ? "文件夹" : item.mime || "文件"}</small></span></button></span><span>{item.isDir ? "—" : formatBytes(item.size)}</span><span>{item.modifiedAt ? formatDate(item.modifiedAt) : "—"}</span><span className="webdav-row-actions"><button className="icon-button" onClick={() => setMenu((value) => !value)}><MoreHorizontal /></button>{menu && <div className="context-menu manager-context"><button onClick={() => { onOpen(); setMenu(false); }}><FolderOpen />{item.isDir ? "打开" : "预览"}</button>{!item.isDir && <button onClick={() => { onDownload(); setMenu(false); }}><Download />下载</button>}<button onClick={() => { onRename(); setMenu(false); }}><Pencil />重命名</button><button onClick={() => { onCopy(); setMenu(false); }}><Copy />复制到…</button><button onClick={() => { onMove(); setMenu(false); }}><Move />移动到…</button><button onClick={() => { onClipboardCopy(); setMenu(false); }}><Clipboard />复制</button><button onClick={() => { onClipboardMove(); setMenu(false); }}><Move />剪切</button><button onClick={() => { onDelete(); setMenu(false); }}><Trash2 />删除</button></div>}</span></div>;
}

function WebdavCard({ item, selected, onSelect, onOpen, onMore }: { item: WebdavItem; selected: boolean; onSelect: () => void; onOpen: () => void; onMore: () => void }) {
  return <article className={`webdav-card ${selected ? "is-selected" : ""}`} onDoubleClick={onOpen}><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={onSelect}>{selected && <Check />}</button><button className="webdav-card__preview" onClick={onOpen}>{item.isDir ? <Folder /> : <File />}</button><div><strong>{item.name}</strong><span>{item.isDir ? "文件夹" : `${formatBytes(item.size)} · ${item.mime || "文件"}`}</span></div><button className="icon-button" onClick={onMore}><MoreHorizontal /></button></article>;
}

function WebdavDestination({ connectionId, mode, targets, onClose, onDone, onToast }: { connectionId: string; mode: "copy" | "move"; targets: WebdavItem[]; onClose: () => void; onDone: () => void; onToast: (message: string) => void }) {
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<WebdavItem[]>([]);
  const [loading, setLoading] = useState(false);
  const browse = useCallback((next: string) => {
    setLoading(true);
    api.webdavFiles(connectionId, next).then(({ items }) => { setPath(next); setFolders(items.filter((item) => item.isDir)); }).catch((error) => onToast((error as Error).message)).finally(() => setLoading(false));
  }, [connectionId, onToast]);
  useEffect(() => { browse(""); }, [browse]);
  const confirm = async () => {
    setLoading(true);
    try {
      for (const item of targets) await api.patchWebdavItem({ connectionId, action: mode, source: item.path, destination: joinPath(path, item.name), isDir: item.isDir });
      onDone();
    } catch (error) { onToast((error as Error).message); setLoading(false); }
  };
  const crumbs = path.split("/").filter(Boolean);
  return <div className="modal-backdrop"><section className="modal destination-modal" role="dialog" aria-modal="true" aria-labelledby="webdav-destination-title"><div className="modal__header"><div><h2 id="webdav-destination-title">{mode === "copy" ? "复制到" : "移动到"} WebDAV 文件夹</h2><p>选择 {targets.length} 个项目的目标目录</p></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="destination-path"><button onClick={() => browse("")}><Cloud />根目录</button>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><i>›</i><button onClick={() => browse(crumbs.slice(0, index + 1).join("/"))}>{crumb}</button></span>)}</div><div className="destination-list">{loading ? <div className="panel-loading"><LoaderCircle className="spin" />读取目录…</div> : folders.length ? folders.map((folder) => <button key={folder.path} onDoubleClick={() => browse(folder.path)} onClick={() => browse(folder.path)}><Folder /><span><strong>{folder.name}</strong><small>打开此文件夹</small></span></button>) : <div className="overview-empty">这里没有子文件夹</div>}</div><div className="modal__footer"><button className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" onClick={confirm} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : mode === "copy" ? <Copy /> : <Move />}{mode === "copy" ? "复制到这里" : "移动到这里"}</button></div></section></div>;
}
