String derivePasteTitle(
  String content, {
  String customTitle = '',
  String fallback = '未命名粘贴',
  int maxLength = 80,
}) {
  final custom = customTitle.trim();
  if (custom.isNotEmpty) return _takeCharacters(custom, maxLength);

  final firstLine = content
      .split(RegExp(r'\r?\n'))
      .map((line) => line.trim())
      .firstWhere((line) => line.isNotEmpty, orElse: () => '');
  final normalized = firstLine
      .replaceFirst(RegExp(r'^(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  final boundary = RegExp(r'[。！？!?]|\.(?=\s|$)').firstMatch(normalized);
  final sentence = (boundary == null
          ? normalized
          : normalized.substring(0, boundary.start))
      .replaceFirst(RegExp(r'[。！？!?.,，；;：:]+$'), '')
      .trim();
  return _takeCharacters(sentence.isEmpty ? fallback : sentence, maxLength);
}

String _takeCharacters(String value, int maxLength) =>
    String.fromCharCodes(value.runes.take(maxLength));
