import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/config/app_config.dart';
import '../models/models.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class SessionStore {
  static const _tokenKey = 'yunpaste.token';
  String? _memoryToken;

  Future<String?> read() async {
    if (_memoryToken != null) return _memoryToken;
    final prefs = await SharedPreferences.getInstance();
    _memoryToken = prefs.getString(_tokenKey);
    return _memoryToken;
  }

  Future<void> write(String token) async {
    _memoryToken = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
  }

  Future<void> clear() async {
    _memoryToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
  }
}

class YunpasteApi {
  YunpasteApi({String? baseUrl, String? webBaseUrl, http.Client? client})
    : _baseUrl = _normalizeBaseUrl(baseUrl ?? AppConfig.apiBaseUrl),
      _webBaseUrl = _normalizeBaseUrl(
        webBaseUrl ?? baseUrl ?? AppConfig.webBaseUrl,
      ),
      _client = client ?? http.Client();

  String _baseUrl;
  String _webBaseUrl;
  final http.Client _client;
  String? _token;

  String get baseUrl => _baseUrl;
  String get webBaseUrl => _webBaseUrl;

  void setToken(String? token) => _token = token;

  /// Changes the endpoint on this shared API instance so every consumer
  /// (including public-share pages) immediately uses the same server.
  void setBaseUrl(String baseUrl, {String? webBaseUrl}) {
    _baseUrl = _normalizeBaseUrl(baseUrl);
    _webBaseUrl = _normalizeBaseUrl(webBaseUrl ?? baseUrl);
  }

  void close() => _client.close();

  Uri _uri(String path, [Map<String, String>? query]) {
    final apiPath = path.startsWith('/api') ? path : '/api$path';
    if (_baseUrl.isEmpty) {
      return Uri.base.resolve(apiPath).replace(queryParameters: query);
    }
    return Uri.parse('$_baseUrl$apiPath').replace(queryParameters: query);
  }

  String absoluteUrl(String path) => _absoluteUrl(_baseUrl, path);

