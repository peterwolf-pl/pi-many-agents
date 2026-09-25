import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProtocolMessage } from "../types.ts";

export class JsonlLogger {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async write(record: ProtocolMessage | Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
