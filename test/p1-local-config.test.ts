import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, DEFAULT_OLLAMA_CONFIG, DEFAULT_MISTRAL_CONFIG, loadConfig } from "../src/config/config.ts";

test("P1: local models configuration has clear typed defaults", () => {
  assert.equal(DEFAULT_OLLAMA_CONFIG.baseUrl, "http://127.0.0.1:11434");
  assert.equal(DEFAULT_OLLAMA_CONFIG.model, undefined, "Qwen4 tag must not be assumed without confirmation");

  assert.equal(DEFAULT_MISTRAL_CONFIG.baseUrl, "http://127.0.0.1:12434/engines/v1");
  assert.equal(DEFAULT_MISTRAL_CONFIG.model, "ai/mistral");

  assert.deepEqual(DEFAULT_CONFIG.ollama, DEFAULT_OLLAMA_CONFIG);
  assert.deepEqual(DEFAULT_CONFIG.mistral, DEFAULT_MISTRAL_CONFIG);
});

test("P1: loadConfig merges partial local model options safely", async () => {
  const config = await loadConfig("non-existent-config-file.json");
  assert.equal(config.mistral.baseUrl, "http://127.0.0.1:12434/engines/v1");
  assert.equal(config.mistral.model, "ai/mistral");
  assert.equal(config.ollama.baseUrl, "http://127.0.0.1:11434");
});
