import { CheckCircle2, LoaderCircle, ShieldCheck, X } from "lucide-react";
import {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState
} from "react";
import { AuthScreen } from "./components/AuthScreen";
import { ContentModal, ThemeModal } from "./components/Modals";
import { DestinationPicker } from "./components/DestinationPicker";
import { SendToWebdavDialog } from "./components/SendToWebdavDialog";
import { MobileNav, Sidebar, Topbar } from "./components/Shell";
import { api, isAbortError, session, UNAUTHORIZED_EVENT } from "./lib/api";
import { demoFiles, demoUser } from "./lib/demo";
import type {
  AdminTab, FileItem, FileKind, FileLayout, FileSort, FolderCrumb, FolderItem, NavView,
  ProfileSection, PublicConfig, SystemSettings, ThemeName, User
} from "./types";

const AdminPanel = lazy(() => import("./components/AdminPanel").then((module) => ({ default: module.AdminPanel })));
const FileBrowser = lazy(() => import("./components/FileBrowser").then((module) => ({ default: module.FileBrowser })));
const PreviewPanel = lazy(() => import("./components/PreviewPanel").then((module) => ({ default: module.PreviewPanel })));
const ShareScreen = lazy(() => import("./components/ShareScreen").then((module) => ({ default: module.ShareScreen })));
const OverviewPanel = lazy(() => import("./components/OverviewPanel").then((module) => ({ default: module.OverviewPanel })));
const ProfilePanel = lazy(() => import("./components/ProfilePanel").then((module) => ({ default: module.ProfilePanel })));
const WebdavPanel = lazy(() => import("./components/WebdavPanel").then((module) => ({ default: module.WebdavPanel })));
const TicketPanel = lazy(() => import("./components/TicketPanel").then((module) => ({ default: module.TicketPanel })));

const defaultConfig: PublicConfig = {
  siteName: "云粘贴",
  siteSubtitle: "把灵感与文件，安全地放在一起",
  allowRegistration: true,
  maxUploadMb: 2048,
  defaultExpiryDays: 30,
  defaultShareDays: 7,
  expiryWarningDays: 7,
  maxFilesPerUpload: 20,
  allowedTypes: "text,image,video,audio,document,archive,other",
  allowPersonalWebdav: true,
  allowTickets: true
};
const fileViews = new Set<NavView>(["files", "shared", "favorites", "trash"]);
const navViews = new Set<NavView>(["overview", "files", "shared", "favorites", "webdav", "tickets", "trash", "profile", "admin"]);
const adminTabs = new Set<AdminTab>(["users", "general", "storage", "security", "config"]);

function workspaceRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = navViews.has(parts[0] as NavView) ? parts[0] as NavView : "overview";
  const adminTab = view === "admin" && adminTabs.has(parts[1] as AdminTab) ? parts[1] as AdminTab : "users";
  const profileSection: ProfileSection = view === "profile" && (parts[1] === "webdav" || parts[1] === "avatar")
    ? parts[1]
    : "account";
  return { view, adminTab, profileSection };
}

function routeHash(view: NavView, adminTab: AdminTab, profileSection: ProfileSection) {
  if (view === "admin") return `#admin/${adminTab}`;
  if (view === "profile") return `#profile/${profileSection}`;
  return `#${view}`;
}

function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(() => true).catch(() => fallbackCopy(value));
  }
  return Promise.resolve(fallbackCopy(value));
}

function fallbackCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function shareTokenFromPath(pathname: string) {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem("tieyun.theme");
    return saved === "ink" || saved === "mist" || saved === "cloud" ? saved : "cloud";
  } catch {
    return "cloud";
  }
}

