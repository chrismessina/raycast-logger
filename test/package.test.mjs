import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

// What actually ships. `files` in package.json is the allowlist that keeps
// private material out of the tarball, and 1.5.0 stopped shipping source maps
// (they carried no sourcesContent and pointed at ../src, which is not packed).
// No test inspected the tarball before this one; CI only ran a dry run.
test("package: the tarball ships dist without maps or private files", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }));
  const files = pack.files.map((f) => f.path);
  assert.ok(files.includes("dist/index.js"), files.join("\n"));
  assert.ok(files.includes("dist/index.d.ts"), files.join("\n"));
  // README, LICENSE and package.json ship regardless of `files`; CHANGELOG and
  // SECURITY do not, and CHANGELOG had never shipped before 1.5.0.
  for (const doc of ["package.json", "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md"]) {
    assert.ok(files.includes(doc), `${doc} must ship: ${files.join(", ")}`);
  }
  const maps = files.filter((f) => f.endsWith(".map"));
  assert.deepEqual(maps, [], `source maps must not ship: ${maps.join(", ")}`);
  const priv = files.filter((f) => f.startsWith(".github/") || f.includes("/.private/"));
  assert.deepEqual(priv, [], `private files must not ship: ${priv.join(", ")}`);
});
