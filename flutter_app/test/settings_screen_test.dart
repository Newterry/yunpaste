import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/domain/app_controller.dart';
import 'package:yunpaste/main.dart';

class _StaticSettingsController extends AppController {
  _StaticSettingsController(this.initialState);

  final AppState initialState;

  @override
  AppState build() => initialState;
}

void main() {
  testWidgets('settings page fits a compact Android viewport', (tester) async {
    tester.view.physicalSize = const Size(1080, 2246);
    tester.view.devicePixelRatio = 3;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appControllerProvider.overrideWith(
            () => _StaticSettingsController(const AppState(initialized: true)),
          ),
        ],
        child: MaterialApp(theme: buildTheme(), home: const SettingsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('设置'), findsOneWidget);
    expect(find.text('外网服务端地址'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
