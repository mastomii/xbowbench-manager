import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getContainerLogs } from '@/lib/docker'

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
    const logs = await getContainerLogs(id, tail)
    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Error getting container logs:', error)
    return NextResponse.json(
      { error: 'Failed to get container logs' },
      { status: 500 }
    )
  }
}
