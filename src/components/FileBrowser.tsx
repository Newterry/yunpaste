import {
  Archive, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, CirclePlay,
  Clipboard, Copy, Download, File, FileAudio, FileCode2, FileImage, FileText,
  FileVideo, Folder, FolderHeart, FolderOpen, FolderPlus, Grid2X2, Heart,
  Images, LayoutList, Link2, MoreHorizontal, Move, Pencil, Plus, RotateCcw,
  SearchX, Share2, Star, Trash2, UploadCloud, X
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { api, isAbortError } from "../lib/api";
import type {
  FileItem, FileKind, FileLayout, FileSort, FolderCrumb, FolderItem, NavView
} from "../types";
import { fileExtension, formatBytes, formatDate } from "../lib/format";

const kindMeta: Record<string, { label: string; icon: typeof File; className: string }> = {
  text: { label: "文本", icon: FileCode2, className: "file-icon--text" },
  image: { label: "图片", icon: FileImage, className: "file-icon--image" },
  video: { label: "视频", icon: FileVideo, className: "file-icon--video" },
  audio: { label: "音频", icon: FileAudio, className: "file-icon--audio" },
  document: { label: "文档", icon: FileText, className: "file-icon--document" },
  archive: { label: "压缩包", icon: Archive, className: "file-icon--archive" },
  other: { label: "其他", icon: File, className: "file-icon--other" }
};

function useDismissibleMenu(open: boolean, close: () => void) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", keydown);
    };
  }, [close, open]);
  return root;
}

function SharedStatus({ file }: { file: FileItem }) {
  return <i className="manager-status is-shared"><Share2 /><span>已共享<small>{file.share_expires_at ? `有效至 ${formatDate(file.share_expires_at)}` : "未设置失效时间"}</small></span></i>;
}

export function FileTypeIcon({ file, large = false }: { file: FileItem; large?: boolean }) {
  const meta = kindMeta[file.kind] || kindMeta.other;
  const Icon = meta.icon;
  return <span className={`file-icon ${meta.className} ${large ? "file-icon--large" : ""}`}><Icon />{large && <small>{fileExtension(file.name)}</small>}</span>;
}

const filters: Array<[FileKind, string]> = [
  ["all", "全部"], ["text", "文本"], ["image", "图片"], ["video", "视频"],
  ["audio", "音频"], ["document", "文档"], ["archive", "压缩包"], ["other", "其他"]
];

const viewCopy: Record<NavView, { title: string; description: string }> = {
  overview: { title: "概览", description: "这是你的工作空间，最近文件都在这里。" },
  files: { title: "我的文件", description: "像桌面文件管理器一样整理、预览和分享内容" },
  shared: { title: "共享链接", description: "管理你已开启公共链接的内容" },
  favorites: { title: "收藏", description: "收藏的文件和文件夹会永久保留" },
  webdav: { title: "个人 WebDAV", description: "连接你的个人远端文件空间" },
  tickets: { title: "工单", description: "联系管理员并跟踪问题处理" },
  trash: { title: "回收站", description: "已删除的项目将在保留期后自动清理" },
  profile: { title: "个人设置", description: "管理头像、名称和密码" },
  admin: { title: "管理中心", description: "管理成员、存储策略与系统安全" }
};

