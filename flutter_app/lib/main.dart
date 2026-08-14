import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/config/app_config.dart';
import 'core/utils/clipboard_utils.dart';
import 'data/models/models.dart';
import 'data/models/server_settings.dart';
import 'data/services/yunpaste_api.dart';
import 'domain/app_controller.dart';
import 'presentation/widgets/formatters.dart';

void main() {
  runApp(const ProviderScope(child: YunpasteApp()));
}

final _routerProvider = Provider<GoRouter>((ref) {
  ref.watch(
    appControllerProvider.select(
      (state) => (state.initialized, state.user?.id),
    ),
  );
  return GoRouter(
    initialLocation: '/overview',
    redirect: (context, state) {
      final appState = ref.read(appControllerProvider);
      if (!appState.initialized) return null;
      final loggedIn = appState.user != null;
      final onLogin = state.uri.path == '/login';
      final onPublicShare = state.uri.path.startsWith('/share/');
      if (!loggedIn && !onLogin && !onPublicShare) return '/login';
      if (loggedIn && onLogin) return '/overview';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/overview',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: OverviewScreen()),
          ),
          GoRoute(
            path: '/files',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: FileBrowserScreen()),
          ),
          GoRoute(
            path: '/shared',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: FileBrowserScreen(view: 'shared'),
            ),
          ),
          GoRoute(
            path: '/favorites',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: FileBrowserScreen(view: 'favorites'),
            ),
          ),
          GoRoute(
            path: '/trash',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: FileBrowserScreen(view: 'trash')),
          ),
          GoRoute(
            path: '/profile',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: ProfileScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) =>
                const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),
      GoRoute(
        path: '/share/:token',
        builder: (context, state) =>
            PublicShareScreen(token: state.pathParameters['token']!),
      ),
    ],
  );
});

class YunpasteApp extends ConsumerStatefulWidget {
  const YunpasteApp({super.key});

  @override
  ConsumerState<YunpasteApp> createState() => _YunpasteAppState();
}

class _YunpasteAppState extends ConsumerState<YunpasteApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(appControllerProvider.notifier).initialize(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(_routerProvider);
    final initialized = ref.watch(
      appControllerProvider.select((state) => state.initialized),
    );
    return MaterialApp.router(
      title: AppConfig.appName,
      // Never show Flutter's debug-only visual overlays in any build variant.
      // This keeps the Android/Web UI free of the black-yellow DEBUG ribbon,
      // performance overlay, material grid and checkerboard diagnostics.
      debugShowMaterialGrid: false,
      showPerformanceOverlay: false,
      checkerboardRasterCacheImages: false,
      checkerboardOffscreenLayers: false,
      showSemanticsDebugger: false,
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: router,
      builder: (context, child) {
        if (!initialized) return const SplashScreen();
        return child ?? const SizedBox.shrink();
      },
    );
  }
}

ThemeData buildTheme() {
  const primary = Color(0xFF356B5D);
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: primary,
      brightness: Brightness.light,
    ),
    scaffoldBackgroundColor: const Color(0xFFF7F7F3),
    cardTheme: const CardThemeData(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE4E7E2)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: primary, width: 1.5),
      ),
    ),
  );
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _accountController = TextEditingController();
  final _passwordController = TextEditingController();
  final _usernameController = TextEditingController();
  final _nameController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _registerMode = false;
  bool _obscure = true;

  @override
  void dispose() {
    _accountController.dispose();
    _passwordController.dispose();
    _usernameController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final controller = ref.read(appControllerProvider.notifier);
    try {
      if (_registerMode) {
        await controller.register(
          username: _usernameController.text,
          name: _nameController.text,
          email: _accountController.text,
          password: _passwordController.text,
        );
      } else {
        await controller.login(
          _accountController.text,
          _passwordController.text,
        );
      }
      if (mounted) context.go('/overview');
    } catch (_) {
      // Error is exposed through app state and rendered below the form.
    }
  }

  Future<void> _openServerSettings() async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        final dialogSize = MediaQuery.sizeOf(dialogContext);
        final width = dialogSize.width < 680 ? dialogSize.width - 24 : 640.0;
        final height = dialogSize.height < 760 ? dialogSize.height - 48 : 720.0;
        return Dialog(
          insetPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 24,
          ),
          clipBehavior: Clip.antiAlias,
          child: SizedBox(
            width: width.clamp(280.0, 640.0).toDouble(),
            height: height.clamp(420.0, 720.0).toDouble(),
            child: SettingsScreen(
              onSaved: () {
                if (Navigator.of(dialogContext).canPop()) {
                  Navigator.of(dialogContext).pop();
                }
              },
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(appControllerProvider);
    final config = state.config;
    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 760;
          return Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.all(compact ? 24 : 40),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 980),
                child: compact
                    ? _loginCard(config, state, compact)
                    : Row(
                        children: [
                          Expanded(child: _brandPanel(config)),
                          const SizedBox(width: 28),
                          SizedBox(
                            width: 400,
                            child: _loginCard(config, state, compact),
                          ),
                        ],
                      ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _brandPanel(PublicConfig config) {
    return Container(
      padding: const EdgeInsets.all(42),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(32),
        gradient: const LinearGradient(
          colors: [Color(0xFF2B5E50), Color(0xFF73A08C)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.cloud_done_rounded, color: Colors.white, size: 52),
          const SizedBox(height: 32),
          Text(
            config.siteName,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 42,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            config.siteSubtitle,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 18,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 34),
          const _FeatureLine(
            icon: Icons.devices_rounded,
            text: 'Web、Android、iOS、macOS、Windows 一套体验',
          ),
          const _FeatureLine(
            icon: Icons.lock_outline_rounded,
            text: '文件默认私有，分享链接可控时效',
          ),
          const _FeatureLine(
            icon: Icons.folder_copy_outlined,
            text: '文件夹、收藏、回收站与在线预览',
          ),
        ],
      ),
    );
  }

  Widget _loginCard(PublicConfig config, AppState state, bool compact) {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(compact ? 24 : 32),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _registerMode ? '创建账户' : '欢迎回来',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _registerMode ? '注册后即可在所有设备访问文件' : '登录云粘贴，继续管理你的文件',
                style: TextStyle(color: Colors.grey.shade600),
              ),
              const SizedBox(height: 28),
              if (_registerMode) ...[
                TextFormField(
                  controller: _usernameController,
                  decoration: const InputDecoration(
                    labelText: '用户名',
                    prefixIcon: Icon(Icons.alternate_email_rounded),
                  ),
                  validator: (value) => value == null || value.trim().length < 3
                      ? '用户名至少 3 位'
                      : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: '显示名称',
                    prefixIcon: Icon(Icons.person_outline_rounded),
                  ),
                  validator: (value) => value == null || value.trim().length < 2
                      ? '请输入显示名称'
                      : null,
                ),
                const SizedBox(height: 14),
              ],
              TextFormField(
                controller: _accountController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: '邮箱或用户名',
                  prefixIcon: Icon(Icons.mail_outline_rounded),
                ),
                validator: (value) =>
                    value == null || value.trim().isEmpty ? '请输入邮箱或用户名' : null,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: '密码',
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
                validator: (value) =>
                    value == null || value.length < 8 ? '密码至少 8 位' : null,
              ),
              const SizedBox(height: 20),
              if (state.error != null) ...[
                ErrorBanner(message: state.error!),
                const SizedBox(height: 16),
              ],
              FilledButton.icon(
                onPressed: state.busy ? null : _submit,
                icon: state.busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.arrow_forward_rounded),
                label: Text(_registerMode ? '注册并进入' : '登录'),
              ),
              if (config.allowRegistration || _registerMode) ...[
                const SizedBox(height: 10),
                TextButton(
                  onPressed: state.busy
                      ? null
                      : () => setState(() => _registerMode = !_registerMode),
                  child: Text(_registerMode ? '已有账户？返回登录' : '还没有账户？立即注册'),
                ),
              ],
              const SizedBox(height: 12),
              Text(
                'API: ${_apiLabel()}',
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
              ),
              const SizedBox(height: 4),
              TextButton.icon(
                onPressed: state.busy ? null : _openServerSettings,
                icon: const Icon(
                  Icons.settings_input_antenna_rounded,
                  size: 17,
                ),
                label: const Text('设置 API 地址 / 切换内外网'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _apiLabel() {
    final settings = ref.read(appControllerProvider).serverSettings;
    return settings.activeUrl.isEmpty ? '当前站点' : settings.activeUrl;
  }
}

class _FeatureLine extends StatelessWidget {
  const _FeatureLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          Icon(icon, color: Colors.white70, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: Colors.white, fontSize: 15),
            ),
          ),
        ],
      ),
    );
  }
}

