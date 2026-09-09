/**
 * Real workerd gate for module-scope initialization in the actual Develop store.
 *
 * node scripts/check-workers-cold-start.mjs --workerd /path/to/workerd
 * Add --baseline-ref <commit> to require the old store to reproduce the global-I/O error first.
 *
 * Install/provide workerd separately; this script never installs packages, reads .env files,
 * builds the application, binds credentials, or touches a customer library. All generated
 * artifacts are confined to a fresh temporary directory, and worker egress is denied.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storePath = path.join(repository, "src/lib/develop/store.ts");
const GLOBAL_IO_ERROR =
  /Disallowed operation called within global scope|Some functionality.*generating random values.*only.*request handler/is;
const TIMEOUT_MS = 15_000;
const MAX_LOG_BYTES = 64 * 1024;

function argumentsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--workerd", "--baseline-ref"].includes(name) || !value)
      throw new Error("Use --workerd <binary> or --baseline-ref <commit>.");
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate argument ${name}.`);
    options[name] = value;
  }
  if (options["--baseline-ref"] && !/^[a-f0-9]{7,40}$/i.test(options["--baseline-ref"]))
    throw new Error("The baseline must be an explicit hexadecimal commit ID.");
  return options;
}

function installedWorkerd() {
  try {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve("workerd/package.json")), "bin/workerd");
  } catch {
    throw new Error("workerd is not installed here. Provide its binary with --workerd <path>.");
  }
}

async function bundleStore(destination, baselineRef) {
  const baseline = baselineRef
    ? execFileSync("git", ["show", `${baselineRef}:src/lib/develop/store.ts`], {
        cwd: repository,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      })
    : undefined;
  await build({
    stdin: {
      contents: `import * as store from "./src/lib/develop/store.ts";
export default {
  fetch() {
    const document = store.createDevelopDocument("workers-cold-start-fixture");
    return Response.json({
      exports: Object.keys(store).length,
      photoId: document.photoId,
      historyId: document.history[0].id,
      historyCount: document.history.length,
    });
  },
};`,
      resolveDir: repository,
      sourcefile: "workers-cold-start-entry.ts",
      loader: "ts",
    },
    outfile: destination,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    define: { "import.meta.hot": "undefined" },
    logLevel: "silent",
    plugins: baseline
      ? [
          {
            name: "read-only-store-baseline",
            setup(builder) {
              builder.onLoad({ filter: /[\\/]src[\\/]lib[\\/]develop[\\/]store\.ts$/ }, (args) =>
                path.resolve(args.path) === storePath
                  ? { contents: baseline, loader: "ts", resolveDir: path.dirname(storePath) }
                  : undefined,
              );
            },
          },
        ]
      : [],
  });
}

async function runWorker(workerd, directory) {
  const config = path.join(directory, "worker.capnp");
  await writeFile(
    config,
    `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "probe", worker = (
      modules = [(name = "worker.mjs", esModule = embed "worker.mjs")],
      compatibilityDate = "2026-09-03"
    )),
    (name = "internet", network = (allow = []))
  ],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "probe")]
);
`,
  );
  const child = spawn(workerd, ["serve", "--control-fd=3", config], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    // No application credentials or environment configuration enter the runtime process.
    env: { PATH: process.env.PATH ?? "" },
  });
  let log = "";
  const capture = (chunk) => {
    log = (log + chunk.toString()).slice(-MAX_LOG_BYTES);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const exit = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  let timeout;
  try {
    const port = await new Promise((resolve, reject) => {
      const fail = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      child.once("error", fail);
      child.once("exit", (code) => fail(new Error(`workerd exited before listening (${code}).`)));
      timeout = setTimeout(() => fail(new Error("workerd cold start timed out.")), TIMEOUT_MS);
      let pending = "";
      child.stdio[3].on("data", (chunk) => {
        pending += chunk.toString();
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines) {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.event === "listen" && event.socket === "http" && Number.isInteger(event.port)) {
            clearTimeout(timeout);
            resolve(event.port);
          }
        }
      });
    });
    const proofs = [];
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await response.text();
      assert.equal(
        response.status,
        200,
        `Worker GET / returned ${response.status}: ${body.slice(0, 500)}`,
      );
      const proof = JSON.parse(body);
      assert.equal(proof.photoId, "workers-cold-start-fixture");
      assert.equal(proof.historyCount, 1);
      assert.ok(proof.exports > 0);
      assert.match(
        proof.historyId,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
      );
      proofs.push(proof);
    }
    assert.notEqual(proofs[0].historyId, proofs[1].historyId);
    return { ok: true, proofs, log };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), log };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
      await exit;
      clearTimeout(kill);
    }
  }
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  const workerd = options["--workerd"] ?? installedWorkerd();
  const version = execFileSync(workerd, ["--version"], { encoding: "utf8" }).trim();
  console.log(`Runtime: ${version}`);
  const directory = await mkdtemp(path.join(tmpdir(), "foto-workers-cold-start-"));
  const workerFile = path.join(directory, "worker.mjs");
  try {
    if (options["--baseline-ref"]) {
      await bundleStore(workerFile, options["--baseline-ref"]);
      const baseline = await runWorker(workerd, directory);
      assert.equal(
        baseline.ok,
        false,
        "Baseline unexpectedly passed; the regression was not reproduced.",
      );
      assert.match(
        baseline.log,
        GLOBAL_IO_ERROR,
        `Baseline failed for an unrelated reason: ${baseline.error}\n${baseline.log}`,
      );
      console.log(
        `PASS baseline ${options["--baseline-ref"]}: actual workerd rejected module-scope I/O.`,
      );
      console.log(baseline.log.trim());
    }
    await bundleStore(workerFile);
    const result = await runWorker(workerd, directory);
    assert.ok(result.ok, `Workers cold-start gate failed: ${result.error}\n${result.log}`);
    console.log(
      "PASS actual store cold start; two requests created distinct valid document UUIDs without storage access.",
    );
  } finally {
    // Only the exact temporary directory allocated by this invocation is removed.
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
