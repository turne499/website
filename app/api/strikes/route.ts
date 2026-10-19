import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServerClient } from "@/lib/supabase/server";
import { computeStrikeTotal } from "@/lib/strikes";
import {
  execAlertTemplate,
  hrNoticeTemplate,
  wrapInShell,
} from "@/lib/email/strikes";
import { sendEmail } from "@/lib/email/send";

const HR_EMAIL = "hr@cubeconsulting.org";

export const dynamic = "force-dynamic";

const STRIKE_ROLES = ["exec", "project_manager", "senior_consultant"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { memberId, role } = session.user;
  const supabase = createServerClient();
  const params = req.nextUrl.searchParams;
  const filterMemberId = params.get("member_id");
  const summary = params.get("summary") === "true";

  // Strike total summary (exec only)
  if (summary && filterMemberId) {
    if (role !== "exec") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data } = await supabase
      .from("strikes")
      .select("effective_type, status")
      .eq("member_id", filterMemberId);
    const total = computeStrikeTotal(data ?? []);
    return NextResponse.json({ total });
  }

  if (role === "exec") {
    const query = supabase
      .from("strikes")
      .select(`
        *,
        member:member_id ( id, full_name, email ),
        filer:filed_by ( id, full_name, email ),
        resolver:resolved_by ( id, full_name, email )
      `)
      .order("created_at", { ascending: false });

    if (filterMemberId) query.eq("member_id", filterMemberId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ strikes: data ?? [] });
  }

  if (role === "project_manager" || role === "senior_consultant") {
    // Their filed requests
    const { data: filed } = await supabase
      .from("strikes")
      .select(`
        *,
        member:member_id ( id, full_name, email )
      `)
      .eq("filed_by", memberId)
      .order("created_at", { ascending: false });

    // Their own received approved strikes
    const { data: received } = await supabase
      .from("strikes")
      .select("id, strike_type, effective_type, reason, status, created_at")
      .eq("member_id", memberId)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    return NextResponse.json({ filed: filed ?? [], received: received ?? [] });
  }

  // Regular member — own approved strikes only
  const { data, error } = await supabase
    .from("strikes")
    .select("id, strike_type, effective_type, reason, status, created_at")
    .eq("member_id", memberId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ received: data ?? [] });
}

const MAX_TARGETS = 50;

type TargetInput = { member_id?: unknown; email_subject?: unknown; email_body?: unknown };

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { memberId, role, name: filerName, email: filerEmail } = session.user;

  if (!STRIKE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { strike_type, reason } = body;

  // Several members can be struck in one filing via `targets`, each with their
  // own email. A single strike may still be sent as target_member_id + email fields.
  const targets: TargetInput[] = Array.isArray(body.targets)
    ? body.targets
    : body.target_member_id
    ? [
        {
          member_id: body.target_member_id,
          email_subject: body.email_subject,
          email_body: body.email_body,
        },
      ]
    : [];

  if (targets.length === 0 || !strike_type || !reason) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["half", "full"].includes(strike_type)) {
    return NextResponse.json({ error: "Invalid strike_type" }, { status: 400 });
  }
  if (targets.length > MAX_TARGETS) {
    return NextResponse.json(
      { error: `At most ${MAX_TARGETS} members can be struck at once` },
      { status: 400 }
    );
  }

  const targetIds = targets.map((t) => t?.member_id);
  if (targetIds.some((id) => typeof id !== "string" || !id)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (new Set(targetIds).size !== targetIds.length) {
    return NextResponse.json(
      { error: "A member can only be struck once per filing" },
      { status: 400 }
    );
  }

  const isExec = role === "exec";

  // Exec strikes are approved on insert, so every member's email must be present
  // before anything is written.
  if (
    isExec &&
    targets.some(
      (t) =>
        typeof t.email_subject !== "string" ||
        !t.email_subject.trim() ||
        typeof t.email_body !== "string" ||
        !t.email_body.trim()
    )
  ) {
    return NextResponse.json({ error: "Missing email content" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: foundMembers } = await supabase
    .from("members")
    .select("id, full_name, email")
    .in("id", targetIds as string[]);

  const membersById = new Map((foundMembers ?? []).map((m) => [m.id as string, m]));
  if (targetIds.some((id) => !membersById.has(id as string))) {
    return NextResponse.json({ error: "Target member not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const status = isExec ? "approved" : "pending";

  // One insert, so a multi-member filing lands all-or-nothing.
  const { data: strikes, error } = await supabase
    .from("strikes")
    .insert(
      targets.map((t) => ({
        member_id: t.member_id as string,
        filed_by: memberId,
        strike_type,
        effective_type: isExec ? strike_type : null,
        reason,
        status,
        resolved_at: isExec ? now : null,
        resolved_by: isExec ? memberId : null,
      }))
    )
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targetNames = targets.map((t) => membersById.get(t.member_id as string)!.full_name);

  // Best-effort HR notice, one per filing. Email failure never fails the strike.
  try {
    const hrNotice =
      targets.length === 1
        ? hrNoticeTemplate(
            "filed",
            targetNames[0],
            `A ${strike_type} strike was filed by ${filerName} (${filerEmail}). Reason: ${reason}. Status: ${status}.`
          )
        : hrNoticeTemplate(
            "filed",
            `${targets.length} members`,
            `A ${strike_type} strike was filed against each of ${listNames(targetNames)} by ${filerName} (${filerEmail}). Reason: ${reason}. Status: ${status}.`
          );
    await sendEmail({
      to: HR_EMAIL,
      subject: hrNotice.subject,
      html: wrapInShell(hrNotice.subject, hrNotice.innerHtml),
    });
  } catch (e) {
    console.error("Strike filing HR notice failed (non-fatal):", e);
  }

  // Send emails for exec-filed (immediately approved) strikes
  if (isExec) {
    let totals = new Map<string, number>();
    let execEmails: string[] | null = null;
    try {
      const { data: allStrikes } = await supabase
        .from("strikes")
        .select("member_id, effective_type, status")
        .in("member_id", targetIds as string[]);
      totals = new Map(
        targetIds.map((id) => [
          id as string,
          computeStrikeTotal((allStrikes ?? []).filter((s) => s.member_id === id)),
        ])
      );
    } catch (e) {
      console.error("Strike total lookup failed (non-fatal):", e);
    }

    // Each member is notified separately so one bad address doesn't stop the rest.
    for (const t of targets) {
      const target = membersById.get(t.member_id as string)!;
      try {
        await sendEmail({
          to: target.email,
          subject: t.email_subject as string,
          html: wrapInShell(t.email_subject as string, t.email_body as string),
        });

        // 3-strike exec alert
        if ((totals.get(target.id) ?? 0) >= 3) {
          if (execEmails === null) {
            const { data: execMembers } = await supabase
              .from("members")
              .select("email")
              .eq("role", "exec");
            execEmails = (execMembers ?? []).map((m) => m.email);
          }
          if (execEmails.length > 0) {
            const alert = execAlertTemplate(target.full_name);
            await sendEmail({
              to: execEmails,
              subject: alert.subject,
              html: wrapInShell(alert.subject, alert.innerHtml),
            });
          }
        }
      } catch (e) {
        console.error(`Strike notification email to ${target.id} failed (non-fatal):`, e);
      }
    }
  }

  return NextResponse.json({ strikes: strikes ?? [] }, { status: 201 });
}
