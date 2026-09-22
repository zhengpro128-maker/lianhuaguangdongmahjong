import { spawnSync } from 'node:child_process'

// Windows ships powershell; macOS/Linux install the same runtime as pwsh.
const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/sync-master-to-vibehub.ps1', ...process.argv.slice(2)]
let result = spawnSync('powershell', args, { stdio: 'inherit' })
if (result.error?.code === 'ENOENT') result = spawnSync('pwsh', args, { stdio: 'inherit' })
if (result.error) console.error(`PowerShell is required to sync branches: ${result.error.message}`)
process.exitCode = result.status ?? 1
