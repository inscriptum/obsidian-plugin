import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const AVD = process.env.ANDROID_AVD ?? "Pixel_10";
const SERIAL = process.env.ANDROID_SERIAL ?? "emulator-5554";
const PACKAGE = process.env.ANDROID_PACKAGE ?? "md.obsidian";
const VAULT_PATH = process.env.ANDROID_VAULT_PATH ?? "/sdcard/Documents/TestVault";
const CDP_PORT = process.env.ANDROID_CDP_PORT ?? "9224";
const PLUGIN_ID = "inscriptum";
const localPluginDir = join(process.cwd(), ".obsidian", "plugins", PLUGIN_ID);
const remotePluginDir = `${VAULT_PATH}/.obsidian/plugins/${PLUGIN_ID}`;

const ADB = process.env.ADB ?? "adb";
const EMULATOR = process.env.EMULATOR ?? "emulator";

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

function adb(args, options = {}) {
  return run(ADB, ["-s", SERIAL, ...args], options);
}

function adbWithoutSerial(args, options = {}) {
  return run(ADB, args, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, check, timeoutMs = 180_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function isDeviceOnline() {
  try {
    return adbWithoutSerial(["devices"])
      .split("\n")
      .some((line) => line.startsWith(`${SERIAL}\tdevice`));
  } catch {
    return false;
  }
}

async function ensureEmulator() {
  if (!isDeviceOnline()) {
    console.log(`[android] Starting AVD ${AVD}...`);
    const child = spawn(
      EMULATOR,
      ["-avd", AVD, "-no-boot-anim"],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  } else {
    console.log(`[android] Using running device ${SERIAL}`);
  }

  await waitFor("Android device", () => isDeviceOnline());
  await waitFor("Android boot", () => {
    try {
      return adb(["shell", "getprop", "sys.boot_completed"]) === "1";
    } catch {
      return false;
    }
  });
}

function build() {
  console.log("[android] Building plugin...");
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });

  if (!existsSync(localPluginDir)) {
    throw new Error(`Build output not found: ${localPluginDir}`);
  }
}

function copyPlugin() {
  console.log(`[android] Copying plugin to ${remotePluginDir}...`);
  adb(["shell", "mkdir", "-p", remotePluginDir]);
  adb(["push", `${localPluginDir}/.`, `${remotePluginDir}/`], { stdio: "inherit" });
}

function restartObsidian() {
  console.log(`[android] Starting ${PACKAGE}...`);
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb([
    "shell",
    "monkey",
    "-p",
    PACKAGE,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ], { stdio: "inherit" });
}

async function forwardDevtools() {
  const pid = await waitFor("Obsidian process", () => {
    try {
      return adb(["shell", "pidof", PACKAGE]).split(/\s+/)[0] || false;
    } catch {
      return false;
    }
  });

  const socket = await waitFor("Android WebView DevTools socket", () => {
    const unixSockets = adb(["shell", "cat", "/proc/net/unix"]);
    const match = unixSockets.match(new RegExp(`@webview_devtools_remote_${pid}\\b`));
    return match ? match[0].slice(1) : false;
  });

  try {
    adbWithoutSerial(["forward", "--remove", `tcp:${CDP_PORT}`]);
  } catch {
    // There may be no previous forward.
  }
  adbWithoutSerial(["-s", SERIAL, "forward", `tcp:${CDP_PORT}`, `localabstract:${socket}`]);

  await waitFor("CDP endpoint", async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  });

  const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json());
  console.log(`[android] WebView PID: ${pid}`);
  console.log(`[android] DevTools socket: ${socket}`);
  console.log(`[android] CDP endpoint: http://127.0.0.1:${CDP_PORT}`);
  console.log(`[android] Browser: ${version.Browser}`);
  console.log("");
  console.log("Use this MCP endpoint while debugging Android:");
  console.log(`  --cdp-endpoint=http://localhost:${CDP_PORT}`);
}

await ensureEmulator();
build();
copyPlugin();
restartObsidian();
await forwardDevtools();
