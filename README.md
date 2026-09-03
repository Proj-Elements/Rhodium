# 月余

面向大学生的个人记账 Web 应用：记录日常支出、设置月度预算、管理固定订阅，并在月底回顾本月余量。

## 本地开发

```bash
npm install
cp .env.example .env
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

打开 <http://localhost:3030>。

## Docker 部署

```bash
docker compose up -d --build
```

应用容器会在启动时自动执行 Prisma migrations。PostgreSQL 数据保存在 `yueyu-postgres` named volume 中。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

应用默认使用人民币、中文界面和 `Asia/Shanghai` 时区。首版是单人本地账本，不包含登录、多人共享、银行同步或多币种。
