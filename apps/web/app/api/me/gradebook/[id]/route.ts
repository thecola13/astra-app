import { NextResponse } from "next/server";
import { examRecord, examRecordInput } from "@astra/shared";
import { newRequestId, errorResponse } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getSessionUser } from "@/lib/session";
import {
  GradebookError,
  deleteExamRecord,
  toExamRecord,
  updateExamRecord,
} from "@/lib/gradebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/me/gradebook/:id — replace one attempt. Ownership is enforced in the
// query itself, so a guessed id from another student is a 404, not a leak.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const session = await getSessionUser(req.headers);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Not signed in.", requestId);
  assertCan(session.actor, "self:write", { ownerId: session.user.id });
  const { id } = await ctx.params;

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
    const row = await updateExamRecord(session.user.id, id, parsed.data);
    return NextResponse.json(
      { record: examRecord.parse(toExamRecord(row)) },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    if (error instanceof GradebookError) {
      const notFound = error.message === "Exam record not found.";
      return errorResponse(
        notFound ? 404 : 400,
        notFound ? "NOT_FOUND" : "INVALID_EXAM_RECORD",
        error.message,
        requestId
      );
    }
    throw error;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const session = await getSessionUser(req.headers);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Not signed in.", requestId);
  assertCan(session.actor, "self:write", { ownerId: session.user.id });
  const { id } = await ctx.params;

  try {
    await deleteExamRecord(session.user.id, id);
  } catch (error) {
    if (error instanceof GradebookError) {
      return errorResponse(404, "NOT_FOUND", error.message, requestId);
    }
    throw error;
  }
  return NextResponse.json({ ok: true }, { headers: { "x-request-id": requestId } });
}