class AppShell extends ConsumerWidget {
  const AppShell({required this.child, super.key});

  final Widget child;

  static const _items = [
    (path: '/overview', label: '概览', icon: Icons.dashboard_outlined),
    (path: '/files', label: '全部文件', icon: Icons.folder_open_outlined),
    (path: '/shared', label: '我的分享', icon: Icons.ios_share_outlined),
    (path: '/favorites', label: '收藏', icon: Icons.star_border_rounded),
    (path: '/trash', label: '回收站', icon: Icons.delete_outline_rounded),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shellData = ref.watch(
      appControllerProvider.select(
        (state) =>
            (siteName: state.config.siteName, userName: state.user?.name ?? ''),
      ),
    );
    final routerState = GoRouterState.of(context);
    final compact = MediaQuery.sizeOf(context).width < 900;
    if (compact) {
      return Scaffold(
        appBar: AppBar(
          title: Text(
            shellData.siteName,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          actions: [
            IconButton(
              onPressed: () =>
                  ref.read(appControllerProvider.notifier).refresh(),
              icon: const Icon(Icons.refresh_rounded),
            ),
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'profile') {
                  context.go('/profile');
                }
                if (value == 'settings') {
                  context.go('/settings');
                }
                if (value == 'logout') {
                  ref.read(appControllerProvider.notifier).logout();
                }
              },
              itemBuilder: (context) => const [
                PopupMenuItem(value: 'profile', child: Text('个人资料')),
                PopupMenuItem(value: 'settings', child: Text('设置')),
                PopupMenuItem(value: 'logout', child: Text('退出登录')),
              ],
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: CircleAvatar(
                  child: Text(
                    (shellData.userName.isEmpty ? '云' : shellData.userName)
                        .characters
                        .first,
                  ),
                ),
              ),
            ),
          ],
        ),
        body: child,
        bottomNavigationBar: NavigationBar(
          selectedIndex: _selectedIndex(routerState.uri.path),
          onDestinationSelected: (index) => context.go(_items[index].path),
          destinations: [
            for (final item in _items)
              NavigationDestination(icon: Icon(item.icon), label: item.label),
          ],
        ),
      );
    }
    return Scaffold(
      body: Row(
        children: [
          _SideRail(
            currentPath: routerState.uri.path,
            siteName: shellData.siteName,
            userName: shellData.userName,
          ),
          Expanded(
            child: Column(
              children: [
                _TopBar(userName: shellData.userName),
                Expanded(child: child),
              ],
            ),
          ),
        ],
      ),
    );
  }

  int _selectedIndex(String path) {
    final index = _items.indexWhere((item) => item.path == path);
    return index < 0 ? 0 : index;
  }
}

class _SideRail extends ConsumerWidget {
  const _SideRail({
    required this.currentPath,
    required this.siteName,
    required this.userName,
  });

  final String currentPath;
  final String siteName;
  final String userName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      width: 248,
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 18),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(right: BorderSide(color: Color(0xFFE8EBE6))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.cloud_done_rounded,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  siteName,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),
          for (final item in AppShell._items)
            _NavItem(item: item, selected: currentPath == item.path),
          const Spacer(),
          const Divider(),
          _NavItem(
            item: (
              path: '/settings',
              label: '设置',
              icon: Icons.settings_outlined,
            ),
            selected: currentPath == '/settings',
          ),
          _NavItem(
            item: (
              path: '/profile',
              label: '个人资料',
              icon: Icons.person_outline_rounded,
            ),
            selected: currentPath == '/profile',
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 0),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  child: Text(
                    (userName.isEmpty ? '云' : userName).characters.first,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    userName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  tooltip: '退出登录',
                  onPressed: () =>
                      ref.read(appControllerProvider.notifier).logout(),
                  icon: const Icon(Icons.logout_rounded, size: 19),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NavItem extends ConsumerWidget {
  const _NavItem({required this.item, required this.selected});

  final ({String path, String label, IconData icon}) item;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: ListTile(
        selected: selected,
        onTap: () => context.go(item.path),
        leading: Icon(item.icon),
        title: Text(item.label),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar({required this.userName});

  final String userName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      height: 76,
      padding: const EdgeInsets.symmetric(horizontal: 32),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFE8EBE6))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '你好，$userName',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
          ),
          IconButton(
            onPressed: () => ref.read(appControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 8),
          CircleAvatar(
            child: Text((userName.isEmpty ? '云' : userName).characters.first),
          ),
        ],
      ),
    );
  }
}

class OverviewScreen extends ConsumerWidget {
  const OverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(appControllerProvider);
    final overview = state.overview;
    return ContentPage(
      title: '概览',
      subtitle: state.config.siteSubtitle,
      actions: [
        FilledButton.icon(
          onPressed: () => showPasteDialog(context, ref),
          icon: const Icon(Icons.edit_note_rounded),
          label: const Text('新建粘贴'),
        ),
        const SizedBox(width: 10),
        OutlinedButton.icon(
          onPressed: () => pickAndUpload(context, ref),
          icon: const Icon(Icons.upload_file_rounded),
          label: const Text('上传文件'),
        ),
      ],
      child: overview == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () =>
                  ref.read(appControllerProvider.notifier).refresh(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  if (state.error != null) ...[
                    ErrorBanner(message: state.error!),
                    const SizedBox(height: 16),
                  ],
                  Wrap(
                    spacing: 14,
                    runSpacing: 14,
                    children: [
                      StatCard(
                        label: '全部文件',
                        value: '${overview.totalFiles}',
                        icon: Icons.folder_copy_outlined,
                        color: const Color(0xFF356B5D),
                      ),
                      StatCard(
                        label: '即将过期',
                        value: '${overview.expiringSoon}',
                        icon: Icons.schedule_rounded,
                        color: const Color(0xFFB27727),
                      ),
                      StatCard(
                        label: '活跃分享',
                        value: '${overview.activeShares}',
                        icon: Icons.ios_share_outlined,
                        color: const Color(0xFF6B5AA6),
                      ),
                      StatCard(
                        label: '已用空间',
                        value:
                            '${formatBytes(overview.usage)} / ${formatBytes(overview.quota)}',
                        icon: Icons.storage_outlined,
                        color: const Color(0xFF36709A),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final stacked = constraints.maxWidth < 850;
                      final recent = _recentCard(context, ref, overview);
                      final expiring = _expiringCard(overview);
                      if (stacked) {
                        return Column(
                          children: [
                            recent,
                            const SizedBox(height: 16),
                            expiring,
                          ],
                        );
                      }
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: recent),
                          const SizedBox(width: 16),
                          SizedBox(width: 330, child: expiring),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
    );
  }

  Widget _recentCard(
    BuildContext context,
    WidgetRef ref,
    OverviewData overview,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '最近更新',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            if (overview.recent.isEmpty)
              const EmptyState(
                icon: Icons.inbox_outlined,
                title: '还没有文件',
                message: '上传文件或创建一条粘贴开始使用',
              ),
            for (final file in overview.recent)
              FileRow(
                file: file,
                onOpen: () => openPrivateFile(context, ref, file),
                onFavorite: () => ref
                    .read(appControllerProvider.notifier)
                    .toggleFavorite(file),
                onShare: () => shareFile(context, ref, file),
              ),
          ],
        ),
      ),
    );
  }

  Widget _expiringCard(OverviewData overview) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '即将过期',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            if (overview.expiring.isEmpty)
              const EmptyState(
                icon: Icons.verified_outlined,
                title: '暂无临期文件',
                message: '收藏的文件可以永久保留',
              ),
            for (final file in overview.expiring)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: FileIcon(kind: file.kind),
                title: Text(
                  file.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text('到期：${formatDate(file.expiresAt)}'),
              ),
          ],
        ),
      ),
    );
  }
}

