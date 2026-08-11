export const localeOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" }
] as const;

export type AppLocale = typeof localeOptions[number]["value"];

const supported = new Set<string>(localeOptions.map(({ value }) => value));
let activeLocale: AppLocale = "zh-CN";

export function normalizeLocale(value?: string | null): AppLocale {
  if (value && supported.has(value)) return value as AppLocale;
  const normalized = String(value || "").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("ja")) return "ja-JP";
  if (normalized.startsWith("ko")) return "ko-KR";
  if (normalized.startsWith("es")) return "es-ES";
  if (normalized.startsWith("fr")) return "fr-FR";
  if (normalized.startsWith("en")) return "en-US";
  return "zh-CN";
}

export function initialLocale(): AppLocale {
  try {
    return normalizeLocale(localStorage.getItem("yunpaste.locale") || navigator.language);
  } catch {
    return "zh-CN";
  }
}

export function applyLocale(locale: AppLocale) {
  activeLocale = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
  try { localStorage.setItem("yunpaste.locale", locale); } catch { /* Storage may be disabled. */ }
}

export function getActiveLocale() {
  return activeLocale;
}
