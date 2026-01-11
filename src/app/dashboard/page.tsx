'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ThemeToggle } from '@/components/theme-toggle'
import { toast } from 'sonner'
import {
  Shield,
  LogOut,
  RefreshCw,
  Search,
  Play,
  Square,
  RotateCw,
  Hammer,
  FileText,
  Terminal,
  ChevronDown,
  ChevronRight,
  Server,
  Box,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Cpu,
  HardDrive,
  Database,
  Container,
  Shuffle,
  ExternalLink,
  BookOpen,
  Clock,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import ReactMarkdown from 'react-markdown'

interface BenchmarkInfo {
  id: string
  path: string
  status: 'running' | 'stopped' | 'partial' | 'unknown'
  containers: ContainerInfo[]
  hasDockerCompose: boolean
  hasMakefile: boolean
  description?: string
  readme?: string
}

interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string[]
  portMappings?: { private: number; public: number }[]
}

interface SystemStats {
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

interface DockerInfo {
  connected: boolean
  version?: string
  containers?: number
  images?: number
  platform?: string
  system?: SystemStats
  appAccess?: string
}

interface FixItem {
  type: string
  file: string
  description: string
  before?: string
  after?: string
}

interface FixResult {
  benchmark: string
  fixed: boolean
  items: FixItem[]
}

function generateRandomPort(): number {
  return Math.floor(Math.random() * (65535 - 10000) + 10000)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export default function DashboardPage() {
  const router = useRouter()
  const [benchmarks, setBenchmarks] = useState<BenchmarkInfo[]>([])
  const [filteredBenchmarks, setFilteredBenchmarks] = useState<BenchmarkInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dockerInfo, setDockerInfo] = useState<DockerInfo | null>(null)
  const [expandedBenchmarks, setExpandedBenchmarks] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({})
  const [logsDialogOpen, setLogsDialogOpen] = useState(false)
  const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [fixDialogOpen, setFixDialogOpen] = useState(false)
  const [fixResults, setFixResults] = useState<FixResult[]>([])
  const [fixLoading, setFixLoading] = useState(false)
  const [randomizePort, setRandomizePort] = useState(false)
  const [readmeDialogOpen, setReadmeDialogOpen] = useState(false)
  const [selectedReadme, setSelectedReadme] = useState<{ id: string; content: string } | null>(null)
  const [containerLogsDialogOpen, setContainerLogsDialogOpen] = useState(false)
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null)
  const [containerLogs, setContainerLogs] = useState<string>('')
  const [containerLogsLoading, setContainerLogsLoading] = useState(false)
  const [shellDialogOpen, setShellDialogOpen] = useState(false)
  const [shellCommand, setShellCommand] = useState('')
  const [shellOutput, setShellOutput] = useState<string[]>([])
  const [shellLoading, setShellLoading] = useState(false)

