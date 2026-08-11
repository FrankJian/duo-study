import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { db, closeDatabase, isDatabaseMigrated } from "../db/client.js";
import { users } from "../db/schema.js";
import { normalizeUsername } from "../auth/session.js";

async function readSecret(prompt: string) {
  output.write(prompt);
  if (!input.isTTY || !output.isTTY) {
    throw new Error("create-admin 需要在交互式终端中运行，密码不会从参数读取");
  }
  input.setRawMode(true);
  input.resume();
  return await new Promise<string>((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");
      if (char === "\u0003") process.exit(130);
      if (char === "\r" || char === "\n") {
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        output.write("\n");
        resolve(value);
      } else if (char === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    input.on("data", onData);
  });
}

const rl = createInterface({ input, output });
try {
  if (!isDatabaseMigrated()) throw new Error("数据库尚未迁移，请先运行 npm run db:migrate");
  const username = normalizeUsername(await rl.question("管理员用户名: "));
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new Error("用户名需为 3-64 位小写字母、数字或 ._- 字符");
  if (db.select().from(users).where(eq(users.username, username)).get()) throw new Error("用户名已经存在");
  const password = await readSecret("管理员密码（不会显示）: ");
  const confirm = await readSecret("再次输入密码: ");
  if (password.length < 12 || password !== confirm) throw new Error("密码至少 12 位，且两次输入必须一致");
  const now = new Date();
  db.insert(users).values({
    id: randomUUID(),
    username,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  console.log(`管理员 ${username} 创建成功`);
} finally {
  rl.close();
  closeDatabase();
}