export default function App() {
  const demoMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("demo") === "1";
  const shareToken = shareTokenFromPath(window.location.pathname);
  const [config, setConfig] = useState<PublicConfig>(defaultConfig);
  const [user, setUser] = useState<User>();
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [demoLibrary, setDemoLibrary] = useState<FileItem[]>(demoFiles);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [workspace, setWorkspace] = useState(workspaceRoute);
  const { view, adminTab, profileSection } = workspace;
  const [filter, setFilter] = useState<FileKind>("all");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<FileLayout>("list");
  const [sortBy, setSortBy] = useState<FileSort>("updated");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  const [activeId, setActiveId] = useState<string>();
  const [overviewPreview, setOverviewPreview] = useState<FileItem>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{
    mode: "copy" | "move";
    fileIds: string[];
    folderIds: string[];
  }>();
  const [destinationOperation, setDestinationOperation] = useState<{
    mode: "copy" | "move";
    fileIds: string[];
    folderIds: string[];
  }>();
  const [webdavSendFiles, setWebdavSendFiles] = useState<FileItem[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const toastTimer = useRef<number | undefined>(undefined);
  const listRefreshTimer = useRef<number | undefined>(undefined);
  const listGeneration = useRef(0);
  const authGeneration = useRef(0);
  const authInFlight = useRef(false);
  const operationControllers = useRef(new Set<AbortController>());
  const fileMutationChains = useRef(new Map<string, Promise<void>>());
  const pasteTrigger = useRef<HTMLElement | null>(null);
  const themeTrigger = useRef<HTMLElement | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const clearWorkspace = useCallback(() => {
    if (listRefreshTimer.current) window.clearTimeout(listRefreshTimer.current);
    fileMutationChains.current.clear();
    authGeneration.current += 1;
    operationControllers.current.forEach((controller) => controller.abort());
    operationControllers.current.clear();
    listGeneration.current += 1;
    setUser(undefined);
    setFiles([]);
    setFolders([]);
    setBreadcrumbs([]);
    setCurrentFolderId(null);
    setActiveId(undefined);
    setOverviewPreview(undefined);
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
    setClipboard(undefined);
    setDestinationOperation(undefined);
    setWorkspace({ view: "overview", adminTab: "users", profileSection: "account" });
    window.history.replaceState(null, "", routeHash("overview", "users", "account"));
    setFilter("all");
    setQuery("");
    setPage(1);
    setTotal(0);
    setMobileNavOpen(false);
    setPasteOpen(false);
    setThemeOpen(false);
    setLoading(false);
    setUploading(false);
    setPasteBusy(false);
  }, []);

  const logout = useCallback(() => {
    session.clear();
    clearWorkspace();
  }, [clearWorkspace]);

  useEffect(() => {
    const controller = new AbortController();
    api.config(controller.signal)
      .then(({ config: next }) => setConfig(next))
      .catch((error) => {
        if (!isAbortError(error)) console.warn("Unable to load public configuration", error);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.title = `${config.siteName} · 网络粘贴板`;
  }, [config.siteName]);

  useEffect(() => {
    const unauthorized = () => {
      clearWorkspace();
      notify("登录已过期，请重新登录");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized);
  }, [clearWorkspace, notify]);

  useEffect(() => {
    const controller = new AbortController();
    if (shareToken !== undefined) {
      setAuthReady(true);
      return () => controller.abort();
    }
    if (demoMode) {
      setUser(demoUser);
      setDemoLibrary(demoFiles);
      setActiveId("demo-poster");
      setSelectedIds(new Set(["demo-poster"]));
      setAuthReady(true);
      return () => controller.abort();
    }
    if (!session.token) {
      setAuthReady(true);
      return () => controller.abort();
    }
    api.me(controller.signal)
      .then(({ user: data }) => {
        if (!controller.signal.aborted) setUser(data);
      })
      .catch((error) => {
        if (!isAbortError(error)) session.clear();
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthReady(true);
      });
    return () => controller.abort();
  }, [demoMode, shareToken]);

  useEffect(() => {
    const syncWorkspaceRoute = () => {
      const route = workspaceRoute();
      if (route.view === "admin" && user && user.role !== "admin") {
        setWorkspace({ ...route, view: "overview" });
        window.history.replaceState(null, "", routeHash("overview", route.adminTab, route.profileSection));
        return;
      }
      setWorkspace(route);
    };
    window.addEventListener("popstate", syncWorkspaceRoute);
    window.addEventListener("hashchange", syncWorkspaceRoute);
    return () => {
      window.removeEventListener("popstate", syncWorkspaceRoute);
      window.removeEventListener("hashchange", syncWorkspaceRoute);
    };
  }, [user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tieyun.theme", theme);
    } catch {
      // The selected theme remains active for the current tab.
    }
  }, [theme]);

  const criteriaKey = `${user?.id || ""}|${view}|${filter}|${query}|${sortBy}|${sortOrder}|${pageSize}|${currentFolderId || "root"}|${demoMode}`;
  useEffect(() => {
    setPage(1);
    setTotal(0);
    if (!demoMode && fileViews.has(view)) {
      setFiles([]);
      setFolders([]);
    }
  }, [criteriaKey, demoMode, view]);

  useEffect(() => {
    if (!user || !fileViews.has(view)) return;
    if (demoMode) {
      const timer = window.setTimeout(() => {
        const filtered = demoLibrary
          .filter((file) => {
            if (view === "trash" && !file.is_trashed) return false;
            if (view !== "trash" && file.is_trashed) return false;
            if (view === "shared" && !file.is_shared) return false;
            if (view === "favorites" && !file.is_favorite) return false;
            if (filter !== "all" && file.kind !== filter) return false;
            if (
              query
              && !file.name.toLowerCase().includes(query.toLowerCase())
              && !file.owner_name.toLowerCase().includes(query.toLowerCase())
            ) return false;
            return true;
          });
        const direction = sortOrder === "asc" ? 1 : -1;
        filtered.sort((a, b) => {
          const delta = sortBy === "name"
            ? a.name.localeCompare(b.name, "zh-CN")
            : sortBy === "size"
              ? a.size - b.size
              : Date.parse(a.updated_at) - Date.parse(b.updated_at);
          return delta * direction;
        });
        setTotal(filtered.length);
        setFiles(filtered.slice((page - 1) * pageSize, page * pageSize));
      }, 50);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const generation = ++listGeneration.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("view", view === "overview" ? "files" : view);
      params.set("kind", filter);
      params.set("sort", sortBy);
      params.set("order", sortOrder);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (currentFolderId && !query) params.set("folderId", currentFolderId);
      if (query) params.set("q", query);
      api.files(params, controller.signal)
        .then((data) => {
          if (controller.signal.aborted || generation !== listGeneration.current) return;
          setFiles(data.files);
          setFolders(data.folders);
          setBreadcrumbs(data.breadcrumbs);
          setTotal(data.total);
          setActiveId((current) => (
            current && data.files.some((file) => file.id === current)
              ? current
              : undefined
          ));
          const incomingIds = new Set(data.files.map((file) => file.id));
          setSelectedIds((current) => new Set([...current].filter((id) => incomingIds.has(id))));
          const incomingFolderIds = new Set(data.folders.map((folder) => folder.id));
          setSelectedFolderIds((current) => new Set([...current].filter((id) => incomingFolderIds.has(id))));
        })
        .catch((error) => {
          if (!isAbortError(error) && generation === listGeneration.current) {
            notify(error.message);
            if (page > 1) setPage((current) => current === page ? Math.max(1, page - 1) : current);
          }
        })
        .finally(() => {
          if (generation !== listGeneration.current) return;
          setLoading(false);
        });
    }, query ? 220 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    user?.id, view, filter, query, sortBy, sortOrder, page, pageSize,
    listRefresh, demoMode, demoLibrary, notify, currentFolderId
  ]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (listRefreshTimer.current) window.clearTimeout(listRefreshTimer.current);
  }, []);

  const activeFile = useMemo(
    () => overviewPreview || files.find((file) => file.id === activeId),
    [files, activeId, overviewPreview]
  );
  const activeIndex = activeFile ? files.findIndex((file) => file.id === activeFile.id) : -1;

  useEffect(() => {
    if (!activeId || !window.matchMedia("(max-width: 760px)").matches) return;
    const background = [...document.querySelectorAll<HTMLElement>(
      ".sidebar, .topbar, .file-browser, .mobile-nav"
    )];
    const previous = background.map((element) => [element, element.hasAttribute("inert")] as const);
    background.forEach((element) => element.setAttribute("inert", ""));
    return () => previous.forEach(([element, alreadyInert]) => {
      if (!alreadyInert) element.removeAttribute("inert");
    });
  }, [activeId]);

  const authenticate = async (
    mode: "login" | "register",
    data: { username: string; name: string; email: string; password: string }
  ) => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = mode === "login"
        ? await api.login(data.email, data.password)
        : await api.register(data.username, data.name, data.email, data.password);
      authGeneration.current += 1;
      operationControllers.current.forEach((controller) => controller.abort());
      operationControllers.current.clear();
      session.set(result.token);
      setFiles([]);
      setFolders([]);
      setBreadcrumbs([]);
      setCurrentFolderId(null);
      setActiveId(undefined);
      setSelectedIds(new Set());
      setSelectedFolderIds(new Set());
      setPage(1);
      setUser(result.user);
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      authInFlight.current = false;
      setAuthBusy(false);
    }
  };

  const navigate = useCallback((next: NavView, options?: { adminTab?: AdminTab; profileSection?: ProfileSection }) => {
    if (next === "admin" && user?.role !== "admin") {
      notify("当前账号没有管理中心权限");
      return;
    }
    const nextAdminTab = options?.adminTab ?? (next === "admin" ? adminTab : "users");
    const nextProfileSection = options?.profileSection ?? (next === "profile" ? "account" : profileSection);
    setWorkspace({ view: next, adminTab: nextAdminTab, profileSection: nextProfileSection });
    const hash = routeHash(next, nextAdminTab, nextProfileSection);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setFilter("all");
    setQuery("");
    setActiveId(undefined);
    setOverviewPreview(undefined);
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
    setCurrentFolderId(null);
    setBreadcrumbs([]);
    window.requestAnimationFrame(() => {
      for (const selector of [".workspace-main", ".admin-panel", ".webdav-workspace"]) {
        const workspace = document.querySelector<HTMLElement>(selector);
        if (workspace) workspace.scrollTop = 0;
      }
    });
  }, [adminTab, notify, profileSection, user?.role]);

  const selectAdminTab = useCallback((next: AdminTab) => {
    setWorkspace({ view: "admin", adminTab: next, profileSection });
    const hash = routeHash("admin", next, profileSection);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, [profileSection]);

  const selectProfileSection = useCallback((next: ProfileSection) => {
    setWorkspace({ view: "profile", adminTab, profileSection: next });
    const hash = routeHash("profile", adminTab, next);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, [adminTab]);

  const openPaste = useCallback(() => {
    pasteTrigger.current = document.activeElement as HTMLElement | null;
    setPasteOpen(true);
  }, []);

  const openTheme = useCallback(() => {
    themeTrigger.current = document.activeElement as HTMLElement | null;
    setThemeOpen(true);
  }, []);

  const selectFile = useCallback((file: FileItem, additive = false) => {
    if (!additive) setSelectedFolderIds(new Set());
    setSelectedIds((current) => {
      if (!additive) return new Set([file.id]);
      const next = new Set(current);
      if (next.has(file.id)) next.delete(file.id);
      else next.add(file.id);
      return next;
    });
  }, []);

  const selectFolder = useCallback((folder: FolderItem, additive = false) => {
    if (!additive) setSelectedIds(new Set());
    setSelectedFolderIds((current) => {
      if (!additive) return new Set([folder.id]);
      const next = new Set(current);
      if (next.has(folder.id)) next.delete(folder.id);
      else next.add(folder.id);
      return next;
    });
  }, []);

  const openFolder = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId);
    setQuery("");
    setPage(1);
    setActiveId(undefined);
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
  }, []);

  const previewFile = useCallback((file?: FileItem) => {
    setOverviewPreview(undefined);
    setActiveId(file?.id);
  }, []);
  const previewOverviewFile = useCallback((file: FileItem) => {
    setActiveId(undefined);
    setOverviewPreview(file);
  }, []);
  const closePreview = useCallback(() => {
    setActiveId(undefined);
    setOverviewPreview(undefined);
  }, []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const refreshFiles = useCallback(() => {
    if (listRefreshTimer.current) window.clearTimeout(listRefreshTimer.current);
    listRefreshTimer.current = window.setTimeout(() => {
      setPage(1);
      setListRefresh((current) => current + 1);
    }, 60);
  }, []);

  const uploadFiles = useCallback(async (incoming: File[]) => {
    if (!incoming.length) return false;
    if (incoming.length > config.maxFilesPerUpload) {
      notify(`单次最多上传 ${config.maxFilesPerUpload} 个文件`);
      return false;
    }
    const maxBytes = config.maxUploadMb * 1024 ** 2;
    const oversized = incoming.find((file) => file.size > maxBytes);
    if (oversized) {
      notify(`${oversized.name} 超过单文件上传上限`);
      return false;
    }
    if (demoMode) {
      const created = incoming.map((file) => ({
        ...demoFiles[0],
        id: `demo-local-${crypto.randomUUID()}`,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        kind: (
          file.type.startsWith("image/") ? "image"
            : file.type.startsWith("video/") ? "video"
              : file.type.startsWith("audio/") ? "audio"
                : file.type.startsWith("text/") ? "text"
                  : "other"
        ) as FileItem["kind"],
        is_shared: 0 as const,
        is_favorite: 0 as const,
        is_trashed: 0 as const,
        updated_at: new Date().toISOString()
      }));
      setDemoLibrary((current) => [...created, ...current]);
      navigate("files");
      notify(`已上传 ${created.length} 个文件`);
      return true;
    }
    const generation = authGeneration.current;
    const controller = new AbortController();
    operationControllers.current.add(controller);
    setUploading(true);
    try {
      const targetFolderId = currentFolderId;
      const data = await api.upload(incoming, targetFolderId, controller.signal);
      if (controller.signal.aborted || generation !== authGeneration.current) return false;
      setUser((current) => current ? { ...current, usage: data.usage } : current);
      navigate("files");
      setCurrentFolderId(targetFolderId);
      setQuery("");
      setFiles((current) => {
        const incomingIds = new Set(data.files.map((file) => file.id));
        return [...data.files, ...current.filter((file) => !incomingIds.has(file.id))];
      });
      refreshFiles();
      notify(`已上传 ${data.files.length} 个文件`);
      return true;
    } catch (error) {
      if (!isAbortError(error) && generation === authGeneration.current) {
        notify((error as Error).message);
      }
      return false;
    } finally {
      operationControllers.current.delete(controller);
      if (generation === authGeneration.current) setUploading(false);
    }
  }, [config.maxFilesPerUpload, config.maxUploadMb, currentFolderId, demoMode, navigate, notify, refreshFiles]);

  const createPaste = useCallback(async (payload: {
    title: string;
    content: string;
    format: string;
    expiresInDays?: number | null;
  }) => {
    if (demoMode) {
      const created: FileItem = {
        ...demoFiles[0],
        id: `demo-local-${crypto.randomUUID()}`,
        name: `${payload.title}.${payload.format === "markdown" ? "md" : "txt"}`,
        size: new Blob([payload.content]).size,
        mime: payload.format === "markdown" ? "text/markdown" : "text/plain",
        is_shared: 0,
        is_favorite: 0,
        is_trashed: 0,
        updated_at: new Date().toISOString()
      };
      setDemoLibrary((current) => [created, ...current]);
      navigate("files");
      setActiveId(created.id);
      setSelectedIds(new Set([created.id]));
      notify("粘贴已创建");
      return true;
    }
    const generation = authGeneration.current;
    const controller = new AbortController();
    operationControllers.current.add(controller);
    setPasteBusy(true);
    try {
      const targetFolderId = currentFolderId;
      const { file, usage } = await api.createPaste({ ...payload, folderId: targetFolderId }, controller.signal);
      if (controller.signal.aborted || generation !== authGeneration.current) return false;
      setUser((current) => current ? { ...current, usage } : current);
      setFiles((current) => [file, ...current.filter((item) => item.id !== file.id)]);
      navigate("files");
      setCurrentFolderId(targetFolderId);
      setActiveId(file.id);
      setSelectedIds(new Set([file.id]));
      refreshFiles();
      notify("粘贴已创建");
      return true;
    } catch (error) {
      if (!isAbortError(error) && generation === authGeneration.current) {
        notify((error as Error).message);
      }
      return false;
    } finally {
      operationControllers.current.delete(controller);
      if (generation === authGeneration.current) setPasteBusy(false);
    }
  }, [currentFolderId, demoMode, navigate, notify, refreshFiles]);

  const matchesCurrentView = useCallback((file: FileItem) => {
    if (view === "trash") {
      if (!file.is_trashed) return false;
    } else if (file.is_trashed) return false;
    if (view === "shared" && !file.is_shared) return false;
    if (view === "favorites" && !file.is_favorite) return false;
    if (filter !== "all" && file.kind !== filter) return false;
    if (
      query
      && !file.name.toLowerCase().includes(query.toLowerCase())
      && !file.owner_name.toLowerCase().includes(query.toLowerCase())
    ) return false;
    return true;
  }, [view, filter, query]);

  const patchFile = useCallback(async (file: FileItem, patch: Partial<FileItem>) => {
    if (demoMode) {
      const updated = {
        ...file,
        ...patch,
        ...("is_shared" in patch
          ? {
              share_token: patch.is_shared
                ? `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 11)}`
                : undefined,
              share_expires_at: patch.is_shared
                ? patch.share_expires_at || new Date(Date.now() + 7 * 86_400_000).toISOString()
                : undefined
            }
          : {}),
        updated_at: new Date().toISOString()
      };
      setDemoLibrary((items) => items.map((item) => item.id === updated.id ? updated : item));
      setOverviewPreview((current) => current?.id === updated.id ? updated : current);
      setFiles((items) => matchesCurrentView(updated)
        ? items.map((item) => item.id === updated.id ? updated : item)
        : items.filter((item) => item.id !== updated.id));
      if (!matchesCurrentView(updated)) setActiveId(undefined);
      if ("is_shared" in patch && patch.is_shared) notify("共享链接已开启");
      return updated;
    }
    const generation = authGeneration.current;
    const removesFromCurrentView = Object.hasOwn(patch, "is_trashed")
      && Boolean(patch.is_trashed) !== (view === "trash");
    if (removesFromCurrentView) {
      setFiles((items) => items.filter((item) => item.id !== file.id));
      setTotal((current) => Math.max(0, current - 1));
      setActiveId((current) => current === file.id ? undefined : current);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
    }
    const previous = fileMutationChains.current.get(file.id) || Promise.resolve();
    let releaseGate = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const chain = previous.catch(() => {}).then(() => gate);
    fileMutationChains.current.set(file.id, chain);
    await previous.catch(() => {});
    if (generation !== authGeneration.current) {
      releaseGate();
      return;
    }
    const controller = new AbortController();
    operationControllers.current.add(controller);
    try {
      const { file: updated } = await api.patchFile(file.id, patch, controller.signal);
      if (controller.signal.aborted || generation !== authGeneration.current) return;
      const keep = matchesCurrentView(updated);
      setOverviewPreview((current) => current?.id === updated.id ? updated : current);
      setFiles((items) => keep
        ? items.map((item) => item.id === updated.id ? updated : item)
        : items.filter((item) => item.id !== updated.id));
      if (!keep) {
        setActiveId((current) => current === updated.id ? undefined : current);
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(updated.id);
          return next;
        });
      }
      if ("is_shared" in patch && patch.is_shared) notify("共享链接已开启");
      refreshFiles();
      return updated;
    } catch (error) {
      if (!isAbortError(error) && generation === authGeneration.current) {
        notify((error as Error).message);
        if (removesFromCurrentView) refreshFiles();
      }
    } finally {
      operationControllers.current.delete(controller);
      releaseGate();
      void chain.finally(() => {
        if (fileMutationChains.current.get(file.id) === chain) {
          fileMutationChains.current.delete(file.id);
        }
      });
    }
  }, [demoMode, matchesCurrentView, notify, refreshFiles, view]);

  const copyShareLink = useCallback(async (file: FileItem, days = config.defaultShareDays) => {
    if (file.is_trashed) {
      notify("请先从回收站恢复文件，再创建共享链接");
      return false;
    }
    const generation = authGeneration.current;
    let sharedFile = file;
    const boundedDays = Math.max(1, Math.min(7, Math.round(days)));
    const shareExpiresAt = new Date(Date.now() + boundedDays * 86_400_000).toISOString();
    if (
      !file.is_shared
      || !file.share_token
      || !file.share_expires_at
      || Math.abs(Date.parse(file.share_expires_at) - Date.parse(shareExpiresAt)) > 60_000
    ) {
      const updated = await patchFile(file, {
        is_shared: 1,
        share_expires_at: shareExpiresAt
      });
      if (!updated) return false;
      sharedFile = updated;
    }
    if (!sharedFile.share_token) return false;
    const copied = await copyToClipboard(
      `${window.location.origin}/share/${encodeURIComponent(sharedFile.share_token)}`
    );
    if (generation !== authGeneration.current) return false;
    notify(copied ? `共享链接已复制，${boundedDays} 天内有效` : "无法访问剪贴板，请从预览中复制链接");
    return copied;
  }, [config.defaultShareDays, notify, patchFile]);

  const deleteFile = useCallback(async (file: FileItem) => {
    if (demoMode) {
      setDemoLibrary((items) => items.filter((item) => item.id !== file.id));
      setFiles((items) => items.filter((item) => item.id !== file.id));
      setActiveId(undefined);
      notify("文件已永久删除");
      return;
    }
    const generation = authGeneration.current;
    const controller = new AbortController();
    operationControllers.current.add(controller);
    setFiles((items) => items.filter((item) => item.id !== file.id));
    setTotal((current) => Math.max(0, current - 1));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(file.id);
      return next;
    });
    setActiveId((current) => current === file.id ? undefined : current);
    try {
      const { usage } = await api.deleteFile(file.id, controller.signal);
      if (controller.signal.aborted || generation !== authGeneration.current) return;
      setUser((current) => current ? { ...current, usage } : current);
      refreshFiles();
      notify("文件已永久删除");
    } catch (error) {
      if (!isAbortError(error) && generation === authGeneration.current) {
        notify((error as Error).message);
        refreshFiles();
      }
    } finally {
      operationControllers.current.delete(controller);
    }
  }, [demoMode, notify, refreshFiles]);

  const downloadFile = useCallback(async (file: FileItem) => {
    if (demoMode) {
      notify(`${file.name} 已加入下载队列`);
      return;
    }
    const generation = authGeneration.current;
    const controller = new AbortController();
    operationControllers.current.add(controller);
    try {
      await api.download(file, controller.signal);
    } catch (error) {
      if (!isAbortError(error) && generation === authGeneration.current) {
        notify((error as Error).message);
      }
    } finally {
      operationControllers.current.delete(controller);
    }
  }, [demoMode, notify]);

  const openFile = useCallback(async (file: FileItem) => {
    if (demoMode) {
      previewFile(file);
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      notify("浏览器阻止了新窗口，请允许弹出窗口后重试");
      return;
    }
    popup.opener = null;
    popup.document.title = `正在打开 ${file.name}…`;
    try {
      const { rawUrl } = await api.fileAccess(file.id);
      if (!rawUrl.startsWith("/api/file-access/")) throw new Error("文件打开地址无效");
      popup.location.replace(rawUrl);
    } catch (error) {
      popup.close();
      notify((error as Error).message);
    }
  }, [demoMode, notify, previewFile]);

  const createFolder = useCallback(async () => {
    const name = window.prompt("输入文件夹名称", "新建文件夹")?.trim();
    if (!name) return;
    try {
      await api.createFolder(name, currentFolderId);
      refreshFiles();
      notify("文件夹已创建");
    } catch (error) {
      notify((error as Error).message);
    }
  }, [currentFolderId, notify, refreshFiles]);

  const patchFolder = useCallback(async (folder: FolderItem, patch: Partial<FolderItem>) => {
    const removesFromCurrentView = Object.hasOwn(patch, "is_trashed")
      && Boolean(patch.is_trashed) !== (view === "trash");
    if (removesFromCurrentView) {
      setFolders((items) => items.filter((item) => item.id !== folder.id));
      setTotal((current) => Math.max(0, current - 1));
      setSelectedFolderIds((current) => {
        const next = new Set(current);
        next.delete(folder.id);
        return next;
      });
    }
    try {
      await api.patchFolder(folder.id, patch);
      refreshFiles();
      notify(Object.hasOwn(patch, "name") ? "文件夹已重命名" : "文件夹已更新");
    } catch (error) {
      notify((error as Error).message);
      if (removesFromCurrentView) refreshFiles();
    }
  }, [notify, refreshFiles, view]);

  const deleteFolder = useCallback(async (folder: FolderItem) => {
    setFolders((items) => items.filter((item) => item.id !== folder.id));
    setTotal((current) => Math.max(0, current - 1));
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folder.id);
      return next;
    });
    try {
      const { usage } = await api.deleteFolder(folder.id);
      setUser((current) => current ? { ...current, usage } : current);
      refreshFiles();
      notify("文件夹已永久删除");
    } catch (error) {
      notify((error as Error).message);
      refreshFiles();
    }
  }, [notify, refreshFiles]);

  const copySelection = useCallback((mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => {
    const fileIds = file ? [file.id] : [...selectedIds];
    const folderIds = folder ? [folder.id] : [...selectedFolderIds];
    if (!fileIds.length && !folderIds.length) return;
    setClipboard({ mode, fileIds, folderIds });
    notify(mode === "copy" ? "已复制到文件剪贴板" : "已剪切，可进入目标文件夹后粘贴");
  }, [notify, selectedFolderIds, selectedIds]);

  const pasteSelection = useCallback(async () => {
    if (!clipboard) return;
    try {
      const { usage } = await api.fileOperation({
        action: clipboard.mode,
        fileIds: clipboard.fileIds,
        folderIds: clipboard.folderIds,
        targetFolderId: currentFolderId
      });
      setUser((current) => current ? { ...current, usage } : current);
      if (clipboard.mode === "move") setClipboard(undefined);
      setSelectedIds(new Set());
      setSelectedFolderIds(new Set());
      refreshFiles();
      notify(clipboard.mode === "copy" ? "副本已创建" : "项目已移动");
    } catch (error) {
      notify((error as Error).message);
    }
  }, [clipboard, currentFolderId, notify, refreshFiles]);

  const chooseDestination = useCallback((mode: "copy" | "move", file?: FileItem, folder?: FolderItem) => {
    const fileIds = file ? [file.id] : [...selectedIds];
    const folderIds = folder ? [folder.id] : [...selectedFolderIds];
    if (!fileIds.length && !folderIds.length) return;
    setDestinationOperation({ mode, fileIds, folderIds });
  }, [selectedFolderIds, selectedIds]);

  const confirmDestination = useCallback(async (targetFolderId: string | null) => {
    if (!destinationOperation) return;
    try {
      const { usage } = await api.fileOperation({
        action: destinationOperation.mode,
        fileIds: destinationOperation.fileIds,
        folderIds: destinationOperation.folderIds,
        targetFolderId
      });
      setUser((current) => current ? { ...current, usage } : current);
      setDestinationOperation(undefined);
      setSelectedIds(new Set());
      setSelectedFolderIds(new Set());
      refreshFiles();
      notify(destinationOperation.mode === "copy" ? "项目已复制到目标文件夹" : "项目已移动到目标文件夹");
    } catch (error) {
      notify((error as Error).message);
    }
  }, [destinationOperation, notify, refreshFiles]);

  const sendFileToWebdav = useCallback((file: FileItem) => setWebdavSendFiles([file]), []);

  const updatePublicConfig = useCallback((settings: PublicConfig | SystemSettings) => {
    setConfig({
      siteName: settings.siteName,
      siteSubtitle: settings.siteSubtitle,
      allowRegistration: settings.allowRegistration,
      maxUploadMb: settings.maxUploadMb,
      defaultExpiryDays: settings.defaultExpiryDays,
      defaultShareDays: settings.defaultShareDays,
      expiryWarningDays: settings.expiryWarningDays,
      maxFilesPerUpload: settings.maxFilesPerUpload,
      allowedTypes: settings.allowedTypes,
      allowPersonalWebdav: settings.allowPersonalWebdav,
      allowTickets: settings.allowTickets
    });
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    // Only the overview search box may open the file workspace. Inputs inside
    // settings and management pages must never be able to change the route.
    if (value.trim() && view === "overview") {
      setWorkspace({ view: "files", adminTab, profileSection });
      window.history.pushState(null, "", routeHash("files", adminTab, profileSection));
      setFilter("all");
      setActiveId(undefined);
      setOverviewPreview(undefined);
      setSelectedIds(new Set());
    }
  }, [adminTab, profileSection, view]);

  useEffect(() => {
    if (!user) return;
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      depth += 1;
      setGlobalDragging(true);
    };
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setGlobalDragging(false);
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      setGlobalDragging(false);
      if (event.defaultPrevented || !event.dataTransfer?.files.length) return;
      event.preventDefault();
      void uploadFiles(Array.from(event.dataTransfer.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [uploadFiles, user]);

  useEffect(() => {
    if (!fileViews.has(view)) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "c" || key === "x") {
        event.preventDefault();
        copySelection(key === "c" ? "copy" : "move");
      } else if (key === "v" && clipboard) {
        event.preventDefault();
        void pasteSelection();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clipboard, copySelection, pasteSelection, view]);
  const updateCurrentUser = useCallback((updated: User) => {
    setUser((current) => current?.id === updated.id ? updated : current);
  }, []);
  const changeSort = useCallback((next: FileSort) => {
    if (next === sortBy) {
      setSortOrder((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortBy(next);
      setSortOrder(next === "updated" ? "desc" : "asc");
    }
  }, [sortBy]);

  if (!authReady) {
    return <div className="app-loader"><LoaderCircle className="spin" /><span>正在连接{config.siteName}…</span></div>;
  }
  if (shareToken !== undefined) {
    return (
      <Suspense fallback={<div className="app-loader"><LoaderCircle className="spin" /><span>正在载入共享页面…</span></div>}>
        <ShareScreen token={shareToken} siteName={config.siteName} />
      </Suspense>
    );
  }
  if (!user) {
    return <AuthScreen onSubmit={authenticate} busy={authBusy} error={authError} config={config} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        view={view}
        collapsed={false}
        mobileOpen={mobileNavOpen}
        onNavigate={navigate}
        onCloseMobile={closeMobileNav}
        siteName={config.siteName}
        allowPersonalWebdav={config.allowPersonalWebdav}
        allowTickets={config.allowTickets}
      />
      <div className="app-main">
        <Topbar
          user={user}
          query={query}
          onQuery={updateQuery}
          layout={layout}
          onLayout={setLayout}
          theme={theme}
          onTheme={openTheme}
          onMenu={openMobileNav}
          onLogout={logout}
          onProfile={() => navigate("profile", { profileSection: "account" })}
          view={view}
        />
        <main className="workspace-main">
          <Suspense fallback={<div className="app-loader app-loader--inline"><LoaderCircle className="spin" /><span>正在载入工作区…</span></div>}>
            {view === "overview" ? (
              <OverviewPanel
                user={user}
                demoFiles={demoMode ? demoLibrary : undefined}
                onNavigate={navigate}
                onAdd={openPaste}
                onPreview={previewOverviewFile}
                onPatch={patchFile}
                onDownload={downloadFile}
                onToast={notify}
              />
            ) : view === "profile" ? (
              <ProfilePanel user={user} section={profileSection} onSectionChange={selectProfileSection} onUserChange={updateCurrentUser} onToast={notify} onAccountDeleted={logout} />
            ) : view === "webdav" ? (
              <WebdavPanel onToast={notify} onConfigure={() => navigate("profile", { profileSection: "webdav" })} onOpenMyFiles={() => navigate("files")} />
            ) : view === "tickets" ? (
              <TicketPanel user={user} onToast={notify} />
            ) : view === "admin" ? (
              user.role === "admin" ? <AdminPanel
                  currentUser={user}
                  activeTab={adminTab}
                  onTabChange={selectAdminTab}
                  onToast={notify}
                  onSettingsChange={updatePublicConfig}
                  onCurrentUserChange={updateCurrentUser}
                  demoMode={demoMode}
                /> : <div className="panel-loading"><ShieldCheck />当前账号没有管理中心权限。</div>
            ) : fileViews.has(view) ? (
              <FileBrowser
                files={files}
                folders={folders}
                breadcrumbs={breadcrumbs}
                currentFolderId={currentFolderId}
                view={view}
                filter={filter}
                onFilter={setFilter}
                selectedIds={selectedIds}
                selectedFolderIds={selectedFolderIds}
                onSelect={selectFile}
                onSelectFolder={selectFolder}
                activeFile={activeFile}
                onPreview={previewFile}
                onOpen={openFile}
                onOpenFolder={openFolder}
                layout={layout}
                onLayout={setLayout}
                loading={loading}
                uploading={uploading}
                page={page}
                pageSize={pageSize}
                total={total}
                sortBy={sortBy}
                sortOrder={sortOrder}
                userName={user.name}
                maxUploadMb={config.maxUploadMb}
                maxFilesPerUpload={config.maxFilesPerUpload}
                allowedTypes={config.allowedTypes}
                onUpload={uploadFiles}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1); }}
                onSort={changeSort}
                onAdd={openPaste}
                onCreateFolder={createFolder}
                onPatch={patchFile}
                onPatchFolder={patchFolder}
                onDelete={deleteFile}
                onDeleteFolder={deleteFolder}
                onDownload={downloadFile}
                onCopyLink={copyShareLink}
                onClipboard={copySelection}
                onChooseDestination={chooseDestination}
                onPaste={pasteSelection}
                clipboardLabel={clipboard ? `${clipboard.mode === "copy" ? "复制" : "剪切"}了 ${clipboard.fileIds.length + clipboard.folderIds.length} 项` : undefined}
                onSendWebdav={sendFileToWebdav}
                onSendWebdavSelection={setWebdavSendFiles}
              />
            ) : (
              <div className="panel-loading"><LoaderCircle />工作区状态异常，请从左侧栏重新进入。</div>
            )}
          </Suspense>
          {activeFile && (fileViews.has(view) || view === "overview") ? (
            <Suspense fallback={<PreviewLoadingFallback fileName={activeFile.name} />}>
              <PreviewPanel
                  file={activeFile}
                  onClose={closePreview}
                  onPatch={patchFile}
                  onDownload={downloadFile}
                  onOpen={openFile}
                  onCopyLink={copyShareLink}
                  defaultShareDays={config.defaultShareDays}
                  onPrevious={activeIndex > 0 ? () => setActiveId(files[activeIndex - 1].id) : undefined}
                  onNext={activeIndex < files.length - 1 ? () => setActiveId(files[activeIndex + 1].id) : undefined}
                />
            </Suspense>
          ) : null}
        </main>
      </div>
      <MobileNav view={view} onNavigate={navigate} onAdd={openPaste} />
      {pasteOpen && (
        <ContentModal
          onClose={() => setPasteOpen(false)}
          onCreate={createPaste}
          onUpload={uploadFiles}
          busy={pasteBusy}
          uploading={uploading}
          defaultExpiryDays={config.defaultExpiryDays}
          maxUploadMb={config.maxUploadMb}
          maxFilesPerUpload={config.maxFilesPerUpload}
          returnFocus={pasteTrigger}
        />
      )}
      {globalDragging && !pasteOpen && (
        <div className="global-drop-overlay" aria-hidden="true">
          <UploadDropHint />
        </div>
      )}
      {themeOpen && <ThemeModal theme={theme} onTheme={setTheme} onClose={() => setThemeOpen(false)} returnFocus={themeTrigger} />}
      {destinationOperation && <DestinationPicker mode={destinationOperation.mode} count={destinationOperation.fileIds.length + destinationOperation.folderIds.length} onConfirm={confirmDestination} onClose={() => setDestinationOperation(undefined)} onToast={notify} />}
      {webdavSendFiles.length > 0 && <SendToWebdavDialog files={webdavSendFiles} onClose={() => setWebdavSendFiles([])} onComplete={() => { setWebdavSendFiles([]); setSelectedIds(new Set()); }} onToast={notify} />}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 /><span>{toast}</span><button onClick={() => setToast("")} aria-label="关闭提示"><X /></button>
        </div>
      )}
    </div>
  );
}

function UploadDropHint() {
  return <div><strong>松开即可上传</strong><span>文件将保存到你的私有空间，其他用户与管理员均不可见。</span></div>;
}

function PreviewLoadingFallback({ fileName }: { fileName: string }) {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const frame = window.requestAnimationFrame(() => element.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mobile]);
  return (
    <div
      ref={element}
      className="preview-panel preview-panel--loading"
      role={mobile ? "dialog" : "status"}
      aria-modal={mobile || undefined}
      aria-label={`正在载入 ${fileName} 的预览`}
      tabIndex={mobile ? -1 : undefined}
    >
      <LoaderCircle className="spin" />
    </div>
  );
}
