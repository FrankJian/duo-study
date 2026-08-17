# 儿童学习视频管理平台规格说明

> 文档版本：2.0  
> 状态：待实现  
> 更新日期：2026-08-11

## 1. 背景

当前项目是一个纯静态儿童学习视频站点，课程数据来自 `videos.json`，视频和封面通过文件目录维护。新需求要求管理员能够直接在网页中上传视频、上传或替换卡片封面、编辑课程信息和调整排序；未登录访客只能浏览和播放已经发布的内容。

这些操作涉及身份认证、权限校验、文件写入和数据持久化，因此目标版本需要前端、后端 API、数据库和媒体文件存储。

## 2. 项目目标

- 保留当前儿童友好的公开浏览和播放体验。
- 公开首页使用可选的共享访问密码保护；启用后访客登录一次即可浏览和播放已发布视频。
- 管理员登录后可以管理 Unit、视频、封面、排序和发布状态。
- 视频和封面上传后立即写入持久化存储，无需重新构建前端。
- 所有修改权限必须由后端校验，不能只依赖前端隐藏按钮。
- 继续支持自有服务器部署，并为后续用户、统计和管理功能保留扩展空间。

## 3. 角色与权限

### 3.1 访客

访客不需要单独注册账号；当配置了首页访问密码时，访客需要输入共享密码登录。登录状态通过 HttpOnly Cookie 持久保存，默认一段时间内无需重复登录。

登录后的访客允许：

- 查看已发布的 Unit。
- 查看已发布的视频卡片和封面。
- 播放视频。
- 使用上一集、下一集和返回列表。

访客不允许：

- 访问管理后台。
- 上传、编辑、排序、发布或删除内容。
- 调用任何管理类 API。

未登录访客只能看到登录提示，不能通过目录 API 或直接媒体 URL 获取学习内容。

### 3.2 管理员

管理员登录后允许：

- 新建、编辑、排序、发布和停用 Unit。
- 上传视频并填写标题、Unit、排序和发布状态。
- 上传、替换或删除自定义封面。
- 在没有自定义封面时生成默认视频封面。
- 编辑、排序、发布、下架和删除视频。
- 查看上传结果、媒体信息和操作记录。
- 修改自己的密码和退出登录。

### 3.3 暂不实现的角色

MVP 不实现访客注册、家长账号、儿童账号和编辑员角色。数据库保留 `role` 字段，方便后续增加权限层级。

## 4. MVP 功能范围

### 4.1 公开页面

- 展示站点标题和儿童友好首页。
- 按 Unit 分组展示视频。
- Unit 和视频按照数据库中的 `sortOrder` 数字排序。
- 卡片显示视频封面、课程编号和标题。
- 点击卡片打开 HTML5 播放器。
- 支持全屏、暂停、进度拖动、上一集和下一集。
- 仅显示 `published` 状态的 Unit 和视频。
- 数据或媒体加载失败时展示友好提示。
- 配置访问密码后，首页先展示轻量登录页；目录、Unit API 和媒体地址均需要有效访问会话。
- 页面和响应附带 `noindex` / `X-Robots-Tag`，避免学习内容被搜索引擎收录。

### 4.2 管理员登录

- 独立登录页面 `/admin/login`。
- 用户名和密码登录。
- 登录成功后建立服务端会话。
- 未登录访问 `/admin` 时跳转到登录页。
- 会话过期后要求重新登录。
- 提供退出登录和修改密码。
- 不提供公开注册入口。

### 4.3 Unit 管理

- 新建 Unit。
- 编辑标题、副标题和排序值。
- 发布、下架或停用 Unit。
- 拖动排序或输入排序值。
- Unit 下存在有效视频时，删除操作需要二次确认并被后端阻止；删除 Unit 采用归档方式，便于后续恢复。

### 4.4 视频管理

- 上传 MP4 视频。
- 选择所属 Unit。
- 设置课程标题、排序值和发布状态。
- 显示上传进度。
- 上传完成后读取视频时长、分辨率、编码和文件大小。
- 编辑视频标题、Unit、排序和发布状态。
- 下架或删除视频。
- 删除使用软删除，并将媒体移入回收目录。

### 4.5 封面管理

