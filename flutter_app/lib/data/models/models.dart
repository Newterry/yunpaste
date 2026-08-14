class PublicConfig {
  const PublicConfig({
    this.siteName = '云粘贴',
    this.siteSubtitle = '把灵感与文件，安全地放在一起',
    this.allowRegistration = true,
    this.maxUploadMb = 2048,
    this.defaultExpiryDays = 30,
    this.defaultShareDays = 7,
    this.maxFilesPerUpload = 20,
    this.allowedTypes = 'text,image,video,audio,document,archive,other',
    this.allowPersonalWebdav = true,
    this.allowTickets = true,
    this.expiryWarningDays = 7,
  });

  final String siteName;
  final String siteSubtitle;
  final bool allowRegistration;
  final int maxUploadMb;
  final int defaultExpiryDays;
  final int defaultShareDays;
  final int maxFilesPerUpload;
  final String allowedTypes;
  final bool allowPersonalWebdav;
  final bool allowTickets;
  final int expiryWarningDays;

  factory PublicConfig.fromJson(Map<String, dynamic> json) {
    return PublicConfig(
      siteName: json['siteName'] as String? ?? '云粘贴',
      siteSubtitle: json['siteSubtitle'] as String? ?? '把灵感与文件，安全地放在一起',
      allowRegistration: json['allowRegistration'] as bool? ?? true,
      maxUploadMb: _int(json['maxUploadMb'], 2048),
      defaultExpiryDays: _int(json['defaultExpiryDays'], 30),
      defaultShareDays: _int(json['defaultShareDays'], 7),
      maxFilesPerUpload: _int(json['maxFilesPerUpload'], 20),
      allowedTypes:
          json['allowedTypes'] as String? ??
          'text,image,video,audio,document,archive,other',
      allowPersonalWebdav: json['allowPersonalWebdav'] as bool? ?? true,
      allowTickets: json['allowTickets'] as bool? ?? true,
      expiryWarningDays: _int(json['expiryWarningDays'], 7),
    );
  }
}

class User {
  const User({
    required this.id,
    required this.username,
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    required this.isPrimaryAdmin,
    required this.quota,
    required this.usage,
    required this.createdAt,
    this.lastSeenAt,
    this.avatarUrl,
    this.avatarPreset,
  });

  final String id;
  final String username;
  final String name;
  final String email;
  final String role;
  final String status;
  final bool isPrimaryAdmin;
  final int quota;
  final int usage;
  final DateTime? createdAt;
  final DateTime? lastSeenAt;
  final String? avatarUrl;
  final String? avatarPreset;

  bool get isAdmin => role == 'admin';

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String? ?? '',
      username: json['username'] as String? ?? '',
      name: json['name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: json['role'] as String? ?? 'member',
      status: json['status'] as String? ?? 'active',
      isPrimaryAdmin: json['isPrimaryAdmin'] as bool? ?? false,
      quota: _int(json['quota'], 0),
      usage: _int(json['usage'], 0),
      createdAt: _date(json['created_at']),
      lastSeenAt: _date(json['last_seen_at']),
      avatarUrl: json['avatarUrl'] as String?,
      avatarPreset: json['avatar_preset'] as String?,
    );
  }
}

class FileItem {
  const FileItem({
    required this.id,
    required this.name,
    required this.mime,
    required this.size,
    required this.kind,
    required this.isShared,
    required this.isFavorite,
    required this.isTrashed,
    required this.createdAt,
    required this.updatedAt,
    this.ownerId,
    this.ownerName = '',
    this.ownerEmail,
    this.folderId,
    this.shareToken,
    this.expiresAt,
    this.shareExpiresAt,
  });

  final String id;
  final String name;
  final String mime;
  final int size;
  final String kind;
  final bool isShared;
  final bool isFavorite;
  final bool isTrashed;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String? ownerId;
  final String ownerName;
  final String? ownerEmail;
  final String? folderId;
  final String? shareToken;
  final DateTime? expiresAt;
  final DateTime? shareExpiresAt;

  factory FileItem.fromJson(Map<String, dynamic> json) {
    return FileItem(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '未命名文件',
      mime: json['mime'] as String? ?? 'application/octet-stream',
      size: _int(json['size'], 0),
      kind: json['kind'] as String? ?? 'other',
      isShared: _bool(json['is_shared']),
      isFavorite: _bool(json['is_favorite']),
      isTrashed: _bool(json['is_trashed']),
      createdAt: _date(json['created_at']),
      updatedAt: _date(json['updated_at']),
      ownerId: json['owner_id'] as String?,
      ownerName: json['owner_name'] as String? ?? '',
      ownerEmail: json['owner_email'] as String?,
      folderId: json['folder_id'] as String?,
      shareToken: json['share_token'] as String?,
      expiresAt: _date(json['expires_at']),
      shareExpiresAt: _date(json['share_expires_at']),
    );
  }
}

