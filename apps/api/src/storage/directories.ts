import fs from "node:fs";
import { mediaDirs } from "../config.js";

export function ensureMediaDirectories() {
  for (const directory of Object.values(mediaDirs)) {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  }
}
