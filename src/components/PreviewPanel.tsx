import {
  Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Heart, Info, Link2,
  LoaderCircle, MessageSquareText, Play, Share2, Sparkles, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileItem, WebdavItem } from "../types";
import { api, isAbortError } from "../lib/api";
import { fileExtension, formatBytes, formatDate, initials } from "../lib/format";
import { FileTypeIcon } from "./FileBrowser";

const officePreviewPattern = /\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|wps|et|dps)$/i;

function isOfficePreview(file: FileItem) {
  return officePreviewPattern.test(file.name);
}

function remoteKind(item: WebdavItem): FileItem["kind"] {
  const mime = String(item.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(item.name)) return "audio";
  if (mime.startsWith("text/") || /\.(txt|md|json|csv|log|yaml|yml|xml|ini)$/i.test(item.name)) return "text";
  if (mime === "application/pdf" || officePreviewPattern.test(item.name)) return "document";
  return "other";
}

interface PreviewPanelProps {
  file: FileItem;
  onClose: () => void;
  onPatch: (file: FileItem, patch: Partial<FileItem>) => Promise<FileItem | void>;
  onDownload: (file: FileItem) => void;
  onOpen: (file: FileItem) => void;
  onCopyLink: (file: FileItem, days?: number) => Promise<boolean>;
  defaultShareDays: number;
  onPrevious?: () => void;
  onNext?: () => void;
}

