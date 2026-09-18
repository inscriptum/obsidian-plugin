// npm run ios:debug — the iOS counterpart of scripts/android-debug.mjs.
//
// Builds the plugin and copies it into an Obsidian vault that reaches the
// iOS app. There is no CDP socket to forward on iOS, so debugging goes
// through Safari's Web Inspector.
//
// Primary setup: a real iPhone/iPad with a vault stored in iCloud. Plugin
// files are copied into ~/Library/Mobile Documents/iCloud~md~obsidian/
// Documents/... and iCloud syncs them to the device; reopen Obsidian there
// by hand. Interactive keyboard testing from the Mac: iPhone Mirroring
// (iPhone with iOS 18+ — the mirrored screen shows the real software
// keyboard; iPad is not supported by Mirroring).
//
// Running the iOS app on the Mac itself (sideload via Apple Configurator)
// was tried and does NOT work for Obsidian: Apple blocks App Store apps
// whose developer has not opted in to Apple Silicon availability — `open`
// fails with "The application cannot be opened because it has an incorrect
// executable format". The launch code path is kept behind IOS_OBSIDIAN_APP
// in case that ever changes (or for an opted-in app).
//
// iCloud vaults are never scanned automatically: listing iCloud folders can
// stall indefinitely in the file provider, and that stall even hangs
// process.exit() (libuv joins its threadpool before exiting). Name the vault
// with IOS_VAULT_NAME or pass the full path via IOS_VAULT_PATH instead.
//
// Environment overrides:
//   IOS_OBSIDIAN_APP  path to the iOS Obsidian .app bundle (see note above)
//   IOS_VAULT_PATH    exact path to the vault (skips auto-detection)
//   IOS_VAULT_NAME    vault folder name (app container and iCloud)
//   IOS_PLUGIN_ID     plugin id, default "inscriptum"

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PLUGIN_ID = process.env.IOS_PLUGIN_ID ?? "inscriptum";
const APP_OVERRIDE = process.env.IOS_OBSIDIAN_APP ?? "";
const VAULT_OVERRIDE = process.env.IOS_VAULT_PATH ?? "";
const VAULT_NAME = process.env.IOS_VAULT_NAME ?? "";
// Per-deploy marker baked into the build (EDITOR_VERSION suffix). It shows in
// the toolbar of debug builds, is logged to the browser console on note open
// and is part of the custom element tag names — the only reliable way to
// confirm which exact build the device is running.
const BUILD_TAG = `ios-${Date.now().toString(36)}`;
const APP_CONTAINER_DOCS = join(
  homedir(),
  "Library",
  "Containers",
  "md.obsidian",
  "Data",
  "Documents",
);
const ICLOUD_DOCS = join(
  homedir(),
  "Library",
  "Mobile Documents",
  "iCloud~md~obsidian",
  "Documents",
);
const APP_CANDIDATES = [
  join(homedir(), "Applications", "Obsidian.app"),
  "/Applications/Obsidian.app",
];
const localPluginDir = join(process.cwd(), ".obsidian", "plugins", PLUGIN_ID);

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(`[ios] ${message}`);
  process.exit(1);
}

function readInfoPlist(appPath) {
  for (const plist of [
    join(appPath, "Contents", "Info.plist"),
    join(appPath, "Info.plist"),
  ]) {
    if (!existsSync(plist)) continue;
    try {
      return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", plist]));
    } catch {
      return null;
    }
  }
  return null;
}

// The macOS Electron app shares the "Obsidian.app" name and bundle id, so
// identify the iOS build by its platform markers instead.
function isIosBundle(appPath) {
  const info = readInfoPlist(appPath);
  if (!info) return false;
  if (info.LSRequiresIPhoneOS === true) return true;
  if (info.DTPlatformName === "iphoneos") return true;
  return (info.CFBundleSupportedPlatforms ?? []).includes("iPhoneOS");
}

