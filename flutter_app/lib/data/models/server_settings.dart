import '../../core/config/app_config.dart';

enum ServerMode { external, internal, custom }

extension ServerModeX on ServerMode {
  String get storageValue => switch (this) {
    ServerMode.external => 'external',
    ServerMode.internal => 'internal',
    ServerMode.custom => 'custom',
  };

  String get label => switch (this) {
    ServerMode.external => '外网',
    ServerMode.internal => '内网',
    ServerMode.custom => '自定义',
  };

  String get description => switch (this) {
    ServerMode.external => '通过公网服务访问，适合在外部网络使用',
    ServerMode.internal => '通过局域网服务访问，速度更快、无需经过公网',
    ServerMode.custom => '使用你手动填写的服务端地址',
  };

  static ServerMode fromStorage(String? value) {
    return switch (value?.trim().toLowerCase()) {
      'internal' => ServerMode.internal,
      'custom' => ServerMode.custom,
      _ => ServerMode.external,
    };
  }
}

/// The client-side server endpoints and the currently selected endpoint.
///
/// All endpoint fields are persisted independently so users can switch between
/// the public server and a LAN server without having to re-enter either URL.
class ServerSettings {
  const ServerSettings({
    required this.mode,
    required this.externalUrl,
    required this.internalUrl,
    required this.customUrl,
  });

  /// The production endpoint used by a normal release build.
  static const defaultExternalUrl = AppConfig.productionApiBaseUrl;

  /// The local development endpoint. On a physical Android device, replace
  /// this with the computer's LAN IP (for example, http://192.168.1.100:8787).
  static const defaultInternalUrl = AppConfig.localApiBaseUrl;

  static const defaultCustomUrl = AppConfig.productionApiBaseUrl;

  static const defaultSettings = ServerSettings(
    mode: ServerMode.external,
    externalUrl: defaultExternalUrl,
    internalUrl: defaultInternalUrl,
    customUrl: defaultCustomUrl,
  );

  final ServerMode mode;
  final String externalUrl;
  final String internalUrl;
  final String customUrl;

  /// Settings selected from build-time flags when no user preference exists.
  ///
  /// A release build still defaults to the production endpoint. Local builds
  /// made with API_MODE=local start on the configured local endpoint instead.
  static ServerSettings forCurrentBuild() {
    final isLocal = AppConfig.apiMode == AppConfig.localApiMode;
    final configuredUrl = AppConfig.apiBaseUrl;
    return ServerSettings(
      mode: isLocal ? ServerMode.internal : ServerMode.external,
      externalUrl: isLocal
          ? defaultExternalUrl
          : _safeBuildUrl(configuredUrl, defaultExternalUrl),
      internalUrl: isLocal
          ? _safeBuildUrl(configuredUrl, defaultInternalUrl)
          : defaultInternalUrl,
      customUrl: _safeBuildUrl(configuredUrl, defaultCustomUrl),
    );
  }

  String get activeUrl => switch (mode) {
    ServerMode.external => externalUrl,
    ServerMode.internal => internalUrl,
    ServerMode.custom => customUrl,
  };

  String get modeLabel => mode.label;

  ServerSettings copyWith({
    ServerMode? mode,
    String? externalUrl,
    String? internalUrl,
    String? customUrl,
  }) {
    return ServerSettings(
      mode: mode ?? this.mode,
      externalUrl: externalUrl ?? this.externalUrl,
      internalUrl: internalUrl ?? this.internalUrl,
      customUrl: customUrl ?? this.customUrl,
    );
  }

  /// Returns a normalized URL suitable for YunpasteApi's base URL.
  ///
  /// The API client automatically adds `/api`, so an accidentally entered
  /// trailing `/api` is removed instead of producing `/api/api/...` requests.
  static String normalizeUrl(String value) {
    var result = value.trim();
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    if (result.toLowerCase().endsWith('/api')) {
      result = result.substring(0, result.length - 4);
      while (result.endsWith('/')) {
        result = result.substring(0, result.length - 1);
      }
    }
    return result;
  }

  /// Returns a user-facing validation message, or null when the URL is valid.
  static String? validateUrl(String value, {bool allowEmpty = false}) {
    final normalized = normalizeUrl(value);
    if (normalized.isEmpty) {
      return allowEmpty ? null : '请输入服务端地址';
    }

    Uri uri;
    try {
      uri = Uri.parse(normalized);
    } on FormatException {
      return '服务端地址格式不正确';
    }

    final scheme = uri.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') {
      return '地址必须以 http:// 或 https:// 开头';
    }
    if (uri.host.isEmpty) {
      return '请输入有效的服务器域名或 IP 地址';
    }
    if (uri.userInfo.isNotEmpty) {
      return '地址不能包含用户名或密码';
    }
    if (uri.query.isNotEmpty || uri.fragment.isNotEmpty) {
      return '地址不能包含查询参数或片段';
    }
    return null;
  }

  /// Normalizes and validates all configured endpoints.
  String? validate() {
    final endpoints = <String, String>{
      '外网服务端地址': externalUrl,
      '内网服务端地址': internalUrl,
      '自定义服务端地址': customUrl,
    };
    for (final entry in endpoints.entries) {
      final error = validateUrl(entry.value);
      if (error != null) return '${entry.key}：$error';
    }
    return null;
  }

  ServerSettings normalized() {
    return copyWith(
      externalUrl: normalizeUrl(externalUrl),
      internalUrl: normalizeUrl(internalUrl),
      customUrl: normalizeUrl(customUrl),
    );
  }

  static String _safeBuildUrl(String value, String fallback) {
    final normalized = normalizeUrl(value);
    return validateUrl(normalized) == null ? normalized : fallback;
  }
}
