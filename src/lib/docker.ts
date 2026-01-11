import Docker from 'dockerode'
import path from 'path'
import fs from 'fs/promises'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execAsync = promisify(exec)

// Docker client - handles both Linux/Mac and Windows
const dockerOptions: Docker.DockerOptions = process.platform === 'win32'
  ? { socketPath: '//./pipe/docker_engine' }
  : { socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock' }

export const docker = new Docker(dockerOptions)

export interface BenchmarkInfo {
  id: string
  name: string
  path: string
  description?: string
  level?: number
  tags?: string[]
  cwe?: string
  vulnerability?: string
  readme?: string
  hasDockerCompose: boolean
  hasMakefile: boolean
  services: string[]
  status: 'stopped' | 'running' | 'building' | 'error' | 'partial' | 'unknown'
  ports: Record<string, string[]>
  containers: ContainerInfo[]
  hasImage?: boolean
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string[]
  portMappings: { private: number; public: number }[]
  created: number
}

export interface BuildLog {
  stream?: string
  error?: string
  status?: string
}

export interface FixResult {
  benchmark: string
  fixes: {
    type: string
    file: string
    description: string
  }[]
}

export interface SystemStats {
  cpu: {
    usage: number
    cores: number
    model: string
  }
  memory: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  disk: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  uptime: number
  hostname: string
}

// Get benchmarks directory from environment
function getBenchmarksPath(): string {
  return process.env.BENCHMARKS_PATH || path.join(process.cwd(), '..', 'validation-benchmarks', 'benchmarks')
}

// Check if benchmarks are available
export async function isBenchmarksCloned(): Promise<boolean> {
  const benchmarksPath = getBenchmarksPath()
  try {
    const entries = await fs.readdir(benchmarksPath)
    return entries.some(e => e.startsWith('XBEN-'))
  } catch {
    return false
  }
}

export async function listBenchmarks(): Promise<BenchmarkInfo[]> {
  const benchmarksPath = getBenchmarksPath()

  try {
    // Ensure directory exists
    await fs.mkdir(benchmarksPath, { recursive: true })
    
    const entries = await fs.readdir(benchmarksPath, { withFileTypes: true })
    const benchmarkDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('XBEN-'))
    
    // Get all containers and images ONCE for all benchmarks (much faster!)
    const [containers, images] = await Promise.all([
      docker.listContainers({ all: true }).catch(() => []),
      docker.listImages().catch(() => []),
    ])
    
    // Process benchmarks in parallel for speed
    const benchmarks = await Promise.all(
      benchmarkDirs.map(entry => {
        const benchmarkPath = path.join(benchmarksPath, entry.name)
        return getBenchmarkInfoFast(entry.name, benchmarkPath, containers, images)
      })
    )

    // Sort by numeric ID (XBEN-001-24, XBEN-002-24, etc.)
    benchmarks.sort((a, b) => {
      // Extract number from XBEN-XXX-YY format
      const numA = parseInt(a.id.match(/XBEN-(\d+)/)?.[1] || '0')
      const numB = parseInt(b.id.match(/XBEN-(\d+)/)?.[1] || '0')
      return numA - numB
    })
    
    return benchmarks
  } catch (error) {
    console.error('Error listing benchmarks:', error)
    return []
  }
}

export async function getBenchmarkInfo(name: string, benchmarkPath: string): Promise<BenchmarkInfo> {
  // For single benchmark info, fetch containers and images
  const [containers, images] = await Promise.all([
    docker.listContainers({ all: true }).catch(() => []),
    docker.listImages().catch(() => []),
  ])
  return getBenchmarkInfoFast(name, benchmarkPath, containers, images)
}

