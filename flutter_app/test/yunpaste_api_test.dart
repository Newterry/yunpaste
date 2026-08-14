import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yunpaste/data/services/yunpaste_api.dart';

void main() {
  test('resolves signed private file URLs returned by the backend', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(
        request.url.toString(),
        'https://paste.example.com/api/files/file-1/access',
      );
      return http.Response(
        jsonEncode({
          'rawUrl': '/api/file-access/token-1/raw',
          'downloadUrl': '/api/file-access/token-1/download',
          'previewUrl': '/api/file-access/token-1/preview',
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final api = YunpasteApi(
      baseUrl: 'https://paste.example.com/',
      client: client,
    );

    final access = await api.fileAccess('file-1');

    expect(
      access.rawUrl,
      'https://paste.example.com/api/file-access/token-1/raw',
    );
    expect(
      access.downloadUrl,
      'https://paste.example.com/api/file-access/token-1/download',
    );
    expect(
      access.previewUrl,
      'https://paste.example.com/api/file-access/token-1/preview',
    );
  });

  test('sends cloud clipboard copy operations to the backend', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(
        request.url.toString(),
        'https://paste.example.com/api/file-operations',
      );
      expect(request.headers['content-type'], 'application/json');
      expect(jsonDecode(request.body), {
        'action': 'copy',
        'fileIds': ['file-1'],
        'folderIds': [],
        'targetFolderId': 'folder-2',
      });
      return http.Response(
        jsonEncode({'ok': true, 'usage': 1234}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final api = YunpasteApi(
      baseUrl: 'https://paste.example.com/',
      client: client,
    );

    final usage = await api.fileOperation(
      action: 'copy',
      fileIds: const ['file-1'],
      targetFolderId: 'folder-2',
    );

    expect(usage, 1234);
  });

  test('patches a folder with the backend field names', () async {
    final client = MockClient((request) async {
      expect(request.method, 'PATCH');
      expect(
        request.url.toString(),
        'https://paste.example.com/api/folders/folder-1',
      );
      expect(request.headers['content-type'], 'application/json');
      expect(jsonDecode(request.body), {'is_favorite': true});
      return http.Response(
        jsonEncode({
          'folder': {
            'id': 'folder-1',
            'name': '资料',
            'is_favorite': 1,
            'is_trashed': 0,
            'created_at': '2026-08-14T00:00:00.000Z',
            'updated_at': '2026-08-14T00:00:00.000Z',
          },
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final api = YunpasteApi(
      baseUrl: 'https://paste.example.com/',
      client: client,
    );

    final folder = await api.patchFolder('folder-1', {'is_favorite': true});

    expect(folder.id, 'folder-1');
    expect(folder.isFavorite, isTrue);
  });

  test('deletes a folder through the folder endpoint', () async {
    final client = MockClient((request) async {
      expect(request.method, 'DELETE');
      expect(
        request.url.toString(),
        'https://paste.example.com/api/folders/folder-1',
      );
      return http.Response('{}', 200);
    });

    final api = YunpasteApi(
      baseUrl: 'https://paste.example.com/',
      client: client,
    );

    await api.deleteFolder('folder-1');
  });
  test('switches the shared API and public URL to a new server', () async {
    final client = MockClient((request) async {
      expect(request.url.toString(), 'https://new.example.com:333/api/config');
      return http.Response(
        jsonEncode({
          'config': {'siteName': '新服务'},
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final api = YunpasteApi(
      baseUrl: 'https://old.example.com:333',
      client: client,
    );
    api.setBaseUrl(
      'https://new.example.com:333/',
      webBaseUrl: 'https://share.example.com/',
    );

    final config = await api.config();

    expect(config.siteName, '新服务');
    expect(api.baseUrl, 'https://new.example.com:333');
    expect(
      api.publicShareUrl('token-1'),
      'https://share.example.com/share/token-1',
    );
  });
}
