import { NextRequest, NextResponse } from 'next/server';
import { getKlingVideoTask } from '@/lib/services/kling';

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId');
    const provider = request.nextUrl.searchParams.get('provider');

    if (!taskId || !provider) {
      return NextResponse.json(
        { error: 'taskId and provider are required' },
        { status: 400 }
      );
    }

    if (provider === 'kling') {
      const result = await getKlingVideoTask(taskId);

      return NextResponse.json({
        status: result.status === 'succeed' ? 'completed' : result.status === 'failed' ? 'failed' : 'processing',
        taskId: result.taskId,
        ...(result.videoUrl && {
          outputs: [{ type: 'video', url: result.videoUrl, duration: result.duration }],
        }),
      });
    }

    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status check failed';
    console.error('Status check error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
