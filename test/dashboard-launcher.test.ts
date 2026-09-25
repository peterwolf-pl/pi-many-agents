import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { posixEscape, launchDashboard, isDarwin } from "../src/dashboard/launcher.ts";

describe("dashboard launcher", () => {
  it("posixEscape wraps in single quotes and escapes embedded single quotes", () => {
    assert.equal(posixEscape(""), "''");
    assert.equal(posixEscape("hello"), "'hello'");
    assert.equal(posixEscape("hello world"), "'hello world'");
    assert.equal(posixEscape("it's cool"), "'it'\\''s cool'");
    assert.equal(posixEscape("/path/to/my project/bin"), "'/path/to/my project/bin'");
  });

  it("launchDashboard with inline=true always bypasses launcher", () => {
    const res = launchDashboard({ inline: true });
    assert.equal(res.launched, false);
    assert.equal(res.inline, true);
  });

  it("isDarwin returns boolean matching process.platform", () => {
    assert.equal(isDarwin(), process.platform === "darwin");
  });
});
