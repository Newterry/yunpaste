import {
  Eye, EyeOff, LockKeyhole, Mail, MonitorSmartphone, ScanEye,
  ShieldCheck, UserRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "./Brand";
import type { PublicConfig } from "../types";

export function AuthScreen({ onSubmit, busy, error, config }: {
  onSubmit: (
    mode: "login" | "register",
    data: { username: string; name: string; email: string; password: string }
  ) => void;
  busy: boolean;
  error?: string;
  config: PublicConfig;
}) {
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
          <h2>把灵感与文件，<br /><span>安全</span>地放在一起。</h2>
          <p>文本、图片、音视频与文档，在你的私有空间自然流转。</p>
          <div className="auth-benefits">
            <span><ScanEye />多格式即时预览</span>
            <span><ShieldCheck />私有部署与权限控制</span>
            <span><MonitorSmartphone />桌面与移动端自然适配</span>
          </div>
        </div>
        <img
          className="auth-artwork"
          src="/assets/cloud-workspace.webp"
          alt=""
          width="1200"
          height="800"
          decoding="async"
          fetchPriority="high"
        />
      </section>
      <section className="auth-form-area">
        <div className="auth-form">
          <div className="auth-mobile-brand"><Brand name={config.siteName} /></div>
          <h1 id="auth-heading">{mode === "login" ? "欢迎回来" : "创建你的账户"}</h1>
          <p>{mode === "login" ? "登录后继续管理你的内容。" : "几秒钟开始使用你的私有空间。"}</p>
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
              登录
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
                注册
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
              <span>{mode === "login" ? "用户名或邮箱地址" : "邮箱地址"}</span>
              <div className="auth-input">
                <Mail aria-hidden="true" />
                <input
                  type={mode === "login" ? "text" : "email"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={mode === "login" ? "请输入用户名或邮箱地址" : "请输入邮箱地址"}
                  autoComplete={mode === "login" ? "username" : "email"}
                  inputMode={mode === "login" ? "text" : "email"}
                  required
                />
              </div>
            </label>
            <label>
              <span>密码</span>
              <div className="auth-input password-input">
                <LockKeyhole aria-hidden="true" />
                <input
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
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
              <span>{busy ? (mode === "login" ? "正在登录…" : "正在创建…") : (mode === "login" ? "进入工作台" : "创建账户")}</span>
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
