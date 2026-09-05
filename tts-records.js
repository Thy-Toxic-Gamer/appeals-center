(() => {
  const typeLabels = { free: "Free / Channel Points", bits: "Bits", donations: "Donations" };
  const clean = (value) => escapeText(String(value ?? ""));
  let records = [];
  let typeView = "all";
  let statusView = "all";
  let searchValue = "";
  let staffRole = null;
  let selectedRecord = null;

  const results = () => document.querySelector("#tts-records-results");
  const dateTime = (value) => value ? new Date(value).toLocaleString() : "Not recorded";

  function filteredRecords() {
    return records.filter((record) => {
      const typeMatch = typeView === "all" || record.tts_type === typeView;
      const statusMatch = statusView === "all" || record.status === statusView;
      const searchMatch = !searchValue || [
        record.queue_number,
        typeLabels[record.tts_type],
        record.status,
        record.status_note,
        record.sender,
        record.platform,
        record.contribution,
        record.transcript,
        record.source_key,
        record.discord_message_id,
        record.twitch_vod_url,
      ].join(" ").toLowerCase().includes(searchValue);
      return typeMatch && statusMatch && searchMatch;
    });
  }

  function recordCard(record) {
    const excerpt = record.transcript.length > 220 ? record.transcript.slice(0, 219) + "…" : record.transcript;
    return `<button class="tts-record-card tts-type-${clean(record.tts_type)}" type="button" data-open-tts-record="${clean(record.id)}">
      <div class="tts-record-heading">
        <div><strong>TTS #${clean(record.queue_number)}</strong><small>${clean(typeLabels[record.tts_type] || record.tts_type)} · ${clean(record.status)}</small></div>
        <em>View record →</em>
      </div>
      <p>${clean(excerpt)}</p>
      <small>${clean(record.sender)} · ${clean(record.platform)} · ${clean(record.contribution)}</small>
      <time>${dateTime(record.ended_at)}</time>
    </button>`;
  }

  function renderRecords() {
    const target = results();
    if (!target) return;
    const visible = filteredRecords();
    const counts = Object.fromEntries(["free", "bits", "donations"].map((type) => [type, records.filter((record) => record.tts_type === type).length]));
    target.innerHTML = `
      <div class="ticket-center-heading tts-records-heading">
        <div><p class="section-number">PROTECTED TTS HISTORY</p><h2 id="tts-records-title">TTS Records</h2><p>One consistent record for Free / Channel Points, Bits, and Donations. Records automatically delete after one year.</p></div>
        <div class="tts-record-actions">
          <button class="button button-secondary" type="button" data-refresh-tts-records>Refresh</button>
          ${staffRole === "owner" && records.length ? '<button class="button button-danger" type="button" data-clear-tts-records>Clear All</button>' : ""}
        </div>
      </div>
      <div class="ticket-type-tabs tts-type-tabs" role="tablist" aria-label="TTS source">
        <button type="button" data-tts-type="all" class="${typeView === "all" ? "is-active" : ""}">All <span>${records.length}</span></button>
        <button type="button" data-tts-type="free" class="${typeView === "free" ? "is-active" : ""}">Free / Points <span>${counts.free}</span></button>
        <button type="button" data-tts-type="bits" class="${typeView === "bits" ? "is-active" : ""}">Bits <span>${counts.bits}</span></button>
        <button type="button" data-tts-type="donations" class="${typeView === "donations" ? "is-active" : ""}">Donations <span>${counts.donations}</span></button>
      </div>
      <div class="ticket-status-tabs tts-status-tabs" role="tablist" aria-label="TTS outcome">
        ${["all", "completed", "blocked", "interrupted"].map((status) => `<button type="button" data-tts-status="${status}" class="${statusView === status ? "is-active" : ""}">${status === "all" ? "All outcomes" : clean(status[0].toUpperCase() + status.slice(1))}</button>`).join("")}
      </div>
      <label class="ticket-search"><span>Search every TTS record and transcript</span><input type="search" id="tts-record-search" value="${clean(searchValue)}" placeholder="Queue number, sender, contribution, status, or message"></label>
      <p class="ticket-result-count">Showing <strong>${visible.length}</strong> of ${records.length} retained record${records.length === 1 ? "" : "s"}.</p>
      <div class="tts-record-grid">
        ${visible.length ? visible.map(recordCard).join("") : '<div class="empty-state"><strong>No matching TTS records</strong><p>Completed, blocked, and interrupted live TTS entries will appear here.</p></div>'}
      </div>`;
  }

  async function loadAllRecords() {
    const loaded = [];
    const pageSize = 1000;
    for (let start = 0; start < 10000; start += pageSize) {
      const { data, error } = await database.from("tts_records")
        .select("id,source_event_id,source_key,queue_number,tts_type,status,status_note,sender,platform,contribution,transcript,received_at,started_at,ended_at,stream_id,twitch_vod_url,twitch_vod_note,discord_channel_id,discord_message_id,created_at,updated_at,purge_after")
        .order("created_at", { ascending: false }).range(start, start + pageSize - 1);
      if (error) throw error;
      loaded.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return loaded;
  }

  async function loadRecords() {
    const target = results();
    if (!target || !database) return;
    target.innerHTML = '<div class="loading-state">Loading protected TTS records…</div>';
    const { data: role, error: roleError } = await database.rpc("current_staff_role");
    if (roleError || !["moderator", "admin", "owner"].includes(role)) {
      target.innerHTML = '<div class="empty-state"><strong>Staff access required</strong><p>Sign in with an approved Appeals Center staff account.</p></div>';
      return;
    }
    staffRole = role;
    try {
      records = await loadAllRecords();
      renderRecords();
    } catch (error) {
      const setup = String(error?.message || "").includes("tts_records") ? " Run Supabase migration 018_tts_records.sql, then refresh." : "";
      target.innerHTML = `<p class="inline-message is-error">${clean(cleanError(error))}${clean(setup)}</p>`;
    }
  }

  function openRecord(recordId) {
    selectedRecord = records.find((record) => record.id === recordId);
    if (!selectedRecord) return;
    const dialog = document.querySelector("#tts-record-dialog");
    const details = document.querySelector("#tts-record-details");
    details.innerHTML = `
      <div class="staff-case-title">
        <div><h2>TTS #${clean(selectedRecord.queue_number)}</h2><p>${clean(typeLabels[selectedRecord.tts_type] || selectedRecord.tts_type)}</p></div>
        <span data-status="${clean(selectedRecord.status)}">${clean(selectedRecord.status)}</span>
      </div>
      <div class="staff-case-grid">
        <article><small>Sender</small><strong>${clean(selectedRecord.sender)}</strong><p>${clean(selectedRecord.platform)}</p></article>
        <article><small>Contribution</small><strong>${clean(selectedRecord.contribution)}</strong><p>${clean(typeLabels[selectedRecord.tts_type] || selectedRecord.tts_type)}</p></article>
        <article class="wide"><small>Timeline</small><p>Received: ${dateTime(selectedRecord.received_at)} · Started: ${dateTime(selectedRecord.started_at)} · Ended: ${dateTime(selectedRecord.ended_at)}</p></article>
        <article class="wide"><small>Outcome</small><strong>${clean(selectedRecord.status)}</strong><p>${clean(selectedRecord.status_note || "No additional note.")}</p></article>
        <article class="wide"><small>Connected records</small><p>Discord channel: ${clean(selectedRecord.discord_channel_id || "Not posted")} · Discord message: ${clean(selectedRecord.discord_message_id || "Not posted")} · Stream: ${clean(selectedRecord.stream_id || "Not available")}</p>${selectedRecord.twitch_vod_url ? `<a href="${clean(selectedRecord.twitch_vod_url)}" target="_blank" rel="noopener noreferrer">Open Twitch VOD at TTS timestamp ↗</a>` : `<p>${clean(selectedRecord.twitch_vod_note || "Twitch VOD pending or unavailable.")}</p>`}</article>
        <article class="wide"><small>Retention</small><p>Automatically deletes on ${dateTime(selectedRecord.purge_after)}.</p></article>
      </div>
      ${staffRole === "owner" ? `<section class="owner-delete-actions"><div><strong>Owner record control</strong><p>Permanently delete this website record before its one-year expiration. This does not change Discord or Streamer.bot.</p></div><button class="button button-danger" type="button" data-delete-tts-record>Delete Record Permanently</button><p class="staff-form-message" id="tts-delete-message" hidden></p></section>` : ""}
      <section class="ticket-transcript-panel tts-transcript-panel"><div class="panel-heading"><div><span>Full TTS transcript</span><small>Protected website record—no Discord text-file attachment</small></div></div><pre>${clean(selectedRecord.transcript)}</pre></section>`;
    dialog.showModal();
  }

  async function deleteRecord() {
    if (!selectedRecord || staffRole !== "owner" || !window.confirm(`Permanently delete TTS #${selectedRecord.queue_number}? This cannot be undone.`)) return;
    const button = document.querySelector("[data-delete-tts-record]");
    if (button) { button.disabled = true; button.textContent = "Deleting…"; }
    const { error } = await database.rpc("owner_delete_tts_record", { p_record_id: selectedRecord.id });
    if (error) {
      const message = document.querySelector("#tts-delete-message");
      if (message) { message.textContent = cleanError(error); message.classList.add("is-error"); message.hidden = false; }
      if (button) { button.disabled = false; button.textContent = "Delete Record Permanently"; }
      return;
    }
    records = records.filter((record) => record.id !== selectedRecord.id);
    document.querySelector("#tts-record-dialog")?.close();
    selectedRecord = null;
    renderRecords();
  }

  async function clearRecords() {
    if (staffRole !== "owner" || !records.length || !window.confirm(`Permanently delete all ${records.length} TTS records? This cannot be undone.`)) return;
    const { error } = await database.rpc("owner_clear_tts_records");
    if (error) { window.alert(cleanError(error)); return; }
    records = [];
    renderRecords();
  }

  document.addEventListener("click", (event) => {
    const typeButton = event.target.closest("[data-tts-type]");
    if (typeButton) { typeView = typeButton.dataset.ttsType; renderRecords(); return; }
    const statusButton = event.target.closest("[data-tts-status]");
    if (statusButton) { statusView = statusButton.dataset.ttsStatus; renderRecords(); return; }
    const recordButton = event.target.closest("[data-open-tts-record]");
    if (recordButton) { openRecord(recordButton.dataset.openTtsRecord); return; }
    if (event.target.closest("[data-close-tts-dialog]")) { document.querySelector("#tts-record-dialog")?.close(); return; }
    if (event.target.closest("[data-refresh-tts-records]")) loadRecords();
    if (event.target.closest("[data-delete-tts-record]")) deleteRecord();
    if (event.target.closest("[data-clear-tts-records]")) clearRecords();
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "tts-record-search") return;
    searchValue = event.target.value.trim().toLowerCase();
    renderRecords();
    const input = document.querySelector("#tts-record-search");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });

  window.addEventListener("load", async () => {
    if (!database) return;
    const { data } = await database.auth.getSession();
    if (data.session) await loadRecords();
    database.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(loadRecords, 0);
      else {
        const target = results();
        if (target) target.innerHTML = '<div class="empty-state"><strong>Sign in to view TTS records</strong><p>Full TTS transcripts are protected.</p></div>';
      }
    });
  });
})();