export function PreviewPanel({
  file, onClose, onPatch, onDownload, onOpen, onCopyLink, defaultShareDays, onPrevious, onNext
}: PreviewPanelProps) {
  const [tab, setTab] = useState<"preview" | "info" | "activity">("preview");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareDays, setShareDays] = useState(defaultShareDays);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [resourceLoading, setResourceLoading] = useState(false);
  const [textTruncated, setTextTruncated] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const panelRef = useRef<HTMLElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => setShareDays(defaultShareDays), [defaultShareDays, file.id]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const background = [...document.querySelectorAll<HTMLElement>(
      ".sidebar, .topbar, .file-browser, .mobile-nav"
    )];
    const previous = background.map((element) => [element, element.hasAttribute("inert")] as const);
    const previousFocus = document.activeElement as HTMLElement | null;
    background.forEach((element) => element.setAttribute("inert", ""));
    window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-preview-close]")?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], video[controls], audio[controls], [tabindex]:not([tabindex='-1'])"
      ) || [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      previous.forEach(([element, alreadyInert]) => {
        if (!alreadyInert) element.removeAttribute("inert");
      });
      previousFocus?.focus();
    };
  }, [isMobile, onClose]);

  useEffect(() => {
    setTab("preview");
    setCopied(false);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
  }, [file.id]);

  useEffect(() => () => {
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setText("");
    setMediaFailed(false);
    setMediaUrl("");
    setTextTruncated(false);
    setResourceLoading(true);
    if (file.id === "demo-poster") {
      setMediaUrl("/assets/summer-wander.webp");
      setResourceLoading(false);
      return () => controller.abort();
    }
    if (file.kind === "text") {
      if (file.id.startsWith("demo-")) {
        setText(file.name.endsWith(".md")
          ? "# 云粘贴发布说明\n\n欢迎使用云粘贴。这个版本带来了多格式预览、团队空间、安全共享链接与更可靠的文件管理体验。\n\n- 支持文本、图片、音视频与 PDF\n- 支持多用户和权限管理\n- 支持 Docker 持久化部署"
          : "这是一个受保护的示例文本文件。\n请勿在真实环境中通过粘贴板传递长期有效的密钥。");
        setResourceLoading(false);
        return () => controller.abort();
      }
      api.raw(file, { signal: controller.signal, range: "bytes=0-1048575" })
        .then(async (response) => {
          if (!response.ok) throw new Error("文本预览载入失败");
          if (!disposed) setTextTruncated(response.status === 206 && file.size > 1_048_576);
          return response.text();
        })
        .then((content) => {
          if (!disposed) setText(content);
        })
        .catch((error) => {
          if (!disposed && !isAbortError(error)) setText("无法载入文本预览，请下载后查看。");
        })
        .finally(() => {
          if (!disposed && !controller.signal.aborted) setResourceLoading(false);
        });
      return () => {
        disposed = true;
        controller.abort();
      };
    }
    if (file.id.startsWith("demo-")) {
      setMediaFailed(true);
      setResourceLoading(false);
      return () => controller.abort();
    }
    const officePreview = isOfficePreview(file);
    const previewable = file.kind === "image"
      || file.kind === "video"
      || file.kind === "audio"
      || file.mime === "application/pdf"
      || officePreview;
    if (!previewable) {
      setMediaFailed(true);
      setResourceLoading(false);
      return () => controller.abort();
    }
    api.fileAccess(file.id, controller.signal)
      .then(({ rawUrl, previewUrl }) => {
        if (!disposed) setMediaUrl(officePreview ? previewUrl : rawUrl);
      })
      .catch((error) => {
        if (!disposed && !isAbortError(error)) setMediaFailed(true);
      })
      .finally(() => {
        if (!disposed && !controller.signal.aborted) setResourceLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [file.id, file.kind, file.mime, file.size]);

  const copyLink = async () => {
    if (await onCopyLink(file, shareDays)) {
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    }
  };
  const rendererAvailable = file.kind === "text"
    || file.kind === "image"
    || file.kind === "video"
    || file.kind === "audio"
    || file.mime === "application/pdf"
    || isOfficePreview(file);
  const documentFrame = file.mime === "application/pdf" || isOfficePreview(file);

  return (
    <aside ref={panelRef} className="preview-panel" role={isMobile ? "dialog" : "complementary"} aria-modal={isMobile || undefined} aria-label={`预览 ${file.name}`}>
      <div className="preview-panel__header">
        <div className="preview-panel__title">
          <FileTypeIcon file={file} />
          <div><strong>{file.name}</strong><small>{fileExtension(file.name)} · {formatBytes(file.size)}</small></div>
        </div>
        <div>
          <button className="icon-button" onClick={() => onPatch(file, { is_favorite: file.is_favorite ? 0 : 1 })} aria-label="收藏">
            <Heart fill={file.is_favorite ? "currentColor" : "none"} />
          </button>
          <button className="icon-button" data-preview-close onClick={onClose} aria-label="关闭预览"><X /></button>
        </div>
      </div>
      <div className="preview-tabs" role="tablist" aria-label="预览面板">
        <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "is-active" : ""} onClick={() => setTab("preview")}>预览</button>
        <button role="tab" aria-selected={tab === "info"} className={tab === "info" ? "is-active" : ""} onClick={() => setTab("info")}>信息</button>
        <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>活动</button>
      </div>

      <div className="preview-panel__body">
        {tab === "preview" && (
          <>
            <div className={`media-preview media-preview--${file.kind}`}>
              {file.kind === "image" && mediaUrl && !mediaFailed && (
                <img src={mediaUrl} alt={file.name} onError={() => setMediaFailed(true)} />
              )}
              {file.kind === "video" && mediaUrl && !mediaFailed && (
                <video src={mediaUrl} controls preload="metadata" onError={() => setMediaFailed(true)} />
              )}
              {file.kind === "audio" && mediaUrl && !mediaFailed && (
                <div className="audio-preview">
                  <span><Play /></span>
                  <div className="audio-wave">{Array.from({ length: 30 }).map((_, i) => <i key={i} style={{ height: `${18 + ((i * 17) % 42)}%` }} />)}</div>
                  <audio src={mediaUrl} controls preload="metadata" onError={() => setMediaFailed(true)} />
                </div>
              )}
              {documentFrame && mediaUrl && !mediaFailed && (
                <iframe
                  src={mediaUrl}
                  title={file.name}
                  referrerPolicy="no-referrer"
                  onError={() => setMediaFailed(true)}
                />
              )}
              {file.kind === "text" && <pre>{resourceLoading ? "正在载入文本…" : text}</pre>}
              {textTruncated && <div className="preview-truncated">仅显示前 1 MB，下载文件可查看完整内容。</div>}
              {resourceLoading && file.kind !== "text" && <div className="preview-loading"><LoaderCircle className="spin" />正在准备流式预览…</div>}
              {(mediaFailed || !rendererAvailable) && !resourceLoading && (
                <div className="preview-fallback">
                  <FileTypeIcon file={file} large />
                  <strong>{file.name}</strong>
                  <span>{isOfficePreview(file) ? "文档转换失败，可下载原文件查看" : "浏览器不支持直接预览，请下载后查看"}</span>
                  <button className="button button--secondary" onClick={() => onDownload(file)}><Download />下载查看</button>
                </div>
              )}
              <div className="preview-nav">
                <button onClick={onPrevious} disabled={!onPrevious} aria-label="上一个文件"><ChevronLeft /></button>
                <button onClick={onNext} disabled={!onNext} aria-label="下一个文件"><ChevronRight /></button>
              </div>
            </div>
            <MetaList file={file} />
            <ShareBox
              file={file}
              copied={copied}
              shareDays={shareDays}
              onShareDays={setShareDays}
              onToggle={() => onPatch(file, { is_shared: file.is_shared ? 0 : 1 })}
              onCopy={copyLink}
            />
          </>
        )}

        {tab === "info" && (
          <div className="info-view">
            <span className="info-view__hero"><Info /></span>
            <h3>文件信息</h3>
            <MetaList file={file} expanded />
            <div className="info-callout">
              <Sparkles />
              <div><strong>自动识别完成</strong><span>系统会根据文件类型选择最合适的安全预览方式。</span></div>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div className="activity-list">
            <div><span className="avatar">{initials(file.owner_name)}</span><p><strong>{file.owner_name}</strong> 上传了此文件<small>{formatDate(file.created_at)}</small></p></div>
            {file.is_shared ? <div><span className="activity-icon"><Share2 /></span><p><strong>共享已开启</strong><small>{formatDate(file.updated_at)}</small></p></div> : null}
            <div><span className="activity-icon"><MessageSquareText /></span><p><strong>文件活动概览</strong><small>创建与共享状态会显示在这里</small></p></div>
          </div>
        )}
      </div>
      <div className="preview-panel__footer">
        <button className="button button--primary" onClick={() => onOpen(file)}><ExternalLink />新窗口打开</button>
        <button className="button button--secondary" onClick={() => onDownload(file)}><Download />下载</button>
        <button className="button button--secondary" onClick={copyLink} disabled={Boolean(file.is_trashed)} title={file.is_trashed ? "请先恢复文件" : undefined}>{copied ? <Check /> : <Link2 />}{copied ? "已复制" : "复制链接"}</button>
      </div>
    </aside>
  );
}

export function WebdavPreviewPanel({ connectionId, item, onClose, onDownload }: {
  connectionId: string;
  item: WebdavItem;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "info">("preview");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [contentType, setContentType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const kind = remoteKind(item);
  const file: FileItem = {
    id: item.path,
    owner_name: "个人 WebDAV",
    name: item.name,
    mime: item.mime || "application/octet-stream",
    size: item.size,
    kind,
    is_shared: 0,
    is_favorite: 0,
    is_trashed: 0,
    created_at: item.modifiedAt || new Date(0).toISOString(),
    updated_at: item.modifiedAt || new Date(0).toISOString()
  };

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setLoading(true);
    setError("");
    setUrl("");
    setText("");
    api.previewWebdavFile(connectionId, item, controller.signal).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "WebDAV 文件预览失败" }));
        throw new Error(data.error || "WebDAV 文件预览失败");
      }
      const type = response.headers.get("content-type")?.split(";")[0] || item.mime || "application/octet-stream";
      setContentType(type);
      const blob = await response.blob();
      if (type.startsWith("text/")) setText(await blob.text());
      else {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    }).catch((reason) => {
      if (!isAbortError(reason)) setError((reason as Error).message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connectionId, item]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);

  const image = contentType.startsWith("image/");
  const video = contentType.startsWith("video/");
  const audio = contentType.startsWith("audio/");
  const document = contentType === "application/pdf";
  return <aside className="preview-panel webdav-preview-panel" role="complementary" aria-label={`预览 ${item.name}`}>
    <div className="preview-panel__header"><div className="preview-panel__title"><FileTypeIcon file={file} /><div><strong>{item.name}</strong><small>{fileExtension(item.name)} · {formatBytes(item.size)}</small></div></div><div><button className="icon-button" onClick={onClose} aria-label="关闭预览"><X /></button></div></div>
    <div className="preview-tabs" role="tablist" aria-label="WebDAV 预览面板"><button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "is-active" : ""} onClick={() => setTab("preview")}>预览</button><button role="tab" aria-selected={tab === "info"} className={tab === "info" ? "is-active" : ""} onClick={() => setTab("info")}>信息</button></div>
    <div className="preview-panel__body">{tab === "preview" ? <div className={`media-preview media-preview--${kind}`}>
      {loading && <div className="preview-loading"><LoaderCircle className="spin" />正在安全读取 WebDAV 文件…</div>}
      {!loading && !error && image && <img src={url} alt={item.name} />}
      {!loading && !error && video && <video src={url} controls preload="metadata" />}
      {!loading && !error && audio && <div className="audio-preview"><span><Play /></span><div className="audio-wave">{Array.from({ length: 30 }).map((_, i) => <i key={i} style={{ height: `${18 + ((i * 17) % 42)}%` }} />)}</div><audio src={url} controls preload="metadata" /></div>}
      {!loading && !error && document && <iframe src={url} title={item.name} referrerPolicy="no-referrer" />}
      {!loading && !error && contentType.startsWith("text/") && <pre>{text}</pre>}
      {!loading && (error || !(image || video || audio || document || contentType.startsWith("text/"))) && <div className="preview-fallback"><FileTypeIcon file={file} large /><strong>{item.name}</strong><span>{error || "此格式暂不支持在线预览"}</span><button className="button button--secondary" onClick={onDownload}><Download />下载查看</button></div>}
    </div> : <div className="info-view"><span className="info-view__hero"><Info /></span><h3>WebDAV 文件信息</h3><dl className="meta-list meta-list--expanded"><div><dt>类型</dt><dd>{item.mime || contentType || "未知"}</dd></div><div><dt>大小</dt><dd>{formatBytes(item.size)}</dd></div><div><dt>远端路径</dt><dd className="mono">{item.path}</dd></div><div><dt>修改时间</dt><dd>{item.modifiedAt ? formatDate(item.modifiedAt) : "未知"}</dd></div><div><dt>连接</dt><dd>当前用户的个人 WebDAV</dd></div></dl></div>}</div>
    <div className="preview-panel__footer"><button className="button button--primary" onClick={() => { if (url) window.open(url, "_blank", "noopener,noreferrer"); }} disabled={!url}><ExternalLink />完整打开</button><button className="button button--secondary" onClick={onDownload}><Download />下载</button></div>
  </aside>;
}

