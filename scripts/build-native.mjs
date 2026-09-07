import { spawnSync } from 'node:child_process'
const base = process.env.FLOWBUDGET_API_URL || 'https://budget-planner-ecru-seven.vercel.app'
if (!base.startsWith('https://')) throw new Error('Native builds require an HTTPS API URL')
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js','build'], {stdio:'inherit',env:{...process.env,VITE_API_BASE_URL:base}})
if (result.status !== 0) process.exit(result.status || 1)
const sync = spawnSync(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor','sync'], {stdio:'inherit'})
process.exit(sync.status || 0)
