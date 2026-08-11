import {
  ArchiveRestore, ChevronDown, CloudCog, FileHeart, Files, Gauge, Grid2X2, HardDrive,
  Home, Images, Languages, LayoutList, LogOut, Menu, MoonStar, Plus, Search, Settings2, Share2,
  Sparkles, TicketCheck, Trash2, UserCog, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand";
import type { FileLayout, NavView, ThemeName, User } from "../types";
import { formatBytes, initials } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { localeOptions, type AppLocale } from "../lib/locale";

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

type NavLabelKey = "nav.overview" | "nav.files" | "nav.shared" | "nav.favorites" | "nav.webdav" | "nav.tickets" | "nav.trash";
const primaryNav: Array<[NavView, NavLabelKey, typeof Gauge]> = [
  ["overview", "nav.overview", Gauge],
  ["files", "nav.files", Files],
  ["shared", "nav.shared", Share2],
  ["favorites", "nav.favorites", FileHeart],
  ["webdav", "nav.webdav", CloudCog],
  ["tickets", "nav.tickets", TicketCheck],
  ["trash", "nav.trash", Trash2]
];

export function Sidebar({
  user, view, collapsed, mobileOpen, onNavigate, onCloseMobile, siteName,
  allowPersonalWebdav, allowTickets
}: SidebarProps) {
  const { t } = useI18n();
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
      {mobileOpen && <button className="mobile-scrim" onClick={onCloseMobile} aria-label={t("common.close")} />}
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
          {visibleNav.map(([key, labelKey, Icon]) => (
            <button key={key} className={view === key ? "is-active" : ""} onClick={() => go(key)} title={t(labelKey)} aria-current={view === key ? "page" : undefined}>
              <Icon />
              {!collapsed && <span>{t(labelKey)}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__spacer" />
        <div className="storage-card" title={`${t("storage.used")} ${formatBytes(user.usage)}`}>
          <div className="storage-card__label">
            <HardDrive />
            {!collapsed && (
              <span>
                <small>{t("storage.title")}</small>
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
              <span><strong>{user.name}</strong><small>{user.isPrimaryAdmin ? t("role.primary") : user.role === "admin" ? t("role.admin") : t("role.member")}</small></span>
              <UserCog />
            </>
          )}
        </button>
        {user.role === "admin" && (
          <button className={`sidebar-admin-link ${view === "admin" ? "is-active" : ""}`} onClick={() => go("admin")}>
            <Settings2 />{!collapsed && <span>{t("nav.admin")}</span>}
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
  const { locale, setLocale, t } = useI18n();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  const viewLabels: Record<NavView, string> = {
    overview: t("nav.overview"),
    files: t("nav.files"),
    shared: t("nav.shared"),
    favorites: t("nav.favorites"),
    webdav: t("nav.webdav"),
    tickets: t("nav.tickets"),
    trash: t("nav.trash"),
    profile: t("nav.profile"),
    admin: t("nav.admin")
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
          <input ref={searchInput} name="yunpaste-file-search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
          <kbd>⌘ K</kbd>
          <button type="button" className="searchbox__close" onClick={() => { setMobileSearchOpen(false); searchInput.current?.blur(); }} aria-label="关闭搜索"><X /></button>
        </div>
      </>}
      <div className="view-switch" aria-label="视图模式">
        <button className={layout === "list" ? "is-active" : ""} onClick={() => onLayout("list")} aria-label={t("common.list")}><LayoutList /></button>
        <button className={layout === "grid" ? "is-active" : ""} onClick={() => onLayout("grid")} aria-label={t("common.grid")}><Grid2X2 /></button>
        <button className={layout === "gallery" ? "is-active" : ""} onClick={() => onLayout("gallery")} aria-label={t("common.gallery")}><Images /></button>
      </div>
      <label className="topbar-language" title={t("common.language")}>
        <Languages aria-hidden="true" />
        <select value={locale} onChange={(event) => setLocale(event.target.value as AppLocale)} aria-label={t("common.language")}>
          {localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
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
            <button onClick={() => { setProfileOpen(false); onProfile(); }}><UserCog />{t("nav.profile")}</button>
            <button onClick={onLogout}><LogOut />{t("common.logout")}</button>
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
  const { t } = useI18n();
  return (
    <nav className="mobile-nav">
      <button className={view === "overview" ? "is-active" : ""} onClick={() => onNavigate("overview")} aria-current={view === "overview" ? "page" : undefined}><Gauge /><span>{t("nav.overview")}</span></button>
      <button className={view === "files" ? "is-active" : ""} onClick={() => onNavigate("files")} aria-current={view === "files" ? "page" : undefined}><Files /><span>{t("common.files")}</span></button>
      <button className="mobile-nav__create" onClick={onAdd} aria-label={t("common.add")}><Plus /></button>
      <button className={view === "shared" ? "is-active" : ""} onClick={() => onNavigate("shared")} aria-current={view === "shared" ? "page" : undefined}><Share2 /><span>{t("common.share")}</span></button>
      <button className={view === "trash" ? "is-active" : ""} onClick={() => onNavigate("trash")} aria-current={view === "trash" ? "page" : undefined}><ArchiveRestore /><span>{t("nav.trash")}</span></button>
    </nav>
  );
}