- 上传 JPG、PNG 或 WebP 作为卡片封面。
- 上传前显示本地预览。
- 后端统一处理为 640×360 WebP。
- 未上传封面时，后端调用 `ffmpeg` 从视频中生成默认封面。
- 管理员可随时替换封面。
- 封面加载失败时，公开页面回退到彩色占位卡片。

### 4.6 发布控制

- 新上传内容可以保存为草稿。
- 草稿和下架内容只在管理员后台可见。
- 只有已发布 Unit 下的已发布视频可以通过公开 API 返回。
- 下架内容不删除媒体文件，重新发布后可以恢复。

### 4.7 操作记录

记录以下管理操作：

- 登录成功和失败。
- 新建、编辑、排序、发布、下架和删除 Unit。
- 上传、编辑、替换封面、发布、下架和删除视频。
- 修改密码。

## 5. 暂不包含

- 访客注册和第三方登录。
- 儿童学习进度云端同步。
- 付费、订单和会员系统。
- 评论、弹幕和社交功能。
- 多语言内容管理。
- 在线剪辑视频。
- 自动转码集群和多清晰度视频。
- 对象存储和 CDN；MVP 先使用服务器本地磁盘。

## 6. 推荐技术架构

### 6.1 技术选型

| 层级 | 技术 | 用途 |
|---|---|---|
| 前端 | React、Vite、TypeScript | 公开页面和管理后台 |
| 后端 | Node.js 22、Fastify、TypeScript | API、认证、上传和业务逻辑 |
| 数据校验 | Zod | 前后端共享请求与响应类型 |
| 数据库 | SQLite、Drizzle ORM | 用户、会话和课程元数据 |
| 密码 | Argon2id | 密码哈希 |
| 图片处理 | Sharp | 封面缩放、裁剪和 WebP 输出 |
| 视频检查 | ffprobe、ffmpeg | 编码检查和默认封面生成 |
| 反向代理 | Nginx | HTTPS、静态前端、媒体和 API 代理 |
| 部署 | Docker Compose | 固定 Node、ffmpeg 和运行环境 |

SQLite 适合当前单服务器、少量管理员和低写入量场景。启用 WAL 模式并使用迁移文件。若未来需要多实例写入，可迁移到 PostgreSQL。

### 6.2 请求路径

```text
浏览器
  ├── /、/admin/*        → Nginx → 前端静态文件
  ├── /api/*             → Nginx → Node/Fastify API
  └── /media/*           → Nginx → Node 权限检查 → X-Accel-Redirect

Node API
  ├── SQLite             → 用户、会话、Unit、视频、操作日志
  ├── data/uploads       → 上传临时文件
  ├── data/media         → 已完成的视频和封面，仅供 Nginx internal location 读取
  └── data/trash         → 软删除文件
```

前端、API 和媒体使用同一个域名，避免额外的跨域配置，并让会话 Cookie 保持同源。

### 6.3 代码目录

```text
apps/
├── web/                 React/Vite 前端
│   ├── src/public/      公开页面
│   ├── src/admin/       管理后台
│   └── src/shared/      公共组件和 API 客户端
└── api/                 Fastify 后端
    ├── src/auth/
    ├── src/units/
    ├── src/videos/
    ├── src/uploads/
    └── src/audit/
packages/
└── contracts/           Zod schema 和共享类型
data/                    运行数据，不提交到代码仓库
├── app.sqlite
├── uploads/
├── media/
│   ├── videos/
│   └── posters/
└── trash/
deploy/
├── nginx.conf
└── docker-compose.yml
scripts/
├── create-admin.*
├── import-current-catalog.*
└── backup.*
```

## 7. 数据模型

### 7.1 `users`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `username` | TEXT UNIQUE | 登录名，统一小写 |
| `passwordHash` | TEXT | Argon2id 哈希 |
| `role` | TEXT | MVP 固定为 `admin` |
| `status` | TEXT | `active` 或 `disabled` |
| `createdAt` | DATETIME | 创建时间 |
| `updatedAt` | DATETIME | 更新时间 |
| `lastLoginAt` | DATETIME NULL | 最近登录时间 |

### 7.2 `sessions`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 会话主键 |
| `tokenHash` | TEXT UNIQUE | 随机会话令牌的哈希 |
| `userId` | UUID | 关联管理员 |
| `expiresAt` | DATETIME | 过期时间 |
| `createdAt` | DATETIME | 创建时间 |
| `lastSeenAt` | DATETIME | 最近访问时间 |
| `ipAddress` | TEXT NULL | 审计用途 |
| `userAgent` | TEXT NULL | 审计用途 |