interface Props {
  files: FileItem[];
  folders: FolderItem[];
  breadcrumbs: FolderCrumb[];
  currentFolderId: string | null;
  view: NavView;
  filter: FileKind;
  onFilter: (filter: FileKind) => void;
  selectedIds: Set<string>;
  selectedFolderIds: Set<string>;
  onSelect: (file: FileItem, additive?: boolean) => void;
  onSelectFolder: (folder: FolderItem, additive?: boolean) => void;
  activeFile?: FileItem;
  onPreview: (file?: FileItem) => void;
  onOpen: (file: FileItem) => void;
  onOpenFolder: (id: string | null) => void;
  layout: FileLayout;
  onLayout: (layout: FileLayout) => void;
  loading: boolean;
  uploading: boolean;
  page: number;
  pageSize: number;
  total: number;
  sortBy: FileSort;
  sortOrder: "asc" | "desc";
  userName: string;
  maxUploadMb: number;
  maxFilesPerUpload: number;
  allowedTypes: string;
  onUpload: (files: File[]) => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  onSort: (sort: FileSort) => void;
  onAdd: () => void;
  onCreateFolder: () => void;
  onPatch: (file: FileItem, patch: Partial<FileItem>) => void;
  onPatchFolder: (folder: FolderItem, patch: Partial<FolderItem>) => void;
  onDelete: (file: FileItem) => void;
  onDeleteFolder: (folder: FolderItem) => void;
  onDownload: (file: FileItem) => void;
  onCopyLink: (file: FileItem, days?: number) => void;
  onClipboard: (mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => void;
  onChooseDestination: (mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => void;
  onPaste: () => void;
  clipboardLabel?: string;
  onSendWebdav: (file: FileItem) => void;
  onSendWebdavSelection: (files: FileItem[]) => void;
}

export function FileBrowser(props: Props) {
  const {
    files, folders, breadcrumbs, currentFolderId, view, filter, onFilter,
    selectedIds, selectedFolderIds, onSelect, onSelectFolder, activeFile,
    onPreview, onOpen, onOpenFolder, layout, onLayout, loading, uploading,
    page, pageSize, total, sortBy, sortOrder, userName, maxUploadMb,
    maxFilesPerUpload, allowedTypes, onUpload, onPage, onPageSize, onSort,
    onAdd, onCreateFolder, onPatch, onPatchFolder, onDelete, onDeleteFolder,
    onDownload, onCopyLink, onClipboard, onChooseDestination, onPaste, clipboardLabel, onSendWebdav,
    onSendWebdavSelection
  } = props;
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedFiles = files.filter((file) => selectedIds.has(file.id));
  const selectedFolders = folders.filter((folder) => selectedFolderIds.has(folder.id));
  const hasItems = files.length > 0 || folders.length > 0;
  const copy = viewCopy[view] || viewCopy.files;
  const heading = view === "overview"
    ? `${new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好"}，${userName}`
    : copy.title;
  const uploadAccept = allowedTypes.split(",").includes("other") ? undefined : allowedTypes.split(",").flatMap((kind) => ({
    text: ["text/*", ".md", ".json", ".yaml", ".yml"], image: ["image/*"], video: ["video/*"],
    audio: ["audio/*", ".mp3", ".wav", ".flac", ".ogg", ".opus"], document: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".wps", ".et", ".dps"],
    archive: [".zip", ".rar", ".tar", ".gz", ".7z"]
  }[kind.trim()] || [])).join(",");

  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const incoming = Array.from(event.dataTransfer.files);
    if (incoming.length) onUpload(incoming);
  };

