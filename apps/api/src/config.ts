import path from "node:path";

const cwd = path.resolve(process.cwd());
const rootDir = path.basename(cwd) === "api" && path.basename(path.dirname(cwd)) === "apps"
  ? path.resolve(cwd, "../..")
  : cwd;
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(rootDir, "data"));

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3000),
  dbPath: path.resolve(process.env.DB_PATH ?? path.join(dataDir, "app.db")),
  dataDir,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 7),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  maxVideoBytes: Number(process.env.MAX_VIDEO_BYTES ?? 2 * 1024 * 1024 * 1024),
  maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 10 * 1024 * 1024),
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
  ffprobeBin: process.env.FFPROBE_BIN ?? "ffprobe",
};

export const mediaDirs = {
  uploads: path.join(config.dataDir, "uploads"),
  videos: path.join(config.dataDir, "media", "videos"),
  posters: path.join(config.dataDir, "media", "posters"),
  trash: path.join(config.dataDir, "trash"),
};
