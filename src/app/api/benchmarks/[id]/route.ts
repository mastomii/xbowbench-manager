import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  startBenchmark,
  stopBenchmark,
  restartBenchmark,
  buildBenchmark,
  getBenchmarkLogs,
  getBenchmarkInfo,
} from '@/lib/docker'
import path from 'path'

function getBenchmarksPath(): string {
  return process.env.BENCHMARKS_PATH || path.join(process.cwd(), '..', 'validation-benchmarks', 'benchmarks')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const benchmarksPath = getBenchmarksPath()
  const benchmarkPath = path.join(benchmarksPath, id)

  try {
    const info = await getBenchmarkInfo(id, benchmarkPath)
    return NextResponse.json(info)
  } catch (error) {
    console.error('Error getting benchmark:', error)
    return NextResponse.json(
      { error: 'Failed to get benchmark info' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const { action, port } = body

  try {
    let result: { success: boolean; error?: string; ports?: Record<string, number> }

    switch (action) {
      case 'start':
        result = await startBenchmark(id, port)
        break
      case 'stop':
        result = await stopBenchmark(id)
        break
      case 'restart':
        result = await restartBenchmark(id)
        break
      case 'build':
        result = await buildBenchmark(id)
        break
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (result.success) {
      return NextResponse.json(result)
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error(`Error performing ${action} on ${id}:`, error)
    return NextResponse.json(
      { error: `Failed to ${action} benchmark` },
      { status: 500 }
    )
  }
}
