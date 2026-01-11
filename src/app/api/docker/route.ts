import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDockerInfo, getSystemStats, getAppAccessUrl } from '@/lib/docker'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [dockerInfo, systemStats] = await Promise.all([
      getDockerInfo(),
      getSystemStats(),
    ])

    return NextResponse.json({
      ...dockerInfo,
      system: systemStats,
      appAccess: getAppAccessUrl(),
    })
  } catch (error) {
    console.error('Error getting Docker info:', error)
    return NextResponse.json(
      { error: 'Failed to get Docker info', connected: false },
      { status: 500 }
    )
  }
}
