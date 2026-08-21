import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { isGitLfsPointer, readGlb } from './model-tools.mjs';

const root = join(process.cwd(), 'public', 'models', 'forgecore', 'items');
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
const failures = [];
const warnings = [];
const checked = new Set();

function recordFailure(message) { failures.push(message); }
function recordWarning(message) { warnings.push(message); }

if (!Number.isInteger(catalog.modelCount) || !Array.isArray(catalog.models) || catalog.modelCount !== catalog.models.length) {
  recordFailure(`catalog modelCount mismatch: ${catalog.modelCount} vs ${catalog.models?.length ?? 0}`);
}

for (const model of catalog.models ?? []) {
  for (const field of ['relativePath', 'previewPath']) {
    const relativePath = model[field];
    if (typeof relativePath !== 'string' || relativePath.includes('..')) {
      recordFailure(`${model.id ?? '<unknown>'}: invalid ${field}`);
      continue;
    }
    const fullPath = join(root, relativePath);
    checked.add(relativePath.replaceAll(sep, '/'));
    let data;
    try { data = await readFile(fullPath); } catch { recordFailure(`${model.id}: missing ${field} ${relativePath}`); continue; }
    if (isGitLfsPointer(data)) { recordWarning(`${model.id}: ${field} is an unresolved Git LFS pointer`); continue; }
    try {
      if (field === 'relativePath') readGlb(data);
      else if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('not a PNG');
    } catch (error) { recordFailure(`${model.id}: invalid ${field} (${error.message})`); }
  }
}

const sumsPath = join(root, 'SHA256SUMS');
const sumsText = await readFile(sumsPath, 'utf8').catch(() => '');
for (const line of sumsText.split(/\r?\n/u).filter(Boolean)) {
  const [expected, listed] = line.trim().split(/\s+/u);
  if (!expected || !listed) { recordFailure(`invalid SHA256SUMS line: ${line}`); continue; }
  try {
    const data = await readFile(join(root, listed));
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== expected) recordFailure(`${listed}: SHA-256 mismatch`);
  } catch { recordFailure(`${listed}: listed file is missing`); }
}

console.log(`ForgeCore item model audit: ${catalog.models?.length ?? 0} catalog entries`);
console.log(`  valid files checked: ${checked.size}`);
if (warnings.length) console.warn(`  warnings: ${warnings.length} unresolved LFS assets`);
for (const warning of warnings) console.warn(`  ! ${warning}`);
if (failures.length) {
  console.error(`  failures: ${failures.length}`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exitCode = process.argv.includes('--strict') ? 1 : 0;
} else {
  console.log('  result: PASS');
}
