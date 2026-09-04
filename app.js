const platformConfig = {
  discord: { name: "Discord", code: "DIS", color: "#5865f2", actions: ["Ban", "Timeout / Mute", "Kick", "Warning", "Other moderation action"] },
  twitch: { name: "Twitch", code: "TTV", color: "#9146ff", actions: ["Ban", "Timeout", "Warning", "Other moderation action"] },
  youtube: { name: "YouTube", code: "YT", color: "#ff304f", actions: ["Hidden user", "Live-chat restriction", "Comment restriction", "Block", "Other moderation action"] },
  kick: { name: "Kick", code: "KCK", color: "#53fc18", actions: ["Ban", "Timeout", "Warning", "Other moderation action"] },
  twitter: { name: "X / Twitter", code: "X", color: "#1d9bf0", actions: ["Block", "Reply restriction", "Other moderation action"] },
  instagram: { name: "Instagram", code: "IG", color: "#ff3e98", actions: ["Block", "Restriction", "Comment restriction", "Other moderation action"] }
};

const config = window.APPEALS_CONFIG;
const database = window.supabase && config
  ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    })
  : null;

let currentSession = null;
let appealMode = "individual";
let selectedPlatforms = [];
let pendingAppeal = null;
let currentStaffRole = null;
let selectedStaffCase = null;
let staffCases = new Map();
let selectedModerationCase = null;
let moderationCases = new Map();
let discordConnected = false;

const form = document.querySelector("#appeal-form");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const platformButtons = [...document.querySelectorAll("[data-platform]")];
const selectedCases = document.querySelector("#selected-cases");
const platformError = document.querySelector("#platform-error");
const guidance = document.querySelector("#mode-guidance");

function escapeText(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function cleanError(error) {
  const message = error?.message || "Something went wrong. Please try again.";
  if (message.includes("submit_appeal") && message.includes("schema cache")) {
    return "The final database setup step has not been applied yet.";
  }
  if (message.toLowerCase().includes("manual linking is disabled")) {
    return "Discord linking is still disabled in Supabase. Enable Manual Linking under Authentication → Sign In / Providers, save, then refresh this page.";
  }
  return message.replace(/^Error:\s*/i, "");
}

function getRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getClaimParameters() {
  const parameters = new URLSearchParams(window.location.search);
  const caseNumber = parameters.get("case");
  const claimToken = parameters.get("claim");
  if (caseNumber && claimToken) return { caseNumber, claimToken };

  try {
    const saved = JSON.parse(window.sessionStorage.getItem("pendingModerationClaim") || "null");
    if (saved?.caseNumber && saved?.claimToken) return saved;
  } catch {
    window.sessionStorage.removeItem("pendingModerationClaim");
  }
  return { caseNumber: null, claimToken: null };
}

function rememberClaimParameters() {
  const claim = getClaimParameters();
  if (claim.caseNumber && claim.claimToken) {
    window.sessionStorage.setItem("pendingModerationClaim", JSON.stringify(claim));
  }
}

function getIdentity(user) {
  const meta = user?.user_metadata || {};
  const username = meta.user_name || meta.preferred_username || meta.name || user?.email?.split("@")[0] || "Applicant";
  return {
    username,
    displayName: meta.full_name || meta.display_name || username,
    avatar: meta.avatar_url || meta.picture || "",
    provider: user?.app_metadata?.provider || "email"
  };
}

function setAuthMessage(message, isError = false) {
  document.querySelectorAll("[data-auth-message]").forEach((element) => {
    element.hidden = !message;
    element.textContent = message || "";
    element.classList.toggle("is-error", isError);
  });
}

async function signInWithTwitch() {
  if (!database) return setAuthMessage("The secure account connection could not load.", true);
  rememberClaimParameters();
  setAuthMessage("Opening Twitch sign-in…");
  const { error } = await database.auth.signInWithOAuth({
    provider: "twitch",
    options: { redirectTo: getRedirectUrl() }
  });
  if (error) setAuthMessage(cleanError(error), true);
}

async function signInWithEmail(event) {
  event.preventDefault();
  if (!database) return setAuthMessage("The secure account connection could not load.", true);
  const email = new FormData(event.currentTarget).get("email")?.toString().trim();
  if (!email) return;
  rememberClaimParameters();
  setAuthMessage("Sending your secure sign-in link…");
  const { error } = await database.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getRedirectUrl(), shouldCreateUser: true }
  });
  setAuthMessage(error ? cleanError(error) : "Check your email for the secure sign-in link.", Boolean(error));
}