### 7.3 `units`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `slug` | TEXT UNIQUE | 稳定 URL 标识，如 `unit1` |
| `title` | TEXT | 显示标题 |
| `subtitle` | TEXT NULL | 显示副标题 |
| `sortOrder` | INTEGER | 数字排序 |
| `status` | TEXT | `draft`、`published`、`archived` |
| `createdAt` | DATETIME | 创建时间 |
| `updatedAt` | DATETIME | 更新时间 |

### 7.4 `videos`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `unitId` | UUID | 所属 Unit |
| `title` | TEXT | 课程标题 |
| `sortOrder` | INTEGER | Unit 内排序 |
| `status` | TEXT | `draft`、`published`、`archived` |
| `videoPath` | TEXT | 服务器内部相对路径 |
| `posterPath` | TEXT NULL | 封面相对路径 |
| `originalFilename` | TEXT | 原始文件名，仅用于展示 |
| `mimeType` | TEXT | 经过检测的 MIME |
| `sizeBytes` | INTEGER | 文件大小 |
| `durationSeconds` | REAL | 视频时长 |
| `width` | INTEGER | 视频宽度 |
| `height` | INTEGER | 视频高度 |
| `videoCodec` | TEXT | 视频编码 |
| `audioCodec` | TEXT NULL | 音频编码 |
| `createdBy` | UUID | 上传管理员 |
| `createdAt` | DATETIME | 创建时间 |
| `updatedAt` | DATETIME | 更新时间 |
| `deletedAt` | DATETIME NULL | 软删除时间 |

### 7.5 `audit_logs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `userId` | UUID NULL | 操作管理员 |
| `action` | TEXT | 动作名称 |
| `entityType` | TEXT NULL | `user`、`unit`、`video` |
| `entityId` | UUID NULL | 被操作实体 |
| `details` | JSON NULL | 非敏感变更摘要 |
| `ipAddress` | TEXT NULL | 请求地址 |
| `createdAt` | DATETIME | 操作时间 |

审计日志不得记录明文密码、会话令牌或媒体文件内容。

## 8. API 规格

所有 API 使用 JSON；上传接口使用 `multipart/form-data`。成功响应直接返回资源或分页对象，错误统一为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "可展示给用户的错误信息",
    "requestId": "..."
  }
}
```

### 8.1 公开 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/catalog` | 返回已发布 Unit 和视频，按数字排序 |
| `GET` | `/api/units/:slug` | 返回单个已发布 Unit |
| `GET` | `/api/health` | 健康检查，不返回敏感信息 |

公开 API 不返回服务器内部绝对路径、原始上传临时路径、管理员信息或草稿内容。

### 8.2 认证 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/login` | 登录并设置会话 Cookie |
| `POST` | `/api/auth/logout` | 删除当前会话 |
| `GET` | `/api/auth/me` | 返回当前管理员摘要 |
| `PUT` | `/api/auth/password` | 修改当前密码并撤销其他会话 |

### 8.3 Unit 管理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/units` | 返回全部 Unit，包括草稿和下架 |
| `POST` | `/api/admin/units` | 新建 Unit |
| `PATCH` | `/api/admin/units/:id` | 编辑 Unit |
| `PUT` | `/api/admin/units/order` | 批量调整 Unit 排序 |
| `DELETE` | `/api/admin/units/:id` | 归档或删除空 Unit |

### 8.4 视频管理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/videos` | 管理端分页查询和筛选 |
| `GET` | `/api/admin/videos/:id` | 视频详情和媒体信息 |
| `POST` | `/api/admin/videos` | 流式上传视频，可同时上传封面 |
| `PATCH` | `/api/admin/videos/:id` | 编辑标题、Unit、排序和状态 |
| `PUT` | `/api/admin/videos/order` | 批量调整 Unit 内排序 |
| `PUT` | `/api/admin/videos/:id/poster` | 上传或替换封面 |
| `DELETE` | `/api/admin/videos/:id/poster` | 删除自定义封面并生成默认封面 |
| `DELETE` | `/api/admin/videos/:id` | 软删除视频和媒体 |

## 9. 上传与媒体处理

