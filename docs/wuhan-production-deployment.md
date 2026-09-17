# 武汉晃晃生产部署

1. 将 `.env.production.example` 复制为 `.env.production`，生成独立的
   `GUEST_SESSION_SECRET` 并填写 PostgreSQL 连接串。
2. 运行 `docker compose -f compose.production.yml build`。
3. 运行 `docker compose -f compose.production.yml up -d`。
4. 在宿主机的 HTTPS 网关把域名反向代理到 `127.0.0.1:8080`。浏览器、REST
   与 WebSocket 使用同一个域名，不需要设置 `VITE_API_BASE`。
5. 检查 `/api/health`、`/api/ready`，再以四个独立浏览器窗口完成建房、加入、
   准备、开局、断线重连和结算验收。

后端房间状态仍在单进程内存中，必须保持一个 Uvicorn worker；部署重启会结束进行中
的房间。数据库保存账号、房间元数据和战绩，但目前不用于恢复进行中的牌局。
