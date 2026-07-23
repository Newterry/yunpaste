import type { FileItem, User } from "../types";

const demoExpiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
const demoShareExpiry = new Date(Date.now() + 7 * 86_400_000).toISOString();

export const demoUser: User = {
  id: "user-admin",
  username: "admin",
  name: "陈默",
  email: "admin@tieyun.local",
  role: "admin",
  status: "active",
  isPrimaryAdmin: true,
  quota: 10 * 1024 ** 3,
  usage: 212 * 1024 ** 2,
  created_at: "2026-01-10T08:00:00.000Z",
  last_seen_at: new Date().toISOString()
};

const base = {
  owner_id: "user-admin",
  owner_name: "陈默",
  owner_email: "admin@tieyun.local",
  is_trashed: 0 as const,
  created_at: "2026-07-14T08:10:00.000Z",
  expires_at: demoExpiry,
  share_expires_at: demoShareExpiry
};

export const demoFiles: FileItem[] = [
  { ...base, id: "demo-md", name: "产品发布说明.md", stored_name: "demo-product-release.md", mime: "text/markdown", size: 12680, kind: "text", is_shared: 1, is_favorite: 0, share_token: "YUN82MD6", updated_at: "2026-07-17T06:32:00.000Z" },
  { ...base, id: "demo-poster", name: "夏日活动主视觉.webp", stored_name: "demo-summer-wander.webp", mime: "image/webp", size: 94836, kind: "image", is_shared: 1, is_favorite: 1, share_token: "SUMMER26", expires_at: undefined, updated_at: "2026-07-17T02:15:00.000Z" },
  { ...base, id: "demo-video", name: "季度复盘会议.mp4", stored_name: "demo-quarter-review.mp4", mime: "video/mp4", size: 134846873, kind: "video", is_shared: 1, is_favorite: 0, share_token: "Q2REVIEW", updated_at: "2026-07-16T08:45:00.000Z" },
  { ...base, id: "demo-audio", name: "品牌音效.wav", stored_name: "demo-brand-audio.wav", mime: "audio/wav", size: 10171187, kind: "audio", is_shared: 0, is_favorite: 0, updated_at: "2026-07-15T03:22:00.000Z" },
  { ...base, id: "demo-pdf", name: "项目交接清单.pdf", stored_name: "demo-handover.pdf", mime: "application/pdf", size: 1258291, kind: "document", is_shared: 1, is_favorite: 0, share_token: "HANDOVER", updated_at: "2026-07-14T01:08:00.000Z" },
  { ...base, id: "demo-txt", name: "API 临时凭据.txt", stored_name: "demo-api-note.txt", mime: "text/plain", size: 1638, kind: "text", is_shared: 0, is_favorite: 0, updated_at: "2026-07-13T10:30:00.000Z" }
];
