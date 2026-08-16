import { NextResponse } from "next/server";
import { examRecord, examRecordInput, gradebookResponse } from "@astra/shared";
import { newRequestId, errorResponse } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getSessionUser } from "@/lib/session";
import {
  GradebookError,
  createExamRecord,
  listGradebook,
  toExamRecord,
} from "@/lib/gradebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = newRequestId();
  const session = await getSessionUser(req.headers);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Not signed in.", requestId);
  assertCan(session.actor, "self:read", { ownerId: session.user.id });

  const rows = await listGradebook(session.user.id);
  return NextResponse.json(
    gradebookResponse.parse({ records: rows.map(toExamRecord) }),
    { headers: { "x-request-id": requestId } }
  );
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const session = await getSessionUser(req.headers);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Not signed in.", requestId);
  assertCan(session.actor, "self:write", { ownerId: session.user.id });

  const parsed = examRecordInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid exam record.",
      requestId
    );
  }

  try {
    const row = await createExamRecord(session.user.id, parsed.data);
    return NextResponse.json(
      { record: examRecord.parse(toExamRecord(row)) },
      { status: 201, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    if (error instanceof GradebookError) {
      return errorResponse(400, "INVALID_EXAM_RECORD", error.message, requestId);
    }
    throw error;
  }
}
