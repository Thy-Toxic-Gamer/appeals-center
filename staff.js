function staffStatusLabel(status) {
  return String(status || "").replaceAll("_", " ");
}

let staffHistoryRefreshTimer = null;
let staffHistoryPollTimer = null;
let staffCaseData = [];
let staffPendingModerationData = [];
let pendingModerationCases = new Map();
let selectedPendingModerationCase = null;
let pendingModerationSetupError = "";
let activeStaffView = window.location.hash === "#archive"
  ? "archive"
  : window.location.hash === "#active"
    ? "open"
    : "waiting";
let staffSearchQuery = "";

function staffApplicantKey(item) {
  const submission = item.appeal_submissions || {};
  if (submission.applicant_id) return `id:${submission.applicant_id}`;
  return `name:${String(submission.display_name || "").trim().toLowerCase()}|user:${String(item.platform_username || "").trim().toLowerCase()}`;
}

function staffApplicantAppealCount(item) {
  const applicantKey = staffApplicantKey(item);
  const submissionIds = new Set(
    staffCaseData
      .filter((candidate) => staffApplicantKey(candidate) === applicantKey)
      .map((candidate) => candidate.appeal_submissions?.id)
      .filter(Boolean)
  );
  return submissionIds.size;
}

function staffCaseMatchesSearch(item) {
  if (!staffSearchQuery) return true;
  const submission = item.appeal_submissions || {};
  const searchable = [
    submission.display_name,
    item.platform_username,
    submission.submission_number,
    item.case_number,
    item.platform,
    item.action_type
  ].join(" ").toLowerCase();
  return searchable.includes(staffSearchQuery);
}

function pendingModerationCaseMatchesSearch(item) {
  if (!staffSearchQuery) return true;
  return [
    item.discord_display_name,
    item.discord_username,
    item.discord_user_id,
    item.case_number,
    item.action_type,
    item.reason
  ].join(" ").toLowerCase().includes(staffSearchQuery);
}

function staffCaseListMarkup(cases, emptyCopy) {
  if (!cases.length) return emptyCopy;
  return cases.map((item) => {
    const appealCount = staffApplicantAppealCount(item);
    const priorCount = Math.max(0, appealCount - 1);
    const isFinal = ["approved", "denied", "closed"].includes(item.status);
    return `<button class="staff-case-row${item.appeal_submissions?.is_test ? " is-test" : ""}${isFinal ? " is-archived" : ""}" type="button" data-open-staff-case="${escapeText(item.id)}"><div><strong>${escapeText(item.case_number)}${item.appeal_submissions?.is_test ? ' <b class="test-badge">TEST</b>' : ""}</strong><small>${escapeText(item.appeal_submissions?.display_name || "Applicant")} · @${escapeText(item.platform_username)} · ${escapeText(platformConfig[item.platform]?.name || item.platform)} · ${escapeText(item.action_type)}</small><small class="appeal-history-count">${appealCount} total appeal${appealCount === 1 ? "" : "s"} · ${priorCount} prior</small></div><span data-status="${escapeText(item.status)}">${escapeText(staffStatusLabel(item.status))}</span><em>${isFinal ? "View archive →" : "Open case →"}</em></button>`;
  }).join("");
}

function pendingModerationListMarkup(cases, emptyCopy) {
  if (!cases.length) return emptyCopy;
  return cases.map((item) => `<button class="staff-case-row is-awaiting" type="button" data-open-pending-case="${escapeText(item.id)}"><div><strong>${escapeText(item.case_number)}</strong><small>${escapeText(item.discord_display_name || item.discord_username || "Discord member")} · @${escapeText(item.discord_username)} · ${escapeText(staffStatusLabel(item.action_type))}</small><small class="appeal-history-count">${item.account_connected ? "Discord account connected" : item.dm_delivered ? "Appeal link delivered by DM" : "DM delivery failed"} · No appeal submitted</small></div><span data-status="waiting">Awaiting appeal</span><em>View case →</em></button>`).join("");
}

