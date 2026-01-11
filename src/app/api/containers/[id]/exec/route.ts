import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { execInContainer } from '@/lib/docker'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { command } = await request.json()

  if (!command || !Array.isArray(command)) {
    return NextResponse.json({ error: 'Invalid command' }, { status: 400 })
  }

  try {
    const result = await execInContainer(id, command)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error executing in container:', error)
    return NextResponse.json(
      { error: 'Failed to execute command' },
      { status: 500 }
    )
  }
}
