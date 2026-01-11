import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { analyzeBenchmark, fixBenchmark, analyzeAllBenchmarks, fixAllBenchmarks } from '@/lib/fixer'
import path from 'path'

function getBenchmarksPath(): string {
  return process.env.BENCHMARKS_PATH || path.join(process.cwd(), '..', 'validation-benchmarks', 'benchmarks')
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const benchmarkId = searchParams.get('id')
  const benchmarksPath = getBenchmarksPath()

  try {
    if (benchmarkId) {
      // Analyze single benchmark
      const benchmarkPath = path.join(benchmarksPath, benchmarkId)
      const issues = await analyzeBenchmark(benchmarkPath)
      return NextResponse.json({ benchmark: benchmarkId, issues })
    } else {
      // Analyze all benchmarks
      const allIssues = await analyzeAllBenchmarks()
      return NextResponse.json({ benchmarks: allIssues })
    }
  } catch (error) {
    console.error('Error analyzing benchmark:', error)
    return NextResponse.json(
      { error: 'Failed to analyze benchmark' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { id, all } = body
  const benchmarksPath = getBenchmarksPath()

  try {
    if (all) {
      // Fix all benchmarks
      const results = await fixAllBenchmarks()
      return NextResponse.json({ success: true, results })
    } else if (id) {
      // Fix single benchmark
      const benchmarkPath = path.join(benchmarksPath, id)
      const result = await fixBenchmark(benchmarkPath)
      return NextResponse.json({ success: true, result })
    } else {
      return NextResponse.json(
        { error: 'Must specify id or all=true' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error fixing benchmark:', error)
    return NextResponse.json(
      { error: 'Failed to fix benchmark' },
      { status: 500 }
    )
  }
}
