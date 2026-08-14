import 'package:shared_preferences/shared_preferences.dart';

import '../models/server_settings.dart';

class ServerSettingsStore {
  static const _modeKey = 'yunpaste.server.mode';
  static const _externalUrlKey = 'yunpaste.server.external_url';
  static const _internalUrlKey = 'yunpaste.server.internal_url';
  static const _customUrlKey = 'yunpaste.server.custom_url';

  ServerSettings? _memorySettings;

  Future<ServerSettings> read() async {
    final memorySettings = _memorySettings;
    if (memorySettings != null) return memorySettings;

    final prefs = await SharedPreferences.getInstance();
    final hasStoredSettings =
        prefs.containsKey(_modeKey) ||
        prefs.containsKey(_externalUrlKey) ||
        prefs.containsKey(_internalUrlKey) ||
        prefs.containsKey(_customUrlKey);
    if (!hasStoredSettings) {
      final defaults = ServerSettings.forCurrentBuild();
      _memorySettings = defaults;
      return defaults;
    }

    final settings = ServerSettings(
      mode: ServerModeX.fromStorage(prefs.getString(_modeKey)),
      externalUrl: _readUrl(
        prefs.getString(_externalUrlKey),
        ServerSettings.defaultExternalUrl,
      ),
      internalUrl: _readUrl(
        prefs.getString(_internalUrlKey),
        ServerSettings.defaultInternalUrl,
      ),
      customUrl: _readUrl(
        prefs.getString(_customUrlKey),
        ServerSettings.defaultCustomUrl,
      ),
    ).normalized();
    _memorySettings = settings;
    return settings;
  }

  Future<void> write(ServerSettings settings) async {
    final normalized = settings.normalized();
    _memorySettings = normalized;
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.setString(_modeKey, normalized.mode.storageValue),
      prefs.setString(_externalUrlKey, normalized.externalUrl),
      prefs.setString(_internalUrlKey, normalized.internalUrl),
      prefs.setString(_customUrlKey, normalized.customUrl),
    ]);
  }

  Future<void> clear() async {
    _memorySettings = null;
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.remove(_modeKey),
      prefs.remove(_externalUrlKey),
      prefs.remove(_internalUrlKey),
      prefs.remove(_customUrlKey),
    ]);
  }

  String _readUrl(String? value, String fallback) {
    final normalized = ServerSettings.normalizeUrl(value ?? '');
    return ServerSettings.validateUrl(normalized) == null
        ? normalized
        : fallback;
  }
}
