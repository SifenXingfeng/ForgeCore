import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const entry = process.argv[2] ?? 'scripts/sim-regression.ts'
const tempDir = await mkdtemp(join(tmpdir(), 'forgemind-sim-'))
const outfile = join(tempDir, 'runner.mjs')

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  })

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [outfile], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
  process.exitCode = exitCode
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
