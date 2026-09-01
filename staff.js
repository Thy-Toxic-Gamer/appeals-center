function staffStatusLabel(status) {
  return String(status || "").replaceAll("_", " ");
}

let staffHistoryRefreshTimer = null;
let staffHistoryPollTimer = null;

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
    return;
  }

  currentStaffRole = role;
  const { data, error } = await database
    .from("appeal_cases")
    .select("id, case_number, platform, action_type, platform_username, profile_url, moderation_reason, status, applicant_update, decision_reason, created_at, closed_at, purge_after, appeal_submissions(id, submission_number, display_name, incident_date, existing_case_number, explanation, evidence_link, is_test, created_at)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(error))}</p>`;
    return;
  }

  staffCases = new Map((data || []).map((item) => [item.id, item]));
  results.innerHTML = `<div class="staff-toolbar"><div class="staff-role">Signed in as <strong>${escapeText(role)}</strong></div>${role === "owner" ? '<button class="button button-secondary" type="button" data-create-test-ticket>Create Test Ticket</button>' : ""}</div><p class="staff-form-message" id="staff-test-message" hidden></p>${data?.length
    ? data.map((item) => `<button class="staff-case-row${item.appeal_submissions?.is_test ? " is-test" : ""}" type="button" data-open-staff-case="${escapeText(item.id)}"><div><strong>${escapeText(item.case_number)}${item.appeal_submissions?.is_test ? ' <b class="test-badge">TEST</b>' : ""}</strong><small>${escapeText(platformConfig[item.platform]?.name || item.platform)} · ${escapeText(item.action_type)} · @${escapeText(item.platform_username)}</small></div><span data-status="${escapeText(item.status)}">${escapeText(staffStatusLabel(item.status))}</span><em>Open case →</em></button>`).join("")
    : '<div class="empty-state"><strong>No cases in the queue</strong><p>New appeals will appear here.</p></div>'}`;
}

loadStaffCases = advancedLoadStaffCases;

async function openStaffCase(caseId) {
  const item = staffCases.get(caseId);
  const dialog = document.querySelector("#staff-case-dialog");
  if (!item || !dialog) return;

  selectedStaffCase = item;
  const submission = item.appeal_submissions || {};
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
      <article class="wide"><small>Applicant explanation</small><p>${escapeText(submission.explanation || "No explanation provided.")}</p>${evidenceUrl ? `<a href="${escapeText(evidenceUrl)}" target="_blank" rel="noopener noreferrer">Open supporting evidence ↗</a>` : ""}</article>
      ${item.moderation_reason ? `<article class="wide"><small>Original moderation reason</small><p>${escapeText(item.moderation_reason)}</p></article>` : ""}
    </div>`;

  document.querySelector("#staff-decision-panel").hidden = !["admin", "owner"].includes(currentStaffRole);
  document.querySelector("#test-ticket-actions").hidden = !(currentStaffRole === "owner" && submission.is_test);
  const deleteTestButton = document.querySelector("#delete-test-ticket");
  deleteTestButton.disabled = false;
  deleteTestButton.textContent = "Delete Test Ticket";
  const testTicketMessage = document.querySelector("#test-ticket-message");
  testTicketMessage.hidden = true;
  testTicketMessage.textContent = "";
  testTicketMessage.classList.remove("is-error");
  document.querySelector("#staff-case-status").value = item.status;
  document.querySelector("#staff-public-update").value = item.applicant_update || "";
  document.querySelector("#staff-decision-reason").value = item.decision_reason || "";
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
  await advancedLoadStaffCases();
  selectedStaffCase = staffCases.get(caseId);
  if (selectedStaffCase) {
    document.querySelector("#staff-case-status").value = selectedStaffCase.status;
    queueStaffHistoryRefresh(caseId);
  }
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

  stopStaffHistoryRefresh();
  document.querySelector("#staff-case-dialog")?.close();
  selectedStaffCase = null;
  await advancedLoadStaffCases();
}

document.querySelector("#staff-results")?.addEventListener("click", (event) => {
  const createButton = event.target.closest("[data-create-test-ticket]");
  if (createButton) {
    createTestTicket(createButton);
    return;
  }
  const button = event.target.closest("[data-open-staff-case]");
  if (button) openStaffCase(button.dataset.openStaffCase);
});
document.querySelector("#staff-case-form")?.addEventListener("submit", saveStaffCase);
document.querySelector("#staff-note-form")?.addEventListener("submit", addPrivateStaffNote);
document.querySelector("#delete-test-ticket")?.addEventListener("click", deleteSelectedTestTicket);
document.querySelector("[data-close-staff-dialog]")?.addEventListener("click", () => {
  stopStaffHistoryRefresh();
  document.querySelector("#staff-case-dialog")?.close();
});
document.querySelector("#staff-case-dialog")?.addEventListener("close", stopStaffHistoryRefresh);

advancedLoadStaffCases();
