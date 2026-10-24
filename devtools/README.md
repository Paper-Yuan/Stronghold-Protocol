# devtools/ — 一次性调试脚本

排查问题时临时写的脚本，留在仓库里备查。**不属于测试套件**（`npm test` 只跑 `test/`），
也不参与构建或发布。

| 文件 | 用途 |
|---|---|
| `test_crawl_modules.py` | 遍历站点收集模块列表 |
| `validate_exports.py` | 校验导出接口 |
| `test_server_announcement.mjs` | 服务器公告联调 |
| `test_ws_diag.mjs` | WebSocket 诊断 |

正式测试请用 `node --test test/<area>/` 或 `npm run ci`。
