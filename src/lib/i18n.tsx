import { createContext, useContext, useMemo, useState } from "react";
import { applyLocale, initialLocale, type AppLocale } from "./locale";

const zhCN = {
  "nav.overview": "概览", "nav.files": "我的文件", "nav.shared": "共享链接", "nav.favorites": "收藏",
  "nav.webdav": "个人 WebDAV", "nav.tickets": "工单", "nav.trash": "回收站", "nav.profile": "个人设置", "nav.admin": "管理中心",
  "common.close": "关闭", "common.search": "搜索文件与内容", "common.list": "列表视图", "common.grid": "网格视图", "common.gallery": "图片视图",
  "common.open": "新窗口打开", "common.download": "下载", "common.copyLink": "复制链接", "common.copied": "已复制", "common.loading": "正在载入…",
  "common.type": "类型", "common.size": "大小", "common.created": "创建时间", "common.updated": "修改时间", "common.expires": "过期时间", "common.forever": "永久有效",
  "common.language": "界面语言", "common.add": "添加内容", "common.logout": "退出登录", "common.files": "文件", "common.share": "共享",
  "role.primary": "主管理员", "role.admin": "管理员", "role.member": "普通用户", "storage.title": "存储空间", "storage.used": "已使用",
  "theme.title": "界面皮肤", "theme.subtitle": "选择最适合你的工作氛围。", "theme.done": "完成", "theme.autoFont": "字号会随窗口大小自动缩放",
  "theme.cloud": "云白", "theme.ink": "墨夜", "theme.mist": "雾蓝", "theme.forest": "森屿", "theme.sunset": "落霞", "theme.lavender": "鸢尾",
  "preview.title": "预览", "preview.info": "信息", "preview.activity": "活动", "preview.expand": "展开预览", "preview.collapse": "收起预览",
  "preview.zoomIn": "放大", "preview.zoomOut": "缩小", "preview.rotate": "旋转", "preview.copyText": "复制文本", "preview.loadingText": "正在载入文本…",
  "preview.loadingMedia": "正在准备流式预览…", "preview.unsupported": "浏览器不支持直接预览，请下载后查看", "preview.officeFailed": "文档转换失败，可下载原文件查看",
  "preview.fileInfo": "文件信息", "preview.detected": "自动识别完成", "preview.detectedDetail": "系统会根据文件类型选择最合适的安全预览方式。",
  "preview.creator": "创建者", "preview.fileId": "文件 ID", "preview.policy": "存储策略", "preview.privateVolume": "私有持久化数据卷",
  "preview.shareLink": "共享链接", "preview.sharePublic": "任何拥有链接的人可查看", "preview.sharePrivate": "仅你自己可访问", "preview.shareExpiry": "分享有效期（最长 7 天）",
  "preview.textTruncated": "仅显示前 1 MB，下载文件可查看完整内容。",
  "auth.hero": "一处复制，随处粘贴。", "auth.subtitle": "文件留在云端，手机无需安装额外 App。不主动下载，就不占手机文件空间。",
  "auth.preview": "专业文件管理与预览", "auth.private": "私有部署与权限控制", "auth.responsive": "浏览器打开即用",
  "auth.zeroSpace": "不下载，不占手机空间", "auth.shareAnywhere": "一条链接分享给任何人", "auth.cloudManaged": "云端整理与预览",
  "auth.mobileSubtitle": "文件留在云端，手机轻装使用。", "auth.artworkAlt": "云粘贴让一处复制的文件在手机、平板和电脑之间随处使用",
  "auth.login": "登录", "auth.register": "注册", "auth.welcome": "欢迎回来", "auth.loginHint": "使用用户名或邮箱登录你的私有空间",
  "auth.account": "用户名或邮箱", "auth.password": "密码", "auth.submit": "进入云粘贴", "auth.busy": "正在验证…"
} as const;

type MessageKey = keyof typeof zhCN;
type Messages = Partial<Record<MessageKey, string>>;

