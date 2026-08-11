# 小小探索站

这是一个面向儿童的趣味学习视频平台，按 Unit 分组展示课程，并按照课程编号自然排序。项目正在从原来的纯静态页面升级为带管理员后台的前后端服务，详细约束见 [spec.md](./spec.md)，实施顺序见 [task.md](./task.md)。

## 当前实现

- 根目录仍保留可直接部署的静态版本，便于迁移期间回滚。
- `apps/web` 是新的 React/Vite 前端骨架，课程数据从 `/api/catalog` 读取。
- `apps/api` 是 Fastify/TypeScript API 骨架，已包含 SQLite/Drizzle 数据模型、健康检查和公开目录接口。
- `packages/contracts` 保存前后端共享的 Zod schema。
- 视频源文件仍统一放在 `videos/`，新的运行时上传数据放在 `data/`（已加入 `.gitignore`）。

## 文件结构

```text
index.html       页面结构
styles.css       页面样式
app.js           页面交互逻辑
videos.json      视频清单
favicon.svg      网站图标
posters/
├── unit1/       视频封面帧
└── unit2/       视频封面帧
videos/
├── unit1/       Unit 1 视频
└── unit2/       Unit 2 视频
```

## 原静态版本本地预览

由于页面通过 `fetch` 读取 `videos.json`，不能直接双击 `index.html` 使用 `file://` 打开。可以使用任意静态文件服务器，例如：

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080/`。

## 新前后端版本开发

需要 Node.js 22 或更高版本。首次使用时：

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

前端地址为 `http://127.0.0.1:5173`，API 地址为 `http://127.0.0.1:3000`。数据库和上传运行数据位于 `data/`，不会与源代码和 `videos/` 混在一起。

首次创建管理员：

```bash
npm run admin:create
```

命令会在终端中隐藏密码输入，不接受命令行明文密码。管理后台地址为 `/admin`，未登录用户只能看到登录页；公开页面仍然无需登录。

## 发布 Docker 镜像

项目包含 [`.github/workflows/publish-docker.yml`](./.github/workflows/publish-docker.yml)。向 GitHub 推送符合 `v*.*.*` 的 tag 后，Workflow 会先执行类型检查、lint 和测试，然后发布两个 GHCR 镜像：

向 `main` 分支推送代码时，Workflow 只执行类型检查、lint 和测试，不会发布镜像；只有推送版本 tag 时才会发布镜像。

```text
ghcr.io/frankjian/duo-study-api:v1.0.0
ghcr.io/frankjian/duo-study-web:v1.0.0
```

当前 Workflow 发布 `linux/amd64` 镜像；如果服务器是 ARM 架构，需要在 workflow 的 `platforms` 中增加 `linux/arm64` 并重新发布多架构镜像。

发布新版本：

```bash
git add .
git commit -m "release: v1.0.0"
git tag -a v1.0.0 -m "v1.0.0"
git push origin main
git push origin v1.0.0
```

Workflow 使用 GitHub Actions 自带的 `GITHUB_TOKEN` 写入 GHCR，不需要额外配置密码。仓库的 Actions 需要允许 workflow 写入 packages；如果仓库设置覆盖了 workflow 权限，请在 GitHub 的 Actions 设置中开启读写权限。

镜像只包含程序和运行环境，不把可变的 `videos/`、`posters/` 或 SQLite 数据库打进镜像。这样发布新版本不会覆盖服务器上的视频内容；首次导入和后续上传的数据保存在服务器的 Compose volume 中。

## 从 GHCR 镜像部署到服务器

服务器只需要安装 Docker Engine 和 Docker Compose Plugin，不需要安装 Node.js、npm 或 ffmpeg。准备以下文件和目录：

```text
docker-compose.yml
.env                         # 从 .env.docker.example 复制并修改
videos.json                  # 首次迁移旧内容时需要
videos/                      # 首次迁移旧内容时需要
posters/                     # 首次迁移旧内容时需要
```

先复制配置并填写镜像 tag：

```bash
cp .env.docker.example .env
# 当前仓库已预填 ghcr.io/frankjian/duo-study-* 镜像地址；发布其他版本时只需修改 tag
```

如果 GHCR 镜像是私有的，先登录：

```bash
echo "$CR_PAT" | docker login ghcr.io -u GITHUB_USERNAME --password-stdin
```

首次部署：

```bash
docker compose pull
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm run import:static
docker compose run --rm api npm run admin:create
docker compose up -d
```

`import:static` 可以重复执行，不会重复导入旧视频。`admin:create` 只在第一次没有管理员时执行。

发布新 tag 后升级：

```bash
# 先把 .env 中的 API_IMAGE、WEB_IMAGE 改成新的版本，例如 v1.1.0
docker compose pull
docker compose run --rm api npm run db:migrate
docker compose up -d
```

不要使用 `docker compose down -v`，否则会删除包含数据库、上传视频和封面的 `app_data` volume。生产环境应设置 `COOKIE_SECURE=true`，并在 HTTPS 反向代理后使用；当前 Compose 内部 Nginx 监听 HTTP 80 端口，可由服务器已有的 Nginx、Caddy 或云负载均衡负责 TLS。

常用检查：

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
curl http://127.0.0.1/api/health
```

本地运行数据可使用 `npm run backup` 生成带时间戳的备份目录；`npm run cleanup:trash` 会清理回收目录中超过 7 天的文件。

## 旧静态版本部署（迁移回滚用）

如果暂时不使用 Docker，仍可以只部署原来的静态版本，不需要 Node.js 或后端进程。

将以下文件和目录复制到 Nginx 或其他静态文件服务器的站点根目录：

- `index.html`
- `styles.css`
- `app.js`
- `videos.json`
- `favicon.svg`
- `posters/`
- `videos/`

站点根目录应能访问：

- `/videos.json`
- `/videos/unit1/...`
- `/videos/unit2/...`

Web 服务器需要支持 MP4 的 HTTP Range 请求，并按 UTF-8 处理 URL 和文件名。

## 视频和清单维护

视频文件统一位于 `videos/unit1/` 和 `videos/unit2/`，封面帧位于 `posters/unit1/` 和 `posters/unit2/`。新增或替换视频后，需要同步修改 `videos.json` 中对应的 `order`、`title`、`file` 和 `poster`。文件名必须与实际文件名完全一致，包括空格、中文标点和大小写。

封面图由 `ffmpeg` 从视频第 3 秒截取生成，当前统一为 360×640 的竖屏 JPG，并保留视频画面的完整比例。视频内容变化后需要重新生成对应封面。

重新生成全部封面：

```bash
bash scripts/generate-posters.sh
```

页面会在加载时按照 `order` 数字排序，因此 `1、2、……、10、11、12` 的顺序不会出错。