class FileBrowserScreen extends ConsumerStatefulWidget {
  const FileBrowserScreen({this.view = 'all', super.key});

  final String view;

  @override
  ConsumerState<FileBrowserScreen> createState() => _FileBrowserScreenState();
}

class _FileBrowserScreenState extends ConsumerState<FileBrowserScreen> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    Future<void>.microtask(_syncView);
  }

  @override
  void didUpdateWidget(covariant FileBrowserScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.view != widget.view) {
      _searchController.clear();
      Future<void>.microtask(_syncView);
    }
  }

  void _syncView() {
    if (!mounted) return;
    final controller = ref.read(appControllerProvider.notifier);
    final state = ref.read(appControllerProvider);
    if (state.view != widget.view) {
      controller.setView(widget.view);
    } else if (state.loadedFilesKey == null) {
      controller.loadFiles();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(appControllerProvider);
    final controller = ref.read(appControllerProvider.notifier);
    final currentKey =
        '${state.view}|${state.kind}|${state.sort}|${state.query.trim()}|${state.currentFolderId ?? ''}';
    final hasCurrentData = state.loadedFilesKey == currentKey;
    final loadedView = state.loadedFilesKey?.split('|').first;
    final waitingForAnotherView =
        state.filesLoading && loadedView != null && loadedView != state.view;
    final showInitialLoading =
        state.filesLoading &&
        (!hasCurrentData && (state.files.isEmpty || waitingForAnotherView));
    final hasContent = state.files.isNotEmpty || state.folders.isNotEmpty;
    final fileClipboard = state.clipboard;
    final canPasteClipboard = fileClipboard != null && widget.view != 'trash';

    return ContentPage(
      title: _title,
      subtitle: state.currentFolderId == null
          ? '管理你的文件和文件夹'
          : '当前文件夹：${state.breadcrumbs.lastOrNull?.name ?? ''}',
      actions: [
        FilledButton.icon(
          onPressed: state.busy ? null : () => pickAndUpload(context, ref),
          icon: const Icon(Icons.upload_file_rounded),
          label: const Text('上传'),
        ),
        const SizedBox(width: 10),
        OutlinedButton.icon(
          onPressed: state.busy ? null : () => showPasteDialog(context, ref),
          icon: const Icon(Icons.edit_note_rounded),
          label: const Text('新建粘贴'),
        ),
      ],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.error != null) ...[
            ErrorBanner(message: state.error!),
            const SizedBox(height: 14),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Wrap(
                spacing: 10,
                runSpacing: 10,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SizedBox(
                    width: 280,
                    child: TextField(
                      controller: _searchController,
                      enabled: !state.busy,
                      onSubmitted: controller.setQuery,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: '搜索文件名、类型…',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                    ),
                  ),
                  DropdownButton<String>(
                    value: state.kind,
                    onChanged: state.busy
                        ? null
                        : (value) {
                            if (value != null) controller.setKind(value);
                          },
                    items: const [
                      DropdownMenuItem(value: 'all', child: Text('所有类型')),
                      DropdownMenuItem(value: 'text', child: Text('文本')),
                      DropdownMenuItem(value: 'image', child: Text('图片')),
                      DropdownMenuItem(value: 'document', child: Text('文档')),
                      DropdownMenuItem(value: 'video', child: Text('视频')),
                      DropdownMenuItem(value: 'archive', child: Text('压缩包')),
                    ],
                  ),
                  DropdownButton<String>(
                    value: state.sort,
                    onChanged: state.busy
                        ? null
                        : (value) {
                            if (value != null) controller.setSort(value);
                          },
                    items: const [
                      DropdownMenuItem(value: 'updated', child: Text('最近更新')),
                      DropdownMenuItem(value: 'name', child: Text('名称')),
                      DropdownMenuItem(value: 'size', child: Text('大小')),
                    ],
                  ),
                  OutlinedButton.icon(
                    onPressed: state.busy
                        ? null
                        : () => showFolderDialog(context, ref),
                    icon: const Icon(Icons.create_new_folder_outlined),
                    label: const Text('新建文件夹'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          if (state.filesLoading) const LinearProgressIndicator(minHeight: 2),
          if (state.breadcrumbs.isNotEmpty) ...[
            Breadcrumbs(
              breadcrumbs: state.breadcrumbs,
              onTap: (id) => controller.openFolder(id),
            ),
            const SizedBox(height: 8),
          ],
          if (canPasteClipboard) ...[
            FileClipboardBanner(
              clipboard: fileClipboard,
              enabled: !state.busy,
              onClear: controller.clearFileClipboard,
              onPaste: () async {
                try {
                  await controller.pasteFileClipboard();
                  if (context.mounted) {
                    showSnack(
                      context,
                      fileClipboard.mode == FileClipboardMode.copy
                          ? '副本已粘贴到当前文件夹'
                          : '项目已移动到当前文件夹',
                    );
                  }
                } catch (_) {
                  if (context.mounted) {
                    showSnack(
                      context,
                      ref.read(appControllerProvider).error ?? '粘贴失败',
                    );
                  }
                }
              },
            ),
            const SizedBox(height: 8),
          ],
          Expanded(
            child: showInitialLoading
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    // EmptyState can be taller than the remaining viewport on
                    // small phones after the filter card wraps to multiple
                    // lines. Keeping it inside the scrollable list prevents
                    // Flutter's black-yellow RenderFlex overflow indicator.
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: EdgeInsets.zero,
                    children: [
                      if (!hasContent)
                        EmptyState(
                          icon: widget.view == 'trash'
                              ? Icons.delete_sweep_outlined
                              : widget.view == 'favorites'
                              ? Icons.star_outline_rounded
                              : widget.view == 'shared'
                              ? Icons.ios_share_outlined
                              : Icons.folder_open_rounded,
                          title: widget.view == 'trash'
                              ? '回收站是空的'
                              : widget.view == 'favorites'
                              ? '还没有收藏'
                              : widget.view == 'shared'
                              ? '还没有分享'
                              : '这里还没有内容',
                          message: widget.view == 'trash'
                              ? '移入回收站的文件和文件夹会显示在这里'
                              : widget.view == 'favorites'
                              ? '收藏文件或文件夹后，可以在这里快速找到它们'
                              : widget.view == 'shared'
                              ? '开启文件分享后，分享内容会显示在这里'
                              : '上传文件或创建文件夹，开始整理你的云端空间',
                        ),
                      for (final folder in state.folders)
                        FolderRow(
                          folder: folder,
                          onTap: folder.isTrashed
                              ? null
                              : () => controller.openFolder(folder.id),
                          onFavorite: state.busy
                              ? null
                              : () => controller.toggleFolderFavorite(folder),
                          onCopy: widget.view == 'trash' || state.busy
                              ? null
                              : () {
                                  controller.copyToFileClipboard(
                                    folder: folder,
                                  );
                                  showSnack(context, '文件夹已复制，进入目标文件夹后点击粘贴');
                                },
                          onCut: widget.view == 'trash' || state.busy
                              ? null
                              : () {
                                  controller.cutToFileClipboard(folder: folder);
                                  showSnack(context, '文件夹已剪切，进入目标文件夹后点击粘贴');
                                },
                          onMore: state.busy
                              ? null
                              : () => showFolderActions(context, ref, folder),
                        ),
                      for (final file in state.files)
                        FileRow(
                          file: file,
                          onOpen: () => openPrivateFile(context, ref, file),
                          onFavorite: state.busy
                              ? null
                              : () => controller.toggleFavorite(file),
                          onCopy: widget.view == 'trash' || state.busy
                              ? null
                              : () {
                                  controller.copyToFileClipboard(file: file);
                                  showSnack(context, '文件已复制，进入目标文件夹后点击粘贴');
                                },
                          onCut: widget.view == 'trash' || state.busy
                              ? null
                              : () {
                                  controller.cutToFileClipboard(file: file);
                                  showSnack(context, '文件已剪切，进入目标文件夹后点击粘贴');
                                },
                          onShare: state.busy
                              ? null
                              : () => shareFile(context, ref, file),
                          onMore: state.busy
                              ? null
                              : () => showFileActions(context, ref, file),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  String get _title {
    switch (widget.view) {
      case 'shared':
        return '我的分享';
      case 'favorites':
        return '收藏';
      case 'trash':
        return '回收站';
      default:
        return '全部文件';
    }
  }
}

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(appControllerProvider).user;
    return ContentPage(
      title: '个人资料',
      subtitle: '账户信息和存储配额',
      child: ListView(
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(26),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 42,
                    child: Text(
                      (user?.name ?? '云').characters.first,
                      style: const TextStyle(fontSize: 32),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    user?.name ?? '',
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '@${user?.username ?? ''} · ${user?.email ?? ''}',
                    style: TextStyle(color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 24),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment: WrapAlignment.center,
                    children: [
                      InfoPill(
                        label: '角色',
                        value: user?.isAdmin == true ? '管理员' : '普通用户',
                      ),
                      InfoPill(
                        label: '已使用',
                        value: formatBytes(user?.usage ?? 0),
                      ),
                      InfoPill(
                        label: '配额',
                        value: formatBytes(user?.quota ?? 0),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: const Icon(Icons.security_outlined),
              title: const Text('数据安全'),
              subtitle: const Text('你的文件默认仅自己可见，公开分享需主动开启。'),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.devices_outlined),
              title: const Text('跨端访问'),
              subtitle: const Text('当前 Flutter 客户端支持 Web、Android 与 iOS。'),
            ),
          ),
        ],
      ),
    );
  }
}

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({this.onSaved, super.key});

  final VoidCallback? onSaved;

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _externalController;
  late final TextEditingController _internalController;
  late final TextEditingController _customController;
  ServerMode _mode = ServerMode.external;
  bool _testing = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(appControllerProvider).serverSettings;
    _externalController = TextEditingController(text: settings.externalUrl);
    _internalController = TextEditingController(text: settings.internalUrl);
    _customController = TextEditingController(text: settings.customUrl);
    _mode = settings.mode;
  }

  @override
  void dispose() {
    _externalController.dispose();
    _internalController.dispose();
    _customController.dispose();
    super.dispose();
  }

  ServerSettings _settingsFromForm() {
    return ServerSettings(
      mode: _mode,
      externalUrl: _externalController.text,
      internalUrl: _internalController.text,
      customUrl: _customController.text,
    ).normalized();
  }

  Future<void> _testConnection() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final settings = _settingsFromForm();
    setState(() => _testing = true);
    try {
      final config = await ref
          .read(appControllerProvider.notifier)
          .testServerConnection(settings);
      if (mounted) {
        showSnack(context, '连接成功：${config.siteName}');
      }
    } catch (error) {
      if (mounted) {
        showSnack(context, _errorMessage(error));
      }
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _saveAndSwitch() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final settings = _settingsFromForm();
    setState(() => _saving = true);
    try {
      await ref.read(appControllerProvider.notifier).switchServer(settings);
      if (mounted) {
        showSnack(context, '已切换到${settings.modeLabel}服务：${settings.activeUrl}');
        widget.onSaved?.call();
      }
    } catch (error) {
      if (mounted) {
        showSnack(context, _errorMessage(error));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _resetProduction() {
    setState(() {
      _mode = ServerMode.external;
      _externalController.text = ServerSettings.defaultExternalUrl;
    });
  }

  String? _validateEndpoint(String? value) {
    return ServerSettings.validateUrl(value ?? '');
  }

  String _errorMessage(Object error) {
    if (error is ApiException) return error.message;
    return '连接失败，请检查服务端地址和网络连接';
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(appControllerProvider);
    final currentSettings = state.serverSettings;
    final working = _testing || _saving || state.busy;
    return ContentPage(
      title: '设置',
      subtitle: '配置服务端地址，在外网和内网之间快速切换',
      child: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '当前服务',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '当前使用：${currentSettings.modeLabel}',
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF2F4F0),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.cloud_done_outlined, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              currentSettings.activeUrl,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      '一键切换服务模式',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        for (final mode in ServerMode.values)
                          ChoiceChip(
                            avatar: Icon(switch (mode) {
                              ServerMode.external => Icons.public_rounded,
                              ServerMode.internal => Icons.router_outlined,
                              ServerMode.custom => Icons.tune_rounded,
                            }, size: 18),
                            label: Text(mode.label),
                            selected: _mode == mode,
                            onSelected: working
                                ? null
                                : (selected) {
                                    if (selected) setState(() => _mode = mode);
                                  },
                          ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Text(
                      _mode.description,
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            _EndpointCard(
              title: '外网服务端地址',
              subtitle: '默认正式服务，适合离开局域网后访问',
              icon: Icons.public_rounded,
              controller: _externalController,
              enabled: !working,
              validator: _validateEndpoint,
              onReset: working ? null : _resetProduction,
            ),
            const SizedBox(height: 14),
            _EndpointCard(
              title: '内网服务端地址 / IP',
              subtitle: '填写局域网服务器地址，例如 http://192.168.1.100:8787',
              icon: Icons.router_outlined,
              controller: _internalController,
              enabled: !working,
              validator: _validateEndpoint,
            ),
            const SizedBox(height: 14),
            _EndpointCard(
              title: '自定义服务端地址',
              subtitle: '适合测试环境、反向代理或其他部署地址',
              icon: Icons.tune_rounded,
              controller: _customController,
              enabled: !working,
              validator: _validateEndpoint,
            ),
            const SizedBox(height: 8),
            Text(
              '地址只需填写服务器根地址，客户端会自动补上 /api。保存前会先测试连接；如果填写了末尾 /api，也会自动处理。',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
            ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: working ? null : _testConnection,
                  icon: _testing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.wifi_tethering_rounded),
                  label: Text(_testing ? '测试中…' : '测试连接'),
                ),
                FilledButton.icon(
                  onPressed: working ? null : _saveAndSwitch,
                  icon: _saving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(_saving ? '保存中…' : '保存并切换'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EndpointCard extends StatelessWidget {
  const _EndpointCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.controller,
    required this.enabled,
    required this.validator,
    this.onReset,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final TextEditingController controller;
  final bool enabled;
  final FormFieldValidator<String> validator;
  final VoidCallback? onReset;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (onReset != null)
                  TextButton(onPressed: onReset, child: const Text('恢复默认')),
              ],
            ),
            const SizedBox(height: 5),
            Text(subtitle, style: TextStyle(color: Colors.grey.shade600)),
            const SizedBox(height: 14),
            TextFormField(
              controller: controller,
              enabled: enabled,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.done,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: '服务端地址',
                hintText: 'https://example.com:333',
                prefixIcon: Icon(Icons.link_rounded),
              ),
              validator: validator,
            ),
          ],
        ),
      ),
    );
  }
}

class PublicShareScreen extends ConsumerStatefulWidget {
  const PublicShareScreen({required this.token, super.key});

  final String token;

  @override
  ConsumerState<PublicShareScreen> createState() => _PublicShareScreenState();
}

class _PublicShareScreenState extends ConsumerState<PublicShareScreen> {
  FileItem? _file;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      final file = await ref.read(apiProvider).publicShare(widget.token);
      if (mounted) {
        setState(() {
          _file = file;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final file = _file;
    return Scaffold(
      appBar: AppBar(title: const Text('云粘贴分享')),
      body: Center(
        child: _loading
            ? const CircularProgressIndicator()
            : _error != null
            ? ErrorBanner(message: _error!)
            : ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: Card(
                  margin: const EdgeInsets.all(24),
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FileIcon(kind: file!.kind, size: 54),
                        const SizedBox(height: 16),
                        Text(
                          file.name,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${fileKindLabel(file.kind)} · ${formatBytes(file.size)}',
                          style: TextStyle(color: Colors.grey.shade600),
                        ),
                        const SizedBox(height: 24),
                        FilledButton.icon(
                          onPressed: () => launchUrl(
                            Uri.parse(
                              ref
                                  .read(apiProvider)
                                  .publicDownloadUrl(widget.token),
                            ),
                            mode: LaunchMode.externalApplication,
                          ),
                          icon: const Icon(Icons.download_rounded),
                          label: const Text('下载文件'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
      ),
    );
  }
}

class ContentPage extends StatelessWidget {
  const ContentPage({
    required this.title,
    required this.subtitle,
    required this.child,
    this.actions = const [],
    super.key,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        MediaQuery.sizeOf(context).width < 900 ? 16 : 32,
        26,
        MediaQuery.sizeOf(context).width < 900 ? 16 : 32,
        24,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 16,
            runSpacing: 12,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(subtitle, style: TextStyle(color: Colors.grey.shade600)),
                ],
              ),
              Wrap(spacing: 10, children: actions),
            ],
          ),
          const SizedBox(height: 24),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    super.key,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 236,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: color),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FileClipboardBanner extends StatelessWidget {
  const FileClipboardBanner({
    required this.clipboard,
    required this.enabled,
    required this.onPaste,
    this.onClear,
    super.key,
  });

  final FileClipboard? clipboard;
  final bool enabled;
  final VoidCallback onPaste;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final current = clipboard;
    if (current == null) return const SizedBox.shrink();
    final isCopy = current.mode == FileClipboardMode.copy;
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  isCopy ? Icons.copy_outlined : Icons.drive_file_move_outlined,
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${isCopy ? '已复制' : '已剪切'} ${current.itemCount} 项，进入目标文件夹后粘贴',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (onClear != null)
                  IconButton(
                    tooltip: '清除剪贴板',
                    onPressed: enabled ? onClear : null,
                    icon: const Icon(Icons.close_rounded),
                    color: Theme.of(context).colorScheme.onPrimaryContainer,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: enabled ? onPaste : null,
                icon: Icon(
                  isCopy
                      ? Icons.content_paste_rounded
                      : Icons.drive_file_move_rounded,
                ),
                label: Text(isCopy ? '粘贴到这里' : '移动到这里'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FileRow extends StatelessWidget {
  const FileRow({
    required this.file,
    this.onOpen,
    this.onFavorite,
    this.onCopy,
    this.onCut,
    this.onShare,
    this.onMore,
    super.key,
  });

  final FileItem file;
  final VoidCallback? onOpen;
  final VoidCallback? onFavorite;
  final VoidCallback? onCopy;
  final VoidCallback? onCut;
  final VoidCallback? onShare;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onOpen,
      contentPadding: const EdgeInsets.symmetric(vertical: 3),
      leading: FileIcon(kind: file.kind),
      title: Text(file.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${formatBytes(file.size)} · ${formatDate(file.updatedAt)}',
      ),
      trailing: Wrap(
        spacing: 1,
        children: [
          if (file.isShared)
            const Icon(
              Icons.ios_share_outlined,
              size: 18,
              color: Color(0xFF356B5D),
            ),
          if (onCopy != null)
            IconButton(
              tooltip: '复制',
              onPressed: onCopy,
              icon: const Icon(Icons.copy_outlined),
            ),
          IconButton(
            tooltip: file.isFavorite ? '取消收藏' : '收藏',
            onPressed: onFavorite,
            icon: Icon(
              file.isFavorite ? Icons.star_rounded : Icons.star_border_rounded,
              color: file.isFavorite ? Colors.amber.shade700 : null,
            ),
          ),
          if (onShare != null)
            IconButton(
              tooltip: file.isShared ? '管理分享' : '分享',
              onPressed: onShare,
              icon: const Icon(Icons.link_rounded),
            ),
          if (onMore != null)
            IconButton(
              tooltip: '更多',
              onPressed: onMore,
              icon: const Icon(Icons.more_horiz_rounded),
            ),
        ],
      ),
    );
  }
}

class FolderRow extends StatelessWidget {
  const FolderRow({
    required this.folder,
    this.onTap,
    this.onFavorite,
    this.onCopy,
    this.onCut,
    this.onMore,
    super.key,
  });

  final FolderItem folder;
  final VoidCallback? onTap;
  final VoidCallback? onFavorite;
  final VoidCallback? onCopy;
  final VoidCallback? onCut;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final subtitle = folder.isTrashed
        ? '文件夹 · 已在回收站'
        : folder.isFavorite
        ? '文件夹 · 已收藏'
        : '文件夹';
    return ListTile(
      onTap: onTap,
      leading: const FileIcon(kind: 'folder'),
      title: Text(
        folder.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: folder.isTrashed ? Colors.grey.shade600 : null),
      ),
      subtitle: Text(subtitle),
      trailing: Wrap(
        spacing: 1,
        children: [
          if (onCopy != null)
            IconButton(
              tooltip: '复制',
              onPressed: onCopy,
              icon: const Icon(Icons.copy_outlined),
            ),
          if (onFavorite != null)
            IconButton(
              tooltip: folder.isFavorite ? '取消收藏' : '收藏',
              onPressed: onFavorite,
              icon: Icon(
                folder.isFavorite
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                color: folder.isFavorite ? Colors.amber.shade700 : null,
              ),
            ),
          if (onMore != null)
            IconButton(
              tooltip: '更多',
              onPressed: onMore,
              icon: const Icon(Icons.more_horiz_rounded),
            ),
          if (onTap != null && onMore == null)
            const Icon(Icons.chevron_right_rounded),
        ],
      ),
    );
  }
}

class Breadcrumbs extends StatelessWidget {
  const Breadcrumbs({
    required this.breadcrumbs,
    required this.onTap,
    super.key,
  });

  final List<FolderCrumb> breadcrumbs;
  final ValueChanged<String?> onTap;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        TextButton(onPressed: () => onTap(null), child: const Text('根目录')),
        for (final crumb in breadcrumbs) ...[
          const Icon(Icons.chevron_right_rounded, size: 18),
          TextButton(onPressed: () => onTap(crumb.id), child: Text(crumb.name)),
        ],
      ],
    );
  }
}

class FileIcon extends StatelessWidget {
  const FileIcon({required this.kind, this.size = 42, super.key});

  final String kind;
  final double size;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (kind) {
      'folder' => (Icons.folder_rounded, const Color(0xFFE3A52E)),
      'image' => (Icons.image_outlined, const Color(0xFFB45F9B)),
      'video' => (Icons.movie_outlined, const Color(0xFF4F78B8)),
      'audio' => (Icons.audiotrack_rounded, const Color(0xFF8158A8)),
      'document' => (Icons.description_outlined, const Color(0xFF4C80A3)),
      'archive' => (Icons.archive_outlined, const Color(0xFF8D704B)),
      'text' => (Icons.notes_rounded, const Color(0xFF4E927A)),
      _ => (Icons.insert_drive_file_outlined, const Color(0xFF6D747B)),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(size * .28),
      ),
      child: Icon(icon, color: color, size: size * .54),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(34),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 46, color: Colors.grey.shade400),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFFFFEDEC),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, color: Color(0xFFB54343)),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Color(0xFF8D3131)),
            ),
          ),
        ],
      ),
    );
  }
}