  // Load randomizePort from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('randomizePort')
    if (saved !== null) {
      setRandomizePort(saved === 'true')
    }
  }, [])

  // Save randomizePort to localStorage when it changes
  const handleRandomizePortChange = (checked: boolean) => {
    setRandomizePort(checked)
    localStorage.setItem('randomizePort', String(checked))
  }

  const fetchBenchmarks = useCallback(async () => {
    try {
      const response = await fetch('/api/benchmarks')
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const data = await response.json()
      setBenchmarks(data.benchmarks || [])
      setFilteredBenchmarks(data.benchmarks || [])
    } catch (error) {
      console.error('Error fetching benchmarks:', error)
      toast.error('Failed to fetch benchmarks')
    } finally {
      setLoading(false)
    }
  }, [router])

  const fetchDockerInfo = useCallback(async () => {
    try {
      const response = await fetch('/api/docker')
      if (response.ok) {
        const data = await response.json()
        setDockerInfo(data)
      }
    } catch (error) {
      console.error('Error fetching Docker info:', error)
      setDockerInfo({ connected: false })
    }
  }, [])

  useEffect(() => {
    fetchBenchmarks()
    fetchDockerInfo()
    
    // Refresh system stats every 30 seconds
    const interval = setInterval(fetchDockerInfo, 30000)
    return () => clearInterval(interval)
  }, [fetchBenchmarks, fetchDockerInfo])

  useEffect(() => {
    if (searchQuery) {
      const filtered = benchmarks.filter((b) =>
        b.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
      setFilteredBenchmarks(filtered)
    } else {
      setFilteredBenchmarks(benchmarks)
    }
  }, [searchQuery, benchmarks])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const handleBenchmarkAction = async (
    benchmarkId: string,
    action: 'start' | 'stop' | 'restart' | 'build'
  ) => {
    setActionLoading((prev) => ({ ...prev, [benchmarkId]: action }))
    try {
      const port = randomizePort ? generateRandomPort() : undefined
      const response = await fetch(`/api/benchmarks/${benchmarkId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, port }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`${action} completed for ${benchmarkId}`)
        fetchBenchmarks()
      } else {
        toast.error(data.error || `Failed to ${action} ${benchmarkId}`)
      }
    } catch (error) {
      console.error('Action error:', error)
      toast.error(`Failed to ${action} ${benchmarkId}`)
    } finally {
      setActionLoading((prev) => {
        const newState = { ...prev }
        delete newState[benchmarkId]
        return newState
      })
    }
  }

  const handleViewBuildLogs = async (benchmarkId: string) => {
    setSelectedBenchmark(benchmarkId)
    setLogsDialogOpen(true)
    setLogsLoading(true)
    try {
      const response = await fetch(`/api/benchmarks/${benchmarkId}/logs?tail=500`)
      const data = await response.json()
      setLogs(data.logs || 'No logs available')
    } catch (error) {
      console.error('Error fetching logs:', error)
      setLogs('Failed to fetch logs')
    } finally {
      setLogsLoading(false)
    }
  }

  const handleViewContainerLogs = async (container: ContainerInfo) => {
    setSelectedContainer(container)
    setContainerLogsDialogOpen(true)
    setContainerLogsLoading(true)
    try {
      const response = await fetch(`/api/containers/${container.id}/logs?tail=500`)
      const data = await response.json()
      setContainerLogs(data.logs || 'No logs available')
    } catch (error) {
      console.error('Error fetching container logs:', error)
      setContainerLogs('Failed to fetch logs')
    } finally {
      setContainerLogsLoading(false)
    }
  }

  const handleOpenShell = (container: ContainerInfo) => {
    setSelectedContainer(container)
    setShellDialogOpen(true)
    setShellOutput([])
    setShellCommand('')
  }

  const handleShellCommand = async () => {
    if (!shellCommand.trim() || !selectedContainer) return
    
    setShellLoading(true)
    const cmd = shellCommand
    setShellCommand('')
    setShellOutput((prev) => [...prev, `$ ${cmd}`])
    
    try {
      const response = await fetch(`/api/containers/${selectedContainer.id}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: ['sh', '-c', cmd] }),
      })
      const data = await response.json()
      setShellOutput((prev) => [...prev, data.output || '(no output)'])
    } catch (error) {
      setShellOutput((prev) => [...prev, `Error: ${error}`])
    } finally {
      setShellLoading(false)
    }
  }

  const handleViewReadme = (benchmark: BenchmarkInfo) => {
    if (benchmark.readme) {
      setSelectedReadme({ id: benchmark.id, content: benchmark.readme })
      setReadmeDialogOpen(true)
    } else {
      toast.info('No README available for this benchmark')
    }
  }

  const handlePullBenchmarks = async () => {
    toast.info('Pulling latest benchmarks...')
    try {
      const response = await fetch('/api/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull' }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Benchmarks updated successfully')
        fetchBenchmarks()
      } else {
        toast.error(data.error || 'Failed to pull benchmarks')
      }
    } catch (error) {
      console.error('Pull error:', error)
      toast.error('Failed to pull benchmarks')
    }
  }

  const handleFixAll = async () => {
    setFixDialogOpen(true)
    setFixLoading(true)
    setFixResults([])
    try {
      const response = await fetch('/api/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const data = await response.json()
      if (data.success) {
        setFixResults(data.results || [])
        toast.success('Fix completed')
      } else {
        toast.error(data.error || 'Fix failed')
      }
    } catch (error) {
      console.error('Fix error:', error)
      toast.error('Failed to fix benchmarks')
    } finally {
      setFixLoading(false)
    }
  }

  const toggleExpand = (benchmarkId: string) => {
    setExpandedBenchmarks((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(benchmarkId)) {
        newSet.delete(benchmarkId)
      } else {
        newSet.add(benchmarkId)
      }
      return newSet
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-500 border-green-500/20">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Running
          </Badge>
        )
      case 'stopped':
        return (
          <Badge variant="secondary" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
            <Square className="mr-1 h-3 w-3" />
            Stopped
          </Badge>
        )
      case 'partial':
        return (
          <Badge variant="default" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
            <AlertCircle className="mr-1 h-3 w-3" />
            Partial
          </Badge>
        )
      default:
        return (
          <Badge variant="outline">
            <AlertCircle className="mr-1 h-3 w-3" />
            Unknown
          </Badge>
        )
    }
  }

  const getContainerLink = (container: ContainerInfo): string | null => {
    if (!dockerInfo?.appAccess) return null
    const webPorts = container.portMappings?.filter(p => 
      [80, 443, 8080, 8000, 3000, 5000, 8888].includes(p.private) && p.public
    )
    if (webPorts && webPorts.length > 0) {
      return `${dockerInfo.appAccess}:${webPorts[0].public}`
    }
    // Fallback: check if any port is exposed
    if (container.ports.length > 0) {
      const portMatch = container.ports[0].match(/^(\d+):/)
      if (portMatch) {
        return `${dockerInfo.appAccess}:${portMatch[1]}`
      }
    }
    return null
  }

  const runningCount = benchmarks.filter((b) => b.status === 'running').length
  const stoppedCount = benchmarks.filter((b) => b.status === 'stopped').length
  const systemStats = dockerInfo?.system

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-md">
                <Shield className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold">XBowBench Manager</h1>
                <p className="text-xs text-muted-foreground">
                  Security Benchmark Dashboard
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-4 space-y-4">
          {/* Stats Cards - 2 rows layout */}
          <div className="space-y-2">
            {/* Row 1: Benchmarks Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Box className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-lg font-bold">{benchmarks.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Running</p>
                      <p className="text-lg font-bold text-green-500">{runningCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Square className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Stopped</p>
                      <p className="text-lg font-bold text-gray-500">{stoppedCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Docker</p>
                      {dockerInfo?.connected ? (
                        <div className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-xs">v{dockerInfo.version}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-red-500">Offline</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Row 2: System Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">CPU</p>
                      <p className="text-lg font-bold text-blue-500">
                        {systemStats?.cpu.usage.toFixed(1) || 0}%
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {systemStats?.cpu.cores || 0} cores
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-purple-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">Memory</p>
                      <p className="text-lg font-bold text-purple-500">
                        {systemStats?.memory.usagePercent.toFixed(1) || 0}%
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {formatBytes(systemStats?.memory.used || 0)} / {formatBytes(systemStats?.memory.total || 0)}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-orange-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">Disk</p>
                      <p className="text-lg font-bold text-orange-500">
                        {systemStats?.disk.usagePercent.toFixed(1) || 0}%
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {formatBytes(systemStats?.disk.used || 0)} / {formatBytes(systemStats?.disk.total || 0)}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-cyan-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">Uptime</p>
                      <p className="text-lg font-bold text-cyan-500">
                        {formatUptime(systemStats?.uptime || 0)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {systemStats?.hostname || 'N/A'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search benchmarks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background/50"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-4">
                <Switch
                  id="randomize-port"
                  checked={randomizePort}
                  onCheckedChange={handleRandomizePortChange}
                />
                <Label htmlFor="randomize-port" className="text-sm cursor-pointer flex items-center gap-1">
                  <Shuffle className="h-3 w-3" />
                  Random Port
                </Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePullBenchmarks}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Pull
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFixAll}
                className="gap-2"
              >
                <Wrench className="h-4 w-4" />
                Fix All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchBenchmarks}
                className="gap-2"
              >
                <RotateCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Benchmark List */}
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Container className="h-5 w-5" />
                Benchmarks
              </CardTitle>
              <CardDescription>
                {filteredBenchmarks.length} benchmark{filteredBenchmarks.length !== 1 ? 's' : ''} found
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-340px)] pr-4">
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-8 w-24" />
                      </div>
                    ))}
                  </div>
                ) : filteredBenchmarks.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No benchmarks found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredBenchmarks.map((benchmark) => (
                      <Collapsible
                        key={benchmark.id}
                        open={expandedBenchmarks.has(benchmark.id)}
                        onOpenChange={() => toggleExpand(benchmark.id)}
                      >
                        <div className="rounded-lg border bg-background/50 hover:bg-background/80 transition-colors">
                          <CollapsibleTrigger className="w-full">
                            <div className="flex items-center gap-4 p-4">
                              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <Box className="h-5 w-5 text-primary" />
                              </div>
                              <div className="flex-1 text-left min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-medium truncate">{benchmark.id}</h3>
                                  {getStatusBadge(benchmark.status)}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {benchmark.containers.length} container{benchmark.containers.length !== 1 ? 's' : ''}
                                  {benchmark.description && ` • ${benchmark.description.substring(0, 50)}...`}
                                </p>
                              </div>
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleBenchmarkAction(benchmark.id, 'start')}
                                      disabled={!!actionLoading[benchmark.id]}
                                    >
                                      {actionLoading[benchmark.id] === 'start' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Play className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Start</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleBenchmarkAction(benchmark.id, 'stop')}
                                      disabled={!!actionLoading[benchmark.id]}
                                    >
                                      {actionLoading[benchmark.id] === 'stop' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Square className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Stop</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleBenchmarkAction(benchmark.id, 'restart')}
                                      disabled={!!actionLoading[benchmark.id]}
                                    >
                                      {actionLoading[benchmark.id] === 'restart' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RotateCw className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Restart</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleBenchmarkAction(benchmark.id, 'build')}
                                      disabled={!!actionLoading[benchmark.id]}
                                    >
                                      {actionLoading[benchmark.id] === 'build' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Hammer className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Build</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleViewBuildLogs(benchmark.id)}
                                    >
                                      <FileText className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Build Logs</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleViewReadme(benchmark)}
                                      disabled={!benchmark.readme}
                                    >
                                      <BookOpen className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>README</TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="flex items-center">
                                {expandedBenchmarks.has(benchmark.id) ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="px-4 pb-4 pt-0 border-t">
                              <div className="pt-4 space-y-4">
                                {/* Benchmark Details */}
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Path:</span>
                                    <p className="font-mono text-xs truncate">{benchmark.path}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Config:</span>
                                    <div className="flex gap-2 mt-1">
                                      {benchmark.hasDockerCompose && (
                                        <Badge variant="outline" className="text-xs">docker-compose</Badge>
                                      )}
                                      {benchmark.hasMakefile && (
                                        <Badge variant="outline" className="text-xs">Makefile</Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Containers */}
                                {benchmark.containers.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-2">Containers</h4>
                                    <div className="space-y-2">
                                      {benchmark.containers.map((container) => {
                                        const containerLink = getContainerLink(container)
                                        return (
                                          <div
                                            key={container.id}
                                            className="flex items-center gap-3 p-3 rounded-md bg-muted/30"
                                          >
                                            <Container className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm font-medium truncate">
                                                {container.name}
                                              </p>
                                              <p className="text-xs text-muted-foreground truncate">
                                                {container.image}
                                              </p>
                                            </div>
                                            <Badge
                                              variant={container.state === 'running' ? 'default' : 'secondary'}
                                              className={
                                                container.state === 'running'
                                                  ? 'bg-green-500/10 text-green-500'
                                                  : ''
                                              }
                                            >
                                              {container.state}
                                            </Badge>
                                            {container.ports.length > 0 && (
                                              <div className="flex gap-1 flex-wrap">
                                                {container.ports.map((port, idx) => (
                                                  <Badge key={idx} variant="outline" className="text-xs font-mono">
                                                    {port}
                                                  </Badge>
                                                ))}
                                              </div>
                                            )}
                                            {containerLink && (
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={() => window.open(containerLink, '_blank')}
                                                  >
                                                    <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Open in Browser</TooltipContent>
                                              </Tooltip>
                                            )}
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-7 w-7"
                                                  onClick={() => handleViewContainerLogs(container)}
                                                >
                                                  <FileText className="h-3.5 w-3.5" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Container Logs</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-7 w-7"
                                                  onClick={() => handleOpenShell(container)}
                                                  disabled={container.state !== 'running'}
                                                >
                                                  <Terminal className="h-3.5 w-3.5" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Shell</TooltipContent>
                                            </Tooltip>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </main>

        {/* Build Logs Dialog */}
        <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hammer className="h-5 w-5" />
                Build Logs - {selectedBenchmark}
              </DialogTitle>
              <DialogDescription>
                Docker compose build logs
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              {logsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[500px] rounded-md border bg-black/90 p-4">
                  <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                    {logs}
                  </pre>
                </ScrollArea>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Container Logs Dialog */}
        <Dialog open={containerLogsDialogOpen} onOpenChange={setContainerLogsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Container Logs - {selectedContainer?.name}
              </DialogTitle>
              <DialogDescription>
                Logs from container {selectedContainer?.id}
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              {containerLogsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[500px] rounded-md border bg-black/90 p-4">
                  <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                    {containerLogs}
                  </pre>
                </ScrollArea>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Shell Dialog */}
        <Dialog open={shellDialogOpen} onOpenChange={setShellDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Shell - {selectedContainer?.name}
              </DialogTitle>
              <DialogDescription>
                Execute commands in container
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <ScrollArea className="h-[400px] rounded-md border bg-black/90 p-4">
                <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                  {shellOutput.join('\n') || 'Ready for commands...'}
                </pre>
              </ScrollArea>
              <div className="flex gap-2">
                <Input
                  value={shellCommand}
                  onChange={(e) => setShellCommand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleShellCommand()}
                  placeholder="Enter command..."
                  className="font-mono"
                  disabled={shellLoading}
                />
                <Button onClick={handleShellCommand} disabled={shellLoading || !shellCommand.trim()}>
                  {shellLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* README Dialog */}
        <Dialog open={readmeDialogOpen} onOpenChange={setReadmeDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                README - {selectedReadme?.id}
              </DialogTitle>
              <DialogDescription>
                Benchmark instructions and documentation
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[500px] pr-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{selectedReadme?.content || ''}</ReactMarkdown>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Fix Results Dialog */}
        <Dialog open={fixDialogOpen} onOpenChange={setFixDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Fix Results
              </DialogTitle>
              <DialogDescription>
                Changes applied to benchmarks
              </DialogDescription>
            </DialogHeader>
            <div>
              {fixLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Analyzing and fixing benchmarks...</p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4 pr-4">
                    {/* Summary Stats */}
                    {fixResults.length > 0 && (
                      <div className="p-4 rounded-lg bg-muted/50 border">
                        <div className="flex items-center gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Benchmarks scanned:</span>
                            <span className="ml-2 font-bold">{fixResults.length}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Fixed:</span>
                            <span className="ml-2 font-bold text-green-500">
                              {fixResults.filter(r => r.items.length > 0).length}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total fixes:</span>
                            <span className="ml-2 font-bold text-blue-500">
                              {fixResults.reduce((sum, r) => sum + r.items.length, 0)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {fixResults.filter(r => r.items.length > 0).length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No fixes needed - all benchmarks are up to date!</p>
                        <p className="text-xs mt-2">Scanned {fixResults.length} benchmarks</p>
                      </div>
                    ) : (
                      fixResults
                        .filter((r) => r.items.length > 0)
                        .map((result) => (
                          <Card key={result.benchmark} className="bg-muted/30">
                            <CardHeader className="py-3">
                              <CardTitle className="text-sm flex items-center gap-2">
                                <Box className="h-4 w-4" />
                                {result.benchmark}
                                <Badge variant="secondary" className="ml-auto">
                                  {result.items.length} fix{result.items.length !== 1 ? 'es' : ''}
                                </Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="py-0 pb-3">
                              <div className="space-y-2">
                                {result.items.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="text-xs p-2 rounded bg-background/50"
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge variant="outline" className="text-xs">
                                        {item.type}
                                      </Badge>
                                      <span className="text-muted-foreground">
                                        {item.file}
                                      </span>
                                    </div>
                                    <p className="text-muted-foreground">{item.description}</p>
                                    {item.before && item.after && (
                                      <div className="mt-2 grid grid-cols-2 gap-2">
                                        <div className="p-2 rounded bg-red-500/10 text-red-400 font-mono text-xs overflow-auto">
                                          <span className="text-red-500/70">Before:</span>
                                          <pre className="mt-1">{item.before}</pre>
                                        </div>
                                        <div className="p-2 rounded bg-green-500/10 text-green-400 font-mono text-xs overflow-auto">
                                          <span className="text-green-500/70">After:</span>
                                          <pre className="mt-1">{item.after}</pre>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
