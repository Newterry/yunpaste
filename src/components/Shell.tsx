import {
  ArchiveRestore, ChevronDown, CloudCog, FileHeart, Files, Gauge, Grid2X2, HardDrive,
  Home, Images, LayoutList, LogOut, Menu, MoonStar, Plus, Search, Settings2, Share2,
  Sparkles, TicketCheck, Trash2, UserCog, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand";
import type { FileLayout, NavView, ThemeName, User } from "../types";
import { formatBytes, initials } from "../lib/format";

interface SidebarProps {
  user: User;
  view: NavView;
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: (view: NavView) => void;
  onCloseMobile: () => void;
  siteName: string;
  allowPersonalWebdav: boolean;
  allowTickets: boolean;
}

const primaryNav: Array<[NavView, string, typeof Gauge]> = [
  ["overview", "概览", Gauge],
  ["files", "我的文件", Files],
  ["shared", "共享链接", Share2],
  ["favorites", "收藏", FileHeart],
  ["webdav", "个人 WebDAV", CloudCog],
  ["tickets", "工单", TicketCheck],
  ["trash", "回收站", Trash2]
];

export function Sidebar({
  user, view, collapsed, mobileOpen, onNavigate, onCloseMobile, siteName,
  allowPersonalWebdav, allowTickets
}: SidebarProps) {
  const quotaPercent = user.quota > 0 ? Math.min(100, (user.usage / user.quota) * 100) : 100;
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>(".app-main, .mobile-nav")];
    const previousInert = background.map((element) => [element, element.hasAttribute("inert")] as const);
    background.forEach((element) => element.setAttribute("inert", ""));
    const focusable = () => [...(drawer.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
    ) || [])];
    window.requestAnimationFrame(() => {
      drawer.current?.querySelector<HTMLElement>(".sidebar__mobile-close")?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
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
      previousFocus?.focus();
    };
  }, [isMobile, mobileOpen, onCloseMobile]);
  const go = (next: NavView) => {
    onNavigate(next);
    onCloseMobile();
  };
  const visibleNav = primaryNav.filter(([key]) => (
    (key !== "webdav" || allowPersonalWebdav)
    && (key !== "tickets" || allowTickets)
  ));
  return (
    <>
      {mobileOpen && <button className="mobile-scrim" onClick={onCloseMobile} aria-label="关闭导航" />}
      <aside
        ref={drawer}
        className={`sidebar ${collapsed ? "sidebar--collapsed" : ""} ${mobileOpen ? "sidebar--open" : ""}`}
        aria-hidden={isMobile && !mobileOpen}
        inert={isMobile && !mobileOpen ? true : undefined}
      >
        <div className="sidebar__head">
          <Brand compact={collapsed} name={siteName} />
          <button className="sidebar__mobile-close icon-button" onClick={onCloseMobile} aria-label="关闭导航"><X /></button>
        </div>
        <nav className="sidebar__nav" aria-label="主导航">
          {visibleNav.map(([key, label, Icon]) => (
            <button key={key} className={view === key ? "is-active" : ""} onClick={() => go(key)} title={label} aria-current={view === key ? "page" : undefined}>
              <Icon />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__spacer" />
        <div className="storage-card" title={`已使用 ${formatBytes(user.usage)}`}>
          <div className="storage-card__label">
            <HardDrive />
            {!collapsed && (
              <span>
                <small>存储空间</small>
                <strong>{formatBytes(user.usage)} / {formatBytes(user.quota)}</strong>
              </span>
            )}
          </div>
          {!collapsed && (
            <>
              <div className="progress"><i style={{ width: `${quotaPercent}%` }} /></div>
              <small>{Math.round(quotaPercent)}%</small>
            </>
          )}
        </div>
        <button className={`profile-card ${view === "profile" ? "is-active" : ""}`} onClick={() => go("profile")}>
          <span className="avatar avatar--large">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span>
          {!collapsed && (
            <>
              <span><strong>{user.name}</strong><small>{user.isPrimaryAdmin ? "主管理员" : user.role === "admin" ? "管理员" : "普通用户"}</small></span>
              <UserCog />
            </>
          )}
        </button>
        {user.role === "admin" && (
          <button className={`sidebar-admin-link ${view === "admin" ? "is-active" : ""}`} onClick={() => go("admin")}>
            <Settings2 />{!collapsed && <span>管理中心</span>}
          </button>
        )}
      </aside>
    </>
  );
}

interface TopbarProps {
  user: User;
  query: string;
  onQuery: (value: string) => void;
  layout: FileLayout;
  onLayout: (layout: FileLayout) => void;
  theme: ThemeName;
  onTheme: () => void;
  onMenu: () => void;
  onLogout: () => void;
  onProfile: () => void;
  view: NavView;
}

export function Topbar({
  user, query, onQuery, layout, onLayout, theme, onTheme, onMenu, onLogout, onProfile, view
}: TopbarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  const viewLabels: Record<NavView, string> = {
    overview: "概览",
    files: "我的文件",
    shared: "共享链接",
    favorites: "收藏",
    webdav: "个人 WebDAV",
    tickets: "工单",
    trash: "回收站",
    profile: "个人设置",
    admin: "管理中心"
  };
  const searchable = view === "overview" || view === "files" || view === "shared" || view === "favorites" || view === "trash";

  useEffect(() => setMobileSearchOpen(false), [view]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape") setProfileOpen(false);
    };
    const pointer = (event: PointerEvent) => {
      if (!profile.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("pointerdown", pointer);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("pointerdown", pointer);
    };
  }, []);

  return (
    <header className="topbar">
      <button className="topbar__menu icon-button" onClick={onMenu} aria-label="打开菜单"><Menu /></button>
      <div className="breadcrumbs"><Home /><i>›</i><strong>{viewLabels[view]}</strong></div>
      <strong className="topbar__mobile-title">{viewLabels[view]}</strong>
      {searchable && <>
        <button className="topbar__mobile-search icon-button" onClick={() => { setMobileSearchOpen(true); window.requestAnimationFrame(() => searchInput.current?.focus()); }} aria-label="搜索文件"><Search /></button>
        <div className={`searchbox ${mobileSearchOpen ? "is-mobile-open" : ""}`} role="search">
          <Search />
          <input ref={searchInput} name="yunpaste-file-search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索文件与内容" aria-label="模糊搜索文件名、类型或扩展名" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
          <kbd>⌘ K</kbd>
          <button type="button" className="searchbox__close" onClick={() => { setMobileSearchOpen(false); searchInput.current?.blur(); }} aria-label="关闭搜索"><X /></button>
        </div>
      </>}
      <div className="view-switch" aria-label="视图模式">
        <button className={layout === "list" ? "is-active" : ""} onClick={() => onLayout("list")} aria-label="列表视图"><LayoutList /></button>
        <button className={layout === "grid" ? "is-active" : ""} onClick={() => onLayout("grid")} aria-label="网格视图"><Grid2X2 /></button>
        <button className={layout === "gallery" ? "is-active" : ""} onClick={() => onLayout("gallery")} aria-label="图片视图"><Images /></button>
      </div>
      <button className="icon-button theme-trigger" onClick={onTheme} aria-label={`切换皮肤，当前 ${theme}`}>
        {theme === "ink" ? <MoonStar /> : theme === "mist" ? <Sparkles /> : <MoonStar />}
      </button>
      <div className="topbar-profile-wrap" ref={profile}>
        <button className="topbar__profile" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen}>
          <span className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span>
          <span>{user.name}</span>
          <ChevronDown />
        </button>
        {profileOpen && (
          <div className="profile-menu">
            <span><strong>{user.name}</strong><small>{user.email}</small></span>
            <button onClick={() => { setProfileOpen(false); onProfile(); }}><UserCog />个人设置</button>
            <button onClick={onLogout}><LogOut />退出登录</button>
          </div>
        )}
      </div>
    </header>
  );
}

export function MobileNav({ view, onNavigate, onAdd }: {
  view: NavView;
  onNavigate: (view: NavView) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="mobile-nav">
      <button className={view === "overview" ? "is-active" : ""} onClick={() => onNavigate("overview")} aria-current={view === "overview" ? "page" : undefined}><Gauge /><span>概览</span></button>
      <button className={view === "files" ? "is-active" : ""} onClick={() => onNavigate("files")} aria-current={view === "files" ? "page" : undefined}><Files /><span>文件</span></button>
      <button className="mobile-nav__create" onClick={onAdd} aria-label="添加内容"><Plus /></button>
      <button className={view === "shared" ? "is-active" : ""} onClick={() => onNavigate("shared")} aria-current={view === "shared" ? "page" : undefined}><Share2 /><span>共享</span></button>
      <button className={view === "trash" ? "is-active" : ""} onClick={() => onNavigate("trash")} aria-current={view === "trash" ? "page" : undefined}><ArchiveRestore /><span>回收站</span></button>
    </nav>
  );
}
