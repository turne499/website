"use client";

import { useState } from "react";
import Link from "next/link";
import { MemberSearch, type MemberOption } from "@/components/portal/MemberSearch";
import { EmailEditorModal, type EmailPayload } from "@/components/portal/EmailEditorModal";
import { approvalTemplate } from "@/lib/email/strikes";
import { weightLabel } from "@/lib/strikes";
import { CheckCircle, X } from "lucide-react";

type Props = {
  isExec: boolean;
  sessionMemberId: string;
};

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function StrikeForm({ isExec }: Props) {
  const [selectedMembers, setSelectedMembers] = useState<MemberOption[]>([]);
  const [strikeType, setStrikeType] = useState<"half" | "full">("full");
  const [reason, setReason] = useState("");
  const [memberTotals, setMemberTotals] = useState<Record<string, number>>({});
  const [loadingTotals, setLoadingTotals] = useState<string[]>([]);

  // Exec flow: one email per member, reviewed in order. null = modal closed.
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [reviewedEmails, setReviewedEmails] = useState<EmailPayload[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMemberSelect(member: MemberOption) {
    if (selectedMembers.some((m) => m.id === member.id)) return;
    setSelectedMembers((prev) => [...prev, member]);
    if (!isExec) return;
    setLoadingTotals((prev) => [...prev, member.id]);
    try {
      const res = await fetch(
        `/api/strikes?summary=true&member_id=${encodeURIComponent(member.id)}`
      );
      if (res.ok) {
        const data = await res.json();
        setMemberTotals((prev) => ({ ...prev, [member.id]: data.total ?? 0 }));
      }
    } finally {
      setLoadingTotals((prev) => prev.filter((id) => id !== member.id));
    }
  }

  function handleMemberRemove(id: string) {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== id));
  }

  function projectedTotalFor(member: MemberOption) {
    return (memberTotals[member.id] ?? 0) + (strikeType === "full" ? 1 : 0.5);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedMembers.length === 0 || !reason.trim()) return;
    setError(null);
    if (isExec) {
      setReviewedEmails([]);
      setReviewIndex(0);
    } else {
      doSubmit([]);
    }
  }

  function handleEmailConfirm(email: EmailPayload) {
    if (reviewIndex === null) return;
    const emails = [...reviewedEmails.slice(0, reviewIndex), email];
    setReviewedEmails(emails);
    if (reviewIndex < selectedMembers.length - 1) {
      setReviewIndex(reviewIndex + 1);
    } else {
      doSubmit(emails);
    }
  }

  async function doSubmit(emails: EmailPayload[]) {
    if (selectedMembers.length === 0) return;
    if (isExec && emails.length !== selectedMembers.length) {
      setError("Email subject and body are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setReviewIndex(null);

    try {
      const res = await fetch("/api/strikes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strike_type: strikeType,
          reason,
          targets: selectedMembers.map((m, i) => ({
            member_id: m.id,
            email_subject: emails[i]?.subject,
            email_body: emails[i]?.body,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const names = listNames(selectedMembers.map((m) => m.name));
  const multiple = selectedMembers.length > 1;

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white p-8 flex flex-col items-center text-center gap-4">
        <span className="grid place-items-center w-14 h-14 rounded-full bg-green-50 text-green-600">
          <CheckCircle size={28} />
        </span>
        <div>
          <h2 className="font-display font-bold text-xl text-[var(--bg-dark)]">
            {isExec
              ? multiple ? `${selectedMembers.length} strikes submitted` : "Strike submitted"
              : multiple ? "Requests submitted" : "Request submitted"}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)] max-w-sm">
            {isExec
              ? `A ${strikeType} strike has been filed against ${names} and ${multiple ? "each has" : "they have"} been notified.`
              : `Your strike ${multiple ? "requests" : "request"} against ${names} ${multiple ? "have" : "has"} been submitted for exec review.`}
          </p>
        </div>
        <Link href="/portal/strikes" className="btn btn-gold text-sm px-5 py-2 mt-2">
          View strikes
        </Link>
      </div>
    );
  }

  const reviewMember = reviewIndex !== null ? selectedMembers[reviewIndex] : null;
  const reviewTemplate = reviewMember
    ? approvalTemplate(reviewMember.name, reason || "(reason)", projectedTotalFor(reviewMember))
    : null;
  const reviewIsLast = reviewIndex === selectedMembers.length - 1;

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[var(--border)] bg-white p-6 md:p-8 space-y-6"
      >
        {/* Member search */}
        <div>
          <label className="block text-sm font-semibold text-[var(--bg-dark)] mb-2">
            {multiple ? `Members (${selectedMembers.length})` : "Members"}
          </label>
          <MemberSearch
            onSelect={handleMemberSelect}
            disabled={submitting}
            clearOnSelect
            excludeIds={selectedMembers.map((m) => m.id)}
            placeholder={
              selectedMembers.length > 0 ? "Add another member…" : "Search member name…"
            }
          />
          {selectedMembers.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {selectedMembers.map((m) => (
                <li
                  key={m.id}
                  className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-cream)]/40 text-sm"
                >
                  <span className="font-medium text-[var(--bg-dark)]">{m.name}</span>
                  {isExec && (
                    <span className="text-xs text-[var(--muted)]">
                      {loadingTotals.includes(m.id)
                        ? "…"
                        : `${memberTotals[m.id] ?? 0} strike${memberTotals[m.id] === 1 ? "" : "s"}`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleMemberRemove(m.id)}
                    disabled={submitting}
                    className="grid place-items-center w-5 h-5 rounded-full text-[var(--muted)] hover:text-[var(--bg-dark)] hover:bg-gray-100"
                    aria-label={`Remove ${m.name}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isExec && multiple && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Each member gets the same strike and reason, with their own email to review.
            </p>
          )}
        </div>

        {/* Strike type */}
        <div>
          <label className="block text-sm font-semibold text-[var(--bg-dark)] mb-2">
            Strike weight
          </label>
          <div className="flex gap-3">
            {(["half", "full"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setStrikeType(t)}
                className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all ${
                  strikeType === t
                    ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold-deep)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50"
                }`}
              >
                {weightLabel(t)}
              </button>
            ))}
          </div>
        </div>

        {/* Reason */}
        <div>
          <label
            htmlFor="reason"
            className="block text-sm font-semibold text-[var(--bg-dark)] mb-2"
          >
            Reason
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Describe the reason for this strike request…"
            disabled={submitting}
            required
            className="w-full px-4 py-3 rounded-xl border border-[var(--border)] text-sm focus:outline-2 focus:outline-[var(--gold)] focus:outline-offset-2 resize-y disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={
            submitting ||
            selectedMembers.length === 0 ||
            !reason.trim() ||
            loadingTotals.length > 0
          }
          className="btn btn-gold w-full py-3 disabled:opacity-50"
        >
          {submitting
            ? "Submitting…"
            : isExec
            ? multiple ? `Review ${selectedMembers.length} emails & submit` : "Review email & submit"
            : multiple ? `Submit ${selectedMembers.length} requests` : "Submit request"}
        </button>
      </form>

      {reviewMember && reviewTemplate && (
        <EmailEditorModal
          key={reviewMember.id}
          title={
            multiple
              ? `Email to ${reviewMember.name} (${reviewIndex! + 1} of ${selectedMembers.length})`
              : `Email to ${reviewMember.name}`
          }
          confirmLabel={
            !reviewIsLast
              ? "Next email"
              : multiple
              ? `Confirm & send ${selectedMembers.length} strikes`
              : "Confirm & send strike"
          }
          initialSubject={reviewTemplate.subject}
          initialBody={reviewTemplate.innerHtml}
          loading={submitting}
          onCancel={() => setReviewIndex(null)}
          onConfirm={handleEmailConfirm}
        />
      )}
    </>
  );
}
