#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const COLORS = { server: '\u001b[36m', web: '\u001b[35m' }
const RESET = '\u001b[0m'

const children = []
let shuttingDown = false

function run(name, args, cwd) {
  const env = { ...process.env, FORCE_COLOR: '1' }
  // FORCE_COLOR 与 NO_COLOR 同时存在会触发 Node 警告
  delete env.NO_COLOR
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = (COLORS[name] ?? '') + name.padEnd(6) + RESET + ' │ '
  const pipe = (stream, isError) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        ;(isError ? process.stderr : process.stdout).write(prefix + line + '\n')
      }
    })
  }
  pipe(child.stdout, false)
  pipe(child.stderr, true)
  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(prefix + '进程退出，退出码 ' + code)
    shutdown(typeof code === 'number' ? code : 0)
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}

console.log('\n  觅音 · 开发模式\n')
console.log('  前端  http://localhost:5173')
console.log('  接口  http://localhost:3000\n')

run('server', [tsxCli, 'watch', 'src/index.ts'], path.join(root, 'server'))
run('web', [viteCli, '--host'], path.join(root, 'web'))