function findIosApp() {
  if (APP_OVERRIDE) {
    if (!existsSync(APP_OVERRIDE)) {
      fail(`IOS_OBSIDIAN_APP points to a missing path: ${APP_OVERRIDE}`);
    }
    if (!isIosBundle(APP_OVERRIDE)) {
      fail(
        `${APP_OVERRIDE} is not an iOS app bundle. That is probably the macOS ` +
          "Electron app — ios:debug needs the iOS build (see the script header " +
          "for setup instructions).",
      );
    }
    return APP_OVERRIDE;
  }

  for (const candidate of APP_CANDIDATES) {
    if (existsSync(candidate) && isIosBundle(candidate)) return candidate;
  }
  return null;
}

// Only local folders are listed here. Never point this at iCloud — a stalled
// file provider blocks the listing (and the process exit) forever.
function listVaultDirs(root) {
  if (!existsSync(root)) return [];

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn(`[ios] Could not list ${root}: ${error.message}`);
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, entry.name, ".obsidian")),
    )
    .map((entry) => join(root, entry.name));
}

function chooseVault() {
  if (VAULT_OVERRIDE) {
    if (!existsSync(VAULT_OVERRIDE)) {
      fail(`IOS_VAULT_PATH points to a missing path: ${VAULT_OVERRIDE}`);
    }
    return { path: VAULT_OVERRIDE, where: "override" };
  }

  const vaults = listVaultDirs(APP_CONTAINER_DOCS).map((path) => ({
    path,
    where: "app container",
  }));

  // A single stat on a named iCloud folder is safe; listing the folder is not.
  if (VAULT_NAME) {
    const iCloudVault = join(ICLOUD_DOCS, VAULT_NAME);
    if (existsSync(join(iCloudVault, ".obsidian"))) {
      vaults.push({ path: iCloudVault, where: "iCloud" });
    }
  }

  if (vaults.length === 0) {
    fail(
      (VAULT_NAME
        ? `No vault named "${VAULT_NAME}" in the app container or iCloud.\n\n`
        : "") + setupGuide(),
    );
  }
  if (vaults.length === 1) return vaults[0];

  const listed = vaults
    .map((vault) => `${basename(vault.path)} (${vault.where})`)
    .join(", ");
  if (!VAULT_NAME) {
    fail(`Several vaults found: ${listed}. Set IOS_VAULT_NAME to pick one.`);
  }
  const match = vaults.find((vault) => basename(vault.path) === VAULT_NAME);
  if (!match) fail(`No vault named "${VAULT_NAME}" (found: ${listed}).`);
  return match;
}

function setupGuide() {
  return [
    "No iOS vault found to deploy the plugin into.",
    "",
    "The deploy target is the Obsidian iCloud container — iCloud syncs the",
    "plugin to your iPhone/iPad. Create a vault stored in iCloud in Obsidian",
    "on the device first (an existing local vault can be moved to iCloud via",
    "the vault menu), then point the script at it:",
    "",
    "  IOS_VAULT_NAME=<VaultName> npm run ios:debug",
    "",
    "or pass the full path:",
    '  IOS_VAULT_PATH="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/<VaultName>" npm run ios:debug',
    "",
    "Workflow after a deploy: give iCloud a minute to sync, reopen Obsidian",
    "on the device and check the plugin. Keyboard behavior: test on the",
    "device, or via iPhone Mirroring (iPhone with iOS 18+ — the mirrored",
    "screen shows the real software keyboard). DOM/console debugging:",
    "connect the device by cable, then Safari > Develop > <the device>.",
    "",
    "Note: running the iOS app on the Mac itself (sideload via Apple",
    "Configurator) is blocked by Apple for Obsidian — open fails with",
    '"incorrect executable format" because the developer has not opted in',
    "to Apple Silicon availability.",
  ].join("\n");
}