### 9.1 视频上传

- MVP 只接受 `.mp4`。
- 默认最大上传大小为 2 GB，通过环境变量调整。
- 后端使用流式写入临时目录，禁止将完整视频读入内存。
- 文件扩展名、声明 MIME、文件签名和 `ffprobe` 结果需要一致。
- MVP 接受 H.264 视频；音频允许 AAC。其他编码返回明确错误，不在请求内同步转码。
- 上传文件使用 UUID 作为存储名，不直接使用用户文件名。
- 上传成功并通过检查后，原子移动到正式媒体目录并写入数据库。
- 任一步骤失败都需要删除临时文件，不产生半成品记录。

### 9.2 封面上传

- 接受 JPG、PNG 和 WebP。
- 默认最大 10 MB。
- 使用 Sharp 读取真实图片格式，不信任扩展名。
- 去除 EXIF 等不必要元数据。
- 输出 640×360 WebP。
- 管理端在上传前展示裁剪预览。

### 9.3 自动封面

- 视频上传时未提供封面，则使用 `ffmpeg` 截取默认帧。
- 默认时间点为第 3 秒；短于 3 秒时使用视频时长的 20%。
- 自动封面按 640×360 比例缩放并留边，不强制裁掉主体。
- 自动封面失败不阻止视频保存，但视频保持草稿并展示告警。

### 9.4 媒体访问

- 数据库保存相对内部路径，公开 API 返回 `/media/...` URL。
- `/media/*` 请求先由 Node 根据发布状态或管理员会话做权限检查。
- 校验通过后，Node 返回 `X-Accel-Redirect`，由 Nginx internal location 读取真实文件并支持 HTTP Range。
- 草稿、下架和软删除媒体不能通过猜测 URL 被访客读取。
- Node 只做权限判断，不读取或转发视频文件内容。
- 媒体 URL 不包含用户提交的原始文件名。

## 10. 认证与安全

- 管理员由服务器 CLI 创建，用户名和密码不得提交到代码仓库。
- 密码使用 Argon2id 哈希，并设置合理的内存和时间成本。
- 登录成功后生成至少 256 位随机会话令牌；数据库只保存令牌哈希。
- Cookie 必须设置 `HttpOnly`、`Secure`、`SameSite=Lax` 和明确过期时间。
- 所有 `/api/admin/*` 写操作必须同时校验会话、角色和 CSRF Token。
- 登录接口按 IP 和用户名限速，并记录失败事件。
- 连续失败不返回“用户名不存在”或“密码错误”的差异信息。
- 所有输入通过 Zod 校验并设置长度上限。
- 文件路径由服务器生成，禁止从请求拼接实际磁盘路径。
- 设置 CSP、`X-Content-Type-Options`、`Referrer-Policy` 等响应头。
- Nginx 和 API 都设置请求体大小和超时限制。
- 管理端任何隐藏按钮都不代表授权；授权只以 API 响应为准。

## 11. 管理后台交互

### 11.1 登录页

- 用户名和密码输入。
- 提交中状态和明确但不过度暴露信息的错误提示。
- 登录成功后跳转 `/admin`。

### 11.2 内容总览

- 显示 Unit 数、视频数、草稿数和最近上传。
- 左侧或顶部导航包含 Unit、视频和操作记录。
- 管理界面以桌面操作为主，同时兼容平板。

### 11.3 视频上传页

- 拖放或选择 MP4。
- 选择 Unit、标题、排序、发布状态。
- 可选上传封面并预览。
- 显示上传百分比和处理状态。
- 上传过程中离开页面需要确认。
- 成功后进入视频详情页。

### 11.4 内容列表

- 按 Unit、状态和标题筛选。
- 显示封面、标题、Unit、排序、时长、大小和状态。
- 提供编辑、发布/下架、替换封面和删除操作。
- 删除必须二次确认并说明可恢复期限。

## 12. 删除、恢复与一致性

- 删除视频默认为软删除。
- 数据库设置 `deletedAt`，媒体原子移动到 `data/trash`。
- 回收内容默认保留 7 天，之后由定时任务永久删除。
- 管理员可在保留期内恢复。
- 删除 Unit 前需要确认其下没有有效视频，或先迁移/删除视频。
- 数据库写入和文件移动需要设计补偿逻辑，避免数据库存在但文件丢失。

