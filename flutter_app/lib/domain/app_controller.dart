import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config.dart';

import '../data/models/models.dart';
import '../data/models/server_settings.dart';
import '../data/services/server_settings_store.dart';
import '../data/services/yunpaste_api.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) => SessionStore());
final serverSettingsStoreProvider = Provider<ServerSettingsStore>(
  (ref) => ServerSettingsStore(),
);
final apiProvider = Provider<YunpasteApi>((ref) => YunpasteApi());
final appControllerProvider = NotifierProvider<AppController, AppState>(
  AppController.new,
);

enum FileClipboardMode { copy, move }

class FileClipboard {
  const FileClipboard({
    required this.mode,
    this.fileIds = const [],
    this.folderIds = const [],
  });

  final FileClipboardMode mode;
  final List<String> fileIds;
  final List<String> folderIds;

  int get itemCount => fileIds.length + folderIds.length;
}

class AppState {
  const AppState({
    this.initialized = false,
    this.busy = false,
    this.filesLoading = false,
    this.config = const PublicConfig(),
    this.serverSettings = ServerSettings.defaultSettings,
    this.user,
    this.overview,
    this.files = const [],
    this.folders = const [],
    this.breadcrumbs = const [],
    this.currentFolderId,
    this.loadedFilesKey,
    this.view = 'all',
    this.kind = 'all',
    this.sort = 'updated',
    this.query = '',
    this.clipboard,
    this.error,
  });

  final bool initialized;
  final bool busy;
  final bool filesLoading;
  final PublicConfig config;
  final ServerSettings serverSettings;
  final User? user;
  final OverviewData? overview;
  final List<FileItem> files;
  final List<FolderItem> folders;
  final List<FolderCrumb> breadcrumbs;
  final String? currentFolderId;
  final String? loadedFilesKey;
  final String view;
  final String kind;
  final String sort;
  final String query;
  final FileClipboard? clipboard;
  final String? error;