async function linkDiscordIdentity() {
  if (!database || !currentSession) return;
  rememberClaimParameters();
  setAuthMessage("Opening Discord connection…");
  const { error } = await database.auth.linkIdentity({
    provider: "discord",
    options: { redirectTo: getRedirectUrl() }
  });
  if (error) setAuthMessage(cleanError(error), true);
}

async function signOut() {
  if (!database) return;
  await database.auth.signOut();
  window.location.reload();
}

function renderAuth(session) {
  currentSession = session;
  const identity = session ? getIdentity(session.user) : null;
  discordConnected = Boolean(session?.user?.identities?.some((item) => item.provider === "discord"));
  document.querySelectorAll("[data-auth-signed-out]").forEach((element) => { element.hidden = Boolean(session); });
  document.querySelectorAll("[data-auth-signed-in]").forEach((element) => { element.hidden = !session; });
  document.querySelectorAll("[data-auth-name]").forEach((element) => { element.textContent = identity?.displayName || ""; });
  document.querySelectorAll("[data-auth-username]").forEach((element) => { element.textContent = identity ? `@${identity.username}` : ""; });
  document.querySelectorAll("[data-auth-provider]").forEach((element) => { element.textContent = identity?.provider === "twitch" ? "Verified through Twitch" : "Verified by email"; });
  document.querySelectorAll("[data-link-discord]").forEach((button) => { button.hidden = !session || discordConnected; });
  document.querySelectorAll("[data-discord-status]").forEach((element) => {
    element.textContent = discordConnected ? "Discord connected · cases sync automatically" : "Connect Discord for automatic case access";
    element.classList.toggle("is-connected", discordConnected);
  });
  document.querySelectorAll("[data-auth-avatar]").forEach((element) => {
    if (identity?.avatar) {
      element.src = identity.avatar;
      element.alt = `${identity.displayName} profile image`;
      element.hidden = false;
    } else {
      element.hidden = true;
    }
  });

  const displayName = document.querySelector("#display-name");
  if (displayName && identity && !displayName.value) displayName.value = identity.displayName;
  document.querySelectorAll("[data-auth-required]").forEach((element) => { element.classList.toggle("is-locked", !session); });
  if (document.querySelector("#linked-moderation-cases")) loadModerationCases();
  if (document.querySelector("#status-results")) loadApplicantCases();
  if (document.querySelector("#staff-results")) loadStaffCases();
}

function moderationActionLabel(action) {
  return {
    warn: "Warning",
    mute: "Timeout / Mute",
    kick: "Kick",
    ban: "Ban",
    automod: "Other moderation action"
  }[action] || "Other moderation action";
}

