import type { Plugin } from 'vite';
import { execSync } from 'child_process';

export function deployPlugin(): Plugin {
  return {
    name: 'deploy-obsidian-plugin',
    writeBundle() {
      try {
        execSync('cp dist/main.js manifest.json dist/styles.css .obsidian/plugins/inscriptum/', {
          stdio: 'inherit',
        });
        console.log('[deploy] Copied to .obsidian/plugins/inscriptum/');
      } catch {
        console.warn('[deploy] Failed to copy — is plugin dir set up?');
      }
    },
  };
}