// Fast version that reuses pre-fetched containers and images
async function getBenchmarkInfoFast(
  name: string, 
  benchmarkPath: string,
  allContainers: Docker.ContainerInfo[],
  allImages: Docker.ImageInfo[]
): Promise<BenchmarkInfo> {
  const info: BenchmarkInfo = {
    id: name,
    name,
    path: benchmarkPath,
    hasDockerCompose: false,
    hasMakefile: false,
    services: [],
    status: 'stopped',
    ports: {},
    containers: [],
    hasImage: false,
  }

  // Check for docker-compose.yml and Makefile in parallel
  const [hasCompose, hasMake] = await Promise.all([
    fs.access(path.join(benchmarkPath, 'docker-compose.yml')).then(() => true).catch(() => false),
    fs.access(path.join(benchmarkPath, 'Makefile')).then(() => true).catch(() => false),
  ])
  
  info.hasDockerCompose = hasCompose
  info.hasMakefile = hasMake

  // Read benchmark.yaml for metadata (skip README for speed - only load on demand)
  try {
    const yamlPath = path.join(benchmarkPath, 'benchmark.yaml')
    const content = await fs.readFile(yamlPath, 'utf-8')

    // Parse YAML fields
    const nameMatch = content.match(/^name:\s*(.+)$/m)
    const levelMatch = content.match(/^level:\s*(\d+)/m)
    const tagsMatch = content.match(/^tags:\s*\n((?:- .+\n?)+)/m)
    
    // Parse description from content section
    const descMatch = content.match(/kind:\s*description[\s\S]*?content:\s*["']?([^"'\n]+(?:\n\s+[^"'\n]+)*)["']?/i)
    
    if (nameMatch) info.name = nameMatch[1].trim()
    if (levelMatch) info.level = parseInt(levelMatch[1])
    if (tagsMatch) {
      const tagLines = tagsMatch[1].match(/- (.+)/g)
      if (tagLines) {
        info.tags = tagLines.map(t => t.replace(/^- /, '').trim())
      }
    }
    if (descMatch) {
      info.description = descMatch[1].replace(/\n\s+/g, ' ').trim()
    }
  } catch {
    // No metadata file - that's ok
  }

  // Get container status from pre-fetched list
  const benchmarkContainers = allContainers.filter(c =>
    c.Labels?.['com.docker.compose.project'] === name.toLowerCase() ||
    c.Names.some(n => n.includes(name.toLowerCase()))
  )

  info.containers = benchmarkContainers.map(c => {
    const portMappings = c.Ports.map(p => ({ private: p.PrivatePort, public: p.PublicPort || 0 }))
    return {
      id: c.Id.substring(0, 12),
      name: c.Names[0]?.replace('/', '') || '',
      image: c.Image,
      status: c.Status,
      state: c.State,
      ports: portMappings.filter(p => p.public).map(p => `${p.public}:${p.private}`),
      portMappings,
      created: c.Created,
    }
  })

  // Determine overall status
  if (info.containers.length === 0) {
    info.status = 'stopped'
  } else if (info.containers.every(c => c.state === 'running')) {
    info.status = 'running'
  } else if (info.containers.some(c => c.state === 'running')) {
    info.status = 'partial'
  } else {
    info.status = 'stopped'
  }

  // Extract ports
  info.containers.forEach(c => {
    c.portMappings.forEach(p => {
      if (p.public) {
        if (!info.ports[p.private]) info.ports[p.private] = []
        info.ports[p.private].push(String(p.public))
      }
    })
  })

  // Check if Docker image exists from pre-fetched list
  info.hasImage = allImages.some(img => 
    img.RepoTags?.some(tag => tag.toLowerCase().includes(name.toLowerCase()))
  )

  return info
}