  return (
    <section className={`file-browser file-manager ${activeFile ? "file-browser--inspector-open" : ""}`}>
      <div className="page-heading">
        <div><h1>{heading}</h1><p>{copy.description}</p></div>
        <div className="page-heading__actions">
          {view === "files" && <button className="button button--secondary" onClick={onCreateFolder}><FolderPlus />新建文件夹</button>}
          <button className="button button--primary" onClick={onAdd} disabled={uploading}><Plus />添加内容</button>
        </div>
      </div>

      {view === "files" && (
        <div className="folder-breadcrumbs" aria-label="当前文件夹">
          {currentFolderId && <button className="folder-up-button" onClick={() => onOpenFolder(breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null)}><ChevronLeft />返回上一级</button>}
          <button className={!currentFolderId ? "is-current" : ""} onClick={() => onOpenFolder(null)}><FolderOpen />我的文件</button>
          {breadcrumbs.map((crumb) => <span key={crumb.id}><i>›</i><button className={crumb.id === currentFolderId ? "is-current" : ""} onClick={() => onOpenFolder(crumb.id)}>{crumb.name}</button></span>)}
        </div>
      )}

      {view === "files" && (
        <button className={`dropzone dropzone--compact ${dragging ? "is-dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <UploadCloud /><span>拖拽到当前文件夹，或 <strong>选择文件</strong></span><i>单文件 {formatBytes(maxUploadMb * 1024 ** 2)} · 最多 {maxFilesPerUpload} 个</i>
        </button>
      )}
      <input ref={fileInput} type="file" hidden multiple accept={uploadAccept} onChange={(event) => { const incoming = Array.from(event.target.files || []); if (incoming.length) onUpload(incoming); event.target.value = ""; }} />

      {clipboardLabel && <div className="clipboard-banner"><Clipboard /><span>{clipboardLabel}</span><button className="button button--secondary" onClick={onPaste}>粘贴到这里 <kbd>⌘V</kbd></button></div>}

      <div className="file-toolbar">
        <div className="filters" role="tablist" aria-label="文件类型">{filters.map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => onFilter(key)}>{label}</button>)}</div>
        <div className="file-toolbar__right">
          <div className="view-switch view-switch--inline" aria-label="显示方式">
            <button className={layout === "list" ? "is-active" : ""} onClick={() => onLayout("list")} title="列表视图"><LayoutList /></button>
            <button className={layout === "grid" ? "is-active" : ""} onClick={() => onLayout("grid")} title="文件夹视图"><Grid2X2 /></button>
            <button className={layout === "gallery" ? "is-active" : ""} onClick={() => onLayout("gallery")} title="图片视图"><Images /></button>
          </div>
          <label className="manager-sort">排序<select value={sortBy} onChange={(event) => onSort(event.target.value as FileSort)}><option value="updated">修改时间</option><option value="name">名称</option><option value="size">大小</option></select></label>
          <button className="icon-button" onClick={() => onSort(sortBy)} title="切换排序方向">{sortOrder === "asc" ? <ArrowUp /> : <ArrowDown />}</button>
        </div>
      </div>

      {loading && !hasItems ? <LoadingRows /> : !hasItems ? <EmptyState view={view} onUpload={() => fileInput.current?.click()} onCreateFolder={onCreateFolder} /> : layout === "list" ? (
        <div className="manager-list" role="grid">
          <div className="manager-list__head" role="row"><span>名称</span><span>大小</span><span>修改时间</span><span>状态</span><span /></div>
          {folders.map((folder) => <FolderRow key={folder.id} folder={folder} selected={selectedFolderIds.has(folder.id)} view={view} onSelect={onSelectFolder} onOpen={onOpenFolder} onPatch={onPatchFolder} onDelete={onDeleteFolder} onClipboard={onClipboard} onChooseDestination={onChooseDestination} />)}
          {files.map((file) => <FileRow key={file.id} file={file} selected={selectedIds.has(file.id)} active={activeFile?.id === file.id} view={view} onSelect={onSelect} onPreview={onPreview} onOpen={onOpen} onPatch={onPatch} onDelete={onDelete} onDownload={onDownload} onCopyLink={onCopyLink} onClipboard={onClipboard} onChooseDestination={onChooseDestination} onSendWebdav={onSendWebdav} />)}
        </div>
      ) : (
        <div className={`file-grid ${layout === "gallery" ? "file-grid--gallery" : ""}`}>
          {folders.map((folder) => <FolderCard key={folder.id} folder={folder} selected={selectedFolderIds.has(folder.id)} view={view} onSelect={onSelectFolder} onOpen={onOpenFolder} onPatch={onPatchFolder} onDelete={onDeleteFolder} onClipboard={onClipboard} onChooseDestination={onChooseDestination} />)}
          {files.map((file) => <FileCard key={file.id} file={file} gallery={layout === "gallery"} selected={selectedIds.has(file.id)} view={view} onSelect={onSelect} onPreview={onPreview} onOpen={onOpen} onPatch={onPatch} onDelete={onDelete} onDownload={onDownload} onCopyLink={onCopyLink} onClipboard={onClipboard} onChooseDestination={onChooseDestination} onSendWebdav={onSendWebdav} />)}
        </div>
      )}

      {total > 0 && <div className="file-pagination"><span>共 {total.toLocaleString()} 项</span><div><button className="icon-button" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft /></button><strong>{page} / {Math.max(1, Math.ceil(total / pageSize))}</strong><button className="icon-button" onClick={() => onPage(page + 1)} disabled={page >= Math.ceil(total / pageSize)}><ChevronRight /></button></div><label>每页<select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} 项</option>)}</select></label></div>}

      {(selectedFiles.length > 0 || selectedFolders.length > 0) && <div className="selection-bar"><strong>已选择 {selectedFiles.length + selectedFolders.length} 项</strong>{view !== "trash" && <><button onClick={() => onChooseDestination("copy")}><Copy />复制到</button><button onClick={() => onChooseDestination("move")}><Move />移动到</button><button onClick={() => onClipboard("copy")}><Clipboard />复制</button><button onClick={() => onClipboard("move")}><Move />剪切</button>{selectedFiles.length > 0 && <button onClick={() => onSendWebdavSelection(selectedFiles)}><UploadCloud />发送到 WebDAV</button>}</>}{selectedFiles.length === 1 && selectedFolders.length === 0 && <><button onClick={() => onPreview(selectedFiles[0])}><CirclePlay />预览</button><button onClick={() => onOpen(selectedFiles[0])}><FolderOpen />打开</button></>}{view === "trash" ? <><button onClick={() => { selectedFiles.forEach((file) => onPatch(file, { is_trashed: 0 })); selectedFolders.forEach((folder) => onPatchFolder(folder, { is_trashed: 0 })); }}><RotateCcw />恢复</button><button className="danger" onClick={() => { selectedFiles.forEach(onDelete); selectedFolders.forEach(onDeleteFolder); }}><Trash2 />永久删除</button></> : <button className="danger" onClick={() => { selectedFiles.forEach((file) => onPatch(file, { is_trashed: 1 })); selectedFolders.forEach((folder) => onPatchFolder(folder, { is_trashed: 1 })); }}><Trash2 />删除</button>}<button className="selection-bar__close" onClick={() => { selectedFiles.forEach((file) => onSelect(file, true)); selectedFolders.forEach((folder) => onSelectFolder(folder, true)); }}><X /></button></div>}
    </section>
  );
}

interface FileActions {
  file: FileItem; view: NavView; onPreview: (file: FileItem) => void; onOpen: (file: FileItem) => void;
  onPatch: (file: FileItem, patch: Partial<FileItem>) => void; onDelete: (file: FileItem) => void;
  onDownload: (file: FileItem) => void; onCopyLink: (file: FileItem, days?: number) => void;
  onClipboard: (mode: "copy" | "move", file?: FileItem) => void;
  onChooseDestination: (mode: "copy" | "move", file?: FileItem) => void;
  onSendWebdav: (file: FileItem) => void;
}

function FileMenu({ file, view, onPreview, onOpen, onPatch, onDelete, onDownload, onCopyLink, onClipboard, onChooseDestination, onSendWebdav, close }: FileActions & { close: () => void }) {
  const act = (fn: () => void) => { fn(); close(); };
  return <div className="context-menu manager-context"><button onClick={() => act(() => onOpen(file))}><FolderOpen />新窗口打开</button><button onClick={() => act(() => onPreview(file))}><CirclePlay />在侧栏预览</button>{view === "trash" ? <><button onClick={() => act(() => onPatch(file, { is_trashed: 0 }))}><RotateCcw />恢复</button><button onClick={() => act(() => onDelete(file))}><Trash2 />永久删除</button></> : <><button onClick={() => act(() => onCopyLink(file, 1))}><Link2 />快速分享（1 天）</button><button onClick={() => act(() => { const name = window.prompt("输入新的文件名", file.name)?.trim(); if (name && name !== file.name) onPatch(file, { name }); })}><Pencil />重命名</button><button onClick={() => act(() => onChooseDestination("copy", file))}><Copy />复制到…</button><button onClick={() => act(() => onChooseDestination("move", file))}><Move />移动到…</button><button onClick={() => act(() => onClipboard("copy", file))}><Clipboard />复制</button><button onClick={() => act(() => onClipboard("move", file))}><Move />剪切</button><button onClick={() => act(() => onSendWebdav(file))}><UploadCloud />发送到 WebDAV</button><button onClick={() => act(() => onPatch(file, { is_favorite: file.is_favorite ? 0 : 1 }))}><Heart />{file.is_favorite ? "取消收藏" : "收藏"}</button><button onClick={() => act(() => onDownload(file))}><Download />下载</button><button onClick={() => act(() => onPatch(file, { is_trashed: 1 }))}><Trash2 />移到回收站</button></>}</div>;
}

const FileRow = memo(function FileRow(props: FileActions & { selected: boolean; active: boolean; onSelect: (file: FileItem, additive?: boolean) => void }) {
  const { file, selected, active, onSelect, onPreview, onOpen } = props;
  const [menu, setMenu] = useState(false);
  const menuRoot = useDismissibleMenu(menu, () => setMenu(false));
  return <div ref={menuRoot as React.RefObject<HTMLDivElement>} className={`manager-row ${selected ? "is-selected" : ""} ${active ? "is-active" : ""}`} role="row" onDoubleClick={() => onOpen(file)} onContextMenu={(event) => { event.preventDefault(); onSelect(file); setMenu(true); }}><span className="manager-name"><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={() => onSelect(file, true)}>{selected && <Check />}</button><button className="file-name" onClick={() => { onSelect(file); onPreview(file); }}><FileTypeIcon file={file} /><i><strong>{file.name}</strong><small>{kindMeta[file.kind]?.label || "文件"}</small></i></button></span><span>{formatBytes(file.size)}</span><span>{formatDate(file.updated_at)}</span><span>{file.is_shared ? <SharedStatus file={file} /> : file.is_favorite ? <i className="manager-status"><Star />收藏</i> : <i className="manager-status">私有</i>}</span><span className="manager-more"><button className="icon-button" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-label={`打开 ${file.name} 的文件菜单`}><MoreHorizontal /></button>{menu && <FileMenu {...props} close={() => setMenu(false)} />}</span></div>;
});

const FileCard = memo(function FileCard(props: FileActions & { gallery: boolean; selected: boolean; onSelect: (file: FileItem, additive?: boolean) => void }) {
  const { file, gallery, selected, onSelect, onPreview, onOpen, onPatch } = props;
  const [menu, setMenu] = useState(false);
  const menuRoot = useDismissibleMenu(menu, () => setMenu(false));
  return <article ref={menuRoot as React.RefObject<HTMLElement>} className={`file-card manager-card ${gallery ? "manager-card--gallery" : ""} ${selected ? "is-selected" : ""}`} onDoubleClick={() => onOpen(file)} onContextMenu={(event) => { event.preventDefault(); onSelect(file); setMenu(true); }}><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={() => onSelect(file, true)}>{selected && <Check />}</button><button className="file-card__favorite" onClick={() => onPatch(file, { is_favorite: file.is_favorite ? 0 : 1 })}><Heart fill={file.is_favorite ? "currentColor" : "none"} /></button><button className="file-card__preview" onClick={() => { onSelect(file); onPreview(file); }}>{file.kind === "image" && gallery ? <FileThumbnail file={file} /> : <FileTypeIcon file={file} large />}</button><div className="file-card__info"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {formatDate(file.updated_at, false)}</span>{file.is_shared && <small className="file-card__share-expiry">{file.share_expires_at ? `分享有效至 ${formatDate(file.share_expires_at)}` : "分享未设置失效时间"}</small>}</div><button className="manager-card__menu icon-button" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-label={`打开 ${file.name} 的文件菜单`}><MoreHorizontal /></button>{menu && <FileMenu {...props} close={() => setMenu(false)} />}</article>;
});

function FileThumbnail({ file }: { file: FileItem }) {
  const [url, setUrl] = useState(file.id === "demo-poster" ? "/assets/summer-wander.webp" : "");
  useEffect(() => {
    if (file.id.startsWith("demo-")) return;
    const controller = new AbortController();
    api.fileAccess(file.id, controller.signal).then(({ rawUrl }) => setUrl(rawUrl)).catch((error) => { if (!isAbortError(error)) setUrl(""); });
    return () => controller.abort();
  }, [file.id]);
  return url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <FileTypeIcon file={file} large />;
}

interface FolderActions {
  folder: FolderItem; view: NavView; onOpen: (id: string) => void;
  onPatch: (folder: FolderItem, patch: Partial<FolderItem>) => void; onDelete: (folder: FolderItem) => void;
  onClipboard: (mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => void;
  onChooseDestination: (mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => void;
}

function FolderMenu({ folder, view, onOpen, onPatch, onDelete, onClipboard, onChooseDestination, close }: FolderActions & { close: () => void }) {
  const act = (fn: () => void) => { fn(); close(); };
  return <div className="context-menu manager-context"><button onClick={() => act(() => onOpen(folder.id))}><FolderOpen />打开文件夹</button>{view === "trash" ? <><button onClick={() => act(() => onPatch(folder, { is_trashed: 0 }))}><RotateCcw />恢复</button><button onClick={() => act(() => onDelete(folder))}><Trash2 />永久删除</button></> : <><button onClick={() => act(() => { const name = window.prompt("输入新的文件夹名称", folder.name)?.trim(); if (name && name !== folder.name) onPatch(folder, { name }); })}><Pencil />重命名</button><button onClick={() => act(() => onChooseDestination("copy", undefined, folder))}><Copy />复制到…</button><button onClick={() => act(() => onChooseDestination("move", undefined, folder))}><Move />移动到…</button><button onClick={() => act(() => onClipboard("copy", undefined, folder))}><Clipboard />复制</button><button onClick={() => act(() => onClipboard("move", undefined, folder))}><Move />剪切</button><button onClick={() => act(() => onPatch(folder, { is_favorite: folder.is_favorite ? 0 : 1 }))}><FolderHeart />{folder.is_favorite ? "取消收藏" : "收藏"}</button><button onClick={() => act(() => onPatch(folder, { is_trashed: 1 }))}><Trash2 />移到回收站</button></>}</div>;
}

const FolderRow = memo(function FolderRow(props: FolderActions & { selected: boolean; onSelect: (folder: FolderItem, additive?: boolean) => void }) {
  const { folder, selected, onSelect, onOpen } = props;
  const [menu, setMenu] = useState(false);
  const menuRoot = useDismissibleMenu(menu, () => setMenu(false));
  return <div ref={menuRoot as React.RefObject<HTMLDivElement>} className={`manager-row manager-row--folder ${selected ? "is-selected" : ""}`} role="row" onDoubleClick={() => onOpen(folder.id)} onContextMenu={(event) => { event.preventDefault(); onSelect(folder); setMenu(true); }}><span className="manager-name"><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={() => onSelect(folder, true)}>{selected && <Check />}</button><button className="file-name" onClick={() => onSelect(folder)}><span className="folder-icon"><Folder /></span><i><strong>{folder.name}</strong><small>文件夹 · 双击打开</small></i></button></span><span>—</span><span>{formatDate(folder.updated_at)}</span><span>{folder.is_favorite ? <i className="manager-status"><Star />永久保留</i> : <i className="manager-status">文件夹</i>}</span><span className="manager-more"><button className="icon-button" onClick={() => setMenu((value) => !value)}><MoreHorizontal /></button>{menu && <FolderMenu {...props} close={() => setMenu(false)} />}</span></div>;
});

const FolderCard = memo(function FolderCard(props: FolderActions & { selected: boolean; onSelect: (folder: FolderItem, additive?: boolean) => void }) {
  const { folder, selected, onSelect, onOpen, onPatch } = props;
  const [menu, setMenu] = useState(false);
  const menuRoot = useDismissibleMenu(menu, () => setMenu(false));
  return <article ref={menuRoot as React.RefObject<HTMLElement>} className={`file-card manager-card manager-folder-card ${selected ? "is-selected" : ""}`} onDoubleClick={() => onOpen(folder.id)} onContextMenu={(event) => { event.preventDefault(); onSelect(folder); setMenu(true); }}><button className={`fake-checkbox ${selected ? "is-checked" : ""}`} onClick={() => onSelect(folder, true)}>{selected && <Check />}</button><button className="file-card__favorite" onClick={() => onPatch(folder, { is_favorite: folder.is_favorite ? 0 : 1 })}><Heart fill={folder.is_favorite ? "currentColor" : "none"} /></button><button className="file-card__preview folder-card__preview" onClick={() => onOpen(folder.id)}><Folder /></button><div className="file-card__info"><strong>{folder.name}</strong><span>文件夹 · {formatDate(folder.updated_at, false)}</span></div><button className="manager-card__menu icon-button" onClick={() => setMenu((value) => !value)}><MoreHorizontal /></button>{menu && <FolderMenu {...props} close={() => setMenu(false)} />}</article>;
});

function LoadingRows() { return <div className="loading-list">{Array.from({ length: 6 }).map((_, index) => <i key={index} />)}</div>; }

function EmptyState({ view, onUpload, onCreateFolder }: { view: NavView; onUpload: () => void; onCreateFolder: () => void }) {
  return <div className="empty-state"><span>{view === "trash" ? <Trash2 /> : <SearchX />}</span><h2>{view === "trash" ? "回收站是空的" : "这个文件夹是空的"}</h2><p>{view === "trash" ? "删除的项目会在这里保留一段时间。" : "拖入文件，或创建一个文件夹开始整理。"}</p>{view === "files" && <div className="empty-state__actions"><button className="button button--secondary" onClick={onCreateFolder}><FolderPlus />新建文件夹</button><button className="button button--primary" onClick={onUpload}><UploadCloud />上传文件</button></div>}</div>;
}
