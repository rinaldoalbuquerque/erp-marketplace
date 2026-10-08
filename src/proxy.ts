import { type NextRequest } from "next/server";

import { updateSession } from "@/server/auth/proxy-session";

// Next.js 16 "proxy" (formerly middleware). Docs: node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/proxy.md
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Every path except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
