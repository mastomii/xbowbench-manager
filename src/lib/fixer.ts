import fs from 'fs/promises'
import path from 'path'

export interface FixResult {
  benchmark: string
  fixed: boolean
  items: FixItem[]
  error?: string
}

export interface FixItem {
  type: 'mysql' | 'compose' | 'buster' | 'composer'
  file: string
  description: string
  before?: string
  after?: string
}

// Get benchmarks directory from environment
function getBenchmarksPath(): string {
  return process.env.BENCHMARKS_PATH || path.join(process.cwd(), '..', 'validation-benchmarks', 'benchmarks')
}

// Buster-based images that need fixing
const BUSTER_BASED_IMAGES = [
  'python:2.7', 'python:2.', 'debian:buster', 'slim-buster', ':buster',
  'httpd:2.4.49', 'httpd:2.4.50', 'httpd:2.4.51',
  'php:7.1', 'php:7.2', 'php:7.3',
  'haproxy:2.0', 'haproxy:2.1',
]

// Broken MySQL images
const BROKEN_MYSQL_IMAGES: Record<string, string> = {
  'mysql:5.7.15': 'mysql:5.7',
  'mysql:5.7.14': 'mysql:5.7',
  'mysql:5.7.13': 'mysql:5.7',
  'mysql:5.7.12': 'mysql:5.7',
  'mysql:5.6': 'mysql:5.7',
}

