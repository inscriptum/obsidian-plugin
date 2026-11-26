import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configuredPath = process.env.INSCRIPTUM_DEV_VAULT;
if (configuredPath && !isAbsolute(configuredPath)) {
  throw new Error('INSCRIPTUM_DEV_VAULT must be an absolute path');
}

export const devVaultPath = configuredPath
  ? resolve(configuredPath)
  : fileURLToPath(new URL('../../', import.meta.url)).replace(/[/\\]$/, '');