class InfoPill extends StatelessWidget {
  const InfoPill({required this.label, required this.value, super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
      decoration: BoxDecoration(
        color: const Color(0xFFF2F4F0),
        borderRadius: BorderRadius.circular(12),
      ),
      child: RichText(
        text: TextSpan(
          style: DefaultTextStyle.of(context).style,
          children: [
            TextSpan(
              text: '$label  ',
              style: TextStyle(color: Colors.grey.shade600),
            ),
            TextSpan(
              text: value,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> pickAndUpload(BuildContext context, WidgetRef ref) async {
  final result = await FilePicker.pickFiles(
    allowMultiple: true,
    withData: true,
  );
  if (result == null || result.files.isEmpty) return;
  final uploads = result.files
      .map(
        (file) => PickedUpload(
          name: file.name,
          path: file.path,
          bytes: file.bytes,
          size: file.size,
        ),
      )
      .toList();
  try {
    await ref.read(appControllerProvider.notifier).upload(uploads);
    if (context.mounted) showSnack(context, '上传成功');
  } catch (_) {
    if (context.mounted) {
      showSnack(context, ref.read(appControllerProvider).error ?? '上传失败');
    }
  }
}

const _officePreviewExtensions = <String>{
  '.doc',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.dotm',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlt',
  '.xltx',
  '.xltm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.pot',
  '.potx',
  '.potm',
  '.pps',
  '.ppsx',
  '.ppsm',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.wps',
  '.et',
  '.dps',
  '.vsd',
  '.vsdx',
  '.pub',
};

Future<void> openPrivateFile(
  BuildContext context,
  WidgetRef ref,
  FileItem file,
) async {
  try {
    final access = await ref.read(appControllerProvider.notifier).access(file);
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => PrivateFileDialog(
        file: file,
        access: access,
        api: ref.read(apiProvider),
      ),
    );
  } catch (_) {
    if (context.mounted) {
      showSnack(context, ref.read(appControllerProvider).error ?? '文件打开失败');
    }
  }
}

Future<void> openFileUrl(
  BuildContext context,
  String url, {
  required String failureMessage,
}) async {
  final opened = await launchUrl(
    Uri.parse(url),
    mode: LaunchMode.externalApplication,
  );
  if (!opened && context.mounted) showSnack(context, failureMessage);
}

bool _isTextFile(FileItem file) =>
    file.kind == 'text' || file.mime.toLowerCase().startsWith('text/');

bool _isImageFile(FileItem file) =>
    file.kind == 'image' || file.mime.toLowerCase().startsWith('image/');

bool _isOfficePreviewFile(FileItem file) {
  final name = file.name.toLowerCase();
  final extensionStart = name.lastIndexOf('.');
  if (extensionStart < 0) return false;
  return _officePreviewExtensions.contains(name.substring(extensionStart));
}

class PrivateFileDialog extends StatefulWidget {
  const PrivateFileDialog({
    required this.file,
    required this.access,
    required this.api,
    super.key,
  });

  final FileItem file;
  final FileAccess access;
  final YunpasteApi api;

  @override
  State<PrivateFileDialog> createState() => _PrivateFileDialogState();
}

class _PrivateFileDialogState extends State<PrivateFileDialog> {
  Future<String>? _textFuture;

  @override
  void initState() {
    super.initState();
    if (_isTextFile(widget.file)) {
      _textFuture = widget.api.readTextAt(widget.access.rawUrl);
    }
  }

  Future<void> _copyText() async {
    final textFuture = _textFuture;
    if (textFuture == null) return;
    try {
      await ClipboardUtils.copyText(await textFuture);
      if (mounted) showSnack(context, '文本内容已复制');
    } catch (_) {
      if (mounted) showSnack(context, '无法访问系统剪贴板');
    }
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final width = screen.width < 760 ? screen.width * .82 : 680.0;
    final height = screen.height < 700 ? screen.height * .58 : 520.0;
    final previewUrl = _isOfficePreviewFile(widget.file)
        ? widget.access.previewUrl
        : widget.access.rawUrl;

    return AlertDialog(
      title: Row(
        children: [
          FileIcon(kind: widget.file.kind, size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              widget.file.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: width,
        height: height,
        child: _buildPreview(context),
      ),
      actions: [
        if (_isTextFile(widget.file))
          OutlinedButton.icon(
            onPressed: _copyText,
            icon: const Icon(Icons.copy_outlined),
            label: const Text('复制内容'),
          ),
        TextButton(
          onPressed: () =>
              openFileUrl(context, previewUrl, failureMessage: '预览地址无法打开'),
          child: Text(_isOfficePreviewFile(widget.file) ? '打开预览' : '浏览器打开'),
        ),
        FilledButton.icon(
          onPressed: () => openFileUrl(
            context,
            widget.access.downloadUrl,
            failureMessage: '下载地址无法打开',
          ),
          icon: const Icon(Icons.download_rounded),
          label: const Text('下载'),
        ),
      ],
    );
  }

  Widget _buildPreview(BuildContext context) {
    if (_isTextFile(widget.file)) {
      return FutureBuilder<String>(
        future: _textFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(child: Text('文本内容加载失败，请使用浏览器打开'));
          }
          return DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xFFF5F6F3),
              borderRadius: BorderRadius.circular(12),
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: SelectableText(
                snapshot.data ?? '',
                style: const TextStyle(fontFamily: 'monospace', height: 1.45),
              ),
            ),
          );
        },
      );
    }

    if (_isImageFile(widget.file)) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: InteractiveViewer(
          minScale: .5,
          maxScale: 5,
          child: Image.network(
            widget.access.rawUrl,
            fit: BoxFit.contain,
            loadingBuilder: (context, child, progress) {
              if (progress == null) return child;
              return const Center(child: CircularProgressIndicator());
            },
            errorBuilder: (context, error, stackTrace) =>
                const Center(child: Text('图片加载失败，请使用浏览器打开')),
          ),
        ),
      );
    }

    final message = _isOfficePreviewFile(widget.file)
        ? '服务端会将办公文档转换为 PDF 后打开预览。'
        : widget.file.kind == 'video' || widget.file.kind == 'audio'
        ? '媒体文件将在系统浏览器或播放器中打开。'
        : '该文件类型适合下载后使用对应应用打开。';
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FileIcon(kind: widget.file.kind, size: 72),
          const SizedBox(height: 18),
          Text(
            '${fileKindLabel(widget.file.kind)} · ${formatBytes(widget.file.size)}',
            style: TextStyle(color: Colors.grey.shade700),
          ),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

Future<void> showPasteDialog(BuildContext context, WidgetRef ref) async {
  final titleController = TextEditingController(text: '未命名粘贴');
  final contentController = TextEditingController();
  var format = 'text';
  final submitted = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('新建粘贴'),
        content: SizedBox(
          width: 520,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleController,
                decoration: const InputDecoration(labelText: '标题'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: format,
                decoration: const InputDecoration(labelText: '格式'),
                items: const [
                  DropdownMenuItem(value: 'text', child: Text('纯文本')),
                  DropdownMenuItem(value: 'markdown', child: Text('Markdown')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => format = value);
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: contentController,
                minLines: 6,
                maxLines: 12,
                decoration: const InputDecoration(
                  labelText: '内容',
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () async {
                    try {
                      final text = await ClipboardUtils.readText();
                      if (text == null) {
                        if (context.mounted) showSnack(context, '系统剪贴板为空');
                        return;
                      }
                      contentController
                        ..text = text
                        ..selection = TextSelection.collapsed(
                          offset: text.length,
                        );
                      if (context.mounted) setState(() {});
                    } catch (_) {
                      if (context.mounted) {
                        showSnack(context, '无法读取系统剪贴板');
                      }
                    }
                  },
                  icon: const Icon(Icons.content_paste_rounded),
                  label: const Text('从剪贴板粘贴'),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('创建'),
          ),
        ],
      ),
    ),
  );
  if (submitted != true) {
    titleController.dispose();
    contentController.dispose();
    return;
  }
  try {
    await ref
        .read(appControllerProvider.notifier)
        .createPaste(
          title: titleController.text,
          content: contentController.text,
          format: format,
        );
    if (context.mounted) showSnack(context, '粘贴已创建');
  } catch (_) {
    if (context.mounted) {
      showSnack(context, ref.read(appControllerProvider).error ?? '创建失败');
    }
  }
  titleController.dispose();
  contentController.dispose();
}

Future<void> showFolderDialog(BuildContext context, WidgetRef ref) async {
  final controller = TextEditingController();
  final submitted = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('新建文件夹'),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: const InputDecoration(labelText: '文件夹名称'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('创建'),
        ),
      ],
    ),
  );
  if (submitted == true && controller.text.trim().isNotEmpty) {
    try {
      await ref
          .read(appControllerProvider.notifier)
          .createFolder(controller.text.trim());
      if (context.mounted) showSnack(context, '文件夹已创建');
    } catch (_) {
      if (context.mounted) {
        showSnack(context, ref.read(appControllerProvider).error ?? '创建失败');
      }
    }
  }
  controller.dispose();
}

