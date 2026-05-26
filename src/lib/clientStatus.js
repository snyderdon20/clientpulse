/**
 * Two-layer client status computation.
 *
 * Layer 1 (parent): lead | active | lapsed | inactive | restricted
 * Layer 2 (sub-status): one specific classification within the parent.
 *
 * Priority rules (spec §PRIORITY & OVERRIDE RULES):
 *   1. RESTRICTED wins over all time-based / package-based logic.
 *   2. A first-session no-show stays under Lead until manual/automated recovery.
 */

const MSEC_PER_DAY = 1000 * 60 * 60 * 24;

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date(todayStr());
  const then  = new Date(dateStr);
  const diff  = today.getTime() - then.getTime();
  return Math.floor(diff / MSEC_PER_DAY);
}

/** Returns the ISO date string of the last verified visit (completed or checked-in). */
function lastVerifiedVisitDate(client) {
  const apptDate = (client.appointments || [])
    .filter((a) => a.status === "completed" || a.status === "checked-in")
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  return apptDate || client.lastVisit || null;
}

/** True if the client has any future appointment that isn't cancelled. */
function hasFutureAppointment(client) {
  const today = todayStr();
  return (client.appointments || []).some(
    (a) => a.date >= today && a.status !== "cancelled",
  );
}

/** True if the client has any future appointment with an active/booked status. */
function hasFutureBookedAppointment(client) {
  const today = todayStr();
  return (client.appointments || []).some(
    (a) => a.date >= today && (a.status === "scheduled" || a.status === "checked-in"),
  );
}

/** True if there is any comm.* outreach entry in history. */
function hasOutreachHistory(client) {
  return (client.history || []).some((h) => h.type && h.type.startsWith("comm."));
}

const CONTACTED_COOLDOWN_DAYS = 7;

/** Returns the ms timestamp of the most recent comm.* history entry, or null.
 *  Handles both numeric ms timestamps (local state) and ISO strings (Supabase). */
function lastOutreachTs(client) {
  const entries = (client.history || []).filter(
    (h) => h.type && h.type.startsWith("comm.")
  );
  if (!entries.length) return null;
  const timestamps = entries.map((h) => {
    if (!h.ts) return 0;
    const n = typeof h.ts === "number" ? h.ts : new Date(h.ts).getTime();
    return isNaN(n) ? 0 : n;
  });
  const max = Math.max(...timestamps);
  return max > 0 ? max : null;
}

/** True if a comm entry was logged within the cooldown window. */
function wasRecentlyContacted(client) {
  const ts = lastOutreachTs(client);
  if (!ts) return false;
  return Date.now() - ts < CONTACTED_COOLDOWN_DAYS * MSEC_PER_DAY;
}

/**
 * Returns { layer1: string, layer2: string } for the given client.
 *
 * @param {object} client - The client object as used in App.jsx (camelCase fields).
 */
export function computeClientStatus(client) {
  // ── Priority 1: RESTRICTED overrides everything ───────────────────────────
  if (client.restrictedStatus === "deactivated") {
    return { layer1: "restricted", layer2: "deactivated" };
  }
  if (client.restrictedStatus === "flagged") {
    return { layer1: "restricted", layer2: "flagged" };
  }

  const today     = todayStr();
  const completed = client.completedAppointmentsCount ?? 0;

  // ── Layer 1: LEAD — zero completed visits ─────────────────────────────────
  if (completed === 0) {
    // First Session No-Show: had a no-show before their first real visit.
    // noShows is incremented by the webhook on every no-show event.
    const hadNoShow =
      (client.noShows ?? 0) > 0 ||
      (client.history || []).some((h) => h.type === "appt.noshow");
    if (hadNoShow) {
      return { layer1: "lead", layer2: "first-session-no-show" };
    }

    // First Session Booked: future appointment is on the calendar.
    if (hasFutureBookedAppointment(client)) {
      return { layer1: "lead", layer2: "first-session-booked" };
    }

    // Contacted: outreach has happened (manual notes OR contacted_at timestamp).
    const wasContacted =
      !!client.contactedAt || hasOutreachHistory(client);

    if (wasContacted) {
      // Lost Lead: contacted >14 days ago with zero subsequent activity.
      const contactTs = client.contactedAt
        ? new Date(client.contactedAt).getTime()
        : null;
      if (contactTs !== null) {
        const contactedDaysAgo = Math.floor(
          (Date.now() - contactTs) / MSEC_PER_DAY,
        );
        if (contactedDaysAgo > 14) {
          return { layer1: "lead", layer2: "lost-lead" };
        }
      }
      return { layer1: "lead", layer2: "contacted" };
    }

    // New: fresh profile, no outreach, no prior activity.
    return { layer1: "lead", layer2: "new" };
  }

  // ── Check for expired package / gift card (LAPSED sub-status) ────────────
  // Fires when the calendar date crosses purchase_date + 365 days AND
  // the balance at that time was > 0.
  if (
    client.giftCardPurchaseDate &&
    (client.giftCardBalance ?? 0) > 0 &&
    daysSince(client.giftCardPurchaseDate) >= 365
  ) {
    return { layer1: "lapsed", layer2: "expired-package" };
  }

  const lastVisit = lastVerifiedVisitDate(client);
  const ds        = daysSince(lastVisit);

  // ── Layer 1: INACTIVE — 90+ days, no future appointments ─────────────────
  if (ds > 90 && !hasFutureAppointment(client)) {
    return { layer1: "inactive", layer2: "past-client" };
  }

  // ── Layer 1: LAPSED — 31 – 90 days since last visit ──────────────────────
  if (ds > 30) {
    const contacted = wasRecentlyContacted(client);
    // Stale: 61 – 90 days (or 90+ with a future appt keeping them out of inactive)
    if (ds > 60) {
      return { layer1: "lapsed", layer2: contacted ? "stale-contacted" : "stale" };
    }
    // Overdue 31 – 60 days
    const hasActivePackage =
      (client.packageCreditsRemaining ?? 0) > 0 &&
      client.packageExpirationDate &&
      client.packageExpirationDate > today;
    if (contacted) {
      return { layer1: "lapsed", layer2: "overdue-contacted" };
    }
    if (hasActivePackage) {
      return { layer1: "lapsed", layer2: "overdue-with-package" };
    }
    return { layer1: "lapsed", layer2: "overdue" };
  }

  // ── Layer 1: ACTIVE — last visit within 30 days ───────────────────────────
  // Needs Follow Up: manually flagged by staff (client left without booking).
  if (client.needsFollowUp) {
    return { layer1: "active", layer2: "needs-follow-up" };
  }

  // Package Holder: active unexpired package credits.
  const hasActivePackage =
    (client.packageCreditsRemaining ?? 0) > 0 &&
    client.packageExpirationDate &&
    client.packageExpirationDate > today;
  if (hasActivePackage) {
    return { layer1: "active", layer2: "package-holder" };
  }

  // New Client: exactly 1 completed visit (just onboarded).
  if (completed === 1) {
    return { layer1: "active", layer2: "new-client" };
  }

  // Regular: 2+ completed visits, active cadence, no package.
  return { layer1: "active", layer2: "regular" };
}

