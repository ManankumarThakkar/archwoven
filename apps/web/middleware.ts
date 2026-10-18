import { NextResponse, type NextRequest } from 'next/server';
import { localRequestRefusal } from './lib/local-guard';
import { hostingProbeRequested } from './lib/hosting-probe';

export function middleware(req: NextRequest) {
  if (hostingProbeRequested() && req.nextUrl.pathname !== '/api/hosting-probe') {
    return NextResponse.json({
      error: 'hosting-probe-only',
      message: 'This preview is running deployment diagnostics. Diagram generation is unavailable.',
    }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const refusal = localRequestRefusal(req.headers, process.env.ARCHWOVEN_MODE);
  return refusal ? NextResponse.json({ error: refusal }, { status: 403 }) : NextResponse.next();
}

// Node runtime: the deploy mode is read at request time, never inlined at build.
export const config = { matcher: '/api/:path*', runtime: 'nodejs' };