function renderStaffCaseQueue() {
  const results = document.querySelector("#staff-results");
  if (!results || !currentStaffRole) return;

  const archivedCases = staffCaseData.filter((item) => ["approved", "denied", "closed"].includes(item.status));
  const openCases = staffCaseData.filter((item) => !["approved", "denied", "closed"].includes(item.status));
  const viewCases = activeStaffView === "waiting"
    ? staffPendingModerationData
    : activeStaffView === "archive"
      ? archivedCases
      : openCases;
  const visibleCases = viewCases.filter(activeStaffView === "waiting" ? pendingModerationCaseMatchesSearch : staffCaseMatchesSearch);
  const viewLabel = activeStaffView === "waiting" ? "awaiting-appeal" : activeStaffView === "archive" ? "archived" : "active";
  const emptyCopy = staffSearchQuery
    ? '<div class="empty-state"><strong>No matching appeals</strong><p>Try another applicant name, username, submission number, or case number.</p></div>'
    : activeStaffView === "waiting"
      ? pendingModerationSetupError
        ? `<div class="empty-state"><strong>Awaiting-Appeal setup required</strong><p>${escapeText(pendingModerationSetupError)}</p></div>`
        : '<div class="empty-state"><strong>No cases awaiting appeal</strong><p>New appealable ThyToxicBot actions will appear here before a member submits an appeal.</p></div>'
      : activeStaffView === "archive"
        ? '<div class="empty-state"><strong>No archived cases</strong><p>Approved and denied appeals will move here with their complete protected record.</p></div>'
        : '<div class="empty-state"><strong>No cases in the queue</strong><p>New and active appeals will appear here.</p></div>';

  results.innerHTML = `
    <div class="staff-toolbar">
      <div class="staff-role">Signed in as <strong>${escapeText(currentStaffRole)}</strong></div>
      ${currentStaffRole === "owner" ? '<button class="button button-secondary" type="button" data-create-test-ticket>Create Test Ticket</button>' : ""}
    </div>
    <p class="staff-form-message" id="staff-test-message" hidden></p>
    ${currentStaffRole === "owner" ? `
      <section class="owner-counter-tool" aria-labelledby="owner-counter-title">
        <div>
          <small>Owner tool</small>
          <strong id="owner-counter-title">Moderation Ticket Counter</strong>
          <p>Reset numbering to <b>TTG-MOD-000001</b>. Existing cases keep their numbers, and numbers already in use are automatically skipped.</p>
        </div>
        <button class="button button-danger" type="button" data-reset-ticket-counter>Reset Ticket Counter</button>
        <p class="staff-form-message" id="ticket-counter-message" hidden></p>
      </section>` : ""}
    <div class="staff-search-panel">
      <label for="staff-case-search"><span>Search cases and appeal history</span><input id="staff-case-search" type="search" value="${escapeText(staffSearchQuery)}" placeholder="Name, username, case, or submission number" autocomplete="off"></label>
      <p id="staff-search-summary">Showing <strong>${visibleCases.length}</strong> of ${viewCases.length} ${viewLabel} cases.</p>
    </div>
    <div class="staff-view-tabs" role="tablist" aria-label="Appeal case lists">
      <button type="button" role="tab" aria-selected="${activeStaffView === "waiting"}" class="${activeStaffView === "waiting" ? "is-active" : ""}" data-staff-view="waiting">Awaiting Appeal <span>${staffPendingModerationData.length}</span></button>
      <button type="button" role="tab" aria-selected="${activeStaffView === "open"}" class="${activeStaffView === "open" ? "is-active" : ""}" data-staff-view="open">Active Appeals <span>${openCases.length}</span></button>
      <button type="button" role="tab" aria-selected="${activeStaffView === "archive"}" class="${activeStaffView === "archive" ? "is-active" : ""}" data-staff-view="archive">Archive <span>${archivedCases.length}</span></button>
    </div>
    <div class="staff-case-list">
      ${activeStaffView === "waiting" ? pendingModerationListMarkup(visibleCases, emptyCopy) : staffCaseListMarkup(visibleCases, emptyCopy)}
    </div>`;
}

function queueStaffHistoryRefresh(caseId, delay = 700) {
  window.clearTimeout(staffHistoryRefreshTimer);
  staffHistoryRefreshTimer = window.setTimeout(() => {
    const dialog = document.querySelector("#staff-case-dialog");
    if (dialog?.open && selectedStaffCase?.id === caseId) loadStaffHistory(caseId);
  }, delay);
}

function startStaffHistoryPolling(caseId) {
  window.clearInterval(staffHistoryPollTimer);
  staffHistoryPollTimer = window.setInterval(() => {
    const dialog = document.querySelector("#staff-case-dialog");
    if (dialog?.open && selectedStaffCase?.id === caseId) loadStaffHistory(caseId);
  }, 8000);
}

function stopStaffHistoryRefresh() {
  window.clearTimeout(staffHistoryRefreshTimer);
  window.clearInterval(staffHistoryPollTimer);
}

function prependStaffHistory(containerSelector, title, body) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const loadingOrEmpty = container.querySelector(".loading-state, .empty-state");
  if (loadingOrEmpty) container.innerHTML = "";
  container.insertAdjacentHTML("afterbegin", `<article class="is-new"><div><strong>${escapeText(title)}</strong><time>Just now</time></div><p>${escapeText(body)}</p></article>`);
}

