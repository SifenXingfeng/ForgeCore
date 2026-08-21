import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { extractGeometry, isGitLfsPointer, readGlb, renderPreview } from './model-tools.mjs';

const root = join(process.cwd(), 'public', 'models', 'forgecore', 'items');
const catalogPath = join(root, 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
let generated = 0;
let skipped = 0;

for (const model of catalog.models ?? []) {
  const modelPath = join(root, model.relativePath);
  const previewPath = join(root, model.previewPath);
  let source;
  try { source = await readFile(modelPath); } catch { skipped += 1; console.warn(`skip ${model.id}: missing ${model.relativePath}`); continue; }
  if (isGitLfsPointer(source)) { skipped += 1; console.warn(`skip ${model.id}: unresolved Git LFS pointer`); continue; }
  try {
    const document = readGlb(source);
    const preview = renderPreview(extractGeometry(document));
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, preview);
    model.previewBytes = preview.length;
    model.previewSha256 = createHash('sha256').update(preview).digest('hex');
    generated += 1;
    console.log(`generated ${model.id} -> ${model.previewPath}`);
  } catch (error) {
    skipped += 1;
    console.warn(`skip ${model.id}: ${error.message}`);
  }
}

await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath);
    else if (entry.name !== 'SHA256SUMS') files.push(fullPath);
  }
}
await collect(root);
files.sort();
const sums = [];
for (const filePath of files) {
  const data = await readFile(filePath);
  const digest = createHash('sha256').update(data).digest('hex');
  sums.push(`${digest}  ${filePath.slice(root.length + 1).replaceAll('\\', '/')}`);
}
await writeFile(join(root, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`preview generation complete: ${generated} generated, ${skipped} skipped`);