export async function buildBenchmark(
  benchmarkId: string,
  onLog?: (log: string) => void
): Promise<{ success: boolean; error?: string }> {
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, benchmarkId)

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DOCKER_BUILDKIT: '0',
      COMPOSE_DOCKER_CLI_BUILD: '0',
    }

    const proc = spawn('docker', ['compose', 'build', '--no-cache'], {
      cwd: benchmarkPath,
      env,
      shell: true,
    })

    let error = ''

    proc.stdout.on('data', (data) => {
      const line = data.toString()
      onLog?.(line)
    })

    proc.stderr.on('data', (data) => {
      const line = data.toString()
      error += line
      onLog?.(line)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: error || `Build failed with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

export async function startBenchmark(
  benchmarkId: string,
  port?: number,
  onLog?: (log: string) => void
): Promise<{ success: boolean; error?: string; ports?: Record<string, number> }> {
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, benchmarkId)

  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DOCKER_BUILDKIT: '0',
      COMPOSE_DOCKER_CLI_BUILD: '0',
    }

    // Set port if provided
    if (port) {
      env['PORT'] = String(port)
      env['HOST_PORT'] = String(port)
    }

    const proc = spawn('docker', ['compose', 'up', '-d', '--build'], {
      cwd: benchmarkPath,
      env,
      shell: true,
    })

    let error = ''

    proc.stdout.on('data', (data) => {
      onLog?.(data.toString())
    })

    proc.stderr.on('data', (data) => {
      const line = data.toString()
      // Docker compose outputs progress to stderr
      if (!line.includes('Error') && !line.includes('error')) {
        onLog?.(line)
      } else {
        error += line
      }
    })

    proc.on('close', async (code) => {
      if (code === 0) {
        // Get the assigned ports
        const info = await getBenchmarkInfo(benchmarkId, benchmarkPath)
        const ports: Record<string, number> = {}
        Object.entries(info.ports).forEach(([priv, pubs]) => {
          if (pubs[0]) ports[priv] = parseInt(pubs[0])
        })
        resolve({ success: true, ports })
      } else {
        resolve({ success: false, error: error || `Start failed with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

export async function stopBenchmark(
  benchmarkId: string,
  onLog?: (log: string) => void
): Promise<{ success: boolean; error?: string }> {
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, benchmarkId)

  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'down', '-v', '--remove-orphans'], {
      cwd: benchmarkPath,
      shell: true,
    })

    let error = ''

    proc.stdout.on('data', (data) => {
      onLog?.(data.toString())
    })

    proc.stderr.on('data', (data) => {
      const line = data.toString()
      if (line.includes('Error') || line.includes('error')) {
        error += line
      } else {
        onLog?.(line)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: error || `Stop failed with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

export async function restartBenchmark(
  benchmarkId: string,
  onLog?: (log: string) => void
): Promise<{ success: boolean; error?: string }> {
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, benchmarkId)

  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'restart'], {
      cwd: benchmarkPath,
      shell: true,
    })

    let error = ''

    proc.stdout.on('data', (data) => {
      onLog?.(data.toString())
    })

    proc.stderr.on('data', (data) => {
      const line = data.toString()
      if (line.includes('Error')) {
        error += line
      } else {
        onLog?.(line)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: error || `Restart failed with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

export async function getBenchmarkLogs(
  benchmarkId: string,
  tail: number = 100
): Promise<string> {
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, benchmarkId)

  try {
    const { stdout, stderr } = await execAsync(
      `docker compose logs --tail=${tail}`,
      { cwd: benchmarkPath }
    )
    return stdout + stderr
  } catch (error) {
    return `Error fetching logs: ${error}`
  }
}

export async function getContainerLogs(
  containerId: string,
  tail: number = 100
): Promise<string> {
  try {
    const container = docker.getContainer(containerId)
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })
    return logs.toString()
  } catch (error) {
    return `Error fetching container logs: ${error}`
  }
}

export async function execInContainer(
  containerId: string,
  command: string[]
): Promise<{ output: string; exitCode: number }> {
  try {
    const container = docker.getContainer(containerId)
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
    })

    const stream = await exec.start({ hijack: true, stdin: false })

    return new Promise((resolve, reject) => {
      let output = ''

      stream.on('data', (chunk: Buffer) => {
        // Docker multiplexed stream - skip header bytes
        const data = chunk.slice(8).toString()
        output += data
      })

      stream.on('end', async () => {
        const inspect = await exec.inspect()
        resolve({ output, exitCode: inspect.ExitCode || 0 })
      })

      stream.on('error', reject)
    })
  } catch (error) {
    return { output: `Error: ${error}`, exitCode: 1 }
  }
}

export async function pullBenchmarks(): Promise<{ success: boolean; output: string }> {
  const benchmarksPath = getBenchmarksPath()
  
  // Get git repo path - use env var if available, otherwise try parent of benchmarks
  const gitRepoPath = process.env.GIT_REPO_PATH || path.join(benchmarksPath, '..')
  const gitRepoUrl = process.env.GIT_REPO_URL || 'https://github.com/xbow-engineering/validation-benchmarks.git'

  try {
    // Check if it's already a git repo
    try {
      await fs.access(path.join(gitRepoPath, '.git'))
      
      // Git repo exists, do pull
      const { stdout, stderr } = await execAsync('git pull --progress', {
        cwd: gitRepoPath,
      })
      return { success: true, output: stdout + stderr }
    } catch {
      // No git repo - need to clone
      // Make sure parent directory exists
      await fs.mkdir(gitRepoPath, { recursive: true })
      
      // Clone the repo
      const { stdout, stderr } = await execAsync(`git clone --progress ${gitRepoUrl} "${gitRepoPath}"`, {
        cwd: path.dirname(gitRepoPath),
      })
      return { success: true, output: `Cloned repository successfully!\n${stdout}${stderr}` }
    }
  } catch (error) {
    return { success: false, output: `Error: ${error}` }
  }
}