async function advancedLoadStaffCases() {
  const results = document.querySelector("#staff-results");
  if (!results) return;
  if (!currentSession) {
    results.innerHTML = '<div class="empty-state"><strong>Staff sign-in required</strong><p>Use the verified account that was approved for staff access.</p></div>';
    loadSubmissionAccessRecords();
    return;
  }

  results.innerHTML = '<div class="loading-state">Checking staff permissions…</div>';
  const { data: role, error: roleError } = await database.rpc("current_staff_role");
  if (roleError) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(roleError))}</p>`;
    return;
  }
  if (!role) {
    results.innerHTML = '<div class="empty-state"><strong>Account verified—staff access not assigned</strong><p>This account is not yet on the Appeals Center staff list.</p></div>';
    loadSubmissionAccessRecords();
    return;
  }

  currentStaffRole = role;
  loadSubmissionAccessRecords();
  const [appealsResult, pendingResult] = await Promise.all([
    database
      .from("appeal_cases")
      .select("id, case_number, platform, action_type, platform_username, profile_url, moderation_reason, status, applicant_update, decision_reason, created_at, closed_at, purge_after, appeal_submissions(id, applicant_id, submission_number, display_name, incident_date, existing_case_number, explanation, evidence_link, is_test, created_at)")
      .order("created_at", { ascending: false })
      .limit(1000),
    database.rpc("staff_pending_moderation_cases")
  ]);

  if (appealsResult.error) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(appealsResult.error))}</p>`;
    return;
  }

  staffCaseData = appealsResult.data || [];
  pendingModerationSetupError = pendingResult.error
    ? "Run migration 008_pending_moderation_queue.sql in the Appeals Supabase project, then refresh this page."
    : "";
  staffPendingModerationData = pendingResult.error ? [] : pendingResult.data || [];
  staffCases = new Map(staffCaseData.map((item) => [item.id, item]));
  pendingModerationCases = new Map(staffPendingModerationData.map((item) => [item.id, item]));
  renderStaffCaseQueue();
}

loadStaffCases = advancedLoadStaffCases;

function staffDurationLabel(seconds) {
  if (seconds === null || seconds === undefined) return "Not applicable";
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "No duration recorded";
  if (total % 86400 === 0) return `${total / 86400} day${total === 86400 ? "" : "s"}`;
  if (total % 3600 === 0) return `${total / 3600} hour${total === 3600 ? "" : "s"}`;
  if (total % 60 === 0) return `${total / 60} minute${total === 60 ? "" : "s"}`;
  return `${total} seconds`;
}

function openPendingModerationCase(caseId) {
  const item = pendingModerationCases.get(caseId);
  const dialog = document.querySelector("#pending-moderation-dialog");
  if (!item || !dialog) return;

  selectedPendingModerationCase = item;
  document.querySelector("#pending-moderation-details").innerHTML = `
    <div class="staff-case-title">
      <div><h2>${escapeText(item.case_number)}</h2><p>Discord · ${escapeText(moderationActionLabel(item.action_type))}</p></div>
      <span data-status="waiting">Awaiting appeal</span>
    </div>
    <div class="staff-detail-grid">
      <article><small>Discord member</small><strong>${escapeText(item.discord_display_name || item.discord_username || "Discord member")}</strong><p>@${escapeText(item.discord_username)} · ID ${escapeText(item.discord_user_id)}</p></article>
      <article><small>Appeal access</small><strong>${item.account_connected ? "Account connected" : item.dm_delivered ? "DM link delivered" : "DM delivery failed"}</strong><p>${item.account_connected ? "This case appears automatically after the member signs in." : item.dm_delivered ? "The member can claim this case using the secure DM link." : "The member has not received a working DM link."}</p></article>
      <article><small>Moderation status</small><strong>${escapeText(staffStatusLabel(item.status))}</strong><p>${escapeText(moderationActionLabel(item.action_type))} · ${escapeText(staffDurationLabel(item.duration_seconds))}${item.moderator_username ? ` · Issued by @${escapeText(item.moderator_username)}` : ""}</p></article>
      <article><small>Created</small><strong>${new Date(item.created_at).toLocaleDateString()}</strong><p>${new Date(item.created_at).toLocaleString()}</p></article>
      <article class="wide"><small>Moderation reason</small><p>${escapeText(item.reason || "No reason recorded.")}</p></article>
    </div>`;

  document.querySelector("#pending-owner-delete-actions").hidden = currentStaffRole !== "owner";
  const deleteButton = document.querySelector("#delete-pending-moderation-case");
  deleteButton.disabled = false;
  deleteButton.textContent = "Remove Awaiting Case";
  const message = document.querySelector("#pending-delete-message");
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("is-error");
  dialog.showModal();
}

