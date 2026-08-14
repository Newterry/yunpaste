import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/data/models/models.dart';
import 'package:yunpaste/domain/app_controller.dart';
import 'package:yunpaste/main.dart';

class _StaticController extends AppController {
  _StaticController(this.initialState);

  final AppState initialState;

  @override
  AppState build() => initialState;
}

void main() {
  for (final view in ['shared', 'favorites', 'trash']) {
    testWidgets('$view empty state does not overflow on a compact phone', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1080, 2246);
      tester.view.devicePixelRatio = 3;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final state = AppState(
        initialized: true,
        user: const User(
          id: 'user-1',
          username: 'tester',
          name: '测试用户',
          email: 'tester@example.com',
          role: 'member',
          status: 'active',
          isPrimaryAdmin: false,
          quota: 1024,
          usage: 0,
          createdAt: null,
        ),
        view: view,
        loadedFilesKey: '$view|all|updated||',
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appControllerProvider.overrideWith(() => _StaticController(state)),
          ],
          child: MaterialApp(
            home: Scaffold(
              appBar: AppBar(title: const Text('云粘贴')),
              body: SizedBox(height: 600, child: FileBrowserScreen(view: view)),
              bottomNavigationBar: const SizedBox(height: 80),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('all files page exposes copy in the row action bar', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 2246);
    tester.view.devicePixelRatio = 3;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    const file = FileItem(
      id: 'file-all-1',
      name: '全部文件中的内容.txt',
      mime: 'text/plain',
      size: 128,
      kind: 'text',
      isShared: false,
      isFavorite: false,
      isTrashed: false,
      createdAt: null,
      updatedAt: null,
    );
    final state = AppState(
      initialized: true,
      user: const User(
        id: 'user-1',
        username: 'tester',
        name: '测试用户',
        email: 'tester@example.com',
        role: 'member',
        status: 'active',
        isPrimaryAdmin: false,
        quota: 1024,
        usage: 0,
        createdAt: null,
      ),
      view: 'all',
      loadedFilesKey: 'all|all|updated||',
      files: const [file],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appControllerProvider.overrideWith(() => _StaticController(state)),
        ],
        child: const MaterialApp(home: Scaffold(body: FileBrowserScreen())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('复制'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cloud clipboard banner can be cleared without pasting', (
    tester,
  ) async {
    var cleared = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FileClipboardBanner(
            clipboard: const FileClipboard(
              mode: FileClipboardMode.copy,
              fileIds: ['file-1'],
            ),
            enabled: true,
            onPaste: () {},
            onClear: () => cleared = true,
          ),
        ),
      ),
    );

    expect(find.byTooltip('清除剪贴板'), findsOneWidget);
    await tester.tap(find.byTooltip('清除剪贴板'));
    expect(cleared, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('file rows expose a copy action for compact Android layouts', (
    tester,
  ) async {
    var copied = false;
    const file = FileItem(
      id: 'file-1',
      name: '手机上的文件.txt',
      mime: 'text/plain',
      size: 128,
      kind: 'text',
      isShared: false,
      isFavorite: false,
      isTrashed: false,
      createdAt: null,
      updatedAt: null,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FileRow(
            file: file,
            onCopy: () => copied = true,
            onFavorite: () {},
            onMore: () {},
          ),
        ),
      ),
    );

    expect(find.byTooltip('复制'), findsOneWidget);
    await tester.tap(find.byTooltip('复制'));
    expect(copied, isTrue);
    expect(tester.takeException(), isNull);
  });
}
