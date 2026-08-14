import 'package:flutter/foundation.dart';

abstract final class AppConfig {
  /// Build-time API environment names accepted by [API_MODE].
  static const String productionApiMode = 'production';
  static const String localApiMode = 'local';

  /// The production API is the default for every Flutter target.
  static const String productionApiBaseUrl = 'https://ccopy.cloud123.uk:333';

  /// The local backend address for desktop, web and iOS Simulator development.
  ///
  /// Android Emulator cannot reach the host machine through 127.0.0.1, so use
  /// `--dart-define=LOCAL_API_BASE_URL=http://10.0.2.2:8787` there.
  static const String localApiBaseUrl = 'http://127.0.0.1:8787';

  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );
  static const String _configuredApiMode = String.fromEnvironment(
    'API_MODE',
    defaultValue: productionApiMode,
  );
  static const String _configuredLocalApiBaseUrl = String.fromEnvironment(
    'LOCAL_API_BASE_URL',
    defaultValue: '',
  );
  static const String _configuredWebBaseUrl = String.fromEnvironment(
    'WEB_BASE_URL',
    defaultValue: '',
  );

  /// The selected API environment after normalizing an invalid build value.
  ///
  /// `production` is deliberately the fallback so a typo in a release build
  /// cannot silently point the app at a local development server.
  static String get apiMode {
    final mode = _configuredApiMode.trim().toLowerCase();
    return mode == localApiMode ? localApiMode : productionApiMode;
  }

  static String get apiBaseUrl {
    // API_BASE_URL is an escape hatch for staging, CI and one-off deployments.
    if (_configuredBaseUrl.trim().isNotEmpty) {
      return _normalizeBaseUrl(_configuredBaseUrl);
    }

    if (apiMode == localApiMode) {
      final configuredLocalUrl = _configuredLocalApiBaseUrl.trim();
      return _normalizeBaseUrl(
        configuredLocalUrl.isEmpty ? localApiBaseUrl : configuredLocalUrl,
      );
    }

    return productionApiBaseUrl;
  }

  static bool get hasConfiguredWebBaseUrl =>
      _configuredWebBaseUrl.trim().isNotEmpty;

  static String get webBaseUrl {
    if (hasConfiguredWebBaseUrl) {
      return _normalizeBaseUrl(_configuredWebBaseUrl);
    }
    // On web, an empty value means "the current page origin". On native,
    // fall back to the API host so sharing works for a single-host install.
    return kIsWeb ? '' : apiBaseUrl;
  }

  static const String appName = '云粘贴';
  static const String appTagline = '把灵感与文件，安全地放在一起';

  static String _normalizeBaseUrl(String value) {
    var result = value.trim();
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }
}
