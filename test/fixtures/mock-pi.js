#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.exit(0);
}
const raw = process.argv.join(" ");
if (raw.includes("sleep:500") || raw.includes("hang")) {
  setTimeout(() => {}, 5000);
} else {
  console.log(
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: '```json\n{"status":"completed","summary":"daemon test ok","findings":[]}\n```',
      },
    })
  );
}
