import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type VideoProbe = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
};

export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(config.ffprobeBin, [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,duration:format=duration",
    "-of", "json",
    filePath,
  ], { maxBuffer: 1024 * 1024 });
  const payload = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  const audio = payload.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(video?.duration ?? payload.format?.duration);
  return {
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

export async function generatePoster(videoPath: string, posterPath: string) {
  fs.mkdirSync(path.dirname(posterPath), { recursive: true });
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", "3", "-i", videoPath,
    "-frames:v", "1",
    "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
    "-c:v", "libwebp", "-quality", "82", posterPath,
  ];
  try {
    await execFileAsync(config.ffmpegBin, args, { maxBuffer: 1024 * 1024 });
  } catch {
    await execFileAsync(config.ffmpegBin, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", "0.1", "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
      "-c:v", "libwebp", "-quality", "82", posterPath,
    ], { maxBuffer: 1024 * 1024 });
  }
  return fs.existsSync(posterPath);
}
