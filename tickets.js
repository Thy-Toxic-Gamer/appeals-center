(() => {
  const typeLabels = {
    support: "General Support",
    report: "User Reports",
    staff_inquiry: "Staff Inquiries",
    suggestion: "Suggestions",
  };
  const typeIcons = {
    support: "📬",
    report: "🚨",
    staff_inquiry: "🛡️",
    suggestion: "💡",
  };
  let tickets = [];
  let statusView = "active";
  let typeView = "all";
  let searchValue = "";
  let selectedTicket = null;
  let signedInStaffRole = null;

  const clean = (value) => escapeText(String(value ?? ""));
  const results = () => document.querySelector("#ticket-center-results");

  function filteredTickets() {
    return tickets.filter((ticket) => {
      const statusMatch = statusView === "archive"
        ? ticket.status === "closed"
        : ticket.status !== "closed";
      const typeMatch = typeView === "all" || ticket.ticket_type === typeView;
      const searchMatch = !searchValue || [
        ticket.ticket_number,
        ticket.subject,
        ticket.discord_creator_username,
        ticket.discord_creator_display_name,
        ticket.claimed_by_username,
        ticket.closed_by_username,
        ticket.close_summary,
      ].join(" ").toLowerCase().includes(searchValue);
      return statusMatch && typeMatch && searchMatch;
    });
  }

  function ticketCard(ticket) {
    const icon = typeIcons[ticket.ticket_type] || "🎟️";
    const label = typeLabels[ticket.ticket_type] || ticket.ticket_type;
    const creator = ticket.discord_creator_display_name ||
      ticket.discord_creator_username || ticket.discord_creator_id;
    const handler = ticket.claimed_by_username || "Waiting for staff";
    return `<button class="ticket-record-card ticket-type-${clean(ticket.ticket_type)}" type="button" data-open-ticket="${clean(ticket.id)}">
      <div class="ticket-record-heading">
        <span>${icon}</span>
        <div><strong>${clean(ticket.ticket_number)}</strong><small>${clean(label)} · ${clean(ticket.status)}</small></div>
        <em>${ticket.status === "closed" ? "View archive →" : "View ticket →"}</em>
      </div>
      <h3>${clean(ticket.subject)}</h3>
      <p>Opened by ${clean(creator)} · Handled by ${clean(handler)}</p>
      <time>${new Date(ticket.created_at).toLocaleString()}</time>
    </button>`;
  }

  function renderTickets() {
    const target = results();
    if (!target) return;
    const visible = filteredTickets();
    const counts = Object.fromEntries(
      ["support", "report", "staff_inquiry", "suggestion"].map((type) => [
        type,
        tickets.filter((ticket) =>
          ticket.ticket_type === type &&
          (statusView === "archive" ? ticket.status === "closed" : ticket.status !== "closed")
        ).length,
      ]),
    );
    target.innerHTML = `
      <div class="ticket-center-heading">
        <div><p class="section-number">DISCORD TICKETS</p><h2>Ticket Center</h2><p>Active conversations and protected transcripts from ThyToxicBot.</p></div>
        <div class="ticket-status-tabs" role="tablist" aria-label="Ticket status">
          <button type="button" data-ticket-status="active" class="${statusView === "active" ? "is-active" : ""}">Active</button>
          <button type="button" data-ticket-status="archive" class="${statusView === "archive" ? "is-active" : ""}">Archive</button>
        </div>
      </div>
      <div class="ticket-type-tabs" role="tablist" aria-label="Ticket location">
        <button type="button" data-ticket-type="all" class="${typeView === "all" ? "is-active" : ""}">All</button>
        <button type="button" data-ticket-type="support" class="${typeView === "support" ? "is-active" : ""}">📬 Support <span>${counts.support}</span></button>
        <button type="button" data-ticket-type="report" class="${typeView === "report" ? "is-active" : ""}">🚨 Reports <span>${counts.report}</span></button>
        <button type="button" data-ticket-type="staff_inquiry" class="${typeView === "staff_inquiry" ? "is-active" : ""}">🛡️ Staff <span>${counts.staff_inquiry}</span></button>
        <button type="button" data-ticket-type="suggestion" class="${typeView === "suggestion" ? "is-active" : ""}">💡 Suggestions <span>${counts.suggestion}</span></button>
      </div>
      <label class="ticket-search"><span>Search tickets and transcripts</span><input type="search" id="ticket-search-input" value="${clean(searchValue)}" placeholder="Ticket number, member, subject, or resolution"></label>
      <p class="ticket-result-count">Showing <strong>${visible.length}</strong> ${statusView === "archive" ? "archived" : "active"} ticket${visible.length === 1 ? "" : "s"}.</p>
      <div class="ticket-record-grid">
        ${visible.length ? visible.map(ticketCard).join("") : `<div class="empty-state"><strong>No matching tickets</strong><p>${statusView === "archive" ? "Closed ThyToxicBot tickets will appear here with their transcripts." : "New private Discord tickets will appear here as soon as they are created."}</p></div>`}
      </div>`;
  }

  async function loadTickets() {
    const target = results();
    if (!target || !database) return;
    target.hidden = false;
    target.innerHTML = '<div class="loading-state">Loading protected ticket records…</div>';
    const { data: role, error: roleError } = await database.rpc("current_staff_role");
    if (roleError || !["moderator", "admin", "owner"].includes(role)) {
      target.innerHTML = '<div class="empty-state"><strong>Staff access required</strong><p>Sign in with an account assigned to the Appeals & Tickets Center staff list.</p></div>';
      return;
    }
    const { data, error } = await database
      .from("support_tickets")
      .select("id,ticket_number,ticket_type,subject,opening_message,status,discord_channel_id,discord_creator_id,discord_creator_username,discord_creator_display_name,claimed_by_discord_id,claimed_by_username,claimed_at,closed_by_discord_id,closed_by_username,close_summary,closed_at,transcript_text,transcript_discord_message_id,transcript_saved_at,purge_after,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      target.innerHTML = `<p class="inline-message is-error">${clean(error.message)}</p>`;
      return;
    }
    signedInStaffRole = role;
    tickets = data || [];
    renderTickets();
  }

  function openTicket(ticketId) {
    selectedTicket = tickets.find((ticket) => ticket.id === ticketId);
    if (!selectedTicket) return;
    const dialog = document.querySelector("#ticket-record-dialog");
    const details = document.querySelector("#ticket-record-details");
    const label = typeLabels[selectedTicket.ticket_type] || selectedTicket.ticket_type;
    const icon = typeIcons[selectedTicket.ticket_type] || "🎟️";
    details.innerHTML = `
      <div class="staff-case-title">
        <div><h2>${clean(selectedTicket.ticket_number)}</h2><p>${icon} ${clean(label)}</p></div>
        <span data-status="${clean(selectedTicket.status)}">${clean(selectedTicket.status)}</span>
      </div>
      <div class="staff-case-grid">
        <article><small>Opened by</small><strong>${clean(selectedTicket.discord_creator_display_name || selectedTicket.discord_creator_username || selectedTicket.discord_creator_id)}</strong><p>Discord ID: ${clean(selectedTicket.discord_creator_id)}</p></article>
        <article><small>Handled by</small><strong>${clean(selectedTicket.claimed_by_username || "Not claimed")}</strong><p>${selectedTicket.claimed_at ? new Date(selectedTicket.claimed_at).toLocaleString() : "Waiting for staff"}</p></article>
        <article class="wide"><small>Subject</small><strong>${clean(selectedTicket.subject)}</strong><p>${clean(selectedTicket.opening_message)}</p></article>
        <article class="wide"><small>Timeline</small><p>Opened: ${new Date(selectedTicket.created_at).toLocaleString()}${selectedTicket.closed_at ? ` · Closed: ${new Date(selectedTicket.closed_at).toLocaleString()}` : " · Currently active"}${selectedTicket.purge_after ? ` · Auto-deletes: ${new Date(selectedTicket.purge_after).toLocaleDateString()}` : ""}</p></article>
        ${selectedTicket.close_summary ? `<article class="wide"><small>Final resolution</small><p>${clean(selectedTicket.close_summary)}</p></article>` : ""}
      </div>
      ${signedInStaffRole === "owner" && selectedTicket.status === "closed" ? `
      <section class="owner-delete-actions ticket-owner-delete">
        <div><strong>Owner archive control</strong><p>Permanently delete this ticket, transcript, and activity record before its six-month expiration.</p></div>
        <button class="button button-danger" type="button" id="delete-archived-ticket">Delete Ticket Permanently</button>
        <p class="staff-form-message" id="ticket-delete-message" hidden></p>
      </section>` : ""}
      <section class="ticket-transcript-panel">
        <div class="panel-heading"><div><span>Protected transcript</span><small>${selectedTicket.transcript_saved_at ? "Saved " + new Date(selectedTicket.transcript_saved_at).toLocaleString() : "Available after the ticket closes"}</small></div></div>
        ${selectedTicket.transcript_text
          ? `<button class="button button-secondary" type="button" id="download-ticket-transcript">Download Transcript</button><pre>${clean(selectedTicket.transcript_text)}</pre>`
          : '<div class="empty-state"><strong>Ticket still active</strong><p>The complete Discord transcript is saved here before its temporary channel is deleted.</p></div>'}
      </section>`;
    dialog.showModal();
  }

  async function deleteArchivedTicket() {
    if (!selectedTicket || signedInStaffRole !== "owner" || selectedTicket.status !== "closed") return;
    const confirmed = window.confirm(
      "Permanently delete " + selectedTicket.ticket_number +
      " and its transcript? This cannot be undone.",
    );
    if (!confirmed) return;
    const button = document.querySelector("#delete-archived-ticket");
    const message = document.querySelector("#ticket-delete-message");
    if (button) {
      button.disabled = true;
      button.textContent = "Deleting…";
    }
    const { error } = await database.rpc("owner_delete_archived_ticket", {
      p_ticket_id: selectedTicket.id,
    });
    if (error) {
      if (button) {
        button.disabled = false;
        button.textContent = "Delete Ticket Permanently";
      }
      if (message) {
        message.textContent = cleanError(error);
        message.classList.add("is-error");
        message.hidden = false;
      }
      return;
    }
    tickets = tickets.filter((ticket) => ticket.id !== selectedTicket.id);
    document.querySelector("#ticket-record-dialog")?.close();
    selectedTicket = null;
    renderTickets();
  }

  function downloadTranscript() {
    if (!selectedTicket?.transcript_text) return;
    const blob = new Blob([selectedTicket.transcript_text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedTicket.ticket_number.toLowerCase() + "-transcript.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("click", (event) => {
    const statusButton = event.target.closest("[data-ticket-status]");
    if (statusButton) {
      statusView = statusButton.dataset.ticketStatus;
      renderTickets();
      return;
    }
    const typeButton = event.target.closest("[data-ticket-type]");
    if (typeButton) {
      typeView = typeButton.dataset.ticketType;
      renderTickets();
      return;
    }
    const ticketButton = event.target.closest("[data-open-ticket]");
    if (ticketButton) {
      openTicket(ticketButton.dataset.openTicket);
      return;
    }
    if (event.target.closest("[data-close-ticket-dialog]")) {
      document.querySelector("#ticket-record-dialog")?.close();
      return;
    }
    if (event.target.closest("#download-ticket-transcript")) downloadTranscript();
    if (event.target.closest("#delete-archived-ticket")) deleteArchivedTicket();
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "ticket-search-input") {
      searchValue = event.target.value.trim().toLowerCase();
      renderTickets();
      const input = document.querySelector("#ticket-search-input");
      input?.focus();
      input?.setSelectionRange(searchValue.length, searchValue.length);
    }
  });

  window.addEventListener("load", async () => {
    if (!database) return;
    const { data } = await database.auth.getSession();
    if (data.session) await loadTickets();
    database.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(loadTickets, 0);
      else {
        const target = results();
        if (target) {
          target.hidden = false;
          target.innerHTML = '<div class="empty-state"><strong>Sign in to view tickets</strong><p>Ticket records and transcripts are protected.</p></div>';
        }
      }
    });
  });
})();