async function openStaffCase(caseId) {
  const item = staffCases.get(caseId);
  const dialog = document.querySelector("#staff-case-dialog");
  if (!item || !dialog) return;

  selectedStaffCase = item;
  const submission = item.appeal_submissions || {};
  const isArchived = ["approved", "denied", "closed"].includes(item.status);
  const appealCount = staffApplicantAppealCount(item);
  const priorAppealCount = Math.max(0, appealCount - 1);
  const profileUrl = safeExternalUrl(item.profile_url);
  const evidenceUrl = safeExternalUrl(submission.evidence_link);
  document.querySelector("#staff-case-details").innerHTML = `
    <div class="staff-case-title">
      <div><h2>${escapeText(item.case_number)}</h2><p>${escapeText(platformConfig[item.platform]?.name || item.platform)} · ${escapeText(item.action_type)}</p></div>
      <span data-status="${escapeText(item.status)}">${escapeText(staffStatusLabel(item.status))}</span>
    </div>
    <div class="staff-detail-grid">
      <article><small>Applicant</small><strong>${escapeText(submission.display_name || "Applicant")}</strong><p>@${escapeText(item.platform_username)}</p>${profileUrl ? `<a href="${escapeText(profileUrl)}" target="_blank" rel="noopener noreferrer">Open platform profile ↗</a>` : ""}</article>
      <article><small>Submission</small><strong>${escapeText(submission.submission_number || "")}</strong><p>${submission.incident_date ? `Incident: ${escapeText(submission.incident_date)}` : "Incident date not provided"}</p></article>
      <article class="wide appeal-history-summary"><small>Applicant appeal history</small><strong>${appealCount} total appeal${appealCount === 1 ? "" : "s"}</strong><p>${priorAppealCount ? `${priorAppealCount} prior appeal${priorAppealCount === 1 ? "" : "s"} found for this verified applicant.` : "No prior appeals found for this verified applicant."}</p></article>
      <article class="wide"><small>Case timeline</small><p>Opened: ${new Date(item.created_at).toLocaleString()}${item.closed_at ? ` · Closed: ${new Date(item.closed_at).toLocaleString()}` : " · Currently active"}${item.purge_after ? ` · Retained until: ${new Date(item.purge_after).toLocaleDateString()}` : ""}</p></article>
      <article class="wide"><small>Applicant explanation</small><p>${escapeText(submission.explanation || "No explanation provided.")}</p>${evidenceUrl ? `<a href="${escapeText(evidenceUrl)}" target="_blank" rel="noopener noreferrer">Open supporting evidence ↗</a>` : ""}</article>
      ${item.moderation_reason ? `<article class="wide"><small>Original moderation reason</small><p>${escapeText(item.moderation_reason)}</p></article>` : ""}
    </div>`;

  document.querySelector("#archive-case-notice").hidden = !isArchived;
  document.querySelector("#staff-decision-panel").hidden = isArchived || !["admin", "owner"].includes(currentStaffRole);
  document.querySelector("#staff-note-form").hidden = isArchived;
  document.querySelector("#test-ticket-actions").hidden = !(currentStaffRole === "owner" && submission.is_test && !isArchived);
  document.querySelector("#owner-delete-actions").hidden = !(currentStaffRole === "owner" && isArchived);
  const deleteTestButton = document.querySelector("#delete-test-ticket");
  deleteTestButton.disabled = false;
  deleteTestButton.textContent = "Delete Test Ticket";
  const testTicketMessage = document.querySelector("#test-ticket-message");
  testTicketMessage.hidden = true;
  testTicketMessage.textContent = "";
  testTicketMessage.classList.remove("is-error");
  const ownerDeleteButton = document.querySelector("#delete-archived-appeal");
  ownerDeleteButton.disabled = false;
  ownerDeleteButton.textContent = "Delete Appeal Permanently";
  const ownerDeleteMessage = document.querySelector("#owner-delete-message");
  ownerDeleteMessage.hidden = true;
  ownerDeleteMessage.textContent = "";
  ownerDeleteMessage.classList.remove("is-error");
  document.querySelector("#staff-case-status").value = item.status;
  document.querySelector("#staff-public-update").value = item.applicant_update || "";
  document.querySelector("#staff-decision-reason").value = item.decision_reason || "";
  updateStaffDecisionRequirements();
  document.querySelector("#staff-case-message").hidden = true;
  document.querySelector("#staff-note-message").hidden = true;
  document.querySelector("#staff-note-form").reset();
  document.querySelector("#staff-notes").innerHTML = '<div class="loading-state">Loading private notes…</div>';
  document.querySelector("#staff-activity").innerHTML = '<div class="loading-state">Loading case activity…</div>';
  dialog.showModal();
  await loadStaffHistory(caseId);
  startStaffHistoryPolling(caseId);
}