export async function analyzeBenchmark(benchmarkPath: string): Promise<FixItem[]> {
  const fixes: FixItem[] = []
  
  // Check all Dockerfiles
  const dockerfiles = await findFiles(benchmarkPath, 'Dockerfile')
  
  for (const dockerfile of dockerfiles) {
    const content = await fs.readFile(dockerfile, 'utf-8')
    const relativePath = path.relative(benchmarkPath, dockerfile)
    
    // Check for broken MySQL images
    for (const [oldImage, newImage] of Object.entries(BROKEN_MYSQL_IMAGES)) {
      if (content.includes(`FROM ${oldImage}`)) {
        fixes.push({
          type: 'mysql',
          file: relativePath,
          description: `MySQL image ${oldImage} is corrupt on Docker Hub`,
          before: `FROM ${oldImage}`,
          after: `FROM ${newImage}`,
        })
      }
    }
    
    // Check for Buster-based images needing repo fix
    const usesBuster = BUSTER_BASED_IMAGES.some(img => 
      content.toLowerCase().includes(img.toLowerCase())
    )
    
    if (usesBuster && !content.includes('archive.debian.org')) {
      if (content.includes('apt-get update')) {
        fixes.push({
          type: 'buster',
          file: relativePath,
          description: 'Uses Debian Buster (EOL) - needs archive.debian.org repos',
          before: 'apt-get update',
          after: 'apt-get update -o Acquire::Check-Valid-Until=false (with archived repos)',
        })
      }
    }
    
    // Check for composer:latest
    if (content.includes('composer:latest')) {
      fixes.push({
        type: 'composer',
        file: relativePath,
        description: 'Uses composer:latest which blocks vulnerable packages',
        before: 'composer:latest',
        after: 'composer:2.5 (no strict security blocking)',
      })
    }
  }
  
  // Check docker-compose.yml
  const composeFile = path.join(benchmarkPath, 'docker-compose.yml')
  try {
    const content = await fs.readFile(composeFile, 'utf-8')
    
    // Check for invalid expose syntax
    const exposeMatch = content.match(/expose:\s*\n\s*-\s*["']?(\d+):(\d+)["']?/)
    if (exposeMatch) {
      fixes.push({
        type: 'compose',
        file: 'docker-compose.yml',
        description: 'Invalid expose syntax (should not have port mapping)',
        before: `expose: - ${exposeMatch[1]}:${exposeMatch[2]}`,
        after: `expose: - ${exposeMatch[1]}`,
      })
    }
  } catch {
    // No docker-compose.yml
  }
  
  return fixes
}

export async function fixBenchmark(benchmarkPath: string): Promise<FixItem[]> {
  const fixes: FixItem[] = []
  
  // Fix Dockerfiles
  const dockerfiles = await findFiles(benchmarkPath, 'Dockerfile')
  
  for (const dockerfile of dockerfiles) {
    let content = await fs.readFile(dockerfile, 'utf-8')
    const originalContent = content
    const relativePath = path.relative(benchmarkPath, dockerfile)
    
    // Fix broken MySQL images
    for (const [oldImage, newImage] of Object.entries(BROKEN_MYSQL_IMAGES)) {
      if (content.includes(`FROM ${oldImage}`)) {
        content = content.replace(
          new RegExp(`FROM\\s+${oldImage.replace('.', '\\.')}`, 'gi'),
          `FROM ${newImage}`
        )
        fixes.push({
          type: 'mysql',
          file: relativePath,
          description: `Fixed: ${oldImage} → ${newImage}`,
        })
      }
    }
    
    // Fix Buster-based images
    const usesBuster = BUSTER_BASED_IMAGES.some(img => 
      content.toLowerCase().includes(img.toLowerCase())
    )
    
    if (usesBuster && !content.includes('archive.debian.org')) {
      // Insert repo fix before first apt-get update
      const lines = content.split('\n')
      const newLines: string[] = []
      let fixed = false
      
      for (const line of lines) {
        if (!fixed && line.toLowerCase().includes('apt-get update')) {
          newLines.push('')
          newLines.push('# Fix for archived Debian Buster repos (EOL)')
          newLines.push('RUN echo "deb http://archive.debian.org/debian buster main" > /etc/apt/sources.list && \\')
          newLines.push('    echo "deb http://archive.debian.org/debian-security buster/updates main" >> /etc/apt/sources.list')
          newLines.push('')
          fixed = true
          
          fixes.push({
            type: 'buster',
            file: relativePath,
            description: 'Added archive.debian.org repos for Debian Buster',
          })
        }
        newLines.push(line)
      }
      
      content = newLines.join('\n')
      
      // Fix apt-get update commands
      content = content.replace(
        /apt-get update(?!\s+-o)/g,
        'apt-get update -o Acquire::Check-Valid-Until=false'
      )
    }
    
    // Fix composer:latest
    if (content.includes('composer:latest')) {
      content = content.replace(/composer:latest/gi, 'composer:2.5')
      fixes.push({
        type: 'composer',
        file: relativePath,
        description: 'Fixed: composer:latest → composer:2.5',
      })
    }
    
    // Write if changed
    if (content !== originalContent) {
      await fs.writeFile(dockerfile, content, 'utf-8')
    }
  }
  
  // Fix docker-compose.yml
  const composeFile = path.join(benchmarkPath, 'docker-compose.yml')
  try {
    let content = await fs.readFile(composeFile, 'utf-8')
    const originalContent = content
    
    // Fix invalid expose syntax
    const newContent = content.replace(
      /(expose:\s*\n\s*-\s*)["']?(\d+):(\d+)["']?/g,
      '$1$2'
    )
    
    if (newContent !== content) {
      await fs.writeFile(composeFile, newContent, 'utf-8')
      fixes.push({
        type: 'compose',
        file: 'docker-compose.yml',
        description: 'Fixed: expose port mapping syntax',
      })
    }
  } catch {
    // No docker-compose.yml
  }
  
  return fixes
}

export async function fixAllBenchmarks(): Promise<FixResult[]> {
  const benchmarksPath = getBenchmarksPath()
  const results: FixResult[] = []
  
  try {
    const entries = await fs.readdir(benchmarksPath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('XBEN-')) {
        const benchmarkPath = path.join(benchmarksPath, entry.name)
        
        try {
          const items = await fixBenchmark(benchmarkPath)
          results.push({
            benchmark: entry.name,
            fixed: items.length > 0,
            items,
          })
        } catch (error) {
          results.push({
            benchmark: entry.name,
            fixed: false,
            items: [],
            error: String(error),
          })
        }
      }
    }
  } catch (error) {
    console.error('Error fixing benchmarks:', error)
  }
  
  return results
}

export async function analyzeAllBenchmarks(): Promise<FixResult[]> {
  const benchmarksPath = getBenchmarksPath()
  const results: FixResult[] = []
  
  try {
    const entries = await fs.readdir(benchmarksPath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('XBEN-')) {
        const benchmarkPath = path.join(benchmarksPath, entry.name)
        
        try {
          const items = await analyzeBenchmark(benchmarkPath)
          results.push({
            benchmark: entry.name,
            fixed: false,
            items,
          })
        } catch (error) {
          results.push({
            benchmark: entry.name,
            fixed: false,
            items: [],
            error: String(error),
          })
        }
      }
    }
  } catch (error) {
    console.error('Error analyzing benchmarks:', error)
  }
  
  return results
}

// Helper function to find files recursively
async function findFiles(dir: string, filename: string): Promise<string[]> {
  const results: string[] = []
  
  async function walk(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name === filename) {
          results.push(fullPath)
        }
      }
    } catch {
      // Permission denied or other error
    }
  }
  
  await walk(dir)
  return results
}