Future<void> shareFile(
  BuildContext context,
  WidgetRef ref,
  FileItem file,
) async {
  final controller = ref.read(appControllerProvider.notifier);
  var current = file;
  try {
    if (!current.isShared) {
      final updated = await controller.setShare(current, enabled: true);
      if (updated == null) {
        if (context.mounted) showSnack(context, '分享状态更新失败');
        return;
      }
      current = updated;
    }
    if (!context.mounted) return;
    final closed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) =>
          ShareManagementDialog(file: current, controller: controller),
    );
    if (closed == true && context.mounted) {
      showSnack(context, '分享已关闭');
    }
  } catch (_) {
    if (context.mounted) {
      showSnack(context, ref.read(appControllerProvider).error ?? '操作失败');
    }
  }
}

class ShareManagementDialog extends StatefulWidget {
  const ShareManagementDialog({
    required this.file,
    required this.controller,
    super.key,
  });

  final FileItem file;
  final AppController controller;

  @override
  State<ShareManagementDialog> createState() => _ShareManagementDialogState();
}

class _ShareManagementDialogState extends State<ShareManagementDialog> {
  late FileItem _file;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _file = widget.file;
  }

  String? get _link {
    final token = _file.shareToken;
    if (token == null || token.isEmpty) return null;
    return widget.controller.shareUrl(token);
  }

  Future<void> _copyLink() async {
    final link = _link;
    if (link == null) return;
    try {
      await ClipboardUtils.copyText(link);
      if (mounted) showSnack(context, '分享链接已复制');
    } catch (_) {
      if (mounted) showSnack(context, '无法访问系统剪贴板');
    }
  }

  Future<void> _openLink() async {
    final link = _link;
    if (link == null) return;
    await openFileUrl(context, link, failureMessage: '无法打开分享链接');
  }

  Future<void> _changeExpiry() async {
    if (_saving) return;
    final now = DateTime.now();
    final minDate = DateTime(now.year, now.month, now.day);
    final maxAllowed = now.add(const Duration(days: 7));
    final maxDate = DateTime(maxAllowed.year, maxAllowed.month, maxAllowed.day);
    final current = _file.shareExpiresAt?.toLocal();
    final initial = _clampDate(current ?? maxAllowed, minDate, maxDate);
    final selected = await showDatePicker(
      context: context,
      firstDate: minDate,
      lastDate: maxDate,
      initialDate: initial,
      helpText: '选择分享有效期',
      cancelText: '取消',
      confirmText: '保存',
    );
    if (selected == null || !mounted) return;

    var expiresAt = DateTime(
      selected.year,
      selected.month,
      selected.day,
      23,
      59,
      59,
    );
    if (expiresAt.isAfter(maxAllowed)) expiresAt = maxAllowed;
    if (!expiresAt.isAfter(now)) {
      expiresAt = now.add(const Duration(minutes: 1));
    }
    setState(() => _saving = true);
    try {
      final updated = await widget.controller.updateShareExpiry(
        _file,
        expiresAt,
      );
      if (updated != null && mounted) {
        setState(() => _file = updated);
        showSnack(context, '分享有效期已更新');
      }
    } catch (_) {
      if (mounted) {
        showSnack(context, '分享有效期更新失败');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _closeShare() async {
    if (_saving) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('关闭分享？'),
        content: const Text('关闭后，原分享链接将立即失效。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('关闭分享'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _saving = true);
    try {
      await widget.controller.setShare(_file, enabled: false);
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) showSnack(context, '关闭分享失败');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final link = _link;
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.ios_share_outlined),
          const SizedBox(width: 10),
          Expanded(child: Text('管理分享', overflow: TextOverflow.ellipsis)),
        ],
      ),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _file.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 14),
            if (link != null) ...[
              SelectableText(link),
              const SizedBox(height: 12),
              Text(
                '有效期至：${_formatDateTime(_file.shareExpiresAt)}',
                style: TextStyle(color: Colors.grey.shade700),
              ),
            ] else
              const Text('当前分享链接不可用，请重新开启分享。'),
          ],
        ),
      ),
      actions: [
        if (link != null) ...[
          TextButton.icon(
            onPressed: _saving ? null : _copyLink,
            icon: const Icon(Icons.copy_outlined),
            label: const Text('复制'),
          ),
          TextButton.icon(
            onPressed: _saving ? null : _openLink,
            icon: const Icon(Icons.open_in_new_rounded),
            label: const Text('打开'),
          ),
          TextButton(
            onPressed: _saving ? null : _changeExpiry,
            child: const Text('延长有效期'),
          ),
        ],
        TextButton(
          onPressed: _saving ? null : _closeShare,
          child: const Text('关闭分享'),
        ),
        FilledButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: _saving
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('完成'),
        ),
      ],
    );
  }

  DateTime _clampDate(DateTime value, DateTime min, DateTime max) {
    if (value.isBefore(min)) return min;
    if (value.isAfter(max)) return max;
    return value;
  }
}