  String _absoluteUrl(String baseUrl, String path) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    if (baseUrl.isNotEmpty) return '$baseUrl$normalizedPath';
    return Uri.base.resolve(normalizedPath).toString();
  }

  Map<String, String> _headers({bool json = false}) {
    return <String, String>{
      if (json) 'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }

  Future<dynamic> _decode(http.Response response) async {
    dynamic data;
    try {
      data = response.body.isEmpty ? null : jsonDecode(response.body);
    } catch (_) {
      data = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = data is Map<String, dynamic> && data['error'] is String
          ? data['error'] as String
          : '请求失败（${response.statusCode}）';
      if (response.statusCode == 401) _token = null;
      throw ApiException(message, statusCode: response.statusCode);
    }
    return data;
  }

  Future<dynamic> _get(String path, {Map<String, String>? query}) async {
    final response = await _client.get(_uri(path, query), headers: _headers());
    return _decode(response);
  }

  Future<dynamic> _send(
    String path, {
    String method = 'POST',
    Object? body,
  }) async {
    final request = http.Request(method, _uri(path));
    request.headers.addAll(_headers(json: body != null));
    if (body != null) request.body = jsonEncode(body);
    final response = await http.Response.fromStream(
      await _client.send(request),
    );
    return _decode(response);
  }

  Future<PublicConfig> config() async {
    final data = await _get('/config') as Map<String, dynamic>;
    return PublicConfig.fromJson(
      data['config'] as Map<String, dynamic>? ?? const {},
    );
  }

  Future<({String token, User user})> login(
    String account,
    String password,
  ) async {
    final data =
        await _send(
              '/auth/login',
              body: {'email': account, 'password': password},
            )
            as Map<String, dynamic>;
    return (
      token: data['token'] as String,
      user: User.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  Future<({String token, User user})> register({
    required String username,
    required String name,
    required String email,
    required String password,
  }) async {
    final data =
        await _send(
              '/auth/register',
              body: {
                'username': username,
                'name': name,
                'email': email,
                'password': password,
              },
            )
            as Map<String, dynamic>;
    return (
      token: data['token'] as String,
      user: User.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  Future<User> me() async {
    final data = await _get('/auth/me') as Map<String, dynamic>;
    return User.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<OverviewData> overview({
    int page = 1,
    int pageSize = 6,
    String filter = 'all',
  }) async {
    final data =
        await _get(
              '/overview',
              query: {
                'page': '$page',
                'pageSize': '$pageSize',
                'filter': filter,
              },
            )
            as Map<String, dynamic>;
    return OverviewData.fromJson(
      data['overview'] as Map<String, dynamic>? ?? const {},
    );
  }

  Future<FileListResult> files({
    String view = 'all',
    String kind = 'all',
    String sort = 'updated',
    String order = 'desc',
    String query = '',
    String? folderId,
    int page = 1,
    int pageSize = 100,
  }) async {
    final params = <String, String>{
      if (view != 'all') 'view': view,
      if (kind != 'all') 'kind': kind,
      'sort': sort,
      'order': order,
      if (query.trim().isNotEmpty) 'q': query.trim(),
      if (folderId != null) 'folderId': folderId,
      'page': '$page',
      'pageSize': '$pageSize',
    };
    final data = await _get('/files', query: params) as Map<String, dynamic>;
    return FileListResult.fromJson(data);
  }

  /// Copies or moves files/folders inside the cloud workspace clipboard.
  ///
  /// The backend keeps the operation atomic and validates ownership of every
  /// selected item before changing anything. A null [targetFolderId] means
  /// the workspace root.
  Future<int> fileOperation({
    required String action,
    List<String> fileIds = const [],
    List<String> folderIds = const [],
    String? targetFolderId,
  }) async {
    final data =
        await _send(
              '/file-operations',
              body: {
                'action': action,
                'fileIds': fileIds,
                'folderIds': folderIds,
                'targetFolderId': targetFolderId,
              },
            )
            as Map<String, dynamic>;
    return _number(data['usage']);
  }

  Future<({List<FileItem> files, int usage})> upload(
    List<PickedUpload> uploads, {
    String? folderId,
  }) async {
    final request = http.MultipartRequest('POST', _uri('/files/upload'));
    request.headers.addAll(_headers());
    request.headers['X-Upload-Bytes'] =
        '${uploads.fold<int>(0, (sum, item) => sum + item.size)}';
    request.headers['X-Upload-Count'] = '${uploads.length}';
    if (folderId != null) request.fields['folderId'] = folderId;
    for (final item in uploads) {
      if (item.path != null) {
        request.files.add(
          await http.MultipartFile.fromPath(
            'files',
            item.path!,
            filename: item.name,
          ),
        );
      } else if (item.bytes != null) {
        request.files.add(
          http.MultipartFile.fromBytes(
            'files',
            item.bytes!,
            filename: item.name,
          ),
        );
      }
    }
    final response = await http.Response.fromStream(await request.send());
    final data = await _decode(response) as Map<String, dynamic>;
    final files = (data['files'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(FileItem.fromJson)
        .toList();
    return (files: files, usage: _number(data['usage']));
  }

  Future<({FileItem file, int usage})> createPaste({
    required String title,
    required String content,
    String format = 'text',
    int? expiresInDays,
    String? folderId,
  }) async {
    final data =
        await _send(
              '/files/paste',
              body: {
                'title': title,
                'content': content,
                'format': format,
                if (expiresInDays != null) 'expiresInDays': expiresInDays,
                if (folderId != null) 'folderId': folderId,
              },
            )
            as Map<String, dynamic>;
    return (
      file: FileItem.fromJson(data['file'] as Map<String, dynamic>),
      usage: _number(data['usage']),
    );
  }

  Future<FolderItem> createFolder(String name, {String? parentId}) async {
    final data =
        await _send('/folders', body: {'name': name, 'parentId': parentId})
            as Map<String, dynamic>;
    return FolderItem.fromJson(data['folder'] as Map<String, dynamic>);
  }

  Future<FolderItem> patchFolder(
    String id,
    Map<String, dynamic> payload,
  ) async {
    final data =
        await _send('/folders/$id', method: 'PATCH', body: payload)
            as Map<String, dynamic>;
    return FolderItem.fromJson(data['folder'] as Map<String, dynamic>);
  }

  Future<void> deleteFolder(String id) async {
    await _send('/folders/$id', method: 'DELETE');
  }

  Future<FileItem> patchFile(String id, Map<String, dynamic> payload) async {
    final data =
        await _send('/files/$id', method: 'PATCH', body: payload)
            as Map<String, dynamic>;
    return FileItem.fromJson(data['file'] as Map<String, dynamic>);
  }

  Future<void> deleteFile(String id) async {
    await _send('/files/$id', method: 'DELETE');
  }

  Future<FileAccess> fileAccess(String id) async {
    final data = await _send('/files/$id/access') as Map<String, dynamic>;
    final access = FileAccess.fromJson(data);
    // The backend intentionally returns relative signed URLs. Resolve them
    // here so the same model works on Web, Android, and iOS.
    return FileAccess(
      rawUrl: _absoluteUrl(_baseUrl, access.rawUrl),
      downloadUrl: _absoluteUrl(_baseUrl, access.downloadUrl),
      previewUrl: _absoluteUrl(_baseUrl, access.previewUrl),
    );
  }

  Future<String> readTextAt(String url) async {
    final response = await _client.get(Uri.parse(url), headers: _headers());
    await _decode(response);
    return response.body;
  }

  Future<FileItem> publicShare(String token) async {
    final response = await _client.get(_uri('/share/$token'));
    final data = await _decode(response) as Map<String, dynamic>;
    return FileItem.fromJson(data['file'] as Map<String, dynamic>);
  }

  String publicShareUrl(String token) =>
      _absoluteUrl(_webBaseUrl, '/share/$token');
  String publicRawUrl(String token) => absoluteUrl('/api/share/$token/raw');
  String publicDownloadUrl(String token) =>
      absoluteUrl('/api/share/$token/download');

  static String _normalizeBaseUrl(String value) {
    var result = value.trim();
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }

  static int _number(dynamic value) {
    if (value is num) return value.toInt();
    return int.tryParse('$value') ?? 0;
  }
}
