import { createClient } from "npm:@supabase/supabase-js@2";

type AppealLog = {
  case_id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: AppealLog;
};

type SubmissionRecord = {
  submission_number: string;
  is_test: boolean;
};

type CaseRecord = {
  case_number: string;
  platform: string;
  action_type: string;
  status: string;
  appeal_submissions: SubmissionRecord | SubmissionRecord[];
};

const STAFF_REVIEW_URL = "https://thy-toxic-gamer.github.io/appeals-center/staff.html";

const platformNames: Record<string, string> = {
  discord: "Discord",
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  twitter: "X / Twitter",
  instagram: "Instagram",
};

const platformColors: Record<string, number> = {
  discord: 0x5865f2,
  twitch: 0x9146ff,
  youtube: 0xff304f,
  kick: 0x53fc18,
  twitter: 0x1d9bf0,
  instagram: 0xff3e98,
};

function titleCase(value: unknown) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getSubmission(record: CaseRecord) {
  return Array.isArray(record.appeal_submissions)
    ? record.appeal_submissions[0]
    : record.appeal_submissions;
}

async function postDiscord(webhookUrl: string, body: Record<string, unknown>) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐁𝐨𝐭⁆",
      allowed_mentions: { parse: [] },
      ...body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord rejected the notification (${response.status}).`);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const databaseWebhookSecret = Deno.env.get("DATABASE_WEBHOOK_SECRET");
  const appealsWebhook = Deno.env.get("DISCORD_APPEALS_WEBHOOK_URL");
  const logsWebhook = Deno.env.get("DISCORD_APPEAL_LOGS_WEBHOOK_URL");
  const authorization = request.headers.get("Authorization");

  if (!databaseWebhookSecret || authorization !== `Bearer ${databaseWebhookSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!projectUrl || !serviceRoleKey || !appealsWebhook || !logsWebhook) {
    return Response.json({ error: "Required server secrets are not configured." }, { status: 500 });
  }

  const payload = (await request.json()) as WebhookPayload;
  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    payload.table !== "appeal_logs" ||
    !payload.record?.case_id
  ) {
    return Response.json({ ignored: true });
  }

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const log = payload.record;
  const { data: caseData, error: caseError } = await admin
    .from("appeal_cases")
    .select("case_number, platform, action_type, status, appeal_submissions(submission_number, is_test)")
    .eq("id", log.case_id)
    .single();

  if (caseError || !caseData) {
    return Response.json(
      { error: caseError?.message || "Appeal case could not be loaded." },
      { status: 500 },
    );
  }

  const appealCase = caseData as unknown as CaseRecord;
  const submission = getSubmission(appealCase);
  const isTest = Boolean(submission?.is_test);
  const platform = platformNames[appealCase.platform] || titleCase(appealCase.platform);
  const eventName = titleCase(log.event_type);
  const timestamp = log.created_at || new Date().toISOString();
  const commonFields = [
    { name: "Case", value: appealCase.case_number, inline: true },
    { name: "Submission", value: submission?.submission_number || "Unknown", inline: true },
    { name: "Platform", value: platform, inline: true },
    { name: "Action", value: appealCase.action_type, inline: true },
    { name: "Status", value: titleCase(log.new_status || appealCase.status), inline: true },
  ];

  const logFields = [
    ...commonFields,
    { name: "Event", value: eventName, inline: true },
  ];
  if (log.old_status || log.new_status) {
    logFields.push({
      name: "Status change",
      value: `${titleCase(log.old_status || "new")} → ${titleCase(log.new_status || appealCase.status)}`,
      inline: false,
    });
  }

  await postDiscord(logsWebhook, {
    embeds: [{
      title: `${isTest ? "🧪 Test · " : "⚖️ "}${eventName}`,
      color: platformColors[appealCase.platform] || 0xa8f000,
      fields: logFields,
      url: STAFF_REVIEW_URL,
      timestamp,
      footer: { text: "Appeals Center · Minimal private audit alert" },
    }],
  });

  if (["case_created", "status_changed", "applicant_update"].includes(log.event_type)) {
    const isNew = log.event_type === "case_created";
    await postDiscord(appealsWebhook, {
      content: isNew ? "A new appeal is ready for staff review." : "An appeal has been updated.",
      embeds: [{
        title: `${isTest ? "🧪 Test " : ""}${isNew ? "New Appeal" : "Appeal Status Updated"}`,
        color: platformColors[appealCase.platform] || 0xa8f000,
        fields: commonFields,
        url: STAFF_REVIEW_URL,
        timestamp,
        footer: { text: "Open Staff Review for protected details" },
      }],
    });
  }

  return Response.json({ ok: true, event: log.event_type, case: appealCase.case_number });
});
