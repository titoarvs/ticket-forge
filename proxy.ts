import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// The landing page (/) is for visitors. Someone already signed in (they have a session cookie) goes
// straight to their projects, so old links and bookmarks to / keep opening the app.
export function proxy(request: NextRequest) {
  if (request.cookies.get('tf_session')?.value)
    return NextResponse.redirect(new URL('/projects', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/'] };
