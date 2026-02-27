/**
 * Post-build: add .js extensions to extensionless relative imports in dist/.
 * Fixes Node ESM resolution which requires file extensions.
 *
 * If the import target is a directory (has index.js), appends /index.js.
 * Otherwise appends .js.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';

const IMPORT_RE = /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;

function fix(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { fix(full); continue; }
    if (extname(full) !== '.js' && extname(full) !== '.mjs') continue;

    const src = readFileSync(full, 'utf-8');
    const fileDir = dirname(full);

    const out = src.replace(IMPORT_RE, (match, pre, importPath, suf) => {
      if (importPath.endsWith('.js') || importPath.endsWith('.json') || importPath.endsWith('.mjs')) return match;

      const resolved = resolve(fileDir, importPath);

      if (existsSync(resolved) && statSync(resolved).isDirectory() && existsSync(join(resolved, 'index.js'))) {
        return `${pre}${importPath}/index.js${suf}`;
      }

      return `${pre}${importPath}.js${suf}`;
    });

    if (out !== src) writeFileSync(full, out);
  }
}

fix(new URL('../dist', import.meta.url).pathname);
