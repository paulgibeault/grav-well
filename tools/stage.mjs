// Stage the deploy artifact: tracked files minus the dev set.
//
// The only per-app file in the fleet staging trio (GAME_INTEGRATION.md §13a):
// tools/verify-artifact.mjs and tools/inject-precache.mjs are byte-identical
// fleet copies and must never be edited here.
//
// ONE implementation, two callers — the deploy job runs it to build dist/,
// and tools/verify-artifact.mjs runs it into a temp dir to prove the
// result contains everything the game asks for at runtime. That shared
// origin is the point: a staging rule the tests don't exercise is a rule
// that goes stale in silence, which is how a published site ends up missing
// a directory nobody noticed.
//
// Usage: node tools/stage.mjs <outDir>
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectPrecache } from "./inject-precache.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Published, deliberately not precached. This is the only knob on the
// generated list (tools/inject-precache.mjs), and it is reviewed rather than
// silent: tools/verify-artifact.mjs fails the build on any published file that
// is neither cached nor named here.
//
// The audition diagnostic and its config, the frozen chiptune archive kept as
// provenance, the SVG sources the art was drawn from, and the licence text.
export const PRECACHE_EXCLUDE = [
  // Published, deliberately not part of the offline shell. verify-artifact.mjs
  // fails the build on any published file that is neither precached nor named
  // here, so an omission is a decision someone wrote down rather than one
  // nobody noticed.
  //
  // The sound-pack audition timeline and its config are a design diagnostic —
  // they ship so the pack can be re-auditioned from the published site, but no
  // player ever needs them offline.
  "audio/audition.js",
  "soundpack.config.json",
  "LICENSE",
];


// Dev-only: tooling, tests, notes, and local helpers. Everything else a repo
// tracks is game content and ships.
const EXCLUDE_DIRS = new Set([".github", ".claude", "node_modules",
  "tests", "test", "docs", "scratch", "tools", "scripts"]);
const EXCLUDE_ROOT = new Set(["package.json", "package-lock.json",
  ".gitignore", "go.sh", "ago"]);
const EXCLUDE_EXT = new Set([".md", ".py", ".pid"]);

export function isDevOnly(f) {
  return EXCLUDE_DIRS.has(f.split("/")[0]) ||
    (!f.includes("/") && EXCLUDE_ROOT.has(f)) ||
    (!f.includes("/") && /^test_/.test(f)) ||
    EXCLUDE_EXT.has(path.extname(f));
}

/** Stage into outDir and return it. */
export function stage(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const files = execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);
  let staged = 0;
  for (const f of files) {
    if (isDevOnly(f)) continue;
    fs.mkdirSync(path.join(outDir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(outDir, f));
    staged++;
  }
  // Last, so it sees the finished artifact — the precache list is written from
  // what is actually about to deploy, not from what anyone believes is.
  injectPrecache(outDir, { exclude: PRECACHE_EXCLUDE });
  return { outDir, staged, total: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node tools/stage.mjs <outDir>"); process.exit(1); }
  const r = stage(path.resolve(ROOT, out));
  console.log(`staged ${r.staged} files to ${out}/ (${r.total - r.staged} dev files excluded)`);
}