## 13. 日志、监控与备份

- 每个请求生成 `requestId`。
- 服务日志使用结构化 JSON，禁止记录密码、Cookie 和完整上传内容。
- `/api/health` 检查进程、数据库和媒体目录可写性。
- SQLite 和 `data/media` 必须一起备份。
- 每日至少一次备份，保留最近 7 天。
- 恢复流程需要在上线前演练一次。

## 14. 部署规格

### 14.1 组件

- 一个 Nginx 容器或宿主机服务。
- 一个 Node API 容器。
- SQLite 和媒体持久化卷。
- `ffmpeg`、`ffprobe` 和 Sharp 运行依赖包含在 API 镜像内。

### 14.2 配置

通过环境变量提供：

- 生产环境标识。
- Cookie 名称和会话有效期。
- 会话密钥或令牌哈希密钥。
- 数据库路径。
- 上传、媒体和回收目录。
- 视频和图片大小限制。
- 允许的站点域名。

`.env` 不提交仓库；提供不含秘密值的 `.env.example`。

### 14.3 HTTPS

- 公网部署必须使用 HTTPS。
- HTTP 自动跳转 HTTPS。
- 上传接口需要更长的代理超时时间。
- Nginx 开启 MP4 Range 支持和合理缓存。

## 15. 当前静态数据迁移

提供一次性导入脚本，读取现有：

- `videos.json`
- `videos/unit1`、`videos/unit2`
- `posters/unit1`、`posters/unit2`

导入步骤：

1. 创建 Unit 记录。
2. 按 `order` 创建视频记录。
3. 将视频和封面复制或移动到新的 UUID 存储路径。
4. 使用 `ffprobe` 补充媒体信息。
5. 校验 24 个视频和 24 个封面全部存在。
6. 默认导入为已发布状态。
7. 生成导入报告，不覆盖已有记录。

导入前必须备份现有媒体。首次迁移优先复制，确认新系统可用后再清理旧目录。

## 16. 非功能要求

- 公开首页在普通家庭宽带下优先加载封面，不预加载全部视频。
- 封面使用懒加载。
- 公开页面在手机、平板和桌面端可用。
- 管理后台支持最新版 Chrome、Safari 和 Edge。
- API 所有分页接口设置默认和最大页大小。
- 数据库排序字段使用整数，不依赖文件名字符串排序。
- 页面符合基本键盘操作和可访问性要求。
- 时区统一以 UTC 存储，前端按用户本地时区显示。

## 17. 验收标准

### 17.1 权限

- 未登录用户可以浏览和播放已发布内容。
- 未登录调用管理 API 返回 `401`。
- 普通公开页面不能显示草稿或下架内容。
- 登录管理员可以执行全部授权管理操作。
- 仅隐藏前端按钮无法绕过后端权限。

### 17.2 上传

- 管理员可以上传有效 MP4，并看到上传进度。
- 上传成功后数据库和媒体文件均存在。
- 无封面时自动生成默认封面。
- 上传自定义封面后公开卡片及时更新。
- 不支持的格式、超限文件和异常编码被安全拒绝。
- 上传失败不会残留临时文件或不完整记录。

### 17.3 内容管理

- 可以新建和编辑 Unit。
- 可以编辑视频标题、Unit、排序和发布状态。
- 数字排序在公开页面和管理后台一致。
- 下架视频立即从公开 API 消失，但管理后台仍可见。
- 删除的视频进入回收状态，可以在保留期内恢复。

### 17.4 播放与部署

- 视频支持 HTTP Range、全屏和进度拖动。
- 包含中文和特殊符号的原始文件名不会影响存储或播放。
- Docker Compose 可以在新服务器上启动完整系统。
- 数据库、媒体和备份目录使用持久化卷。

## 18. 已确定的产品决策

- MVP 只实现管理员账号，不提供访客注册。
- 公开内容无需登录即可观看。
- 前端和 API 使用同域部署。
- MVP 使用 SQLite 和服务器本地媒体目录。
- Node 校验媒体访问权限，Nginx 通过 `X-Accel-Redirect` 直接传输文件。
- MVP 只接受浏览器兼容的 MP4，不在上传请求中自动转码。
- 自定义封面优先；未提供时由 ffmpeg 生成默认封面。
- 删除默认可恢复，不直接永久删除文件。
