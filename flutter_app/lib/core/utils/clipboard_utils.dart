import 'package:flutter/services.dart';

/// Cross-platform helpers for the system text clipboard.
///
/// Flutter's [Clipboard] implementation is available on Android, iOS, Web,
/// macOS and Windows. Keeping the calls in one place makes it easier for the
/// UI to handle browser permission failures and desktop clipboard errors in a
/// consistent way.
abstract final class ClipboardUtils {
  static Future<void> copyText(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
  }

  static Future<String?> readText() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text == null || text.isEmpty) return null;
    return text;
  }
}
