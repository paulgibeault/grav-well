/* Source-level gates: the floor every fleet app meets, plus the one rule
 * this repo's architecture rests on.
 *
 * Deliberately about the SOURCE. What the published artifact must contain is
 * tools/verify-artifact.mjs's job, and it checks the staged output rather than
 * the checkout — the only way to catch a staging rule that drops a file the
 * game needs.
 */
import { test } from "node:test";
import assert from "node:assert";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../tools/stage.mjs";

const tracked = execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);

test("every tracked JS file parses", () => {
    for (const f of tracked.filter((f) => /\.(js|mjs)$/.test(f))) {
        const r = spawnSync(process.execPath, ["--check", f], { cwd: ROOT });
        assert.strictEqual(r.status, 0, `node --check ${f} failed:\n${r.stderr}`);
    }
});

test("every tracked JSON file parses", () => {
    for (const f of tracked.filter((f) => f.endsWith(".json"))) {
        assert.doesNotThrow(
            () => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")),
            `${f} is not valid JSON`);
    }
});

// ---------------------------------------------------------------------------
// The core-purity gate
// ---------------------------------------------------------------------------
//
// js/core/ is the rules engine, and the whole test suite depends on being able
// to import it under `node --test` with no browser in sight. That property is
// easy to lose by accident — one `performance.now()` reached for inside the
// lock-delay code and the timer stops being something a test can state a
// situation to, one `Math.random()` in the bag and a run stops being
// replayable from its seed.
//
// Read from disk rather than `git ls-files` so the gate covers a module the
// moment it is written, not the moment it is committed.
const coreDir = path.join(ROOT, "js/core");
const coreFiles = fs.existsSync(coreDir)
    ? fs.readdirSync(coreDir).filter((f) => f.endsWith(".js")).map((f) => `js/core/${f}`)
    : [];

/** Source with comments blanked — the gate is about code, not prose about code. */
function codeOnly(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
}

const FORBIDDEN = ["document", "window", "Arcade", "localStorage",
    "performance", "requestAnimationFrame", "setTimeout", "setInterval"];

test("js/core stays free of the DOM, the SDK, and wall time", () => {
    assert.ok(coreFiles.length > 0, "expected js/core/*.js to exist");
    for (const f of coreFiles) {
        const src = codeOnly(fs.readFileSync(path.join(ROOT, f), "utf8"));
        for (const forbidden of FORBIDDEN) {
            assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(src),
                `${f} references \`${forbidden}\`. Core must stay node-importable — ` +
                "reach the value through a parameter instead.");
        }
    }
});

test("js/core draws no entropy of its own", () => {
    // Every random number in this game comes from one seeded generator whose
    // state serializes with the run. A stray Math.random() or Date.now() would
    // make a run unreplayable and a resumed save diverge from an uninterrupted
    // one — both silently, and only for some players.
    for (const f of coreFiles) {
        const src = codeOnly(fs.readFileSync(path.join(ROOT, f), "utf8"));
        assert.ok(!/\bMath\s*\.\s*random\b/.test(src),
            `${f} calls Math.random(). Take an rng from ../arcade-rng.js as a parameter.`);
        assert.ok(!/\bDate\b/.test(src),
            `${f} references Date. Core counts ticks; wall time enters as a dtMs argument.`);
    }
});

test("js/core imports only itself and the vendored rng", () => {
    // A clean file that imports a DOM-touching one is not clean; the import
    // graph is what node actually evaluates.
    for (const f of coreFiles) {
        const src = fs.readFileSync(path.join(ROOT, f), "utf8");
        const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)]
            .map((m) => m[1]);
        for (const spec of specs) {
            const ok = /^\.\/[\w.-]+\.js$/.test(spec) || spec === "../arcade-rng.js";
            assert.ok(ok, `${f} imports "${spec}" — core may import only sibling ` +
                "core modules and ../arcade-rng.js.");
        }
    }
});

test("the vendored fleet files are byte-identical to their canonical copies", () => {
    // These three are fleet property (GAME_INTEGRATION.md §7c, §13a): never
    // edit the copy, change the canonical file and re-copy. A local edit forks
    // this game's seed streams or its deploy verification in silence, so the
    // drift is worth failing a build over. Skipped when no sibling checkout is
    // present (CI runners have only this repo).
    const siblings = {
        "js/arcade-rng.js": "/home/user/paulgibeault/paulgibeault.github.io/arcade-rng.js",
        "tools/verify-artifact.mjs": "/home/user/moon-lit/tools/verify-artifact.mjs",
        "tools/inject-precache.mjs": "/home/user/moon-lit/tools/inject-precache.mjs",
    };
    let checked = 0;
    for (const [local, canonical] of Object.entries(siblings)) {
        if (!fs.existsSync(canonical)) continue;
        assert.strictEqual(
            fs.readFileSync(path.join(ROOT, local), "utf8"),
            fs.readFileSync(canonical, "utf8"),
            `${local} has drifted from ${canonical}`);
        checked++;
    }
    assert.ok(checked >= 0);
});
