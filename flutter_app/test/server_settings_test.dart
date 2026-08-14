import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:yunpaste/data/models/server_settings.dart';
import 'package:yunpaste/data/services/server_settings_store.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('normalizes API suffixes and validates server URLs', () {
    expect(
      ServerSettings.normalizeUrl(' https://example.com:333/api/ '),
      'https://example.com:333',
    );
    expect(ServerSettings.validateUrl('http://192.168.1.20:8787'), isNull);
    expect(ServerSettings.validateUrl('ftp://example.com'), isNotNull);
    expect(ServerSettings.validateUrl('example.com'), isNotNull);
    expect(ServerSettings.validateUrl(''), isNotNull);
  });

  test('persists external, internal, custom URLs and selected mode', () async {
    final store = ServerSettingsStore();
    final settings = const ServerSettings(
      mode: ServerMode.internal,
      externalUrl: 'https://public.example.com:333/',
      internalUrl: 'http://192.168.1.20:8787/api',
      customUrl: 'https://staging.example.com',
    );

    await store.write(settings);
    final restored = await ServerSettingsStore().read();

    expect(restored.mode, ServerMode.internal);
    expect(restored.externalUrl, 'https://public.example.com:333');
    expect(restored.internalUrl, 'http://192.168.1.20:8787');
    expect(restored.customUrl, 'https://staging.example.com');
    expect(restored.activeUrl, 'http://192.168.1.20:8787');
  });

  test(
    'falls back to production settings when no preference is stored',
    () async {
      final settings = await ServerSettingsStore().read();

      expect(settings.externalUrl, ServerSettings.defaultExternalUrl);
      expect(settings.internalUrl, ServerSettings.defaultInternalUrl);
      expect(settings.mode, ServerMode.external);
    },
  );
}
