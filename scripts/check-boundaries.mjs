// Garante as regras de dependência entre camadas (docs/arquitetura/02-sistema-de-modulos.md):
//   core         -> só core
//   shared       -> core, shared
//   integrations -> core
//   verticals    -> core, shared, integrations; nunca outra vertical
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const modulesDir = path.join(root, 'modules');

/** nome do pacote -> camada */
const layerOf = new Map();
for (const [dir, layer] of [
  ['core', 'core'],
  ['shared/*', 'shared'],
  ['integrations/*', 'integration'],
  ['verticals/*', 'vertical'],
]) {
  for (const pkgDir of expand(path.join(modulesDir, dir))) {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    layerOf.set(pkg.name, { layer, dir: pkgDir });
  }
}

const allowed = {
  core: ['core'],
  shared: ['core', 'shared'],
  integration: ['core'],
  vertical: ['core', 'shared', 'integration'],
};

const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](@all\/[^/'"]+)/g;
const violations = [];

for (const [name, { layer, dir }] of layerOf) {
  for (const file of walk(path.join(dir, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const [, target] of source.matchAll(importRe)) {
      const dep = layerOf.get(target);
      if (!dep || target === name) continue;
      if (!allowed[layer].includes(dep.layer)) {
        violations.push(`${path.relative(root, file)}: ${name} (${layer}) importa ${target} (${dep.layer})`);
      }
    }
  }
}

if (violations.length) {
  console.error(`Violações de fronteira entre módulos:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`Fronteiras OK (${layerOf.size} pacotes de módulo verificados).`);

function expand(pattern) {
  if (!pattern.endsWith('*')) return statSafe(pattern) ? [pattern] : [];
  const base = pattern.slice(0, -2);
  if (!statSafe(base)) return [];
  return readdirSync(base)
    .map((d) => path.join(base, d))
    .filter((d) => statSafe(path.join(d, 'package.json')));
}

function* walk(dir) {
  if (!statSafe(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

function statSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
