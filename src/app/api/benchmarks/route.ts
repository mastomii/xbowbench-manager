import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listBenchmarks, getDockerInfo, pullBenchmarks } from '@/lib/docker'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [benchmarks, dockerInfo] = await Promise.all([
      listBenchmarks(),
      getDockerInfo(),
    ])

    return NextResponse.json({
      benchmarks,
      docker: dockerInfo,
      total: benchmarks.length,
      running: benchmarks.filter(b => b.status === 'running').length,
    })
  } catch (error) {
    console.error('Error listing benchmarks:', error)
    return NextResponse.json(
      { error: 'Failed to list benchmarks' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { action } = await request.json()

    if (action === 'pull') {
      const result = await pullBenchmarks()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    )
  }
}