export async function deleteBenchmarkImages(benchmarkId: string): Promise<{ success: boolean; deleted: string[]; error?: string }> {
  const deleted: string[] = []
  
  try {
    const images = await docker.listImages()
    
    for (const image of images) {
      const matchingTag = image.RepoTags?.find(tag => 
        tag.toLowerCase().includes(benchmarkId.toLowerCase())
      )
      
      if (matchingTag) {
        try {
          const dockerImage = docker.getImage(image.Id)
          await dockerImage.remove({ force: true })
          deleted.push(matchingTag)
        } catch (e) {
          console.error(`Failed to delete image ${matchingTag}:`, e)
        }
      }
    }
    
    return { success: true, deleted }
  } catch (error) {
    return { success: false, deleted, error: String(error) }
  }
}

// Load README on-demand (called when user expands a benchmark)
export async function getBenchmarkReadme(benchmarkId: string): Promise<string | null> {
  const benchmarksPath = getBenchmarksPath()
  const readmePath = path.join(benchmarksPath, benchmarkId, 'README.md')
  
  try {
    return await fs.readFile(readmePath, 'utf-8')
  } catch {
    return null
  }
}

export async function getDockerInfo(): Promise<{
  connected: boolean
  version: string
  containers: number
  images: number
  running: number
  platform?: string
}> {
  try {
    const info = await docker.info()
    const version = await docker.version()

    return {
      connected: true,
      version: version.Version || 'unknown',
      containers: info.Containers || 0,
      images: info.Images || 0,
      running: info.ContainersRunning || 0,
      platform: info.OperatingSystem,
    }
  } catch (error) {
    return {
      connected: false,
      version: 'error',
      containers: 0,
      images: 0,
      running: 0,
    }
  }
}

export async function getSystemStats(): Promise<SystemStats> {
  // Check if running in container (cgroup v2 or v1)
  const isContainer = await isRunningInContainer()
  
  // CPU Info - check for container limits
  let cpuCores = os.cpus().length
  const cpuModel = os.cpus()[0]?.model || 'Unknown'
  
  if (isContainer) {
    // Try to get container CPU limits
    const containerCpuCores = await getContainerCpuLimit()
    if (containerCpuCores > 0) {
      cpuCores = containerCpuCores
    }
  }

  // Calculate CPU usage
  const cpuUsage = await getCpuUsage()

  // Memory Info - check for container limits
  let totalMemory = os.totalmem()
  let freeMemory = os.freemem()
  
  if (isContainer) {
    // Try to get container memory limits
    const containerMemory = await getContainerMemoryLimit()
    if (containerMemory.limit > 0) {
      totalMemory = containerMemory.limit
      // Calculate used memory from cgroup if available
      const usedFromCgroup = containerMemory.usage
      if (usedFromCgroup > 0) {
        freeMemory = Math.max(0, totalMemory - usedFromCgroup)
      } else {
        // Estimate based on OS free memory ratio
        const osUsedRatio = (os.totalmem() - os.freemem()) / os.totalmem()
        freeMemory = Math.max(0, totalMemory * (1 - osUsedRatio))
      }
    }
  }
  
  const usedMemory = totalMemory - freeMemory
  const memoryUsagePercent = (usedMemory / totalMemory) * 100

  // Disk Info
  const diskInfo = await getDiskInfo()

  return {
    cpu: {
      usage: cpuUsage,
      cores: cpuCores,
      model: cpuModel,
    },
    memory: {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      usagePercent: memoryUsagePercent,
    },
    disk: diskInfo,
    uptime: os.uptime(),
    hostname: os.hostname(),
  }
}

// Check if running inside a container
async function isRunningInContainer(): Promise<boolean> {
  try {
    // Check for /.dockerenv
    await fs.access('/.dockerenv')
    return true
  } catch {
    try {
      // Check cgroup for docker/lxc/podman
      const { stdout } = await execAsync('cat /proc/1/cgroup 2>/dev/null || echo ""')
      return stdout.includes('docker') || stdout.includes('lxc') || stdout.includes('kubepods')
    } catch {
      return false
    }
  }
}