function formatModerationDuration(seconds) {
  if (!seconds) return "No duration";
  const units = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"]
  ];
  for (const [unitSeconds, label] of units) {
    if (seconds % unitSeconds === 0) {
      const amount = seconds / unitSeconds;
      return `${amount} ${label}${amount === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

function clearClaimParameters() {
  const url = new URL(window.location.href);
  url.searchParams.delete("case");
  url.searchParams.delete("claim");
  window.sessionStorage.removeItem("pendingModerationClaim");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function renderModerationCases(cases, notice = "") {
  const panel = document.querySelector("#linked-moderation-cases");
  const results = document.querySelector("#moderation-case-results");
  if (!panel || !results) return;

  panel.hidden = false;
  moderationCases = new Map((cases || []).map((item) => [item.case_number, item]));

  if (!cases?.length) {
    results.innerHTML = `<div class="linked-case-empty"><strong>${notice ? escapeText(notice) : "No appeal-ready Discord cases"}</strong><p>New eligible moderation actions will appear here when you open the secure link sent by ThyToxicBot.</p></div>`;
    return;
  }

  const noticeMarkup = notice
    ? `<p class="linked-case-notice">${escapeText(notice)}</p>`
    : "";
  results.innerHTML = noticeMarkup + cases.map((item) => {
    const selected = selectedModerationCase?.case_number === item.case_number;
    return `<article class="linked-case-card${selected ? " is-selected" : ""}">
      <div class="linked-case-copy">
        <div><strong>${escapeText(item.case_number)}</strong><span>${escapeText(moderationActionLabel(item.action_type))}</span></div>
        <p>${escapeText(item.reason)}</p>
        <small>${new Date(item.created_at).toLocaleDateString()} · ${escapeText(formatModerationDuration(Number(item.duration_seconds || 0)))}</small>
      </div>
      <button class="button button-primary" type="button" data-appeal-moderation-case="${escapeText(item.case_number)}">${selected ? "Case selected" : "Appeal this case"} <span aria-hidden="true">→</span></button>
    </article>`;
  }).join("");
}

async function loadModerationCases() {
  const panel = document.querySelector("#linked-moderation-cases");
  const results = document.querySelector("#moderation-case-results");
  if (!panel || !results) return;

  if (!currentSession) {
    const claim = getClaimParameters();
    panel.hidden = !(claim.caseNumber && claim.claimToken);
    if (!panel.hidden) {
      results.innerHTML = '<div class="linked-case-empty"><strong>Sign in to open your private case</strong><p>After Twitch sign-in, this secure ticket will appear here automatically.</p></div>';
    }
    return;
  }

  panel.hidden = false;
  results.innerHTML = '<div class="loading-state">Loading your Discord cases…</div>';

  let notice = "";
  const { caseNumber, claimToken } = getClaimParameters();

  if (caseNumber && claimToken) {
    const { error: claimError } = await database.rpc("claim_moderation_case", {
      p_case_number: caseNumber,
      p_claim_token: claimToken
    });
    clearClaimParameters();
    if (claimError) {
      results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(claimError))}</p>`;
      return;
    }
    notice = `${caseNumber} is ready to appeal.`;
  }

  const { data: identityData } = await database.auth.getUserIdentities();
  discordConnected = Boolean(identityData?.identities?.some((item) => item.provider === "discord"));
  document.querySelectorAll("[data-link-discord]").forEach((button) => { button.hidden = discordConnected; });
  document.querySelectorAll("[data-discord-status]").forEach((element) => {
    element.textContent = discordConnected ? "Discord connected · cases sync automatically" : "Connect Discord for automatic case access";
    element.classList.toggle("is-connected", discordConnected);
  });

  if (discordConnected) {
    const { error: linkError } = await database.rpc("link_my_discord_cases");
    if (linkError) {
      results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(linkError))}</p>`;
      return;
    }
  }

  const { data, error } = await database.rpc("my_moderation_cases");
  if (error) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(error))}</p>`;
    return;
  }
  renderModerationCases(data || [], notice);
}

