import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/core/utils/file_name_utils.dart';

void main() {
  test('uses the first sentence when no custom title is provided', () {
    expect(
      derivePasteTitle('第一句话决定文件名。第二句话不会进入文件名。'),
      '第一句话决定文件名',
    );
  });

  test('removes common markdown prefixes', () {
    expect(derivePasteTitle('# 发布说明\n正文'), '发布说明');
  });

  test('prefers a custom title and provides a fallback', () {
    expect(
      derivePasteTitle('正文', customTitle: ' 我的文件 '),
      '我的文件',
    );
    expect(derivePasteTitle('  '), '未命名粘贴');
  });
}