String _formatDateTime(DateTime? value) {
  if (value == null) return '未设置';
  final local = value.toLocal();
  return '${formatDate(local)} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

Future<void> showFileActions(
  BuildContext context,
  WidgetRef ref,
  FileItem file,
) async {
  final controller = ref.read(appControllerProvider.notifier);
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Wrap(
        children: [
          if (!file.isTrashed) ...[
            ListTile(
              leading: const Icon(Icons.copy_outlined),
              title: const Text('复制'),
              subtitle: const Text('进入目标文件夹后粘贴副本'),
              onTap: () {
                Navigator.pop(sheetContext);
                controller.copyToFileClipboard(file: file);
                if (context.mounted) {
                  showSnack(context, '文件已复制，进入目标文件夹后点击粘贴');
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_move_outlined),
              title: const Text('剪切'),
              subtitle: const Text('进入目标文件夹后粘贴以移动文件'),
              onTap: () {
                Navigator.pop(sheetContext);
                controller.cutToFileClipboard(file: file);
                if (context.mounted) {
                  showSnack(context, '文件已剪切，进入目标文件夹后点击粘贴');
                }
              },
            ),
          ],
          ListTile(
            leading: Icon(
              file.isTrashed
                  ? Icons.restore_rounded
                  : Icons.delete_outline_rounded,
            ),
            title: Text(file.isTrashed ? '恢复文件' : '移入回收站'),
            onTap: () async {
              Navigator.pop(sheetContext);
              try {
                await controller.trash(file);
                if (context.mounted) {
                  showSnack(context, file.isTrashed ? '文件已恢复' : '文件已移入回收站');
                }
              } catch (_) {
                if (context.mounted) {
                  showSnack(context, '操作失败');
                }
              }
            },
          ),
          if (file.isTrashed)
            ListTile(
              leading: const Icon(Icons.delete_forever_outlined),
              title: const Text('永久删除'),
              onTap: () async {
                Navigator.pop(sheetContext);
                final confirmed = await _confirmPermanentDelete(
                  context,
                  title: '永久删除文件？',
                  message: '删除后无法恢复，文件内容也会从存储中移除。',
                );
                if (confirmed != true) return;
                try {
                  await controller.deletePermanently(file);
                  if (context.mounted) showSnack(context, '文件已永久删除');
                } catch (_) {
                  if (context.mounted) showSnack(context, '永久删除失败');
                }
              },
            ),
        ],
      ),
    ),
  );
}