  AppState copyWith({
    bool? initialized,
    bool? busy,
    bool? filesLoading,
    PublicConfig? config,
    ServerSettings? serverSettings,
    User? user,
    bool clearUser = false,
    OverviewData? overview,
    bool clearOverview = false,
    List<FileItem>? files,
    List<FolderItem>? folders,
    List<FolderCrumb>? breadcrumbs,
    String? currentFolderId,
    bool clearFolder = false,
    String? loadedFilesKey,
    bool clearLoadedFilesKey = false,
    String? view,
    String? kind,
    String? sort,
    String? query,
    FileClipboard? clipboard,
    bool clearClipboard = false,
    String? error,
    bool clearError = false,
  }) {
    return AppState(
      initialized: initialized ?? this.initialized,
      busy: busy ?? this.busy,
      filesLoading: filesLoading ?? this.filesLoading,
      config: config ?? this.config,
      serverSettings: serverSettings ?? this.serverSettings,
      user: clearUser ? null : (user ?? this.user),
      overview: clearOverview ? null : (overview ?? this.overview),
      files: files ?? this.files,
      folders: folders ?? this.folders,
      breadcrumbs: breadcrumbs ?? this.breadcrumbs,
      currentFolderId: clearFolder
          ? null
          : (currentFolderId ?? this.currentFolderId),
      loadedFilesKey: clearLoadedFilesKey
          ? null
          : (loadedFilesKey ?? this.loadedFilesKey),
      view: view ?? this.view,
      kind: kind ?? this.kind,
      sort: sort ?? this.sort,
      query: query ?? this.query,
      clipboard: clearClipboard ? null : (clipboard ?? this.clipboard),
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class AppController extends Notifier<AppState> {
  late final YunpasteApi _api;
  late final SessionStore _session;
  late final ServerSettingsStore _serverSettingsStore;
  int _filesRequestId = 0;
  int _overviewRequestId = 0;

  @override
  AppState build() {
    _api = ref.read(apiProvider);
    _session = ref.read(sessionStoreProvider);
    _serverSettingsStore = ref.read(serverSettingsStoreProvider);
    return const AppState();
  }

  Future<void> initialize() async {
    if (state.initialized || state.busy) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final serverSettings = await _serverSettingsStore.read();
      _api.setBaseUrl(
        serverSettings.activeUrl,
        webBaseUrl: _webBaseUrlFor(serverSettings),
      );
      state = state.copyWith(serverSettings: serverSettings);
      final config = await _api.config();
      state = state.copyWith(config: config);
      final token = await _session.read();
      if (token != null && token.isNotEmpty) {
        _api.setToken(token);
        try {
          final user = await _api.me();
          state = state.copyWith(user: user);
          await _loadWorkspace();
        } on ApiException {
          await _session.clear();
          _api.setToken(null);
        }
      }
    } catch (error) {
      state = state.copyWith(error: _message(error));
    } finally {
      state = state.copyWith(initialized: true, busy: false);
    }
  }

  /// Checks a server without changing the currently active endpoint.
  Future<PublicConfig> testServerConnection(ServerSettings settings) async {
    final normalized = settings.normalized();
    final validationError = normalized.validate();
    if (validationError != null) {
      throw ApiException(validationError);
    }

    final candidateApi = YunpasteApi(
      baseUrl: normalized.activeUrl,
      webBaseUrl: normalized.activeUrl,
    );
    try {
      return await candidateApi.config();
    } finally {
      candidateApi.close();
    }
  }

  /// Persists a server choice and refreshes all data through the same API
  /// instance. Keeping one instance is important because public-share pages
  /// also read [apiProvider] directly.
  Future<void> switchServer(ServerSettings settings) async {
    final normalized = settings.normalized();
    final validationError = normalized.validate();
    if (validationError != null) {
      final error = ApiException(validationError);
      state = state.copyWith(error: error.message);
      throw error;
    }

    state = state.copyWith(busy: true, clearError: true);
    final candidateApi = YunpasteApi(
      baseUrl: normalized.activeUrl,
      webBaseUrl: normalized.activeUrl,
    );
    try {
      // Verify the endpoint before persisting it. A failed switch leaves the
      // current server and current session untouched.
      final config = await candidateApi.config();
      _invalidateRequests();
      await _serverSettingsStore.write(normalized);
      _api.setBaseUrl(
        normalized.activeUrl,
        webBaseUrl: _webBaseUrlFor(normalized),
      );
      state = state.copyWith(
        serverSettings: normalized,
        config: config,
        clearOverview: true,
        files: const [],
        folders: const [],
        breadcrumbs: const [],
        clearFolder: true,
        clearLoadedFilesKey: true,
        filesLoading: false,
        clearClipboard: true,
        clearError: true,
      );

      final token = await _session.read();
      if (token == null || token.isEmpty) {
        _api.setToken(null);
        _clearUserData();
        return;
      }

      _api.setToken(token);
      try {
        final user = await _api.me();
        state = state.copyWith(user: user);
        await _loadWorkspace();
      } on ApiException catch (error) {
        if (error.statusCode == 401) {
          await _session.clear();
          _api.setToken(null);
          _clearUserData();
        } else {
          _handleError(error);
          rethrow;
        }
      }
    } catch (error) {
      _handleError(error);
      rethrow;
    } finally {
      candidateApi.close();
      state = state.copyWith(busy: false);
    }
  }

  Future<void> login(String account, String password) async {
    await _authenticate(() => _api.login(account.trim(), password));
  }

  Future<void> register({
    required String username,
    required String name,
    required String email,
    required String password,
  }) async {
    await _authenticate(
      () => _api.register(
        username: username.trim(),
        name: name.trim(),
        email: email.trim(),
        password: password,
      ),
    );
  }

  Future<void> _authenticate(
    Future<({String token, User user})> Function() action,
  ) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      final result = await action();
      _api.setToken(result.token);
      await _session.write(result.token);
      state = state.copyWith(user: result.user);
      await _loadWorkspace();
    } catch (error) {
      state = state.copyWith(error: _message(error));
      rethrow;
    } finally {
      state = state.copyWith(busy: false);
    }
  }

  Future<void> logout() async {
    _invalidateRequests();
    await _session.clear();
    _api.setToken(null);
    state = state.copyWith(
      clearUser: true,
      clearOverview: true,
      files: const [],
      folders: const [],
      breadcrumbs: const [],
      clearFolder: true,
      clearLoadedFilesKey: true,
      filesLoading: false,
      clearClipboard: true,
      view: 'all',
      query: '',
      clearError: true,
    );
  }

