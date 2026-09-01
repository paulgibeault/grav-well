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
import { createHash } from "node:crypto";
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

/* The three vendored fleet files (GAME_INTEGRATION.md §7c, §13a): never edit
 * the copy — change the canonical file in the launcher repo and re-copy. A
 * local edit forks this game's seed streams or its deploy verification in
 * silence, so the drift is worth failing a build over.
 *
 * THIS GATE USED TO BE UNABLE TO FAIL. It compared each file against a hard
 * coded absolute path in a specific developer's home directory
 * (`/home/user/moon-lit/...`), skipped every file whose canonical copy was
 * missing, and then asserted `checked >= 0` — which is true of a count. On CI
 * and in any fresh clone nothing was compared and the test passed while
 * enforcing nothing at all.
 *
 * The repair is a digest checked into this file. It cannot prove the copy
 * matches the canonical original — nothing in this repo can, the original is
 * not here — but it catches the failure the comment actually describes: an
 * accidental local edit, on every machine including CI. Re-copying a genuinely
 * updated fleet file is then a deliberate two-line change here, which is the
 * review the old gate was pretending to be.
 *
 * To update after a legitimate re-copy:
 *   shasum -a 256 js/arcade-rng.js tools/verify-artifact.mjs tools/inject-precache.mjs
 */
const VENDORED = {
    "js/arcade-rng.js":
        "385a78da7c74007b621545334bb14e00fbcd3d1a5c79d6d47682ec7277d03cb2",
    "tools/verify-artifact.mjs":
        "f89e40d579a1f85dd5402279bda444ad71861b9db794e3f45ba4ebbe536aa412",
    "tools/inject-precache.mjs":
        "7a8371071220cbfe8c281a67ff44b5685c7b2e8afb8c829137c70884fb9808e3",
};

test("the vendored fleet files have not been edited in place", () => {
    for (const [local, want] of Object.entries(VENDORED)) {
        const full = path.join(ROOT, local);
        assert.ok(fs.existsSync(full), `${local} is missing`);
        const got = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        assert.strictEqual(got, want,
            `${local} has been edited. It is fleet property: change the canonical ` +
            "file in the launcher repo, re-copy it here, and update the digest in " +
            "tests/repo-gates.test.js.");
    }
});

test("the vendored fleet files match the canonical copies, when those are reachable", () => {
    /* The real check, when a fleet checkout is actually present. Opt-in through
     * the environment rather than guessed at from a home directory: point
     * ARCADE_FLEET_ROOT at the launcher checkout and this compares bytes.
     * Absent — which is the case on CI and in a fresh clone — it says so and
     * leaves the digest gate above as the floor, instead of silently passing
     * while checking nothing. */
    const root = process.env.ARCADE_FLEET_ROOT;
    if (!root || !fs.existsSync(root)) {
        assert.ok(true, "no ARCADE_FLEET_ROOT: digest gate is the floor here");
        return;
    }
    const canonical = {
        "js/arcade-rng.js": "arcade-rng.js",
        "tools/verify-artifact.mjs": "tools/verify-artifact.mjs",
        "tools/inject-precache.mjs": "tools/inject-precache.mjs",
    };
    for (const [local, rel] of Object.entries(canonical)) {
        const src = path.join(root, rel);
        if (!fs.existsSync(src)) continue;
        assert.strictEqual(
            fs.readFileSync(path.join(ROOT, local), "utf8"),
            fs.readFileSync(src, "utf8"),
            `${local} has drifted from ${src}`);
    }
});
