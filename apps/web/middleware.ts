import { NextResponse, type NextRequest } from 'next/server';
import { localRequestRefusal } from './lib/local-guard';

export function middleware(req: NextRequest) {
  const refusal = localRequestRefusal(req.headers, process.env.ARCHWOVEN_MODE);
  return refusal ? NextResponse.json({ error: refusal }, { status: 403 }) : NextResponse.next();
}

// Node runtime: the deploy mode is read at request time, never inlined at build.
export const config = { matcher: '/api/:path*', runtime: 'nodejs' };