async function loadStaffHistory(caseId) {
  const [notesResult, logsResult] = await Promise.all([
    database.from("staff_notes").select("id, note, author_id, created_at").eq("case_id", caseId).order("created_at", { ascending: false }),
    database.from("appeal_logs").select("id, event_type, old_status, new_status, public_message, created_at").eq("case_id", caseId).order("created_at", { ascending: false })
  ]);

  const notes = document.querySelector("#staff-notes");
  const activity = document.querySelector("#staff-activity");
  if (notesResult.error) {
    notes.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(notesResult.error))}</p>`;
  } else {
    notes.innerHTML = notesResult.data?.length
      ? notesResult.data.map((note) => `<article><div><strong>Private note</strong><time>${new Date(note.created_at).toLocaleString()}</time></div><p>${escapeText(note.note)}</p></article>`).join("")
      : '<div class="empty-state"><strong>No private notes</strong><p>Add evidence or an internal recommendation above.</p></div>';
  }

  if (logsResult.error) {
    activity.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(logsResult.error))}</p>`;
  } else {
    activity.innerHTML = logsResult.data?.length
      ? logsResult.data.map((log) => `<article><div><strong>${escapeText(log.event_type.replaceAll("_", " "))}</strong><time>${new Date(log.created_at).toLocaleString()}</time></div><p>${log.old_status || log.new_status ? `${escapeText(log.old_status || "new")} → ${escapeText(log.new_status || "")}` : "Internal staff activity"}${log.public_message ? ` · ${escapeText(log.public_message)}` : ""}</p></article>`).join("")
      : '<div class="empty-state"><strong>No activity yet</strong></div>';
  }
}

function updateStaffDecisionRequirements() {
  const status = document.querySelector("#staff-case-status")?.value;
  const publicUpdate = document.querySelector("#staff-public-update");
  const decisionReason = document.querySelector("#staff-decision-reason");
  const publicCount = document.querySelector("#staff-public-count");
  const decisionCount = document.querySelector("#staff-decision-count");
  if (!publicUpdate || !decisionReason) return;

  publicUpdate.required = ["needs_information", "approved", "denied", "closed"].includes(status);
  decisionReason.required = ["approved", "denied"].includes(status);
  if (publicCount) publicCount.textContent = publicUpdate.value.length;
  if (decisionCount) decisionCount.textContent = decisionReason.value.length;
}

