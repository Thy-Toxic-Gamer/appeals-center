const platformConfig = {
  discord: { name: "Discord", code: "DIS", color: "#5865f2", actions: ["Ban", "Timeout / Mute", "Kick", "Warning", "Other moderation action"] },
  twitch: { name: "Twitch", code: "TTV", color: "#9146ff", actions: ["Ban", "Timeout", "Warning", "Other moderation action"] },
  youtube: { name: "YouTube", code: "YT", color: "#ff304f", actions: ["Hidden user", "Live-chat restriction", "Comment restriction", "Block", "Other moderation action"] },
  kick: { name: "Kick", code: "KCK", color: "#53fc18", actions: ["Ban", "Timeout", "Warning", "Other moderation action"] },
  twitter: { name: "X / Twitter", code: "X", color: "#1d9bf0", actions: ["Block", "Reply restriction", "Other moderation action"] },
  instagram: { name: "Instagram", code: "IG", color: "#ff3e98", actions: ["Block", "Restriction", "Comment restriction", "Other moderation action"] }
};

const form = document.querySelector("#appeal-form");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const platformButtons = [...document.querySelectorAll("[data-platform]")];
const selectedCases = document.querySelector("#selected-cases");
const platformError = document.querySelector("#platform-error");
const guidance = document.querySelector("#mode-guidance");
let appealMode = "individual";
let selectedPlatforms = [];

function setMode(mode) {
  appealMode = mode;
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (mode === "individual" && selectedPlatforms.length > 1) selectedPlatforms = selectedPlatforms.slice(0, 1);
  guidance.textContent = mode === "individual" ? "Choose one platform below." : "Choose every platform included in this Universal Appeal.";
  syncPlatformButtons();
  renderCases();
}

function togglePlatform(platform) {
  if (appealMode === "individual") {
    selectedPlatforms = selectedPlatforms[0] === platform ? [] : [platform];
  } else if (selectedPlatforms.includes(platform)) {
    selectedPlatforms = selectedPlatforms.filter((item) => item !== platform);
  } else {
    selectedPlatforms.push(platform);
  }
  platformError.hidden = true;
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

  selectedCases.innerHTML = selectedPlatforms.map((platform) => {
    const config = platformConfig[platform];
    const options = config.actions.map((action) => `<option value="${action}">${action}</option>`).join("");
    return `<section class="case-panel" style="--case-color:${config.color}" data-case="${platform}">
      <div class="case-header"><div><strong>${config.name} Appeal</strong><small>This platform receives a separate decision.</small></div><span class="case-badge">${config.code} CASE</span></div>
      <div class="field-grid two-column">
        <label><span>${config.name} username</span><input name="${platform}_username" type="text" maxlength="80" placeholder="Your username on ${config.name}" required></label>
        <label><span>Profile or channel link <i>Optional</i></span><input name="${platform}_profile" type="url" inputmode="url" placeholder="https://"></label>
        <label><span>Moderation action</span><select name="${platform}_action" required><option value="">Choose an action</option>${options}</select></label>
        <label><span>Reason provided <i>Optional</i></span><input name="${platform}_reason" type="text" maxlength="300" placeholder="Reason shown or given by staff"></label>
      </div>
    </section>`;
  }).join("");
}

modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
platformButtons.forEach((button) => button.addEventListener("click", () => togglePlatform(button.dataset.platform)));

const explanation = document.querySelector("#explanation");
const explanationCount = document.querySelector("#explanation-count");
explanation?.addEventListener("input", () => { explanationCount.textContent = explanation.value.length; });

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedPlatforms.length) {
    platformError.hidden = false;
    document.querySelector(".platform-block")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const cases = selectedPlatforms.map((platform) => {
    const config = platformConfig[platform];
    return `<article class="review-case"><strong>${config.name}: ${data.get(`${platform}_action`)}</strong><p>User: ${escapeText(data.get(`${platform}_username`))}</p></article>`;
  }).join("");
  const reviewContent = document.querySelector("#review-content");
  reviewContent.innerHTML = `<p><strong>${appealMode === "universal" ? "Universal Appeal" : "Individual Appeal"}</strong> for ${escapeText(data.get("display_name"))}</p>${cases}`;
  document.querySelector("#review-dialog")?.showModal();
});

function escapeText(value) {
  const element = document.createElement("span");
  element.textContent = String(value || "");
  return element.innerHTML;
}

document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.querySelector("#review-dialog")?.close()));

document.querySelector("#status-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#status-message").hidden = false;
});

document.querySelector("#staff-login")?.addEventListener("click", () => {
  document.querySelector("#staff-message").hidden = false;
});

document.querySelectorAll("[data-current-year]").forEach((element) => { element.textContent = new Date().getFullYear(); });
