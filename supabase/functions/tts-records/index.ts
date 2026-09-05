type TtsRecordInput = {
  source_event_id?: unknown;
  source_key?: unknown;
  queue_number?: unknown;
  tts_type?: unknown;
  status?: unknown;
  status_note?: unknown;
  sender?: unknown;
  platform?: unknown;
  contribution?: unknown;
  transcript?: unknown;
  received_at?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  stream_id?: unknown;
  twitch_vod_url?: unknown;
  twitch_vod_note?: unknown;
  discord_channel_id?: unknown;
  discord_message_id?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tts-records-key",
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function text(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${name} must contain ${min}-${max} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, name: string, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, name, 1, max);
}

function timestamp(value: unknown, name: string, required: boolean) {
  if (!required && (value === null || value === undefined || value === "")) return null;
  const normalized = text(value, name, 1, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${name} must be a valid timestamp.`);
  return new Date(normalized).toISOString();
}

function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(1, a.length)] || 0) ^ (b[index % Math.max(1, b.length)] || 0);
  }
  return difference === 0;
}

function getAdminKey() {
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    const value = parsed.default || Object.values(parsed).find((entry) => typeof entry === "string" && entry);
    if (typeof value === "string") return value;
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function normalize(input: TtsRecordInput) {
  const queueNumber = Number(input.queue_number);
  if (!Number.isSafeInteger(queueNumber) || queueNumber < 1) throw new Error("queue_number must be a positive integer.");
  const ttsType = text(input.tts_type, "tts_type", 1, 20);
  const status = text(input.status, "status", 1, 20);
  if (!["free", "bits", "donations"].includes(ttsType)) throw new Error("tts_type is invalid.");
  if (!["completed", "blocked", "interrupted"].includes(status)) throw new Error("status is invalid.");
  return {
    source_event_id: text(input.source_event_id, "source_event_id", 1, 200),
    source_key: optionalText(input.source_key, "source_key", 200),
    queue_number: queueNumber,
    tts_type: ttsType,
    status,
    status_note: optionalText(input.status_note, "status_note", 500) || "",
    sender: text(input.sender, "sender", 1, 200),
    platform: text(input.platform, "platform", 1, 100),
    contribution: text(input.contribution, "contribution", 1, 200),
    transcript: text(input.transcript, "transcript", 1, 10000),
    received_at: timestamp(input.received_at, "received_at", true),
    started_at: timestamp(input.started_at, "started_at", false),
    ended_at: timestamp(input.ended_at, "ended_at", true),
    stream_id: optionalText(input.stream_id, "stream_id", 100),
    twitch_vod_url: optionalText(input.twitch_vod_url, "twitch_vod_url", 500),
    twitch_vod_note: optionalText(input.twitch_vod_note, "twitch_vod_note", 500),
    discord_channel_id: optionalText(input.discord_channel_id, "discord_channel_id", 100),
    discord_message_id: optionalText(input.discord_message_id, "discord_message_id", 100),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  try {
    const expectedKey = Deno.env.get("TTS_RECORDS_INGEST_KEY") || "";
    const suppliedKey = request.headers.get("x-tts-records-key") || "";
    if (!expectedKey || !secureEqual(suppliedKey, expectedKey)) return response({ error: "Unauthorized." }, 401);
    const projectUrl = Deno.env.get("SUPABASE_URL") || "";
    const adminKey = getAdminKey();
    if (!projectUrl || !adminKey) return response({ error: "Server configuration is incomplete." }, 500);
    const record = normalize(await request.json() as TtsRecordInput);
    const result = await fetch(`${projectUrl}/rest/v1/tts_records?on_conflict=source_event_id`, {
      method: "POST",
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(record),
    });
    if (!result.ok) throw new Error(`Database rejected the record (${result.status}): ${(await result.text()).slice(0, 300)}`);
    const saved = (await result.json()) as Array<{ id: string; purge_after: string }>;
    return response({ ok: true, id: saved[0]?.id, purge_after: saved[0]?.purge_after });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TTS record could not be saved.";
    return response({ error: message }, message.includes("must") || message.includes("invalid") ? 400 : 500);
  }
});