  Future<void> refresh() async {
    if (state.user == null) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final user = await _api.me();
      state = state.copyWith(user: user);
      await _loadWorkspace();
    } catch (error) {
      state = state.copyWith(error: _message(error));
    } finally {
      state = state.copyWith(busy: false);
    }
  }

  Future<void> setView(String view) async {
    if (state.view == view) {
      if (state.loadedFilesKey == null) await loadFiles();
      return;
    }
    state = state.copyWith(
      view: view,
      clearFolder: true,
      query: '',
      clearError: true,
    );
    await loadFiles();
  }

  Future<void> setKind(String kind) async {
    if (state.kind == kind) return;
    state = state.copyWith(kind: kind, clearError: true);
    await loadFiles();
  }

  Future<void> setSort(String sort) async {
    if (state.sort == sort) return;
    state = state.copyWith(sort: sort, clearError: true);
    await loadFiles();
  }

  Future<void> setQuery(String query) async {
    if (state.query == query) return;
    state = state.copyWith(
      query: query,
      clearFolder: query.trim().isNotEmpty,
      clearError: true,
    );
    await loadFiles();
  }

  Future<void> openFolder(String? folderId) async {
    if (state.currentFolderId == folderId) return;
    state = folderId == null
        ? state.copyWith(clearFolder: true, clearError: true)
        : state.copyWith(currentFolderId: folderId, clearError: true);
    await loadFiles();
  }

  Future<void> loadFiles() async {
    if (state.user == null) return;
    final query = _FilesQuery.fromState(state);
    final requestId = ++_filesRequestId;
    state = state.copyWith(filesLoading: true, clearError: true);
    try {
      final result = await _api.files(
        view: query.view,
        kind: query.kind,
        sort: query.sort,
        query: query.query,
        folderId: query.folderId,
      );
      if (requestId != _filesRequestId) return;
      state = state.copyWith(
        files: result.files,
        folders: result.folders,
        breadcrumbs: result.breadcrumbs,
        currentFolderId: result.currentFolderId,
        loadedFilesKey: query.key,
        filesLoading: false,
        clearError: true,
      );
    } catch (error) {
      if (requestId != _filesRequestId) return;
      state = state.copyWith(filesLoading: false);
      _handleError(error);
    }
  }

  Future<void> upload(List<PickedUpload> uploads) async {
    if (uploads.isEmpty) return;
    await _runBusy(() async {
      await _api.upload(uploads, folderId: state.currentFolderId);
      await _loadWorkspace();
    });
  }

  Future<void> createPaste({
    required String title,
    required String content,
    required String format,
  }) async {
    await _runBusy(() async {
      await _api.createPaste(
        title: title,
        content: content,
        format: format,
        expiresInDays: state.config.defaultExpiryDays,
        folderId: state.currentFolderId,
      );
      await _loadWorkspace();
    });
  }

  Future<void> createFolder(String name) async {
    await _runBusy(() async {
      await _api.createFolder(name, parentId: state.currentFolderId);
      await _loadWorkspace();
    });
  }

  /// Stores selected cloud items in the in-app clipboard. This is separate
  /// from the operating system text clipboard and works consistently on
  /// Android, Web, macOS and Windows.
  void copyToFileClipboard({FileItem? file, FolderItem? folder}) {
    if (file == null && folder == null) return;
    state = state.copyWith(
      clipboard: FileClipboard(
        mode: FileClipboardMode.copy,
        fileIds: file == null ? const [] : [file.id],
        folderIds: folder == null ? const [] : [folder.id],
      ),
      clearError: true,
    );
  }

  /// Clears the in-app cloud clipboard without touching the operating-system
  /// text clipboard. This is useful when the user copied an item by mistake or
  /// wants to avoid pasting an old item into a later folder.
  void clearFileClipboard() {
    if (state.clipboard == null) return;
    state = state.copyWith(clearClipboard: true, clearError: true);
  }

  void cutToFileClipboard({FileItem? file, FolderItem? folder}) {
    if (file == null && folder == null) return;
    state = state.copyWith(
      clipboard: FileClipboard(
        mode: FileClipboardMode.move,
        fileIds: file == null ? const [] : [file.id],
        folderIds: folder == null ? const [] : [folder.id],
      ),
      clearError: true,
    );
  }

  Future<void> pasteFileClipboard() async {
    final clipboard = state.clipboard;
    if (clipboard == null) return;
    await _runBusy(() async {
      await _api.fileOperation(
        action: clipboard.mode == FileClipboardMode.copy ? 'copy' : 'move',
        fileIds: clipboard.fileIds,
        folderIds: clipboard.folderIds,
        targetFolderId: state.currentFolderId,
      );
      if (clipboard.mode == FileClipboardMode.move) {
        state = state.copyWith(clearClipboard: true);
      }
      await _loadWorkspace();
    });
  }

  Future<void> toggleFavorite(FileItem file) async {
    await _runBusy(() async {
      await _api.patchFile(file.id, {'is_favorite': !file.isFavorite});
      await _loadWorkspace();
    });
  }

  Future<void> toggleFolderFavorite(FolderItem folder) async {
    await _runBusy(() async {
      await _api.patchFolder(folder.id, {'is_favorite': !folder.isFavorite});
      await _loadWorkspace();
    });
  }

  Future<FileItem?> toggleShare(FileItem file) {
    return setShare(file, enabled: !file.isShared);
  }

  Future<FileItem?> setShare(
    FileItem file, {
    required bool enabled,
    DateTime? expiresAt,
  }) async {
    FileItem? result;
    await _runBusy(() async {
      final payload = <String, dynamic>{'is_shared': enabled};
      if (enabled && expiresAt != null) {
        payload['share_expires_at'] = expiresAt.toUtc().toIso8601String();
      }
      result = await _api.patchFile(file.id, payload);
      await _loadWorkspace();
    });
    return result;
  }

  Future<FileItem?> updateShareExpiry(FileItem file, DateTime expiresAt) async {
    FileItem? result;
    await _runBusy(() async {
      result = await _api.patchFile(file.id, {
        'share_expires_at': expiresAt.toUtc().toIso8601String(),
      });
      await _loadWorkspace();
    });
    return result;
  }

  Future<void> trash(FileItem file) async {
    await _runBusy(() async {
      await _api.patchFile(file.id, {'is_trashed': !file.isTrashed});
      await _loadWorkspace();
    });
  }

  Future<void> trashFolder(FolderItem folder) async {
    await _runBusy(() async {
      await _api.patchFolder(folder.id, {'is_trashed': !folder.isTrashed});
      await _loadWorkspace();
    });
  }

  Future<void> deletePermanently(FileItem file) async {
    await _runBusy(() async {
      await _api.deleteFile(file.id);
      await _loadWorkspace();
    });
  }

  Future<void> deleteFolderPermanently(FolderItem folder) async {
    await _runBusy(() async {
      await _api.deleteFolder(folder.id);
      await _loadWorkspace();
    });
  }

  Future<FileAccess> access(FileItem file) => _api.fileAccess(file.id);
  String shareUrl(String token) => _api.publicShareUrl(token);
  String downloadUrl(String token) => _api.publicDownloadUrl(token);
  String rawUrl(String token) => _api.publicRawUrl(token);

  Future<void> _loadWorkspace() async {
    await Future.wait([_loadOverview(), loadFiles()]);
  }

  Future<void> _loadOverview() async {
    if (state.user == null) return;
    final requestId = ++_overviewRequestId;
    try {
      final overview = await _api.overview();
      if (requestId != _overviewRequestId) return;
      state = state.copyWith(overview: overview, clearError: true);
    } catch (error) {
      if (requestId != _overviewRequestId) return;
      _handleError(error);
    }
  }

  Future<void> _runBusy(Future<void> Function() action) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      await action();
    } catch (error) {
      _handleError(error);
      rethrow;
    } finally {
      state = state.copyWith(busy: false);
    }
  }

  String _webBaseUrlFor(ServerSettings settings) {
    // Preserve an explicitly configured H5/share host. With the default Web
    // setup, keep relative share links on the current H5 origin; on native
    // platforms, point share links at the currently selected API server.
    if (AppConfig.hasConfiguredWebBaseUrl) return AppConfig.webBaseUrl;
    return kIsWeb ? '' : settings.activeUrl;
  }

  void _clearUserData() {
    state = state.copyWith(
      clearUser: true,
      clearOverview: true,
      files: const [],
      folders: const [],
      breadcrumbs: const [],
      clearFolder: true,
      clearLoadedFilesKey: true,
      filesLoading: false,
      view: 'all',
      query: '',
    );
  }

  void _invalidateRequests() {
    _filesRequestId++;
    _overviewRequestId++;
  }

  void _handleError(Object error) {
    state = state.copyWith(error: _message(error));
  }

  String _message(Object error) {
    if (error is ApiException) return error.message;
    return '网络请求失败，请检查服务器地址和网络连接';
  }
}

class _FilesQuery {
  const _FilesQuery({
    required this.view,
    required this.kind,
    required this.sort,
    required this.query,
    required this.folderId,
  });

  final String view;
  final String kind;
  final String sort;
  final String query;
  final String? folderId;

  String get key => '$view|$kind|$sort|$query|${folderId ?? ''}';

  factory _FilesQuery.fromState(AppState state) {
    return _FilesQuery(
      view: state.view,
      kind: state.kind,
      sort: state.sort,
      query: state.query.trim(),
      folderId: state.currentFolderId,
    );
  }
}
