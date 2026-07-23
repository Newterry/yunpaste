import { Download, FileCheck2, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileItem } from "../types";
import { api, isAbortError } from "../lib/api";
import { fileExtension, formatBytes, formatDate, initials } from "../lib/format";
import { Brand } from "./Brand";
import { FileTypeIcon } from "./FileBrowser";

export function ShareScreen({ token, siteName = "云粘贴" }: { token: string; siteName?: string }) {
  const [file, setFile] = useState<FileItem>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [textTruncated, setTextTruncated] = useState(false);
  const rawUrl = api.publicRawUrl(token);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPreviewError("");
    setText("");
    api.publicShare(token, controller.signal)
      .then(({ file: item }) => {
        setFile(item);
        if (item.kind === "text") {
          fetch(rawUrl, {
            signal: controller.signal,
            headers: { Range: "bytes=0-1048575" }
          })
            .then(async (response) => {
              if (!response.ok) throw new Error("文本内容暂时无法载入");
              setTextTruncated(response.status === 206 && item.size > 1_048_576);
              return response.text();
            })
            .then(setText)
            .catch((reason) => {
              if (!isAbortError(reason)) setPreviewError(reason.message);
            });
        }
      })
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason.message);
      });
    return () => controller.abort();
  }, [token, rawUrl]);

  return (
    <main className="share-screen">
      <header className="share-header">
        <Brand name={siteName} />
        <span><ShieldCheck />安全共享</span>
      </header>
      <section className="share-content">
        {error ? (
          <div className="share-error"><LockKeyhole /><h1>链接不可用</h1><p>{error}</p></div>
        ) : !file ? (
          <div className="share-loading"><LoaderCircle className="spin" /><span>正在安全载入文件…</span></div>
        ) : (
          <>
            <div className="share-title">
              <FileTypeIcon file={file} />
              <div><h1>{file.name}</h1><p>由 {file.owner_name} 通过此空间与你分享</p></div>
            </div>
            <div className={`share-preview share-preview--${file.kind}`}>
              {file.kind === "image" && <img src={rawUrl} alt={file.name} onError={() => setPreviewError("图片预览失败")} />}
              {file.kind === "video" && <video src={rawUrl} controls preload="metadata" onError={() => setPreviewError("视频预览失败")} />}
              {file.kind === "audio" && <audio src={rawUrl} controls preload="metadata" onError={() => setPreviewError("音频预览失败")} />}
              {file.mime === "application/pdf" && <iframe src={rawUrl} title={file.name} sandbox="allow-same-origin" />}
              {file.kind === "text" && <pre>{previewError ? previewError : text || "正在载入文本…"}</pre>}
              {textTruncated && <div className="preview-truncated">仅显示前 1 MB，下载可查看完整内容。</div>}
              {(previewError && file.kind !== "text") || !(
                file.kind === "image"
                || file.kind === "video"
                || file.kind === "audio"
                || file.kind === "text"
                || file.mime === "application/pdf"
              ) ? (
                <div className="share-generic"><FileTypeIcon file={file} large /><span>下载后使用本地应用打开</span></div>
              ) : null}
            </div>
            <div className="share-meta">
              <span><small>文件类型</small><strong>{fileExtension(file.name)}</strong></span>
              <span><small>文件大小</small><strong>{formatBytes(file.size)}</strong></span>
              <span><small>分享者</small><strong><i className="avatar">{initials(file.owner_name)}</i>{file.owner_name}</strong></span>
              <span><small>更新时间</small><strong>{formatDate(file.updated_at)}</strong></span>
              <span className="share-meta__expiry"><small>分享失效时间</small><strong>{file.share_expires_at ? formatDate(file.share_expires_at) : "未设置"}</strong></span>
            </div>
            <a className="button button--primary share-download" href={api.publicDownloadUrl(token)}>
              <Download />下载文件
            </a>
            <p className="share-trust"><FileCheck2 />文件保持原样传输，不会被二次压缩。</p>
          </>
        )}
      </section>
      <footer className="share-footer">{siteName} · 自托管的网络粘贴板</footer>
    </main>
  );
}
