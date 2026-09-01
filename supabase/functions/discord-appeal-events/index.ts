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
  created_at: string;
  closed_at: string | null;
  appeal_submissions: SubmissionRecord | SubmissionRecord[];
};

const STAFF_REVIEW_URL = "https://thy-toxic-gamer.github.io/appeals-center/staff.html";
const STAFF_ARCHIVE_URL = `${STAFF_REVIEW_URL}#archive`;

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

function getSupabaseAdminKey() {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as Record<string, unknown>;
      const defaultKey = secretKeys.default;
      if (typeof defaultKey === "string" && defaultKey) return defaultKey;

      const firstNamedKey = Object.values(secretKeys).find(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (firstNamedKey) return firstNamedKey;
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS is not valid JSON.");
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown function error.";
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
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const projectUrl = Deno.env.get("SUPABASE_URL");
    const databaseWebhookSecret = Deno.env.get("DATABASE_WEBHOOK_SECRET");
    const appealsWebhook = Deno.env.get("DISCORD_APPEALS_WEBHOOK_URL");
    const logsWebhook = Deno.env.get("DISCORD_APPEAL_LOGS_WEBHOOK_URL");
    const authorization = request.headers.get("Authorization");

    if (!databaseWebhookSecret || authorization !== `Bearer ${databaseWebhookSecret}`) {
      console.error("discord-appeal-events failed: webhook authorization was rejected.");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminKey = getSupabaseAdminKey();
    const missingConfiguration = [
      !projectUrl && "SUPABASE_URL",
      !adminKey && "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS",
      !appealsWebhook && "DISCORD_APPEALS_WEBHOOK_URL",
      !logsWebhook && "DISCORD_APPEAL_LOGS_WEBHOOK_URL",
    ].filter(Boolean);

    if (missingConfiguration.length) {
      const message = `Missing server configuration: ${missingConfiguration.join(", ")}`;
      console.error(`discord-appeal-events failed: ${message}`);
      return Response.json({ error: message }, { status: 500 });
    }

    let payload: WebhookPayload;
    try {
      payload = (await request.json()) as WebhookPayload;
    } catch {
      console.error("discord-appeal-events failed: request body was not valid JSON.");
      return Response.json({ error: "Request body was not valid JSON." }, { status: 400 });
    }

    if (
      payload.type !== "INSERT" ||
      payload.schema !== "public" ||
      payload.table !== "appeal_logs" ||
      !payload.record?.case_id
    ) {
      return Response.json({ ignored: true });
    }

    const log = payload.record;
    const caseUrl = new URL(`${projectUrl}/rest/v1/appeal_cases`);
    caseUrl.searchParams.set(
      "select",
      "case_number,platform,action_type,status,created_at,closed_at,appeal_submissions(submission_number,is_test)",
    );
    caseUrl.searchParams.set("id", `eq.${log.case_id}`);

    const caseResponse = await fetch(caseUrl, {
      headers: {
        apikey: adminKey!,
        Accept: "application/vnd.pgrst.object+json",
      },
    });

    if (!caseResponse.ok) {
      const databaseError = (await caseResponse.text()).slice(0, 500);
      throw new Error(`Database lookup failed (${caseResponse.status}): ${databaseError}`);
    }

    const appealCase = (await caseResponse.json()) as CaseRecord;
    const submission = getSubmission(appealCase);
    const isTest = Boolean(submission?.is_test);
    const platform = platformNames[appealCase.platform] || titleCase(appealCase.platform);
    const timestamp = log.created_at || new Date().toISOString();
    const commonFields = [
      { name: "Case", value: appealCase.case_number, inline: true },
      { name: "Submission", value: submission?.submission_number || "Unknown", inline: true },
      { name: "Platform", value: platform, inline: true },
      { name: "Action", value: appealCase.action_type, inline: true },
      { name: "Status", value: titleCase(log.new_status || appealCase.status), inline: true },
    ];

    const isClosedEvent = log.event_type === "status_changed" && (log.new_status || appealCase.status) === "closed";
    let destination = "none";

    if (isClosedEvent) {
      await postDiscord(logsWebhook!, {
        content: "An appeal has been closed and moved to the protected archive.",
        embeds: [{
          title: `${isTest ? "🧪 Test " : ""}Appeal Archived`,
          color: platformColors[appealCase.platform] || 0xa8f000,
          fields: [
            ...commonFields,
            { name: "Opened", value: new Date(appealCase.created_at).toISOString(), inline: true },
            { name: "Closed", value: new Date(appealCase.closed_at || timestamp).toISOString(), inline: true },
          ],
          url: STAFF_ARCHIVE_URL,
          timestamp,
          footer: { text: "Full protected record: Staff Review → Archive" },
        }],
      });
      destination = "appeal-logs";
    } else if (["case_created", "status_changed", "applicant_update"].includes(log.event_type)) {
      const isNew = log.event_type === "case_created";
      await postDiscord(appealsWebhook!, {
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
      destination = "appeals";
    }

    console.log(`discord-appeal-events routed ${log.event_type} for ${appealCase.case_number} to ${destination}.`);
    return Response.json({ ok: true, event: log.event_type, case: appealCase.case_number, destination });
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error(`discord-appeal-events failed: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
});