Future<void> showFolderActions(
  BuildContext context,
  WidgetRef ref,
  FolderItem folder,
) async {
  final controller = ref.read(appControllerProvider.notifier);
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Wrap(
        children: [
          if (!folder.isTrashed) ...[
            ListTile(
              leading: const Icon(Icons.copy_outlined),
              title: const Text('复制'),
              subtitle: const Text('进入目标文件夹后粘贴副本'),
              onTap: () {
                Navigator.pop(sheetContext);
                controller.copyToFileClipboard(folder: folder);
                if (context.mounted) {
                  showSnack(context, '文件夹已复制，进入目标文件夹后点击粘贴');
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_move_outlined),
              title: const Text('剪切'),
              subtitle: const Text('进入目标文件夹后粘贴以移动文件夹'),
              onTap: () {
                Navigator.pop(sheetContext);
                controller.cutToFileClipboard(folder: folder);
                if (context.mounted) {
                  showSnack(context, '文件夹已剪切，进入目标文件夹后点击粘贴');
                }
              },
            ),
          ],
          ListTile(
            leading: Icon(
              folder.isFavorite
                  ? Icons.star_rounded
                  : Icons.star_border_rounded,
              color: folder.isFavorite ? Colors.amber.shade700 : null,
            ),
            title: Text(folder.isFavorite ? '取消收藏文件夹' : '收藏文件夹'),
            onTap: () async {
              Navigator.pop(sheetContext);
              try {
                await controller.toggleFolderFavorite(folder);
                if (context.mounted) {
                  showSnack(context, folder.isFavorite ? '已取消收藏文件夹' : '文件夹已收藏');
                }
              } catch (_) {
                if (context.mounted) showSnack(context, '操作失败');
              }
            },
          ),
          ListTile(
            leading: Icon(
              folder.isTrashed
                  ? Icons.restore_rounded
                  : Icons.delete_outline_rounded,
            ),
            title: Text(folder.isTrashed ? '恢复文件夹' : '移入回收站'),
            subtitle: folder.isTrashed
                ? const Text('文件夹内的内容也会一并恢复')
                : const Text('文件夹内的内容也会一并移入回收站'),
            onTap: () async {
              Navigator.pop(sheetContext);
              try {
                await controller.trashFolder(folder);
                if (context.mounted) {
                  showSnack(
                    context,
                    folder.isTrashed ? '文件夹及内容已恢复' : '文件夹及内容已移入回收站',
                  );
                }
              } catch (_) {
                if (context.mounted) showSnack(context, '操作失败');
              }
            },
          ),
          if (folder.isTrashed)
            ListTile(
              leading: const Icon(Icons.delete_forever_outlined),
              title: const Text('永久删除文件夹'),
              subtitle: const Text('文件夹内的文件也会被永久删除'),
              onTap: () async {
                Navigator.pop(sheetContext);
                final confirmed = await _confirmPermanentDelete(
                  context,
                  title: '永久删除文件夹？',
                  message: '文件夹及其中的所有文件都将被永久删除，无法恢复。',
                );
                if (confirmed != true) return;
                try {
                  await controller.deleteFolderPermanently(folder);
                  if (context.mounted) showSnack(context, '文件夹已永久删除');
                } catch (_) {
                  if (context.mounted) showSnack(context, '永久删除失败');
                }
              },
            ),
        ],
      ),
    ),
  );
}

Future<bool?> _confirmPermanentDelete(
  BuildContext context, {
  required String title,
  required String message,
}) {
  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Colors.white,
          ),
          child: const Text('永久删除'),
        ),
      ],
    ),
  );
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

extension _LastOrNull<T> on Iterable<T> {
  T? get lastOrNull => isEmpty ? null : last;
}