// ── Display configuration ──────────────────────────────────────────────────

export const LAYER1_CFG = {
  lead:       { label: "Lead",       bg: "#dbeafe", color: "#1d5fa8" },
  active:     { label: "Active",     bg: "#dcf5ec", color: "#0f7a4a" },
  lapsed:     { label: "Lapsed",     bg: "#fee2e2", color: "#991b1b" },
  inactive:   { label: "Inactive",   bg: "#f1f5f9", color: "#64748b" },
  restricted: { label: "Restricted", bg: "#fce7f3", color: "#9d174d" },
};

export const LAYER2_CFG = {
  // Lead
  "new":                    { label: "New",                   layer1: "lead",       bg: "#dbeafe", color: "#1d5fa8" },
  "contacted":              { label: "Contacted",             layer1: "lead",       bg: "#bfdbfe", color: "#1e40af" },
  "lead-follow-up":         { label: "Needs Follow Up",       layer1: "lead",       bg: "#ede9fe", color: "#5b21b6" },
  "first-session-booked":   { label: "First Session Booked",  layer1: "lead",       bg: "#a5f3fc", color: "#0e7490" },
  "first-session-no-show":  { label: "First Session No-Show", layer1: "lead",       bg: "#fef3c7", color: "#92400e" },
  "lost-lead":              { label: "Lost Lead",             layer1: "lead",       bg: "#e5e7eb", color: "#4b5563" },
  // Active
  "new-client":             { label: "New Client",            layer1: "active",     bg: "#d1fae5", color: "#065f46" },
  "regular":                { label: "Regular",               layer1: "active",     bg: "#dcf5ec", color: "#0f7a4a" },
  "package-holder":         { label: "Package Holder",        layer1: "active",     bg: "#bbf7d0", color: "#166534" },
  "needs-follow-up":        { label: "Needs Follow Up",       layer1: "active",     bg: "#ede9fe", color: "#5b21b6" },
  // Lapsed
  "overdue-with-package":   { label: "Overdue + Package",     layer1: "lapsed",     bg: "#ffedd5", color: "#9a3412" },
  "overdue":                { label: "Overdue",               layer1: "lapsed",     bg: "#fef3c7", color: "#92400e" },
  "overdue-contacted":      { label: "Overdue · Contacted",   layer1: "lapsed",     bg: "#fef3c7", color: "#92400e" },
  "stale":                  { label: "Stale (61–90 days)",    layer1: "lapsed",     bg: "#fee2e2", color: "#991b1b" },
  "stale-contacted":        { label: "Stale · Contacted",     layer1: "lapsed",     bg: "#fee2e2", color: "#991b1b" },
  "lapsed-follow-up":       { label: "Needs Follow Up",       layer1: "lapsed",     bg: "#ede9fe", color: "#5b21b6" },
  "expired-package":        { label: "Expired Package",       layer1: "lapsed",     bg: "#fecaca", color: "#7f1d1d" },
  // Inactive
  "past-client":            { label: "Past Client",           layer1: "inactive",   bg: "#f1f5f9", color: "#64748b" },
  "inactive-follow-up":     { label: "Needs Follow Up",       layer1: "inactive",   bg: "#ede9fe", color: "#5b21b6" },
  // Restricted
  "deactivated":            { label: "Deactivated",           layer1: "restricted", bg: "#fce7f3", color: "#9d174d" },
  "flagged":                { label: "Flagged",               layer1: "restricted", bg: "#fecdd3", color: "#881337" },
};

/** Convenience: returns the Layer 2 display config, falling back gracefully. */
export function getStatusCfg(layer2) {
  return LAYER2_CFG[layer2] ?? { label: layer2, layer1: "lead", bg: "#e8e0d6", color: "#8a7a6a" };
}
