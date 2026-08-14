import 'package:flutter_test/flutter_test.dart';

import 'package:yunpaste/data/models/models.dart';

void main() {
  test('model defaults match the YunPaste backend contract', () {
    const config = PublicConfig();

    expect(config.siteName, '云粘贴');
    expect(config.allowRegistration, isTrue);
    expect(config.defaultShareDays, 7);
  });
}
