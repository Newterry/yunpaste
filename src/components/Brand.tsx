export function Brand({ compact = false, name = "云粘贴" }: { compact?: boolean; name?: string }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label={name} title={name}>
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <path d="M12 23.5H8.8a6.3 6.3 0 0 1 0-12.6c.9-4.7 5-8.2 10-8.2 5.2 0 9.5 4 10 9.1a6.2 6.2 0 0 1 .6 12.4H18" />
        <path d="M13.2 11.5h9.2a4.9 4.9 0 0 1 0 9.8h-5.7" />
        <path d="M24.4 18.4h-9a4.9 4.9 0 0 1 0-9.8H21" />
      </svg>
      {!compact && <span>{name}</span>}
    </div>
  );
}
