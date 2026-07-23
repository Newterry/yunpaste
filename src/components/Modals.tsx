import {
  Check, ChevronDown, CloudSun, FileText, FolderUp, KeyRound, MoonStar,
  Palette, ShieldCheck, Sparkles, UploadCloud, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThemeName } from "../types";

export function Modal({ children, onClose, label, returnFocus }: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = returnFocus?.current || document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>(".sidebar, .app-main, .mobile-nav")]
      .filter((element) => !layer.current?.contains(element));
    const previousInert = background.map((element) => [element, element.hasAttribute("inert")] as const);
    background.forEach((element) => element.setAttribute("inert", ""));

    const focusable = () => [...(layer.current?.querySelectorAll<HTMLElement>(
      "button:not(.modal-scrim):not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
    ) || [])];
    window.requestAnimationFrame(() => {
      const autoFocus = layer.current?.querySelector<HTMLElement>("[data-modal-initial], [autofocus]");
      (autoFocus || focusable()[0] || layer.current)?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
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
      previousInert.forEach(([element, alreadyInert]) => {
        if (!alreadyInert) element.removeAttribute("inert");
      });
      previous?.focus();
    };
  }, [returnFocus]);

  return (
    <div ref={layer} className="modal-layer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      <button className="modal-scrim" onClick={onClose} aria-label="关闭" />
      <div className="modal-card">{children}</div>
    </div>
  );
}

export function ContentModal({
  onClose, onCreate, onUpload, busy, uploading, defaultExpiryDays,
  maxUploadMb, maxFilesPerUpload, returnFocus
}: {
  onClose: () => void;
  onCreate: (payload: { title: string; content: string; format: string; expiresInDays?: number }) => Promise<boolean>;
  onUpload: (files: File[]) => Promise<boolean>;
  busy: boolean;
  uploading: boolean;
  defaultExpiryDays: number;
  maxUploadMb: number;
  maxFilesPerUpload: number;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState("text");
  const [expiry, setExpiry] = useState(String(defaultExpiryDays));
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const standardExpiry = new Set(["1", "7", "30"]);
  const chooseFiles = (incoming: File[]) => {
    setFiles(incoming.slice(0, maxFilesPerUpload));
  };
  const submit = async () => {
    if (!files.length && !content.trim()) return;
    if (files.length && !(await onUpload(files))) return;
    if (content.trim() && !(await onCreate({
      title: title || "未命名粘贴", content, format, expiresInDays: Number(expiry)
    }))) return;
    onClose();
  };
  return (
    <Modal onClose={onClose} label="添加内容" returnFocus={returnFocus}>
      <div className="modal-header">
        <div><span className="modal-icon"><FolderUp /></span><div><h2>添加内容</h2><p>拖入文件或直接粘贴文本，一次完成。</p></div></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭添加内容"><X /></button>
      </div>
      <div className="paste-form content-composer">
        <section className="content-composer__files" aria-labelledby="content-files-title">
          <div className="content-composer__heading"><FolderUp /><span><strong id="content-files-title">上传文件</strong><small>拖拽或点击选择，可多选</small></span></div>
          <button
            type="button"
            className={`content-dropzone ${dragging ? "is-dragging" : ""}`}
            data-modal-initial
            onClick={() => fileInput.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <UploadCloud />
            <strong>{dragging ? "松开即可添加" : "拖拽文件到这里"}</strong>
            <span>或点击选择文件</span>
            <small>单文件最多 {maxUploadMb} MB · 单次最多 {maxFilesPerUpload} 个</small>
          </button>
          <input ref={fileInput} hidden type="file" multiple onChange={(event) => {
            chooseFiles(Array.from(event.target.files || []));
            event.target.value = "";
          }} />
          {files.length > 0 && (
            <div className="content-file-summary">
              <FolderUp /><span><strong>已选择 {files.length} 个文件</strong><small>{files.slice(0, 3).map((file) => file.name).join("、")}{files.length > 3 ? "…" : ""}</small></span>
              <button className="button button--ghost" onClick={() => setFiles([])}>清除</button>
            </div>
          )}
        </section>
        <div className="content-composer__divider"><span>也可以粘贴文本</span></div>
        <section className="content-composer__text" aria-labelledby="content-text-title">
          <div className="content-composer__heading"><FileText /><span><strong id="content-text-title">粘贴文本</strong><small>留空即可只上传文件</small></span></div>
          <label>
            <span>标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：会议记录" />
          </label>
          <label>
            <span>内容</span>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="在这里粘贴或输入内容…" />
            <small>{content.length.toLocaleString()} 字符</small>
          </label>
          <div className="form-row">
            <label>
              <span>格式</span>
              <span className="select-wrap"><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="text">纯文本</option><option value="markdown">Markdown</option></select><ChevronDown /></span>
            </label>
            <label>
              <span>有效期</span>
              <span className="select-wrap"><select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {!standardExpiry.has(String(defaultExpiryDays)) && <option value={defaultExpiryDays}>{defaultExpiryDays} 天（系统默认）</option>}
                <option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option>
              </select><ChevronDown /></span>
            </label>
          </div>
        </section>
        <div className="secure-note"><ShieldCheck /><span><strong>默认私有 · 文件保留 {defaultExpiryDays} 天</strong>收藏后永久保留；未收藏内容到期自动清理。</span></div>
      </div>
      <div className="modal-actions">
        <button className="button button--ghost" onClick={onClose}>取消</button>
        <button className="button button--primary" disabled={(!files.length && !content.trim()) || uploading || busy} onClick={() => void submit()}>
          {uploading ? "正在上传…" : busy ? "正在保存…" : files.length && content.trim() ? `添加 ${files.length + 1} 项内容` : files.length ? `上传 ${files.length} 个文件` : "保存文本"}
        </button>
      </div>
    </Modal>
  );
}

const themes: Array<{ id: ThemeName; name: string; detail: string; icon: typeof Palette; colors: string[] }> = [
  { id: "cloud", name: "云白", detail: "真白画布与珊瑚红强调色", icon: CloudSun, colors: ["#ffffff", "#ff5d52", "#111b2b"] },
  { id: "ink", name: "墨夜", detail: "深色工作区，适合夜间使用", icon: MoonStar, colors: ["#151821", "#ff776c", "#edeef3"] },
  { id: "mist", name: "雾蓝", detail: "低饱和蓝灰，专注而舒缓", icon: Sparkles, colors: ["#edf3f8", "#4f6bed", "#1d3045"] }
];

export function ThemeModal({ theme, onTheme, onClose, returnFocus }: {
  theme: ThemeName;
  onTheme: (theme: ThemeName) => void;
  onClose: () => void;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Modal onClose={onClose} label="选择界面皮肤" returnFocus={returnFocus}>
      <div className="modal-header">
        <div><span className="modal-icon"><Palette /></span><div><h2>界面皮肤</h2><p>选择最适合你的工作氛围。</p></div></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭皮肤选择"><X /></button>
      </div>
      <div className="theme-grid">
        {themes.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={theme === item.id ? "is-selected" : ""} onClick={() => onTheme(item.id)}>
              <span className={`theme-preview theme-preview--${item.id}`}>
                <i /><b /><em /><small />
              </span>
              <span className="theme-card__copy"><Icon /><span><strong>{item.name}</strong><small>{item.detail}</small></span></span>
              <span className="theme-swatches">{item.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span>
              {theme === item.id && <span className="theme-check"><Check /></span>}
            </button>
          );
        })}
      </div>
      <div className="modal-actions"><button className="button button--primary" onClick={onClose}>完成</button></div>
    </Modal>
  );
}
