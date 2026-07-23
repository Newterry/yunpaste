import {
  ArrowLeft, Camera, CheckCircle2, KeyRound, LoaderCircle, Save, ShieldCheck,
  Sparkles, Trash2, UserRound
} from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { initials } from "../lib/format";
import type { ProfileSection, User } from "../types";
import { PersonalWebdavSettings } from "./PersonalWebdavSettings";

const avatarPresets = [
  ["cat", "小橘猫"], ["dog", "金毛犬"], ["rabbit", "白兔兔"], ["fox", "小狐狸"], ["panda", "大熊猫"],
  ["koala", "小考拉"], ["tiger", "虎宝宝"], ["lion", "狮子宝宝"], ["bear", "棕熊宝宝"], ["frog", "树蛙"],
  ["penguin", "企鹅宝宝"], ["owl", "雪鸮"], ["chick", "小黄鸡"], ["unicorn", "独角兽"], ["hamster", "金丝熊"],
  ["monkey", "小猴子"], ["pig", "粉红猪"], ["mouse", "小灰鼠"], ["octopus", "小章鱼"], ["whale", "小蓝鲸"]
] as const;

export function ProfilePanel({
  user, section, onSectionChange, onUserChange, onToast, onAccountDeleted
}: {
  user: User;
  section: ProfileSection;
  onSectionChange: (section: ProfileSection) => void;
  onUserChange: (user: User) => void;
  onToast: (message: string) => void;
  onAccountDeleted: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState<"name" | "password" | "avatar" | "delete">();
  const fileInput = useRef<HTMLInputElement>(null);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("name");
    try {
      const { user: updated } = await api.updateProfile({
        username,
        name,
        ...(email !== user.email ? { email, currentPassword: emailPassword } : {})
      });
      onUserChange(updated);
      setEmailPassword("");
      onToast("个人资料已更新");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      onToast("两次输入的新密码不一致");
      return;
    }
    setBusy("password");
    try {
      await api.updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onToast("密码已更新，请妥善保管新密码");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    setBusy("avatar");
    try {
      const { user: updated } = await api.uploadAvatar(file);
      onUserChange(updated);
      onToast("头像已更新");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const deleteAvatar = async () => {
    setBusy("avatar");
    try {
      const { user: updated } = await api.deleteAvatar();
      onUserChange(updated);
      onToast("头像已移除");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const choosePreset = async (preset: string) => {
    setBusy("avatar");
    try {
      const { user: updated } = await api.setAvatarPreset(preset);
      onUserChange(updated);
      onToast("预设头像已应用");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const deleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.confirm("确定永久注销账号吗？你的全部文件、分享、WebDAV 配置和工单都会被删除，此操作无法撤销。")) return;
    setBusy("delete");
    try {
      await api.deleteProfile(deletePassword);
      onAccountDeleted();
    } catch (error) {
      onToast((error as Error).message);
      setBusy(undefined);
    }
  };

  return (
    <section className="settings-page profile-page">
      <div className="page-heading">
        <div><h1>个人设置</h1><p>管理头像、登录信息、安全设置和账号生命周期。</p></div>
      </div>

      <nav className="profile-settings-nav" aria-label="个人设置分类">
        <button type="button" className={section === "account" ? "is-active" : ""} onClick={() => onSectionChange("account")} aria-current={section === "account" ? "page" : undefined}><UserRound />账户设置</button>
        <button type="button" className={section === "avatar" ? "is-active" : ""} onClick={() => onSectionChange("avatar")} aria-current={section === "avatar" ? "page" : undefined}><Sparkles />头像中心</button>
        <button type="button" className={section === "webdav" ? "is-active" : ""} onClick={() => onSectionChange("webdav")} aria-current={section === "webdav" ? "page" : undefined}><ShieldCheck />WebDAV 连接</button>
      </nav>

      {section === "webdav" ? (
        <div className="profile-layout profile-layout--connections">
          <PersonalWebdavSettings onToast={onToast} />
        </div>
      ) : section === "avatar" ? (
        <div className="avatar-center-page">
          <button type="button" className="avatar-center__back" onClick={() => onSectionChange("account")}><ArrowLeft />返回账户设置</button>
          <section className="settings-section avatar-center-card">
            <div className="avatar-center__hero"><span><Sparkles /></span><div><h2>选择你的动物伙伴</h2><p>20 个由图像模型生成的全彩卡通头像，选择后会立即应用到整个云粘贴。</p></div></div>
          <div className="avatar-editor">
            <span className="avatar avatar--profile">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
            </span>
            <div>
              <strong>设置你的头像</strong>
              <p>支持 PNG、JPEG、WebP，最大 512 KB。</p>
              <span className="avatar-editor__actions">
                <button className="button button--secondary" onClick={() => fileInput.current?.click()} disabled={busy === "avatar"}>
                  {busy === "avatar" ? <LoaderCircle className="spin" /> : <Camera />}选择图片
                </button>
                {user.avatarUrl && <button className="button button--ghost danger-text" onClick={deleteAvatar} disabled={busy === "avatar"}><Trash2 />移除</button>}
              </span>
            </div>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void uploadAvatar(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <div className="avatar-presets">
            <div><strong>全彩动物头像</strong><small>点击即可预览并应用</small></div>
            <div className="avatar-presets__grid">
              {avatarPresets.map(([id, label]) => <button key={id} type="button" className={user.avatar_preset === id ? "is-active" : ""} onClick={() => void choosePreset(id)} disabled={busy === "avatar"} title={label} aria-label={`使用${label}头像`}><img src={`/api/avatar-presets/${id}.png?v=3`} alt="" loading="lazy" /><span>{label}</span>{user.avatar_preset === id && <CheckCircle2 />}</button>)}
            </div>
          </div>
          </section>
        </div>
      ) : <div className="profile-layout">
        <section className="settings-section profile-card-large account-avatar-summary">
          <span className="avatar avatar--profile">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span>
          <span><strong>你的个人头像</strong><small>上传照片，或从 20 个全彩卡通动物中选择。</small></span>
          <button type="button" className="button button--secondary" onClick={() => onSectionChange("avatar")}><Sparkles />进入头像中心</button>
        </section>

        <form className="settings-section" onSubmit={saveName}>
          <div className="settings-section__title"><UserRound /><span><h2>基本资料</h2><p>所有用户都可以修改自己的用户名和显示名称</p></span></div>
          <label className="field"><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} autoComplete="username" required /><small>可用于登录，支持字母、数字、点、下划线和连字符。</small></label>
          <label className="field"><span>邮箱地址</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /><small>邮箱也可用于登录。</small></label>
          {email !== user.email && <label className="field"><span>当前密码</span><input type="password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} autoComplete="current-password" required /><small>修改登录邮箱前需要验证当前密码。</small></label>}
          <label className="field"><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></label>
          <div className="form-actions"><button className="button button--primary" disabled={busy === "name"}>{busy === "name" ? <LoaderCircle className="spin" /> : <Save />}保存资料</button></div>
        </form>

        <form className="settings-section" onSubmit={savePassword}>
          <div className="settings-section__title"><KeyRound /><span><h2>修改密码</h2><p>更新后现有登录仍保持有效</p></span></div>
          <label className="field"><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label className="field"><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          <label className="field"><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          <div className="security-note"><ShieldCheck /><span>密码使用 bcrypt 加密保存，服务端不会返回密码内容。</span></div>
          <div className="form-actions"><button className="button button--primary" disabled={busy === "password"}>{busy === "password" ? <LoaderCircle className="spin" /> : <CheckCircle2 />}更新密码</button></div>
        </form>

        <form className="settings-section danger-zone" onSubmit={deleteAccount}>
          <div className="settings-section__title"><Trash2 /><span><h2>注销账号</h2><p>永久删除账号及其所有私有数据</p></span></div>
          {user.isPrimaryAdmin ? <div className="security-note"><ShieldCheck /><span>主管理员账号不能自助注销，以避免系统失去所有权。</span></div> : <><label className="field"><span>当前密码</span><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" required /></label><div className="form-actions"><button className="button button--ghost danger-text" disabled={busy === "delete"}>{busy === "delete" ? <LoaderCircle className="spin" /> : <Trash2 />}永久注销账号</button></div></>}
        </form>
      </div>}
    </section>
  );
}
