import {
  ArrowRight, CheckCircle2, Clock3, Copy, Download,
  FileClock, FileText, Files, Grid2X2, HardDrive, Heart, Image, Images, LayoutList,
  Link2, LoaderCircle, Plus, Star, Trash2, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, isAbortError } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import type { FileItem, NavView, OverviewData, User } from "../types";
import { FileTypeIcon } from "./FileBrowser";

function appendUniqueFiles(current: FileItem[], incoming: FileItem[]) {
  const seen = new Set(current.map((file) => file.id));
  return [...current, ...incoming.filter((file) => !seen.has(file.id))];
}

export function OverviewPanel({
  user, demoFiles, onNavigate, onAdd, onPreview, onPatch, onDownload, onToast
}: {
  user: User;
  demoFiles?: FileItem[];
  onNavigate: (view: NavView) => void;
  onAdd: () => void;
  onPreview: (file: FileItem) => void;
  onPatch: (file: FileItem, patch: Partial<FileItem>) => void;
  onDownload: (file: FileItem) => void;
  onToast: (message: string) => void;
}) {
  const [data, setData] = useState<OverviewData>();
  const [loading, setLoading] = useState(true);
  const [contentFilter, setContentFilter] = useState<"all" | "text" | "image" | "file" | "favorite">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("tieyun.overview.pageSize"));
      return [5, 10, 20, 50].includes(stored) ? stored : 10;
    } catch { return 10; }
  });
  const [layout, setLayout] = useState<"list" | "grid" | "gallery">(() => {
    try {
      const stored = localStorage.getItem("tieyun.overview.layout");
      return stored === "grid" || stored === "gallery" ? stored : "list";
    } catch { return "list"; }
  });
  const [copyNotice, setCopyNotice] = useState(false);
  const copyNoticeTimer = useRef<number | undefined>(undefined);
  const loadOlderRef = useRef<HTMLButtonElement | null>(null);
  const [retentionVisible, setRetentionVisible] = useState(() => {
    try { return localStorage.getItem("tieyun.retention-notice.hidden") !== "1"; } catch { return true; }
  });

  useEffect(() => {
    if (demoFiles) {
      const now = Date.now();
      const active = demoFiles.filter((file) => !file.is_trashed);
      const filtered = active.filter((file) => contentFilter === "all"
        || (contentFilter === "favorite" ? Boolean(file.is_favorite) : contentFilter === "file" ? !["text", "image"].includes(file.kind) : file.kind === contentFilter));
      const expiring = active
        .filter((file) => file.expires_at && Date.parse(file.expires_at) > now)
        .sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!));
      const nextRecent = [...filtered]
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice((page - 1) * pageSize, page * pageSize);
      setData((current) => ({
        totalFiles: active.length,
        expiringSoon: expiring.filter((file) => Date.parse(file.expires_at!) <= now + 7 * 86_400_000).length,
        activeShares: active.filter((file) => file.is_shared).length,
        usage: user.usage,
        quota: user.quota,
        recent: page === 1 ? nextRecent : appendUniqueFiles(current?.recent || [], nextRecent),
        recentTotal: filtered.length,
        recentPage: page,
        recentPageSize: pageSize,
        expiring: expiring.filter((file) => Date.parse(file.expires_at!) <= now + 7 * 86_400_000).slice(0, 6),
        expiryWarningDays: 7
      }));
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api.overview({ page, pageSize, filter: contentFilter }, controller.signal)
      .then(({ overview }) => setData((current) => ({
        ...overview,
        recent: page === 1
          ? overview.recent
          : appendUniqueFiles(current?.recent || [], overview.recent)
      })))
      .catch((error) => {
        if (!isAbortError(error)) onToast((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contentFilter, demoFiles, onToast, page, pageSize, user.quota, user.usage]);

  useEffect(() => () => {
    if (copyNoticeTimer.current) window.clearTimeout(copyNoticeTimer.current);
  }, []);

  const showCopied = () => {
    setCopyNotice(false);
    window.requestAnimationFrame(() => setCopyNotice(true));
    if (copyNoticeTimer.current) window.clearTimeout(copyNoticeTimer.current);
    copyNoticeTimer.current = window.setTimeout(() => setCopyNotice(false), 1_700);
  };
  const chooseLayout = (next: "list" | "grid" | "gallery") => {
    setLayout(next);
    try { localStorage.setItem("tieyun.overview.layout", next); } catch { /* preference remains in memory */ }
  };
  const choosePageSize = (next: number) => {
    setPageSize(next);
    setPage(1);
    try { localStorage.setItem("tieyun.overview.pageSize", String(next)); } catch { /* preference remains in memory */ }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const usage = data?.usage ?? user.usage;
  const quota = data?.quota ?? user.quota;
  const percent = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 100;
  const recent = data?.recent || [];
  const recentTotal = data?.recentTotal || 0;
  const pages = Math.max(1, Math.ceil(recentTotal / pageSize));
  const canLoadMore = recent.length < recentTotal && page < pages;
  const loadOlder = () => {
    if (!loading && canLoadMore) setPage((value) => Math.min(pages, value + 1));
  };
  useEffect(() => {
    const target = loadOlderRef.current;
    if (!target || !canLoadMore) return;
    const root = target.closest<HTMLElement>(".overview-panel");
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadOlder();
    }, { root, rootMargin: "0px 0px 180px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, loading, page, pages]);
  const patchRecent = (file: FileItem, patch: Partial<FileItem>) => {
    setData((current) => current ? {
      ...current,
      recent: current.recent.map((item) => item.id === file.id ? { ...item, ...patch } : item)
    } : current);
    onPatch(file, patch);
  };

  return (
    <section className="overview-panel">
      {copyNotice && <div className="overview-copy-toast" role="status" aria-live="polite"><CheckCircle2 /><span>内容已复制</span></div>}
      <div className="page-heading overview-heading">
        <div>
          <h1>{greeting}，{user.name}</h1>
          <p>这里展示空间状态、近期内容和需要处理的文件。</p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--primary" onClick={onAdd}><Plus /><span>添加内容</span></button>
        </div>
      </div>

      {retentionVisible && <div className="retention-notice">
        <Clock3 />
        <span><strong>保留期提示</strong>普通文件会按保留期自动清理；收藏后的文件永久保留。</span>
        <button onClick={() => onNavigate("favorites")}><Star />查看收藏</button>
        <button className="retention-notice__close" onClick={() => { setRetentionVisible(false); try { localStorage.setItem("tieyun.retention-notice.hidden", "1"); } catch { /* preference remains in memory */ } }} aria-label="关闭保留期提示"><X /></button>
      </div>}

      <div className="overview-metrics" aria-label="空间概览">
        <Metric icon={HardDrive} label="存储空间" value={`${formatBytes(usage)} / ${formatBytes(quota)}`} detail={`${percent}% 已使用`} />
        <Metric icon={Files} label="文件总数" value={String(data?.totalFiles ?? "—")} detail="当前有效文件" />
        <Metric icon={FileClock} label="即将过期" value={String(data?.expiringSoon ?? "—")} detail={`未来 ${data?.expiryWarningDays ?? 7} 天`} accent="warning" />
        <Metric icon={Link2} label="活跃分享" value={String(data?.activeShares ?? "—")} detail="尚未失效" accent="success" />
      </div>

      {loading && !data ? (
        <div className="panel-loading"><LoaderCircle className="spin" />正在载入概览…</div>
      ) : (
        <div className="overview-columns">
          <section className="overview-recent clipboard-feed">
            <div className="section-title">
              <div><h2>最近内容</h2><p>直接查看、选择和复制内容</p></div>
              <button onClick={() => onNavigate("files")}>查看全部<ArrowRight /></button>
            </div>
            <div className="clipboard-tabs" role="tablist" aria-label="最近内容类型">
              {([[
                "all", "全部"
              ], ["text", "文本"], ["image", "图片"], ["file", "文件"], ["favorite", "收藏"]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={contentFilter === key} className={contentFilter === key ? "is-active" : ""} onClick={() => { setContentFilter(key); setPage(1); }}>{label}</button>)}
              <span className="clipboard-tabs__spacer" />
              <span className="clipboard-view-switch" aria-label="切换最近内容视图">
                <button className={layout === "list" ? "is-active" : ""} onClick={() => chooseLayout("list")} title="列表视图"><LayoutList /></button>
                <button className={layout === "grid" ? "is-active" : ""} onClick={() => chooseLayout("grid")} title="网格视图"><Grid2X2 /></button>
                <button className={layout === "gallery" ? "is-active" : ""} onClick={() => chooseLayout("gallery")} title="图片视图"><Images /></button>
              </span>
            </div>
            {recent.length ? (
              <div className={`clipboard-list clipboard-list--${layout}`} aria-label="最近内容列表">
                {recent.map((file) => <ClipboardCard key={file.id} file={file} layout={layout} demo={Boolean(demoFiles)} onPreview={() => onPreview(file)} onPatch={(patch) => patchRecent(file, patch)} onDownload={() => onDownload(file)} onToast={onToast} onCopied={showCopied} />)}
                {canLoadMore && <button ref={loadOlderRef} className="overview-load-more" type="button" onClick={loadOlder} disabled={loading}>{loading ? <><LoaderCircle className="spin" />正在加载旧内容…</> : <>继续加载旧内容<ArrowRight /></>}</button>}
              </div>
            ) : <div className="overview-empty">{data?.recent.length ? "此分类暂无内容。" : "还没有内容，先上传或粘贴一条试试。"}</div>}
            {recentTotal > 0 && <div className="file-pagination overview-pagination">
              <span>已显示 {recent.length} / {recentTotal} 项</span>
              <div className="overview-scroll-hint">{canLoadMore ? "继续向下浏览将自动加载旧内容" : "已显示全部内容"}</div>
              <label>每页<select value={pageSize} onChange={(event) => choosePageSize(Number(event.target.value))}>{[5, 10, 20, 50].map((size) => <option key={size} value={size}>{size} 项</option>)}</select></label>
            </div>}
          </section>

          <aside className="overview-side">
            <section>
              <div className="section-title">
                <div><h2>即将过期</h2><p>优先处理或收藏</p></div>
              </div>
              <div className="expiry-list">
                {data?.expiring.length ? data.expiring.map((file) => (
                  <button key={file.id} onClick={() => onPreview(file)}>
                    <FileTypeIcon file={file} />
                    <span><strong>{file.name}</strong><small>{file.expires_at ? formatDate(file.expires_at) : "永久保留"}</small></span>
                    <ArrowRight />
                  </button>
                )) : <p>未来没有待过期文件。</p>}
              </div>
            </section>
            <section>
              <div className="section-title"><div><h2>快速操作</h2><p>常用入口</p></div></div>
              <div className="quick-actions">
                <button onClick={onAdd}><Plus /><span><strong>添加内容</strong><small>上传文件或粘贴文本</small></span><ArrowRight /></button>
                <button onClick={() => onNavigate("shared")}><Link2 /><span><strong>管理分享</strong><small>检查链接有效期</small></span><ArrowRight /></button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function ClipboardCard({ file, layout, demo, onPreview, onPatch, onDownload, onToast, onCopied }: {
  file: FileItem; layout: "list" | "grid" | "gallery"; demo: boolean; onPreview: () => void; onPatch: (patch: Partial<FileItem>) => void; onDownload: () => void; onToast: (message: string) => void; onCopied: () => void;
}) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    if (file.kind === "text") {
      if (demo) { setText(`这是“${file.name}”的示例文本内容，可直接选择或一键复制。`); return; }
      const controller = new AbortController();
      api.raw(file, { signal: controller.signal, range: "bytes=0-65535" }).then(async (response) => {
        if (response.ok || response.status === 206) setText(await response.text());
      }).catch((error) => { if (!isAbortError(error)) setText(""); });
      return () => controller.abort();
    }
    if (file.kind === "image" && layout === "gallery") {
      if (demo) {
        setImageUrl(file.id === "demo-poster" ? "/assets/summer-wander.webp" : "");
        return;
      }
      const controller = new AbortController();
      api.fileAccess(file.id, controller.signal).then(({ rawUrl }) => setImageUrl(rawUrl)).catch(() => setImageUrl(""));
      return () => controller.abort();
    }
    setImageUrl("");
  }, [demo, file, layout]);
  const copy = async (openPreview = false) => {
    if (!text) return onToast("文本内容暂不可用");
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch { /* fall back for HTTP and restricted browser contexts */ }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    if (copied) onCopied();
    else onToast("浏览器未授予剪贴板权限，请手动选择复制");
    if (openPreview) onPreview();
  };
  const typeLabel = file.kind === "text" ? "纯文本" : file.kind === "image" ? "图片" : "文件";
  return <article className="clipboard-card" onDoubleClick={onPreview}>
    <div className="clipboard-card__meta"><span>{typeLabel}{file.kind === "text" && text ? ` · ${text.length} 字符` : ` · ${formatBytes(file.size)}`} · {formatDate(file.updated_at)}</span><div>{file.kind === "text" ? <button onClick={() => void copy(false)} title="仅复制内容"><Copy /></button> : <button onClick={onDownload} title="下载"><Download /></button>}<button onClick={() => onPatch({ is_favorite: file.is_favorite ? 0 : 1 })} className={file.is_favorite ? "is-active" : ""} title={file.is_favorite ? "取消收藏" : "收藏"}><Heart fill={file.is_favorite ? "currentColor" : "none"} /></button><button onClick={() => onPatch({ is_trashed: 1 })} title="移到回收站"><Trash2 /></button></div></div>
    {file.kind === "text" ? <button className="clipboard-text" onClick={() => void copy(true)} title="点击复制并打开预览">{text || <span><LoaderCircle className="spin" />正在读取内容…</span>}</button> : file.kind === "image" && layout === "gallery" ? <button className="clipboard-image" onClick={onPreview}>{imageUrl ? <img src={imageUrl} alt={file.name} loading="lazy" /> : <Image />}<span>{file.name}</span></button> : <button className="clipboard-file" onClick={onPreview}>{file.kind === "image" ? <Image /> : <FileText />}<span><strong>{file.name}</strong><small>{file.mime || "文件"} · {formatBytes(file.size)} · 点击预览</small></span><ArrowRight /></button>}
  </article>;
}

function Metric({
  icon: Icon, label, value, detail, accent = ""
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  detail: string;
  accent?: string;
}) {
  return (
    <div className={`overview-metric ${accent ? `is-${accent}` : ""}`}>
      <Icon />
      <span><small>{label}</small><strong>{value}</strong><i>{detail}</i></span>
    </div>
  );
}