function selectModerationCase(caseNumber) {
  const moderationCase = moderationCases.get(caseNumber);
  if (!moderationCase) return;

  selectedModerationCase = moderationCase;
  appealMode = "individual";
  selectedPlatforms = ["discord"];
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === "individual";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (guidance) guidance.textContent = "This Discord case is linked to your secure appeal ticket.";
  syncPlatformButtons();
  renderCases();

  const existingCase = document.querySelector("#existing-case");
  const incidentDate = document.querySelector("#incident-date");
  const username = document.querySelector('[name="discord_username"]');
  const action = document.querySelector('[name="discord_action"]');
  const reason = document.querySelector('[name="discord_reason"]');

  if (existingCase) {
    existingCase.value = moderationCase.case_number;
    existingCase.readOnly = true;
  }
  if (incidentDate) incidentDate.value = String(moderationCase.created_at).slice(0, 10);
  if (username) username.value = moderationCase.discord_username || moderationCase.discord_display_name || "Discord member";
  if (action) action.value = moderationActionLabel(moderationCase.action_type);
  if (reason) reason.value = String(moderationCase.reason || "").slice(0, 300);

  renderModerationCases([...moderationCases.values()]);
  document.querySelector("#appeal-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearModerationSelection() {
  if (!selectedModerationCase) return;
  selectedModerationCase = null;
  const existingCase = document.querySelector("#existing-case");
  if (existingCase) {
    existingCase.readOnly = false;
    existingCase.value = "";
  }
  renderModerationCases([...moderationCases.values()]);
}

function setMode(mode) {
  clearModerationSelection();
  appealMode = mode;
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (mode === "individual" && selectedPlatforms.length > 1) selectedPlatforms = selectedPlatforms.slice(0, 1);
  if (guidance) guidance.textContent = mode === "individual" ? "Choose one platform below." : "Choose every platform included in this Universal Appeal.";
  syncPlatformButtons();
  renderCases();
}

function togglePlatform(platform) {
  clearModerationSelection();
  if (appealMode === "individual") {
    selectedPlatforms = selectedPlatforms[0] === platform ? [] : [platform];
  } else if (selectedPlatforms.includes(platform)) {
    selectedPlatforms = selectedPlatforms.filter((item) => item !== platform);
  } else {
    selectedPlatforms.push(platform);
  }
  if (platformError) platformError.hidden = true;
  syncPlatformButtons();
  renderCases();
}

function syncPlatformButtons() {
  platformButtons.forEach((button) => {
    const selected = selectedPlatforms.includes(button.dataset.platform);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.querySelector("b").textContent = selected ? "✓" : "+";
  });
}

function renderCases() {
  if (!selectedCases) return;
  if (!selectedPlatforms.length) {
    selectedCases.innerHTML = '<div class="empty-selection"><strong>No platform selected</strong><p>Select a platform above to add its appeal details.</p></div>';
    return;
  }
  const twitchName = currentSession ? getIdentity(currentSession.user).username : "";
  selectedCases.innerHTML = selectedPlatforms.map((platform) => {
    const item = platformConfig[platform];
    const options = item.actions.map((action) => `<option value="${action}">${action}</option>`).join("");
    const value = platform === "twitch" && twitchName ? ` value="${escapeText(twitchName)}"` : "";
    return `<section class="case-panel" style="--case-color:${item.color}" data-case="${platform}">
      <div class="case-header"><div><strong>${item.name} Appeal</strong><small>This platform receives a separate decision.</small></div><span class="case-badge">${item.code} CASE</span></div>
      <div class="field-grid two-column">
        <label><span>${item.name} username</span><input name="${platform}_username" type="text" maxlength="80" placeholder="Your username on ${item.name}"${value} required></label>
        <label><span>Profile or channel link <i>Optional</i></span><input name="${platform}_profile" type="url" inputmode="url" maxlength="1000" placeholder="https://"></label>
        <label><span>Moderation action</span><select name="${platform}_action" required><option value="">Choose an action</option>${options}</select></label>
        <label><span>Reason provided <i>Optional</i></span><input name="${platform}_reason" type="text" maxlength="300" placeholder="Reason shown or given by staff"></label>
      </div>
    </section>`;
  }).join("");
}

function collectAppeal() {
  const data = new FormData(form);
  return {
    p_appeal_mode: appealMode,
    p_display_name: data.get("display_name")?.toString().trim(),
    p_incident_date: data.get("incident_date") || null,
    p_existing_case_number: data.get("existing_case")?.toString().trim() || null,
    p_explanation: data.get("explanation")?.toString().trim(),
    p_evidence_link: data.get("evidence")?.toString().trim() || null,
    p_declaration_accepted: data.get("declaration") === "on",
    p_cases: selectedPlatforms.map((platform) => ({
      platform,
      action_type: data.get(`${platform}_action`)?.toString(),
      platform_username: data.get(`${platform}_username`)?.toString().trim(),
      profile_url: data.get(`${platform}_profile`)?.toString().trim() || null,
      moderation_reason: data.get(`${platform}_reason`)?.toString().trim() || null
    }))
  };
}

function openReview(appeal) {
  pendingAppeal = appeal;
  const cases = appeal.p_cases.map((item) => {
    const platform = platformConfig[item.platform];
    return `<article class="review-case"><strong>${platform.name}: ${escapeText(item.action_type)}</strong><p>User: ${escapeText(item.platform_username)}</p></article>`;
  }).join("");
  document.querySelector("#review-content").innerHTML = `<p><strong>${appealMode === "universal" ? "Universal Appeal" : "Individual Appeal"}</strong> for ${escapeText(appeal.p_display_name)}</p>${cases}`;
  const result = document.querySelector("#submit-result");
  result.hidden = true;
  result.textContent = "";
  const submitButton = document.querySelector("#submit-reviewed-appeal");
  submitButton.hidden = false;
  submitButton.disabled = false;
  submitButton.textContent = "Submit Appeal →";
  document.querySelector("#review-dialog")?.showModal();
}

async function submitReviewedAppeal() {
  if (!database || !pendingAppeal) return;
  const button = document.querySelector("#submit-reviewed-appeal");
  const result = document.querySelector("#submit-result");
  button.disabled = true;
  button.textContent = "Submitting…";
  result.hidden = true;
  const linkedCaseNumber = selectedModerationCase?.case_number || null;
  const request = linkedCaseNumber
    ? database.rpc("submit_moderation_case_appeal", {
        p_case_number: linkedCaseNumber,
        p_display_name: pendingAppeal.p_display_name,
        p_explanation: pendingAppeal.p_explanation,
        p_evidence_link: pendingAppeal.p_evidence_link,
        p_declaration_accepted: pendingAppeal.p_declaration_accepted
      })
    : database.rpc("submit_appeal", pendingAppeal);
  const { data, error } = await request;
  if (error) {
    result.textContent = cleanError(error);
    result.classList.add("is-error");
    result.hidden = false;
    button.disabled = false;
    button.textContent = "Try Again →";
    return;
  }
  result.classList.remove("is-error");
  result.innerHTML = `<strong>Appeal submitted: ${escapeText(data.submission_number)}</strong><br>${data.cases.map((item) => escapeText(item.case_number)).join(" · ")}`;
  result.hidden = false;
  button.hidden = true;
  document.querySelector("#review-content").innerHTML = '<div class="success-mark">✓</div><h3>Your appeal is now in the review queue.</h3><p>Each case will receive its own decision. You can follow every update from the status page.</p>';
  const dialogNotice = document.querySelector("#review-dialog .dialog-notice");
  if (dialogNotice) dialogNotice.innerHTML = '<strong>Saved securely</strong><p>Your authenticated account is linked to these cases.</p>';
  pendingAppeal = null;
  selectedModerationCase = null;
  form.reset();
  const existingCase = document.querySelector("#existing-case");
  if (existingCase) existingCase.readOnly = false;
  selectedPlatforms = [];
  syncPlatformButtons();
  renderCases();
  loadModerationCases();
}

async function loadApplicantCases() {
  const results = document.querySelector("#status-results");
  if (!results) return;
  if (!currentSession) {
    results.innerHTML = '<div class="empty-state"><strong>Sign in to view your appeals</strong><p>Your cases are private and tied to your verified account.</p></div>';
    return;
  }
  results.innerHTML = '<div class="loading-state">Loading your appeals…</div>';
  const { data, error } = await database
    .from("appeal_submissions")
    .select("id, submission_number, appeal_mode, is_test, created_at, appeal_cases(id, case_number, platform, action_type, status, applicant_update, decision_reason, created_at)")
    .order("created_at", { ascending: false });
  if (error) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(error))}</p>`;
    return;
  }
  if (!data?.length) {
    results.innerHTML = '<div class="empty-state"><strong>No appeals yet</strong><p>When you submit an appeal, its cases and decisions will appear here.</p></div>';
    return;
  }
  results.innerHTML = data.map((submission) => `<article class="submission-card">
    <div class="submission-heading"><div><span>${escapeText(submission.submission_number)}${submission.is_test ? ' <b class="test-badge">TEST</b>' : ""}</span><small>${escapeText(submission.appeal_mode)} appeal · ${new Date(submission.created_at).toLocaleDateString()}</small></div><b>${submission.appeal_cases.length} ${submission.appeal_cases.length === 1 ? "case" : "cases"}</b></div>
    <div class="case-list">${submission.appeal_cases.map((item) => `<div class="status-case" style="--case-color:${platformConfig[item.platform]?.color || "#a8f000"}"><div><strong>${escapeText(item.case_number)}</strong><small>${escapeText(platformConfig[item.platform]?.name || item.platform)} · ${escapeText(item.action_type)}</small></div><span data-status="${escapeText(item.status)}">${escapeText(item.status.replaceAll("_", " "))}</span>${item.applicant_update ? `<p>${escapeText(item.applicant_update)}</p>` : ""}${item.decision_reason ? `<p><strong>Decision:</strong> ${escapeText(item.decision_reason)}</p>` : ""}</div>`).join("")}</div>
  </article>`).join("");
}

async function loadStaffCases() {
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
  const { data, error } = await database
    .from("appeal_cases")
    .select("id, case_number, platform, action_type, platform_username, status, created_at, appeal_submissions(submission_number, display_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    results.innerHTML = `<p class="inline-message is-error">${escapeText(cleanError(error))}</p>`;
    return;
  }
  results.innerHTML = `<div class="staff-role">Signed in as <strong>${escapeText(role)}</strong></div>${data?.length ? data.map((item) => `<article class="staff-case-row"><div><strong>${escapeText(item.case_number)}</strong><small>${escapeText(platformConfig[item.platform]?.name || item.platform)} · ${escapeText(item.action_type)} · @${escapeText(item.platform_username)}</small></div><span data-status="${escapeText(item.status)}">${escapeText(item.status.replaceAll("_", " "))}</span></article>`).join("") : '<div class="empty-state"><strong>No cases in the queue</strong><p>New appeals will appear here.</p></div>'}`;
}

modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
platformButtons.forEach((button) => button.addEventListener("click", () => togglePlatform(button.dataset.platform)));
document.querySelectorAll("[data-twitch-sign-in]").forEach((button) => button.addEventListener("click", signInWithTwitch));
document.querySelectorAll("[data-link-discord]").forEach((button) => button.addEventListener("click", linkDiscordIdentity));
document.querySelectorAll("[data-sign-out]").forEach((button) => button.addEventListener("click", signOut));
document.querySelectorAll("[data-email-sign-in]").forEach((emailForm) => emailForm.addEventListener("submit", signInWithEmail));
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.querySelector("#review-dialog")?.close()));
document.querySelector("#submit-reviewed-appeal")?.addEventListener("click", submitReviewedAppeal);
document.querySelector("#moderation-case-results")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-appeal-moderation-case]");
  if (button) selectModerationCase(button.dataset.appealModerationCase);
});

const explanation = document.querySelector("#explanation");
const explanationCount = document.querySelector("#explanation-count");
explanation?.addEventListener("input", () => { explanationCount.textContent = explanation.value.length; });

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentSession) {
    setAuthMessage("Sign in with Twitch or email before submitting your appeal.", true);
    document.querySelector("#account-access")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!selectedPlatforms.length) {
    platformError.hidden = false;
    document.querySelector(".platform-block")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (appealMode === "universal" && selectedPlatforms.length < 2) {
    platformError.hidden = false;
    platformError.textContent = "A Universal Appeal requires at least two platforms.";
    return;
  }
  if (!form.reportValidity()) return;
  openReview(collectAppeal());
});

document.querySelectorAll("[data-current-year]").forEach((element) => { element.textContent = new Date().getFullYear(); });

async function initialise() {
  if (!database) {
    setAuthMessage("The secure account connection could not load. Refresh the page and try again.", true);
    return;
  }
  const { data } = await database.auth.getSession();
  renderAuth(data.session);
  database.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => renderAuth(session), 0);
  });
}

initialise();
