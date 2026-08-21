# ForgeMind Spring Boot 后端

## 职责

Spring Boot 3 + Java 17 是 ForgeMind 的结构化持久化服务，当前负责：

- 用户注册、登录、会话和 bearer token 校验；
- 当前用户的工厂、楼层、物品、配方、端口和设备布局；
- 用户导入资源的 JSON 元数据、项目定义和 GLB 二进制；
- 保存工厂时验证 `factory_object.resource_id` 必须属于当前用户。

高频仿真状态（`ItemLot`、传送带槽位、AGV/无人机每 tick 坐标和机器加工进度）不由该服务逐帧接管。

## 启动

在仓库根目录：

```powershell
docker compose up -d mysql
cd backend
mvn spring-boot:run
```

默认监听 `8080`，数据库默认连接本地 MySQL 8.4 的 `forgemind` 库。可用 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` 覆盖连接信息。Flyway 会在启动时执行 `V1` 到当前最新迁移。

## API

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 否 | 注册 |
| POST | `/api/auth/login` | 否 | 登录 |
| GET | `/api/auth/me` | 是 | 当前用户 |
| POST | `/api/auth/logout` | 是 | 注销 |
| GET | `/api/factory` | 是 | 旧版单工厂兼容读取 |
| PUT | `/api/factory` | 是 | 旧版单工厂兼容保存 |
| GET | `/api/factory/health` | 否 | 健康检查 |
| GET | `/api/factories` | 是 | 列出当前账号的全部工厂存档 |
| POST | `/api/factories` | 是 | 新建完整工厂项目 |
| GET | `/api/factories/{projectId}` | 是 | 读取指定工厂项目 |
| PUT | `/api/factories/{projectId}` | 是 | 覆盖保存指定工厂项目 |
| GET | `/api/resources` | 是 | 当前用户的资源目录 |
| POST | `/api/resources` | 是 | multipart 导入资源 |
| GET | `/api/resources/{resourceId}/model` | 是 | 下载当前用户的 GLB |

资源导入的 multipart 字段为：

- `metadata`：资源摘要 JSON，至少包含稳定的 `id`；
- `project`：原始 `.forgemind-project.json` 内容；
- `model`：GLB 文件。

当前资源保存策略是同一用户同一 `resource_id` 更新，资源归属由 `owner_user_id` 和数据库查询条件共同保证。没有该用户资源的 token 不能列出、下载或在工厂存档中引用它。

## 数据库迁移

迁移文件在 `src/main/resources/db/migration/`。`V5__create_user_imported_resources.sql` 新增私有资源表，`V6__add_resource_reference_to_factory_objects.sql` 为工厂设备增加资源引用，`V7__add_full_factory_project_save.sql` 为每个工厂保存完整的版本化项目载荷。

## 验证

```powershell
mvn test
```

如需验证跨用户隔离，应启动 MySQL 和后端，使用两个账号分别导入同一个资源 ID，确认各自列表只返回自己的资源，并确认第二个账号不能用第一个账号的 token 下载模型或保存资源引用。