const dictionaries: Record<AppLocale, Messages> = {
  "zh-CN": zhCN,
  "zh-TW": {
    "nav.overview": "概覽", "nav.files": "我的檔案", "nav.shared": "分享連結", "nav.favorites": "收藏", "nav.webdav": "個人 WebDAV", "nav.tickets": "工單", "nav.trash": "回收桶", "nav.profile": "個人設定", "nav.admin": "管理中心",
    "common.search": "搜尋檔案與內容", "common.list": "列表檢視", "common.grid": "網格檢視", "common.gallery": "圖片檢視", "common.open": "在新視窗開啟", "common.download": "下載", "common.copyLink": "複製連結", "common.copied": "已複製", "common.language": "介面語言", "common.add": "新增內容", "common.logout": "登出",
    "theme.title": "介面主題", "theme.subtitle": "選擇最適合你的工作氛圍。", "theme.done": "完成", "theme.autoFont": "字體大小會隨視窗自動縮放",
    "preview.title": "預覽", "preview.info": "資訊", "preview.activity": "活動", "preview.expand": "展開預覽", "preview.collapse": "收起預覽", "preview.copyText": "複製文字",
    "auth.hero": "一處複製，隨處貼上。", "auth.subtitle": "檔案留在雲端，手機無需安裝額外 App。不主動下載，就不佔手機檔案空間。", "auth.preview": "專業檔案管理與預覽", "auth.responsive": "瀏覽器開啟即用", "auth.zeroSpace": "不下載，不佔手機空間", "auth.shareAnywhere": "一條連結分享給任何人", "auth.cloudManaged": "雲端整理與預覽", "auth.mobileSubtitle": "檔案留在雲端，手機輕裝使用。", "auth.artworkAlt": "雲粘貼讓一處複製的檔案在手機、平板和電腦之間隨處使用", "auth.welcome": "歡迎回來", "auth.account": "使用者名稱或電子郵件", "auth.password": "密碼", "auth.submit": "進入雲粘貼"
  },
  "en-US": {
    "nav.overview": "Overview", "nav.files": "My files", "nav.shared": "Shared links", "nav.favorites": "Favorites", "nav.webdav": "Personal WebDAV", "nav.tickets": "Tickets", "nav.trash": "Trash", "nav.profile": "Profile", "nav.admin": "Admin center",
    "common.close": "Close", "common.search": "Search files and content", "common.list": "List view", "common.grid": "Grid view", "common.gallery": "Gallery view", "common.open": "Open in new window", "common.download": "Download", "common.copyLink": "Copy link", "common.copied": "Copied", "common.loading": "Loading…", "common.language": "Language", "common.add": "Add content", "common.logout": "Sign out", "common.files": "Files", "common.share": "Shared",
    "common.type": "Type", "common.size": "Size", "common.created": "Created", "common.updated": "Modified", "common.expires": "Expires", "common.forever": "Never",
    "role.primary": "Primary admin", "role.admin": "Admin", "role.member": "Member", "storage.title": "Storage", "storage.used": "Used",
    "theme.title": "Appearance", "theme.subtitle": "Choose a workspace that feels right.", "theme.done": "Done", "theme.autoFont": "Text automatically scales with the window",
    "theme.cloud": "Cloud", "theme.ink": "Midnight", "theme.mist": "Mist", "theme.forest": "Forest", "theme.sunset": "Sunset", "theme.lavender": "Iris",
    "preview.title": "Preview", "preview.info": "Info", "preview.activity": "Activity", "preview.expand": "Expand preview", "preview.collapse": "Collapse preview", "preview.zoomIn": "Zoom in", "preview.zoomOut": "Zoom out", "preview.rotate": "Rotate", "preview.copyText": "Copy text", "preview.loadingText": "Loading text…", "preview.loadingMedia": "Preparing secure preview…", "preview.unsupported": "This format cannot be previewed here. Download it to view.", "preview.officeFailed": "Document conversion failed. Download the original to view.", "preview.fileInfo": "File information", "preview.detected": "Format recognized", "preview.detectedDetail": "The safest available renderer is selected automatically.", "preview.creator": "Owner", "preview.fileId": "File ID", "preview.policy": "Storage policy", "preview.privateVolume": "Private persistent volume", "preview.shareLink": "Shared link", "preview.sharePublic": "Anyone with the link can view", "preview.sharePrivate": "Only you can access", "preview.shareExpiry": "Link expiry (up to 7 days)", "preview.textTruncated": "Showing the first 1 MB. Download for the complete file.",
    "auth.hero": "Copy here. Paste anywhere.", "auth.subtitle": "Files stay in your cloud, with no extra mobile app. If you do not download them, they do not consume phone file storage.", "auth.preview": "Powerful management and preview", "auth.private": "Private hosting and access control", "auth.responsive": "Open in any browser", "auth.zeroSpace": "No download, no phone storage", "auth.shareAnywhere": "One link shares with anyone", "auth.cloudManaged": "Organize and preview in the cloud", "auth.mobileSubtitle": "Files stay in the cloud. Your phone stays light.", "auth.artworkAlt": "YunPaste makes one copied file available across phones, tablets and computers", "auth.login": "Sign in", "auth.register": "Register", "auth.welcome": "Welcome back", "auth.loginHint": "Sign in with your username or email", "auth.account": "Username or email", "auth.password": "Password", "auth.submit": "Open YunPaste", "auth.busy": "Signing in…"
  },
  "ja-JP": {
    "nav.overview": "概要", "nav.files": "マイファイル", "nav.shared": "共有リンク", "nav.favorites": "お気に入り", "nav.webdav": "個人 WebDAV", "nav.tickets": "チケット", "nav.trash": "ゴミ箱", "nav.profile": "個人設定", "nav.admin": "管理センター",
    "common.search": "ファイルと内容を検索", "common.open": "新しいウィンドウで開く", "common.download": "ダウンロード", "common.copyLink": "リンクをコピー", "common.copied": "コピー済み", "common.language": "表示言語", "common.logout": "ログアウト", "theme.title": "テーマ", "theme.subtitle": "作業に合うテーマを選択してください。", "theme.done": "完了", "theme.autoFont": "文字サイズはウィンドウに合わせて自動調整されます", "preview.title": "プレビュー", "preview.info": "情報", "preview.activity": "履歴", "preview.expand": "プレビューを拡大", "preview.collapse": "プレビューを戻す", "preview.copyText": "テキストをコピー", "auth.hero": "ここでコピー、どこでもペースト。", "auth.subtitle": "ファイルはクラウドに保存。追加アプリは不要で、ダウンロードしなければスマホ容量を使いません。", "auth.preview": "本格的な管理とプレビュー", "auth.responsive": "ブラウザですぐ使える", "auth.zeroSpace": "未保存ならスマホ容量ゼロ", "auth.shareAnywhere": "リンク一つで誰にでも共有", "auth.cloudManaged": "クラウドで整理・プレビュー", "auth.mobileSubtitle": "ファイルはクラウドに。スマホは軽いまま。", "auth.artworkAlt": "一度コピーしたファイルをスマホ、タブレット、パソコンで使える YunPaste", "auth.welcome": "おかえりなさい", "auth.account": "ユーザー名またはメール", "auth.password": "パスワード", "auth.submit": "YunPaste を開く"
  },
  "ko-KR": {
    "nav.overview": "개요", "nav.files": "내 파일", "nav.shared": "공유 링크", "nav.favorites": "즐겨찾기", "nav.webdav": "개인 WebDAV", "nav.tickets": "문의", "nav.trash": "휴지통", "nav.profile": "개인 설정", "nav.admin": "관리 센터",
    "common.search": "파일 및 내용 검색", "common.open": "새 창에서 열기", "common.download": "다운로드", "common.copyLink": "링크 복사", "common.copied": "복사됨", "common.language": "언어", "common.logout": "로그아웃", "theme.title": "테마", "theme.subtitle": "작업에 어울리는 테마를 선택하세요.", "theme.done": "완료", "theme.autoFont": "창 크기에 맞춰 글자 크기가 자동 조정됩니다", "preview.title": "미리보기", "preview.info": "정보", "preview.activity": "활동", "preview.expand": "미리보기 확대", "preview.collapse": "미리보기 축소", "preview.copyText": "텍스트 복사", "auth.hero": "한 곳에서 복사하고 어디서나 붙여넣기.", "auth.subtitle": "파일은 클라우드에 보관됩니다. 추가 앱 없이, 다운로드하지 않으면 휴대폰 저장 공간을 쓰지 않습니다.", "auth.preview": "강력한 파일 관리와 미리보기", "auth.responsive": "브라우저에서 바로 사용", "auth.zeroSpace": "다운로드 전에는 저장 공간 제로", "auth.shareAnywhere": "링크 하나로 누구에게나 공유", "auth.cloudManaged": "클라우드 정리 및 미리보기", "auth.mobileSubtitle": "파일은 클라우드에, 휴대폰은 가볍게.", "auth.artworkAlt": "한 번 복사한 파일을 휴대폰, 태블릿, 컴퓨터에서 사용하는 YunPaste", "auth.welcome": "다시 오신 것을 환영합니다", "auth.account": "사용자 이름 또는 이메일", "auth.password": "비밀번호", "auth.submit": "YunPaste 열기"
  },
  "es-ES": {
    "nav.overview": "Resumen", "nav.files": "Mis archivos", "nav.shared": "Enlaces", "nav.favorites": "Favoritos", "nav.webdav": "WebDAV personal", "nav.tickets": "Soporte", "nav.trash": "Papelera", "nav.profile": "Perfil", "nav.admin": "Administración",
    "common.search": "Buscar archivos y contenido", "common.open": "Abrir en otra ventana", "common.download": "Descargar", "common.copyLink": "Copiar enlace", "common.copied": "Copiado", "common.language": "Idioma", "common.logout": "Cerrar sesión", "theme.title": "Apariencia", "theme.subtitle": "Elige el ambiente que prefieras.", "theme.done": "Listo", "theme.autoFont": "El texto se adapta automáticamente a la ventana", "preview.title": "Vista previa", "preview.info": "Información", "preview.activity": "Actividad", "preview.expand": "Ampliar vista previa", "preview.collapse": "Reducir vista previa", "preview.copyText": "Copiar texto", "auth.hero": "Copia aquí. Pega en cualquier lugar.", "auth.subtitle": "Los archivos quedan en tu nube. Sin otra app móvil y sin ocupar espacio si no los descargas.", "auth.preview": "Gestión y vista previa avanzadas", "auth.responsive": "Ábrelo en el navegador", "auth.zeroSpace": "Sin descarga, sin espacio ocupado", "auth.shareAnywhere": "Un enlace para compartir con cualquiera", "auth.cloudManaged": "Organiza y previsualiza en la nube", "auth.mobileSubtitle": "Tus archivos en la nube, tu móvil ligero.", "auth.artworkAlt": "YunPaste permite usar un archivo copiado en móviles, tabletas y ordenadores", "auth.welcome": "Bienvenido de nuevo", "auth.account": "Usuario o correo", "auth.password": "Contraseña", "auth.submit": "Abrir YunPaste"
  },
  "fr-FR": {
    "nav.overview": "Aperçu", "nav.files": "Mes fichiers", "nav.shared": "Liens partagés", "nav.favorites": "Favoris", "nav.webdav": "WebDAV personnel", "nav.tickets": "Tickets", "nav.trash": "Corbeille", "nav.profile": "Profil", "nav.admin": "Administration",
    "common.search": "Rechercher des fichiers et du contenu", "common.open": "Ouvrir dans une nouvelle fenêtre", "common.download": "Télécharger", "common.copyLink": "Copier le lien", "common.copied": "Copié", "common.language": "Langue", "common.logout": "Déconnexion", "theme.title": "Apparence", "theme.subtitle": "Choisissez votre ambiance de travail.", "theme.done": "Terminé", "theme.autoFont": "Le texte s’adapte automatiquement à la fenêtre", "preview.title": "Aperçu", "preview.info": "Informations", "preview.activity": "Activité", "preview.expand": "Agrandir l’aperçu", "preview.collapse": "Réduire l’aperçu", "preview.copyText": "Copier le texte", "auth.hero": "Copiez ici. Collez partout.", "auth.subtitle": "Les fichiers restent dans votre cloud. Aucune app mobile en plus et aucun espace occupé sans téléchargement.", "auth.preview": "Gestion et aperçu avancés", "auth.responsive": "Accessible dans le navigateur", "auth.zeroSpace": "Sans téléchargement, aucun stockage", "auth.shareAnywhere": "Un lien à partager avec tous", "auth.cloudManaged": "Organisation et aperçu dans le cloud", "auth.mobileSubtitle": "Les fichiers dans le cloud, le téléphone léger.", "auth.artworkAlt": "YunPaste rend un fichier copié disponible sur téléphone, tablette et ordinateur", "auth.welcome": "Bon retour", "auth.account": "Nom d’utilisateur ou e-mail", "auth.password": "Mot de passe", "auth.submit": "Ouvrir YunPaste"
  }
};

interface I18nValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState(() => initialLocale());
  applyLocale(locale);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale: (next) => { applyLocale(next); updateLocale(next); },
    t: (key) => dictionaries[locale][key] || zhCN[key]
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
