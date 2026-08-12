import {
  Eye, EyeOff, Feather, Files, Languages, LockKeyhole, Mail, MonitorSmartphone,
  ScanEye, Share2, ShieldCheck, UserRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "./Brand";
import type { PublicConfig } from "../types";
import { useI18n } from "../lib/i18n";
import { localeOptions, type AppLocale } from "../lib/locale";

export function AuthScreen({ onSubmit, busy, error, config }: {
  onSubmit: (
    mode: "login" | "register",
    data: { username: string; name: string; email: string; password: string }
  ) => void;
  busy: boolean;
  error?: string;
  config: PublicConfig;
}) {
  const { locale, setLocale, t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [hideError, setHideError] = useState(false);

  useEffect(() => {
    if (!config.allowRegistration && mode === "register") setMode("login");
  }, [config.allowRegistration, mode]);
  useEffect(() => setHideError(false), [error]);

  const changeMode = (next: "login" | "register") => {
    setMode(next);
    setHideError(true);
  };

  return (
    <main className="auth-screen">
      <section className="auth-showcase" aria-label="云粘贴功能简介">
        <Brand name={config.siteName} />
        <div className="auth-showcase__copy">
          <h2>{t("auth.hero")}</h2>
          <p>{t("auth.subtitle")}</p>
          <div className="auth-benefits">
            <span><Feather /><strong>{t("auth.zeroSpace")}</strong></span>
            <span><MonitorSmartphone /><strong>{t("auth.responsive")}</strong></span>
            <span><Share2 /><strong>{t("auth.shareAnywhere")}</strong></span>
            <span><ScanEye /><strong>{t("auth.preview")}</strong></span>
          </div>
        </div>
        <picture className="auth-artwork">
          <source srcSet="/assets/yunpaste-anywhere-hero.webp" type="image/webp" />
          <img
            src="/assets/yunpaste-anywhere-hero.png"
            alt={t("auth.artworkAlt")}
            width="1672"
            height="941"
            decoding="async"
            fetchPriority="high"
          />
        </picture>
      </section>
      <section className="auth-form-area">
        <label className="auth-language" title={t("common.language")}><Languages /><select value={locale} onChange={(event) => setLocale(event.target.value as AppLocale)} aria-label={t("common.language")}>{localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <div className="auth-form">
          <div className="auth-mobile-brand"><Brand name={config.siteName} /></div>
          <div className="auth-mobile-promise">
            <strong>{t("auth.hero")}</strong>
            <span>{t("auth.mobileSubtitle")}</span>
            <div><Feather />{t("auth.zeroSpace")}<i /> <Files />{t("auth.cloudManaged")}</div>
          </div>
          <h1 id="auth-heading">{mode === "login" ? t("auth.welcome") : "创建你的账户"}</h1>
          <p>{mode === "login" ? t("auth.loginHint") : "几秒钟开始使用你的私有空间。"}</p>
          <div
            className={`auth-mode ${config.allowRegistration ? "" : "auth-mode--single"}`}
            role="tablist"
            aria-label="账户操作"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => changeMode("login")}
              disabled={busy}
            >
              {t("auth.login")}
            </button>
            {config.allowRegistration && (
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => changeMode("register")}
                disabled={busy}
              >
                {t("auth.register")}
              </button>
            )}
          </div>
          <form
            aria-labelledby="auth-heading"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              setHideError(false);
              onSubmit(mode, { username, name, email, password });
            }}
          >
            {mode === "register" && (
              <>
                <label>
                  <span>用户名</span>
                  <div className="auth-input">
                    <UserRound aria-hidden="true" />
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="3–32 位，用于登录"
                      autoComplete="username"
                      minLength={3}
                      maxLength={32}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>显示名称</span>
                  <div className="auth-input">
                    <UserRound aria-hidden="true" />
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="请输入你的名字"
                      autoComplete="name"
                      maxLength={80}
                      required
                    />
                  </div>
                </label>
              </>
            )}
            <label>
              <span>{mode === "login" ? t("auth.account") : "邮箱地址"}</span>
              <div className="auth-input">
                <Mail aria-hidden="true" />
                <input
                  type={mode === "login" ? "text" : "email"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={mode === "login" ? t("auth.account") : "请输入邮箱地址"}
                  autoComplete={mode === "login" ? "username" : "email"}
                  inputMode={mode === "login" ? "text" : "email"}
                  required
                />
              </div>
            </label>
            <label>
              <span>{t("auth.password")}</span>
              <div className="auth-input password-input">
                <LockKeyhole aria-hidden="true" />
                <input
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("auth.password")}
                  minLength={mode === "login" ? 1 : 8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
                <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏密码" : "显示密码"}>
                  {visible ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>
            {error && !hideError && <div className="form-error" role="alert">{error}</div>}
            <button type="submit" className="button button--primary auth-submit" disabled={busy}>
              <span>{busy ? (mode === "login" ? t("auth.busy") : "正在创建…") : (mode === "login" ? t("auth.submit") : "创建账户")}</span>
            </button>
            <span className="sr-only" aria-live="polite">
              {busy ? (mode === "login" ? "正在登录，请稍候" : "正在创建账户，请稍候") : ""}
            </span>
          </form>
          <small className="auth-legal"><ShieldCheck aria-hidden="true" />登录凭据只会发送到当前自托管实例。</small>
        </div>
      </section>
    </main>
  );
}
