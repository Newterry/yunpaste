import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/core/config/app_config.dart';

void main() {
  test('uses the selected API environment and safe production default', () {
    const configuredMode = String.fromEnvironment(
      'API_MODE',
      defaultValue: AppConfig.productionApiMode,
    );
    const configuredBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: '',
    );
    const configuredLocalBaseUrl = String.fromEnvironment(
      'LOCAL_API_BASE_URL',
      defaultValue: '',
    );

    if (configuredBaseUrl.trim().isNotEmpty) {
      expect(AppConfig.apiBaseUrl, _withoutTrailingSlash(configuredBaseUrl));
      return;
    }

    if (configuredMode.trim().toLowerCase() == AppConfig.localApiMode) {
      expect(AppConfig.apiMode, AppConfig.localApiMode);
      expect(
        AppConfig.apiBaseUrl,
        configuredLocalBaseUrl.trim().isEmpty
            ? AppConfig.localApiBaseUrl
            : _withoutTrailingSlash(configuredLocalBaseUrl),
      );
      return;
    }

    expect(AppConfig.apiMode, AppConfig.productionApiMode);
    expect(AppConfig.apiBaseUrl, AppConfig.productionApiBaseUrl);
  });

  test('keeps the production API port in the configured root URL', () {
    expect(AppConfig.productionApiBaseUrl, 'https://ccopy.cloud123.uk:333');
  });

  test('exposes the local development API option', () {
    expect(AppConfig.localApiMode, 'local');
    expect(AppConfig.localApiBaseUrl, 'http://127.0.0.1:8787');
  });
}

String _withoutTrailingSlash(String value) {
  var result = value.trim();
  while (result.endsWith('/')) {
    result = result.substring(0, result.length - 1);
  }
  return result;
}
