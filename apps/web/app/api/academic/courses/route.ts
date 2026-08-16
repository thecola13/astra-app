import { NextResponse } from "next/server";
import { academicCourseSearchResponse } from "@astra/shared";
import { newRequestId, errorResponse } from "@/lib/api";
import { getSessionUser } from "@/lib/session";
import { getAcademicProfile, searchCourses } from "@/lib/academic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/academic/courses?q=&programmeId=&all=1
 *
 * Defaults to the student's own programme, since that is what the gradebook
 * picker wants. `all=1` searches the whole catalogue for electives, exchange
 * and courses borrowed from another programme.
 */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const session = await getSessionUser(req.headers);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Not signed in.", requestId);

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  let programmeId = url.searchParams.get("programmeId") ?? undefined;
  if (!programmeId && !all) {
    programmeId = (await getAcademicProfile(session.user.id))?.programmeId;
  }

  const courses = await searchCourses({
    q: url.searchParams.get("q") ?? undefined,
    programmeId,
  });

  return NextResponse.json(academicCourseSearchResponse.parse({ courses }), {
    headers: { "x-request-id": requestId },
  });
}
