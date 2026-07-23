export function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDate(value?: string, includeTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).format(new Date(value));
}

export function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export function fileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()?.toUpperCase() : "FILE";
}
