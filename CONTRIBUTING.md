# 参与贡献

感谢你愿意帮助改进云粘贴。文档修正、无障碍改进、测试补充、性能优化和新功能都很
欢迎。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. 较大的功能或数据结构变更请先创建 Issue 讨论目标和兼容方案。
3. 安全漏洞不要创建公开 Issue，请阅读 [SECURITY.md](SECURITY.md)。
4. 提交代码即表示你同意按项目的 MIT License 发布贡献。

## 本地环境

需要 Node.js 24、npm 和可选的 Docker Compose v2：

```bash
npm ci
npm run dev
```

开发服务器会同时启动前端和 API。不要把生产数据库、真实密钥或真实用户文件复制
到开发目录。

## 提交前检查

```bash
npm run check
npm test
npm run build
```

涉及 Docker、LibreOffice 预览或 rclone 的修改还应运行：

```bash
docker compose build
docker compose up -d --wait
curl -fsS http://127.0.0.1:8787/readyz
```

## 代码与测试要求

- 保持用户文件隔离：后端查询和存储操作必须绑定当前用户。
- 新增文件端点时同时考虑回收站、过期、分享撤销和 Range 请求。
- 新增管理设置时提供默认值、输入校验、并发修订号与导入导出兼容。
- 新增存储操作时处理路径规范化、队列上限、超时和失败清理。
- 修复缺陷时尽可能加入覆盖根因的回归测试。
- 不要提交 `.env`、`secrets/`、`config/`、`files/`、数据库、日志或用户上传内容。

## Pull Request

PR 请说明：

- 修改了什么以及为什么；
- 对用户、部署或数据格式的影响；
- 是否需要迁移或新增环境变量；
- 完成了哪些测试；
- 涉及界面时附上桌面和手机截图。

尽量保持一个 PR 只解决一个明确问题，避免混入无关格式化或生成文件。