async function saveStaffCase(event) {
  event.preventDefault();
  if (!selectedStaffCase) return;
  const formData = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button[type='submit']");
  const message = document.querySelector("#staff-case-message");
  button.disabled = true;
  button.textContent = "Saving…";
  message.hidden = true;

  const nextStatus = formData.get("status")?.toString();
  const publicUpdate = formData.get("public_update")?.toString().trim() || null;
  const decisionReason = formData.get("decision_reason")?.toString().trim() || null;
  const previousStatus = selectedStaffCase.status;
  const caseId = selectedStaffCase.id;
  const needsPublicUpdate = ["needs_information", "approved", "denied", "closed"].includes(nextStatus);
  const needsDecisionReason = ["approved", "denied"].includes(nextStatus);

  if (needsPublicUpdate && (publicUpdate?.length || 0) < 5) {
    button.disabled = false;
    button.textContent = "Save Case Update →";
    message.textContent = "Applicant-visible update must contain at least 5 characters for this status.";
    message.classList.add("is-error");
    message.hidden = false;
    document.querySelector("#staff-public-update")?.focus();
    return;
  }

  if (needsDecisionReason && (decisionReason?.length || 0) < 5) {
    button.disabled = false;
    button.textContent = "Save Case Update →";
    message.textContent = "Decision reason must contain at least 5 characters before approving or denying.";
    message.classList.add("is-error");
    message.hidden = false;
    document.querySelector("#staff-decision-reason")?.focus();
    return;
  }

  const { error } = await database.rpc("staff_manage_case", {
    p_case_id: caseId,
    p_status: nextStatus,
    p_public_update: publicUpdate,
    p_decision_reason: decisionReason
  });

  button.disabled = false;
  button.textContent = "Save Case Update →";
  if (error) {
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  message.textContent = "Case update saved. The applicant status page is updated.";
  message.classList.remove("is-error");
  message.hidden = false;
  selectedStaffCase.status = nextStatus;
  selectedStaffCase.applicant_update = publicUpdate;
  selectedStaffCase.decision_reason = decisionReason;
  document.querySelector("#staff-case-details [data-status]")?.setAttribute("data-status", nextStatus);
  const dialogStatus = document.querySelector("#staff-case-details [data-status]");
  if (dialogStatus) dialogStatus.textContent = staffStatusLabel(nextStatus);
  prependStaffHistory("#staff-activity", "case status updated", `${staffStatusLabel(previousStatus)} → ${staffStatusLabel(nextStatus)}${publicUpdate ? ` · ${publicUpdate}` : ""}`);
  if (["approved", "denied"].includes(nextStatus)) {
    activeStaffView = "archive";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#archive`);
    document.querySelector("#archive-case-notice").hidden = false;
    document.querySelector("#staff-decision-panel").hidden = true;
    document.querySelector("#staff-note-form").hidden = true;
    document.querySelector("#owner-delete-actions").hidden = currentStaffRole !== "owner";
  }
  await advancedLoadStaffCases();
  selectedStaffCase = staffCases.get(caseId);
  if (selectedStaffCase) {
    document.querySelector("#staff-case-status").value = selectedStaffCase.status;
    queueStaffHistoryRefresh(caseId);
  }
}

async function loadSubmissionAccessRecords() {
  const results = document.querySelector("#submission-access-results");
  if (!results) return;
  if (!currentSession || !currentStaffRole) {
    results.innerHTML = '<div class="empty-state"><strong>Staff sign-in required</strong><p>Sign in with an approved staff account to review submission blocks and private conversations.</p></div>';
    return;
  }

  results.innerHTML = '<div class="loading-state">Loading protected submission-access records…</div>';
  const [blocksResult, reviewsResult, messagesResult, eventsResult] = await Promise.all([
    database.from("submission_blocks").select("*").order("blocked_at", { ascending: false }).limit(250),
    database.from("submission_block_reviews").select("*").order("created_at", { ascending: false }).limit(250),
    database.from("submission_block_review_messages").select("*").order("created_at", { ascending: true }).limit(1000),
    database.from("submission_block_events").select("*").order("created_at", { ascending: false }).limit(500)
  ]);

  const failure = blocksResult.error || reviewsResult.error || messagesResult.error || eventsResult.error;
  if (failure) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(failure))}</p>`;
    return;
  }

  const blocks = blocksResult.data || [];
  const reviews = reviewsResult.data || [];
  const messages = messagesResult.data || [];
  const events = eventsResult.data || [];
  const activeBlocks = blocks.filter((item) => item.active);
  const openReviews = reviews.filter((item) => ["open", "claimed"].includes(item.status));
  const closedReviews = reviews.filter((item) => item.status === "closed");

  const reviewMarkup = (items, emptyText) => items.length ? items.map((review) => {
    const transcript = messages.filter((message) => message.review_number === review.review_number);
    return `<details class="submission-review-record">
      <summary>
        <span><strong>${escapeText(review.review_number)}</strong><small>@${escapeText(review.discord_username || review.discord_user_id)} · ${new Date(review.created_at).toLocaleString()}</small></span>
        <b data-status="${escapeText(review.status)}">${escapeText(staffStatusLabel(review.status))}</b>
      </summary>
      <div class="submission-review-body">
        <p><strong>Opening request:</strong> ${escapeText(review.opening_message)}</p>
        ${review.resolution ? `<p><strong>Resolution:</strong> ${escapeText(review.resolution)}</p>` : ""}
        <div class="submission-review-transcript">
          ${transcript.length ? transcript.map((message) => `<article><div><strong>${escapeText(message.sender_role || message.sender_type)}</strong><time>${new Date(message.created_at).toLocaleString()}</time></div><p>${escapeText(message.message)}</p></article>`).join("") : "<p>No transcript messages are stored.</p>"}
        </div>
      </div>
    </details>`;
  }).join("") : `<div class="empty-state"><strong>${escapeText(emptyText)}</strong></div>`;

  results.innerHTML = `
    <div class="submission-access-summary">
      <article><small>Active blocks</small><strong>${activeBlocks.length}</strong></article>
      <article><small>Open reviews</small><strong>${openReviews.length}</strong></article>
      <article><small>Closed reviews</small><strong>${closedReviews.length}</strong></article>
      <article><small>Audit events</small><strong>${events.length}</strong></article>
    </div>
    <section class="submission-access-section">
      <h3>Active Submission Blocks</h3>
      ${activeBlocks.length ? activeBlocks.map((block) => `<article class="submission-block-record">
        <div><strong>${escapeText(block.discord_display_name || block.discord_username || block.discord_user_id)}</strong><small>@${escapeText(block.discord_username || "Discord member")} · ID ${escapeText(block.discord_user_id)}</small></div>
        <p>${escapeText(block.reason)}</p>
        <small>Applied by @${escapeText(block.blocked_by_username || block.blocked_by_id)} · ${new Date(block.blocked_at).toLocaleString()}</small>
      </article>`).join("") : '<div class="empty-state"><strong>No active submission blocks</strong></div>'}
    </section>
    <section class="submission-access-section">
      <h3>Open Private Reviews</h3>
      ${reviewMarkup(openReviews, "No open block reviews")}
    </section>
    <section class="submission-access-section">
      <h3>Archived Private Reviews</h3>
      ${reviewMarkup(closedReviews, "No archived block reviews")}
    </section>`;
}

async function addPrivateStaffNote(event) {
  event.preventDefault();
  if (!selectedStaffCase) return;
  const formData = new FormData(event.currentTarget);
  const noteText = formData.get("note")?.toString().trim();
  const caseId = selectedStaffCase.id;
  const button = event.currentTarget.querySelector("button[type='submit']");
  const message = document.querySelector("#staff-note-message");
  button.disabled = true;
  button.textContent = "Saving…";
  message.hidden = true;

  const { error } = await database.rpc("add_staff_note", {
    p_case_id: caseId,
    p_note: noteText
  });

  button.disabled = false;
  button.textContent = "Add Private Note";
  if (error) {
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  event.currentTarget.reset();
  message.textContent = "Private note saved.";
  message.classList.remove("is-error");
  message.hidden = false;
  prependStaffHistory("#staff-notes", "Private note", noteText);
  prependStaffHistory("#staff-activity", "staff note added", "Internal staff activity");
  queueStaffHistoryRefresh(caseId);
}

async function createTestTicket(button) {
  if (currentStaffRole !== "owner") return;
  button.disabled = true;
  button.textContent = "Creating…";
  const { data, error } = await database.rpc("create_test_appeal");
  if (error) {
    button.disabled = false;
    button.textContent = "Create Test Ticket";
    const message = document.querySelector("#staff-test-message");
    if (message) {
      message.textContent = cleanError(error);
      message.classList.add("is-error");
      message.hidden = false;
    }
    return;
  }

  await advancedLoadStaffCases();
  const newCase = staffCases.get(data.case_id);
  if (newCase) openStaffCase(newCase.id);
}

async function resetModerationTicketCounter(button) {
  if (currentStaffRole !== "owner") return;
  const confirmed = window.confirm("Reset the moderation ticket counter to TTG-MOD-000001? Existing cases will not be changed, and ticket numbers already in use will be skipped.");
  if (!confirmed) return;

  const message = document.querySelector("#ticket-counter-message");
  button.disabled = true;
  button.textContent = "Resetting…";
  if (message) {
    message.hidden = true;
    message.textContent = "";
    message.classList.remove("is-error");
  }

  const { error } = await database.rpc("reset_moderation_ticket_counter");

  button.disabled = false;
  button.textContent = "Reset Ticket Counter";
  if (!message) return;

  if (error) {
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  message.textContent = "Counter reset. The next moderation ticket will start at TTG-MOD-000001, skipping any number already in use.";
  message.classList.remove("is-error");
  message.hidden = false;
}

async function deleteSelectedTestTicket() {
  const submission = selectedStaffCase?.appeal_submissions;
  if (currentStaffRole !== "owner" || !submission?.is_test) return;
  const confirmed = window.confirm(`Permanently delete test ticket ${submission.submission_number}? This cannot be undone.`);
  if (!confirmed) return;

  const button = document.querySelector("#delete-test-ticket");
  const message = document.querySelector("#test-ticket-message");
  button.disabled = true;
  button.textContent = "Deleting…";
  message.hidden = true;
  const { error } = await database.rpc("delete_test_appeal", {
    p_submission_id: submission.id
  });

  if (error) {
    button.disabled = false;
    button.textContent = "Delete Test Ticket";
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  button.disabled = false;
  button.textContent = "Delete Test Ticket";
  stopStaffHistoryRefresh();
  document.querySelector("#staff-case-dialog")?.close();
  selectedStaffCase = null;
  await advancedLoadStaffCases();
}

async function deleteSelectedArchivedAppeal() {
  const submission = selectedStaffCase?.appeal_submissions;
  if (currentStaffRole !== "owner" || !["approved", "denied", "closed"].includes(selectedStaffCase?.status) || !submission?.id) return;
  const confirmed = window.confirm(`Permanently delete appeal ${submission.submission_number} and every case, note, message, and activity record attached to it? This cannot be undone.`);
  if (!confirmed) return;

  const button = document.querySelector("#delete-archived-appeal");
  const message = document.querySelector("#owner-delete-message");
  button.disabled = true;
  button.textContent = "Deleting…";
  message.hidden = true;

  const { error } = await database.rpc("delete_archived_appeal", {
    p_submission_id: submission.id
  });

  if (error) {
    button.disabled = false;
    button.textContent = "Delete Appeal Permanently";
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  stopStaffHistoryRefresh();
  document.querySelector("#staff-case-dialog")?.close();
  selectedStaffCase = null;
  await advancedLoadStaffCases();
}

async function deleteSelectedPendingModerationCase() {
  if (currentStaffRole !== "owner" || !selectedPendingModerationCase) return;
  const item = selectedPendingModerationCase;
  const confirmed = window.confirm(`Permanently remove awaiting case ${item.case_number} for @${item.discord_username}? It will immediately disappear from the member’s appeal-ready list and cannot be undone.`);
  if (!confirmed) return;

  const button = document.querySelector("#delete-pending-moderation-case");
  const message = document.querySelector("#pending-delete-message");
  button.disabled = true;
  button.textContent = "Removing…";
  message.hidden = true;

  const { error } = await database.rpc("delete_pending_moderation_case", {
    p_case_id: item.id
  });

  if (error) {
    button.disabled = false;
    button.textContent = "Remove Awaiting Case";
    message.textContent = cleanError(error);
    message.classList.add("is-error");
    message.hidden = false;
    return;
  }

  document.querySelector("#pending-moderation-dialog")?.close();
  selectedPendingModerationCase = null;
  await advancedLoadStaffCases();
}

document.querySelector("#staff-results")?.addEventListener("input", (event) => {
  if (!event.target.matches("#staff-case-search")) return;
  staffSearchQuery = event.target.value.trim().toLowerCase();
  const viewCases = activeStaffView === "waiting"
    ? staffPendingModerationData
    : staffCaseData.filter((item) => activeStaffView === "archive" ? ["approved", "denied", "closed"].includes(item.status) : !["approved", "denied", "closed"].includes(item.status));
  const visibleCases = viewCases.filter(activeStaffView === "waiting" ? pendingModerationCaseMatchesSearch : staffCaseMatchesSearch);
  const emptyCopy = '<div class="empty-state"><strong>No matching appeals</strong><p>Try another applicant name, username, submission number, or case number.</p></div>';
  const summary = document.querySelector("#staff-search-summary");
  const list = document.querySelector(".staff-case-list");
  const viewLabel = activeStaffView === "waiting" ? "awaiting-appeal" : activeStaffView === "archive" ? "archived" : "active";
  if (summary) summary.innerHTML = `Showing <strong>${visibleCases.length}</strong> of ${viewCases.length} ${viewLabel} cases.`;
  if (list) list.innerHTML = activeStaffView === "waiting" ? pendingModerationListMarkup(visibleCases, emptyCopy) : staffCaseListMarkup(visibleCases, emptyCopy);
});

document.querySelector("#staff-results")?.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-staff-view]");
  if (viewButton) {
    activeStaffView = ["waiting", "open", "archive"].includes(viewButton.dataset.staffView) ? viewButton.dataset.staffView : "waiting";
    const viewHash = activeStaffView === "archive" ? "#archive" : activeStaffView === "open" ? "#active" : "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${viewHash}`);
    renderStaffCaseQueue();
    return;
  }
  const createButton = event.target.closest("[data-create-test-ticket]");
  if (createButton) {
    createTestTicket(createButton);
    return;
  }
  const resetCounterButton = event.target.closest("[data-reset-ticket-counter]");
  if (resetCounterButton) {
    resetModerationTicketCounter(resetCounterButton);
    return;
  }
  const pendingButton = event.target.closest("[data-open-pending-case]");
  if (pendingButton) {
    openPendingModerationCase(pendingButton.dataset.openPendingCase);
    return;
  }
  const button = event.target.closest("[data-open-staff-case]");
  if (button) openStaffCase(button.dataset.openStaffCase);
});
document.querySelector("#staff-case-form")?.addEventListener("submit", saveStaffCase);
document.querySelector("#staff-note-form")?.addEventListener("submit", addPrivateStaffNote);
document.querySelector("#delete-test-ticket")?.addEventListener("click", deleteSelectedTestTicket);
document.querySelector("#delete-archived-appeal")?.addEventListener("click", deleteSelectedArchivedAppeal);
document.querySelector("#delete-pending-moderation-case")?.addEventListener("click", deleteSelectedPendingModerationCase);
document.querySelector("#staff-case-status")?.addEventListener("change", updateStaffDecisionRequirements);
document.querySelector("#staff-public-update")?.addEventListener("input", updateStaffDecisionRequirements);
document.querySelector("#staff-decision-reason")?.addEventListener("input", updateStaffDecisionRequirements);
document.querySelector("[data-close-staff-dialog]")?.addEventListener("click", () => {
  stopStaffHistoryRefresh();
  document.querySelector("#staff-case-dialog")?.close();
});
document.querySelector("#staff-case-dialog")?.addEventListener("close", stopStaffHistoryRefresh);
document.querySelector("[data-close-pending-dialog]")?.addEventListener("click", () => {
  document.querySelector("#pending-moderation-dialog")?.close();
});
document.querySelector("#pending-moderation-dialog")?.addEventListener("close", () => {
  selectedPendingModerationCase = null;
});

advancedLoadStaffCases();