function MetaList({ file, expanded = false }: { file: FileItem; expanded?: boolean }) {
  return (
    <dl className={`meta-list ${expanded ? "meta-list--expanded" : ""}`}>
      <div><dt>类型</dt><dd>{file.mime}</dd></div>
      <div><dt>大小</dt><dd>{formatBytes(file.size)}</dd></div>
      <div><dt>创建者</dt><dd><span className="avatar">{initials(file.owner_name)}</span>{file.owner_name}</dd></div>
      <div><dt>创建时间</dt><dd>{formatDate(file.created_at)}</dd></div>
      <div><dt>修改时间</dt><dd>{formatDate(file.updated_at)}</dd></div>
      <div><dt>过期时间</dt><dd>{file.expires_at ? formatDate(file.expires_at) : "永久有效"}</dd></div>
      {expanded && <>
        <div><dt>文件 ID</dt><dd className="mono">{file.id.slice(0, 16)}</dd></div>
        <div><dt>存储策略</dt><dd>私有持久化数据卷</dd></div>
      </>}
    </dl>
  );
}

function ShareBox({ file, copied, shareDays, onShareDays, onToggle, onCopy }: {
  file: FileItem;
  copied: boolean;
  shareDays: number;
  onShareDays: (days: number) => void;
  onToggle: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="share-box">
      <div>
        <span><strong>共享链接</strong><small>{file.is_trashed ? "恢复文件后才能创建共享链接" : file.is_shared ? "任何拥有链接的人可查看" : "仅你自己可访问"}</small></span>
        <button className={`switch ${file.is_shared ? "is-on" : ""}`} onClick={onToggle} role="switch" aria-checked={Boolean(file.is_shared)} aria-label="共享链接" disabled={Boolean(file.is_trashed)}><i /></button>
      </div>
      <button className="share-box__url" onClick={onCopy} disabled={Boolean(file.is_trashed)}>
        <span>{file.is_trashed ? "回收站中的文件不可共享" : file.is_shared ? `${window.location.host}/share/${file.share_token || file.id.slice(0, 8)}` : "开启共享以生成链接"}</span>
        {copied ? <Check /> : <Copy />}
      </button>
      {!file.is_trashed && (
        <label className="share-expiry">
          <span>分享有效期（最长 7 天）</span>
          <select value={shareDays} onChange={(event) => onShareDays(Number(event.target.value))}>
            <option value={1}>1 天</option>
            <option value={3}>3 天</option>
            <option value={7}>7 天</option>
          </select>
        </label>
      )}
      {file.is_shared && file.share_expires_at && <small className="share-expires">当前链接失效时间：{formatDate(file.share_expires_at)}</small>}
    </div>
  );
}
