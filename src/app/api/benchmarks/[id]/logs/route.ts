import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBenchmarkLogs } from '@/lib/docker'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const tail = parseInt(searchParams.get('tail') || '100', 10)

  try {
    const logs = await getBenchmarkLogs(id, tail)
    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Error getting logs:', error)
    return NextResponse.json(
      { error: 'Failed to get logs' },
      { status: 500 }
    )
  }
}