// Get container CPU limit (cgroup v2 or v1)
async function getContainerCpuLimit(): Promise<number> {
  try {
    // Try cgroup v2 first
    try {
      const { stdout } = await execAsync('cat /sys/fs/cgroup/cpu.max 2>/dev/null')
      const parts = stdout.trim().split(' ')
      if (parts[0] !== 'max' && parts.length >= 2) {
        const quota = parseInt(parts[0])
        const period = parseInt(parts[1])
        if (quota > 0 && period > 0) {
          return Math.ceil(quota / period)
        }
      }
    } catch {}
    
    // Try cgroup v1
    try {
      const [quotaResult, periodResult] = await Promise.all([
        execAsync('cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null'),
        execAsync('cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null'),
      ])
      const quota = parseInt(quotaResult.stdout.trim())
      const period = parseInt(periodResult.stdout.trim())
      if (quota > 0 && period > 0) {
        return Math.ceil(quota / period)
      }
    } catch {}
    
    // For LXC containers, check /proc/cpuinfo but limit to container assigned cores
    try {
      const { stdout } = await execAsync('nproc 2>/dev/null')
      const cores = parseInt(stdout.trim())
      if (cores > 0) {
        return cores
      }
    } catch {}
    
    return 0
  } catch {
    return 0
  }
}

// Get container memory limit (cgroup v2 or v1)
async function getContainerMemoryLimit(): Promise<{ limit: number; usage: number }> {
  try {
    // Try cgroup v2 first
    try {
      const [limitResult, usageResult] = await Promise.all([
        execAsync('cat /sys/fs/cgroup/memory.max 2>/dev/null'),
        execAsync('cat /sys/fs/cgroup/memory.current 2>/dev/null'),
      ])
      const limitStr = limitResult.stdout.trim()
      const limit = limitStr === 'max' ? 0 : parseInt(limitStr)
      const usage = parseInt(usageResult.stdout.trim()) || 0
      if (limit > 0) {
        return { limit, usage }
      }
    } catch {}
    
    // Try cgroup v1
    try {
      const [limitResult, usageResult] = await Promise.all([
        execAsync('cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null'),
        execAsync('cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null'),
      ])
      const limit = parseInt(limitResult.stdout.trim()) || 0
      const usage = parseInt(usageResult.stdout.trim()) || 0
      // Filter out unrealistic limits (e.g., 9223372036854771712 which is max int64)
      if (limit > 0 && limit < 1e15) {
        return { limit, usage }
      }
    } catch {}
    
    return { limit: 0, usage: 0 }
  } catch {
    return { limit: 0, usage: 0 }
  }
}

async function getCpuUsage(): Promise<number> {
  return new Promise((resolve) => {
    const cpus1 = os.cpus()

    setTimeout(() => {
      const cpus2 = os.cpus()

      let totalIdle = 0
      let totalTick = 0

      for (let i = 0; i < cpus1.length; i++) {
        const cpu1 = cpus1[i]
        const cpu2 = cpus2[i]

        const idle1 = cpu1.times.idle
        const idle2 = cpu2.times.idle

        const total1 = Object.values(cpu1.times).reduce((a, b) => a + b, 0)
        const total2 = Object.values(cpu2.times).reduce((a, b) => a + b, 0)

        totalIdle += idle2 - idle1
        totalTick += total2 - total1
      }

      const usage = totalTick > 0 ? ((totalTick - totalIdle) / totalTick) * 100 : 0
      resolve(Math.round(usage * 10) / 10)
    }, 100)
  })
}

async function getDiskInfo(): Promise<{
  total: number
  used: number
  free: number
  usagePercent: number
}> {
  try {
    if (process.platform === 'win32') {
      // Windows
      const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption')
      const lines = stdout.split('\n').filter(l => l.trim())
      let total = 0
      let free = 0

      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 3) {
          const freeSpace = parseInt(parts[1]) || 0
          const size = parseInt(parts[2]) || 0
          if (size > 0) {
            total += size
            free += freeSpace
          }
        }
      }

      const used = total - free
      return {
        total,
        used,
        free,
        usagePercent: total > 0 ? (used / total) * 100 : 0,
      }
    } else {
      // Linux/Mac
      const { stdout } = await execAsync('df -B1 / | tail -1')
      const parts = stdout.trim().split(/\s+/)
      const total = parseInt(parts[1]) || 0
      const used = parseInt(parts[2]) || 0
      const free = parseInt(parts[3]) || 0

      return {
        total,
        used,
        free,
        usagePercent: total > 0 ? (used / total) * 100 : 0,
      }
    }
  } catch (error) {
    console.error('Error getting disk info:', error)
    return { total: 0, used: 0, free: 0, usagePercent: 0 }
  }
}

export function getAppAccessUrl(): string {
  return process.env.APP_ACCESS || 'http://localhost'
}
