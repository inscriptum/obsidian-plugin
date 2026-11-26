import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let workspace = dirname(plugin);
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") {
    dryRun = true;
  } else if (args[i] === "--workspace" && args[i + 1] && !args[i + 1].startsWith("--")) {
    workspace = resolve(args[++i]);
  } else {
    throw new Error("Usage: npm run dev:vault -- [--dry-run] [--workspace /path/to/inscriptum]");
  }
}

const theme = join(workspace, "obsidian-theme");
const vault = join(workspace, "obsidian-dev-vault");
const marker = join(vault, ".inscriptum-dev-vault.json");
if (existsSync(vault) && (!existsSync(marker) || JSON.parse(readFileSync(marker, "utf8")).kind !== "inscriptum-dev-vault")) {
  throw new Error(`Refusing to write an unmarked existing vault: ${vault}`);
}

const themeFiles = ["theme.css", "manifest.json", ...["Inscriptum.md", "Inscriptum.note", "Inscriptum.um"].map(name => join("examples", name))];
for (const name of themeFiles) {
  if (!existsSync(join(theme, name))) throw new Error(`Missing theme artifact: ${join(theme, name)}`);
}
if (dryRun) {
  console.log(`Would build ${plugin} and deploy plugin + theme to ${vault}. Existing notes/settings are preserved.`);
  process.exit(0);
}

const build = spawnSync("npm", ["run", "build"], { cwd: plugin, stdio: "inherit" });
if (build.status !== 0) throw new Error("Plugin build failed; vault was not updated.");
const outputs = [
  [join(plugin, "dist/main.js"), ".obsidian/plugins/inscriptum/main.js"],
  [join(plugin, "dist/styles.css"), ".obsidian/plugins/inscriptum/styles.css"],
  [join(plugin, "manifest.json"), ".obsidian/plugins/inscriptum/manifest.json"],
  [join(theme, "theme.css"), ".obsidian/themes/Inscriptum/theme.css"],
  [join(theme, "manifest.json"), ".obsidian/themes/Inscriptum/manifest.json"],
];
for (const [source] of outputs) if (!existsSync(source)) throw new Error(`Missing deploy artifact: ${source}`);
mkdirSync(vault, { recursive: true });
for (const [source, name] of outputs) {
  const target = join(vault, name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
const createJson = (name, value) => {
  const path = join(vault, name);
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
createJson(".inscriptum-dev-vault.json", { kind: "inscriptum-dev-vault", version: 1 });
createJson(".obsidian/appearance.json", { cssTheme: "Inscriptum", theme: "system", baseFontSize: 18 });
createJson(".obsidian/community-plugins.json", ["inscriptum"]);
for (const name of ["Inscriptum.md", "Inscriptum.note", "Inscriptum.um"]) {
  if (!existsSync(join(vault, name))) copyFileSync(join(theme, "examples", name), join(vault, name));
}
console.log(`Ready: ${vault}\nOpen this folder as a vault in Obsidian. Allow community plugins if prompted. Reload the vault after deploying updated code.`);
