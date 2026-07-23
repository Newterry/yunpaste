export type ThemeName = "cloud" | "ink" | "mist";
export type NavView =
  | "overview"
  | "files"
  | "shared"
  | "favorites"
  | "webdav"
  | "tickets"
  | "trash"
  | "profile"
  | "admin";
export type FileKind = "all" | "text" | "image" | "video" | "audio" | "document" | "archive" | "other";
export type FileSort = "name" | "size" | "updated";
export type FileLayout = "list" | "grid" | "gallery";
export type ProfileSection = "account" | "avatar" | "webdav";
export type AdminTab = "users" | "general" | "storage" | "security" | "config";

export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  isPrimaryAdmin: boolean;
  quota: number;
  usage: number;
  created_at: string;
  last_seen_at?: string;
  avatarUrl?: string | null;
  avatar_preset?: string | null;
}

export interface FileItem {
  id: string;
  owner_id?: string;
  owner_name: string;
  owner_email?: string;
  folder_id?: string | null;
  name: string;
  stored_name?: string;
  mime: string;
  size: number;
  kind: Exclude<FileKind, "all">;
  is_shared: 0 | 1;
  is_favorite: 0 | 1;
  is_trashed: 0 | 1;
  share_token?: string;
  expires_at?: string;
  share_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface FolderItem {
  id: string;
  owner_id: string;
  parent_id?: string | null;
  name: string;
  is_favorite: 0 | 1;
  is_trashed: 0 | 1;
  expires_at?: string | null;
  trashed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderCrumb {
  id: string;
  name: string;
}

export interface SystemSettings {
  siteName: string;
  siteSubtitle: string;
  allowRegistration: boolean;
  maxUploadMb: number;
  defaultExpiryDays: number;
  defaultShareDays: number;
  defaultUserQuotaGb: number;
  maxFilesPerUpload: number;
  allowedTypes: string;
  retentionDays: number;
  expiryWarningDays: number;
  allowPersonalWebdav: boolean;
  allowTickets: boolean;
}

export type PublicConfig = Pick<
  SystemSettings,
  | "siteName" | "siteSubtitle" | "allowRegistration" | "maxUploadMb"
  | "defaultExpiryDays" | "defaultShareDays" | "maxFilesPerUpload"
  | "allowedTypes" | "allowPersonalWebdav" | "allowTickets" | "expiryWarningDays"
>;

export interface SystemStatus {
  healthy: boolean;
  uptimeSeconds: number;
  users: number;
  files: number;
  storedBytes: number;
  storageFreeBytes: number;
  reservedStorageBytes?: number;
}

export interface SettingsPermissions {
  canRenameSite: boolean;
  canManageStorage: boolean;
  canManageEncryption: boolean;
}

export interface SettingsEnvelope {
  settings: SystemSettings;
  revision: number;
  permissions: SettingsPermissions;
}

export type StorageDriver = "local" | "webdav" | "smb";

export interface StorageConfig {
  driver: StorageDriver;
  url?: string;
  vendor?:
    | "other"
    | "fastmail"
    | "nextcloud"
    | "owncloud"
    | "infinitescale"
    | "sharepoint"
    | "sharepoint-ntlm"
    | "rclone";
  host?: string;
  port?: number;
  share?: string;
  username?: string;
  domain?: string;
  basePath?: string;
  allowInsecure?: boolean;
}

export interface StorageHealth {
  state: "connected" | "degraded" | "unavailable" | "error" | "unknown";
  message?: string;
  latencyMs?: number;
  lastCheckedAt?: string;
}

export interface StorageBackend {
  driver: StorageDriver;
  label: string;
  config: StorageConfig;
  credentialsConfigured: boolean;
  status: StorageHealth;
  paths?: {
    configDir: string;
    filesDir: string;
  };
}

export interface DatabaseEncryptionStatus {
  enabled: boolean;
  state: string;
  provider?: string;
  cipher?: string;
  keySource?: string;
}

export interface SecurityStatus {
  databaseEncryption: DatabaseEncryptionStatus;
  jwtSecret: {
    managed: boolean;
  };
  filesEncrypted: boolean;
}

export interface OverviewData {
  totalFiles: number;
  expiringSoon: number;
  activeShares: number;
  usage: number;
  quota: number;
  recent: FileItem[];
  recentTotal: number;
  recentPage: number;
  recentPageSize: number;
  expiring: FileItem[];
  expiryWarningDays: number;
}

export interface PersonalWebdav {
  id: string;
  name: string;
  enabled: boolean;
  credentialsConfigured: boolean;
  config: StorageConfig;
  updatedAt?: string;
}

export interface WebdavItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mime?: string;
  modifiedAt?: string | null;
}

export interface TicketMessage {
  id: string;
  message: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRole: "admin" | "member";
}

export interface Ticket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages?: TicketMessage[];
}

export interface ConfigBackup {
  format: "yunpaste-config-backup";
  schemaVersion: 2;
  appVersion: string;
  exportedAt: string;
  encryption: {
    algorithm: "aes-256-gcm";
    kdf: "scrypt";
    salt: string;
    iv: string;
    tag: string;
  };
  payload: string;
  coverage: ConfigBackupCoverage;
}

export interface ConfigBackupCoverage {
  settings: true;
  globalStorage: true;
  globalStorageCredential: boolean;
  users: false;
  files: false;
  personalWebdav: false;
}

export interface ConfigBackupSummary {
  appVersion: string;
  exportedAt: string;
  siteName: string;
  storageDriver: StorageDriver;
  storageLabel: string;
  credentialsIncluded: boolean;
  settingsCount: number;
  coverage: ConfigBackupCoverage;
}