class FolderItem {
  const FolderItem({
    required this.id,
    required this.name,
    required this.isFavorite,
    required this.isTrashed,
    required this.createdAt,
    required this.updatedAt,
    this.ownerId = '',
    this.parentId,
    this.expiresAt,
    this.trashedAt,
  });

  final String id;
  final String name;
  final bool isFavorite;
  final bool isTrashed;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String ownerId;
  final String? parentId;
  final DateTime? expiresAt;
  final DateTime? trashedAt;

  factory FolderItem.fromJson(Map<String, dynamic> json) {
    return FolderItem(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '未命名文件夹',
      isFavorite: _bool(json['is_favorite']),
      isTrashed: _bool(json['is_trashed']),
      createdAt: _date(json['created_at']),
      updatedAt: _date(json['updated_at']),
      ownerId: json['owner_id'] as String? ?? '',
      parentId: json['parent_id'] as String?,
      expiresAt: _date(json['expires_at']),
      trashedAt: _date(json['trashed_at']),
    );
  }
}

class FolderCrumb {
  const FolderCrumb({required this.id, required this.name});

  final String id;
  final String name;

  factory FolderCrumb.fromJson(Map<String, dynamic> json) {
    return FolderCrumb(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }
}

class OverviewData {
  const OverviewData({
    required this.totalFiles,
    required this.expiringSoon,
    required this.activeShares,
    required this.usage,
    required this.quota,
    required this.recent,
    required this.expiring,
    required this.expiryWarningDays,
  });

  final int totalFiles;
  final int expiringSoon;
  final int activeShares;
  final int usage;
  final int quota;
  final List<FileItem> recent;
  final List<FileItem> expiring;
  final int expiryWarningDays;

  factory OverviewData.fromJson(Map<String, dynamic> json) {
    return OverviewData(
      totalFiles: _int(json['totalFiles'], 0),
      expiringSoon: _int(json['expiringSoon'], 0),
      activeShares: _int(json['activeShares'], 0),
      usage: _int(json['usage'], 0),
      quota: _int(json['quota'], 0),
      recent: _list(json['recent']).map(FileItem.fromJson).toList(),
      expiring: _list(json['expiring']).map(FileItem.fromJson).toList(),
      expiryWarningDays: _int(json['expiryWarningDays'], 7),
    );
  }
}

class FileListResult {
  const FileListResult({
    required this.files,
    required this.folders,
    required this.breadcrumbs,
    required this.currentFolderId,
    required this.total,
    required this.fileTotal,
    required this.hasMore,
  });

  final List<FileItem> files;
  final List<FolderItem> folders;
  final List<FolderCrumb> breadcrumbs;
  final String? currentFolderId;
  final int total;
  final int fileTotal;
  final bool hasMore;

  factory FileListResult.fromJson(Map<String, dynamic> json) {
    return FileListResult(
      files: _list(json['files']).map(FileItem.fromJson).toList(),
      folders: _list(json['folders']).map(FolderItem.fromJson).toList(),
      breadcrumbs: _list(
        json['breadcrumbs'],
      ).map(FolderCrumb.fromJson).toList(),
      currentFolderId: json['currentFolderId'] as String?,
      total: _int(json['total'], 0),
      fileTotal: _int(json['fileTotal'], 0),
      hasMore: json['hasMore'] as bool? ?? false,
    );
  }
}

class FileAccess {
  const FileAccess({
    required this.rawUrl,
    required this.downloadUrl,
    required this.previewUrl,
  });

  final String rawUrl;
  final String downloadUrl;
  final String previewUrl;

  factory FileAccess.fromJson(Map<String, dynamic> json) {
    return FileAccess(
      rawUrl: json['rawUrl'] as String? ?? '',
      downloadUrl: json['downloadUrl'] as String? ?? '',
      previewUrl: json['previewUrl'] as String? ?? '',
    );
  }
}

class PickedUpload {
  const PickedUpload({
    required this.name,
    this.path,
    this.bytes,
    this.size = 0,
  });

  final String name;
  final String? path;
  final List<int>? bytes;
  final int size;
}

int _int(dynamic value, int fallback) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse('$value') ?? fallback;
}

bool _bool(dynamic value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  return value == '1' || value == 'true';
}

DateTime? _date(dynamic value) {
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value);
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<Map<String, dynamic>>().toList();
}
