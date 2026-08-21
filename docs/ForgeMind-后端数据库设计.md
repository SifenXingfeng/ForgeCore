# ForgeMind 后端数据库设计（MySQL 8.4）

## 1. 落地边界

当前实现把静态工厂设计、用户数据和用户私有导入资源持久化起来：用户、登录会话、工厂、楼层、物品、配方、配方端口、设施布局和 GLB 资源。

`ItemLot`、机器加工进度、传送带槽位和高频位置不直接写 MySQL，它们仍由仿真引擎持有；`simulation_snapshot` 只用于后续保存可复现的低频快照。

## 2. 数据库

```text
数据库：forgemind
字符集：utf8mb4
引擎：InnoDB
开发端口：3306
默认开发账号：forgemind / forgemind
```

## 3. 表职责

| 表 | 当前用途 |
| --- | --- |
| `app_user` | 用户账号和 BCrypt 密码哈希 |
| `auth_session` | 持久化登录会话，数据库只保存 token SHA-256 |
| `factory` | 工厂名称、归属用户、存档版本与完整 `save_json` 项目载荷；同一用户可拥有多份工厂 |
| `factory_member` | 工厂成员与角色，为多人协作预留 |
| `floor` | 多楼层结构；当前默认创建 A-01 主楼层 |
| `item` | 工厂级物品类型定义 |
| `recipe` | 工厂级生产配方定义 |
| `recipe_port` | 配方输入/输出端口及数量；端口与配方的同工厂关系由数据库级联维护 |
| `factory_object` | 设备类型、网格坐标、旋转、配方/物品绑定和 `resource_id`；绑定 ID 由后端按工厂/用户范围校验 |
| `factory_connection` | 设备端口连接，当前前端仍主要按网格方向推导 |
| `simulation_snapshot` | 低频仿真快照，为回放/副本仿真预留 |
| `imported_resource` | 用户导入的资源定义、原始项目 JSON、GLB 二进制和文件元数据；按 `owner_user_id` 隔离 |

## 4. 暂不建表的运行态

以下数据不进入实时 CRUD：`item_lot`、机器实时状态、传送带槽位、AGV 每 tick 坐标、临时 AI 副本的中间状态。后续需要历史分析时，再以批量快照或时序表方式写入，避免把 MySQL 变成每帧状态总线。

## 5. 初始化

```powershell
docker compose up -d mysql
cd backend
mvn spring-boot:run
```

Spring Boot 启动时由 Flyway 执行 v1–v7 迁移。v2–v4 专门处理复合主键下的可空绑定和级联删除边界；V5 新增用户私有资源表，V6 为工厂对象增加 `resource_id`，V7 为多工厂项目库增加完整 `save_json` 载荷。连接信息可通过 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` 覆盖。

## 6. 用户资源隔离规则

资源 API 和工厂存档均以当前 bearer token 解析出的 `app_user.id` 为边界：

1. `GET /api/resources` 只查询当前用户的 `owner_user_id`；
2. `GET /api/resources/{resourceId}/model` 只有资源归属匹配时才返回 GLB；
3. `/api/factories/{projectId}` 读写必须同时匹配项目 ID 与当前 `owner_user_id`，不能访问其他用户的工厂；
4. 相同用户再次登录会恢复资源目录，其他用户不会看到同一条资源记录；
5. 当前策略对同一用户的相同 `resource_id` 使用更新写入，避免重复导入产生重复目录项。

资源文件当前直接存放在 MySQL `LONGBLOB` 中，适合开发和小规模部署；生产环境若出现大量或超大 GLB，应迁移到对象存储，并在此表保存对象键和校验摘要。

仓库内的 `backend/data/factory.json` 与 `backend/data/users.json` 是早期 JSON 方案留下的历史文件，当前启动流程不会读取或写入它们；对应的 `JsonStore`、`UserStore` 仅保留人工迁移/查看用途，不再作为 Spring Bean。

## 7. 当前不持久化的运行态

前端自研仿真层仍持有 `ItemLot`、机器加工进度、传送带槽位、AGV/无人机当前位置和临时诊断候选。它们可以通过本地工厂存档或未来的 `simulation_snapshot` 保存低频快照，但目前不会作为每 tick 的数据库写入。
