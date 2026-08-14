import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/domain/app_controller.dart';
import 'package:yunpaste/main.dart';

class _StaticLoginController extends AppController {
  _StaticLoginController(this.initialState);

  final AppState initialState;

  @override
  AppState build() => initialState;
}

void main() {
  testWidgets('login page exposes API settings before authentication', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appControllerProvider.overrideWith(
            () => _StaticLoginController(const AppState(initialized: true)),
          ),
        ],
        child: MaterialApp(theme: buildTheme(), home: const LoginScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('设置 API 地址 / 切换内外网'), findsOneWidget);

    await tester.tap(find.text('设置 API 地址 / 切换内外网'));
    await tester.pumpAndSettle();

    expect(find.text('配置服务端地址，在外网和内网之间快速切换'), findsOneWidget);
    expect(find.text('外网服务端地址'), findsOneWidget);
  });
}
