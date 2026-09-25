import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "extensions", "test"];
const banned = ["eval(", "any>"];
let failed = false;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

for (const root of roots) {
  for (const file of await walk(root)) {
    const text = await readFile(file, "utf8");
    for (const token of banned) {
      if (text.includes(token)) {
        process.stderr.write(`${file} contains ${token}\n`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
process.stdout.write("lint ok\n");