function build() {
  const { version } = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  );
  console.log(`[ios] Building plugin (build tag: ${BUILD_TAG})...`);
  execFileSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: { ...process.env, INSCRIPTUM_BUILD_TAG: BUILD_TAG },
  });

  if (!existsSync(localPluginDir)) {
    fail(`Build output not found: ${localPluginDir}`);
  }
  console.log(
    `[ios] Verify on device: toolbar shows "${BUILD_TAG}", console logs ` +
      `[inscriptum] build: ${version}-${BUILD_TAG}, custom element tags end ` +
      `with -${version}-${BUILD_TAG}.`,
  );
}

function copyPlugin(vaultPath) {
  const remotePluginDir = join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);
  console.log(`[ios] Copying plugin to ${remotePluginDir}...`);
  mkdirSync(remotePluginDir, { recursive: true });
  cpSync(localPluginDir, remotePluginDir, { recursive: true });
}

function runningPids(appPath) {
  try {
    const out = run("pgrep", ["-f", appPath]);
    return out ? out.split("\n").map(Number) : [];
  } catch {
    return [];
  }
}

async function quitApp(appPath) {
  let pids = runningPids(appPath);
  if (pids.length === 0) return;

  console.log(`[ios] Stopping Obsidian (pid ${pids.join(", ")})...`);
  for (const pid of pids) process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 20; attempt++) {
    pids = runningPids(appPath);
    if (pids.length === 0) return;
    await sleep(500);
  }
  console.log("[ios] Obsidian did not quit in time, killing it...");
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  await sleep(500);
}

function launchApp(appPath) {
  console.log(`[ios] Starting ${appPath}...`);
  execFileSync("open", [appPath]);
}

function enableSafariDevelopMenu() {
  try {
    execFileSync(
      "defaults",
      ["write", "com.apple.Safari", "IncludeDevelopMenu", "-bool", "true"],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function printDebugInstructions(where) {
  const enabled = enableSafariDevelopMenu();
  console.log("");
  console.log("Debugging (no CDP socket on iOS — use Safari Web Inspector):");
  if (enabled) {
    console.log("  Safari Develop menu has been enabled for you.");
  } else {
    console.log(
      "  Enable it first: Safari > Settings > Advanced > Show Develop menu.",
    );
  }
  if (where === "app") {
    console.log(
      "  Then: Safari > Develop > <this Mac> > Obsidian > the WebView.",
    );
  } else {
    console.log(
      "  Connect the iPhone/iPad by cable, then Safari > Develop > " +
        "<the device> > Obsidian.",
    );
  }
  console.log(
    "  If Obsidian never shows up there, the release build is not inspectable —",
  );
  console.log(
    "  in that case validate the plugin functionally (notes, editor, menus).",
  );
}

const app = findIosApp();
const vault = chooseVault();

if (!app) {
  if (vault.where === "app container") {
    fail(
      "Found a vault inside the app container, but no iOS Obsidian app to " +
        "launch it. Sideload the app (see the script header) or set " +
        "IOS_OBSIDIAN_APP to its .app path.",
    );
  }

  console.log(`[ios] Vault: ${vault.path}`);
  build();
  copyPlugin(vault.path);
  console.log(
    "[ios] Done. iCloud will sync the plugin to your device — give it a " +
      "minute, then reopen Obsidian there.",
  );
  console.log(
    "[ios] IMPORTANT: iOS keeps the previously loaded plugin code. After " +
      "syncing, fully quit Obsidian (app switcher > swipe up) and reopen it — " +
      "merely backgrounding the app or toggling the plugin is NOT enough " +
      "(toggle crashes on duplicate custom elements).",
  );
  printDebugInstructions("device");
} else {
  console.log(`[ios] Vault: ${vault.path}`);
  console.log(`[ios] App: ${app}`);
  build();
  await quitApp(app);
  copyPlugin(vault.path);
  launchApp(app);
  printDebugInstructions("app");
}
