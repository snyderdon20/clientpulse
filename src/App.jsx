import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { testVagaroConnection, syncVagaroClients } from "./api/vagaroService";
import { computeClientStatus, LAYER1_CFG, LAYER2_CFG, getStatusCfg } from "./lib/clientStatus";

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useIsMobile(bp = 640) {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" ? window.innerWidth < bp : false
  );
  useEffect(() => {
    const h = () => setMobile(window.innerWidth < bp);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [bp]);
  return mobile;
}

// ─── SHARED STYLES ───────────────────────────────────────────────────────────
const S = {
  card: {
    background: "#ffffff",
    border: "1px solid #e8e0d6",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 1px 4px rgba(46,36,24,0.06)",
  },
  inp: {
    background: "#faf8f5",
    border: "1px solid #ddd6cc",
    borderRadius: "10px",
    padding: "9px 12px",
    fontSize: "13px",
    color: "#2e2418",
    outline: "none",
    width: "100%",
    fontFamily: "'DM Sans',sans-serif",
  },
  lbl: {
    fontSize: "10px",
    fontWeight: "700",
    color: "#8a7a6a",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    display: "block",
    marginBottom: "6px",
  },
  btn: (v = "ghost") => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "9px 16px",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    border: "none",
    fontFamily: "'DM Sans',sans-serif",
    transition: "all 0.15s",
    background:
      v === "primary" ? "linear-gradient(135deg,#a0785a,#7a5640)"
      : v === "danger" ? "#fee2e2"
      : "#f5ede4",
    color: v === "primary" ? "#fff" : v === "danger" ? "#991b1b" : "#6b5244",
  }),
  sm: (v = "ghost") => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    border: "none",
    fontFamily: "'DM Sans',sans-serif",
    transition: "all 0.15s",
    background:
      v === "primary" ? "linear-gradient(135deg,#a0785a,#7a5640)"
      : v === "danger" ? "#fee2e2"
      : "#f5ede4",
    color: v === "primary" ? "#fff" : v === "danger" ? "#991b1b" : "#6b5244",
  }),
};

// ─── DUPLICATE DETECTION ─────────────────────────────────────────────────────
function findDuplicates(clients) {
  const groups = [];
  const processed = new Set();
  for (let i = 0; i < clients.length; i++) {
    const a = clients[i];
    if (processed.has(a.id)) continue;
    const matches = [];
    const reasons = {};
    for (let j = i + 1; j < clients.length; j++) {
      const b = clients[j];
      if (processed.has(b.id)) continue;
      const r = [];
      if (a.email && b.email && a.email.toLowerCase().trim() === b.email.toLowerCase().trim()) r.push("email");
      const pa = (a.phone || "").replace(/\D/g, "");
      const pb = (b.phone || "").replace(/\D/g, "");
      if (pa.length >= 7 && pa === pb) r.push("phone");
      const na = `${a.firstName} ${a.lastName}`.toLowerCase().trim();
      const nb = `${b.firstName} ${b.lastName}`.toLowerCase().trim();
      if (na.length > 3 && na === nb) r.push("name");
      if (r.length > 0) { matches.push(b); reasons[b.id] = r; processed.add(b.id); }
    }
    if (matches.length > 0) { processed.add(a.id); groups.push({ clients: [a, ...matches], reasons }); }
  }
  return groups;
}

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
// Legacy flat map kept for any code that still reads STATUS_CFG[key].
// New code should use computeClientStatus() + LAYER2_CFG from clientStatus.js.
const STATUS_CFG = Object.fromEntries(
  Object.entries(LAYER2_CFG).map(([k, v]) => [k, { label: v.label, bg: v.bg, color: v.color }])
);

const DEFAULT_TAGS = [
  "Deep Tissue", "Swedish", "Hot Stone", "Prenatal", "Sports",
  "Lymphatic", "Relaxation", "Regular", "Monthly", "Corporate",
  "Referral Source", "VIP", "Needs Follow-up",
];

// ─── HISTORY EVENT TYPE REGISTRY ─────────────────────────────────────────────
const HISTORY_TYPES = {
  "appt.scheduled":     { icon: "📅", label: "Appointment Scheduled",   color: "#1d5fa8", bg: "#dbeafe", src: "system" },
  "appt.rescheduled":   { icon: "🔄", label: "Appointment Rescheduled", color: "#5b21b6", bg: "#ede9fe", src: "system" },
  "appt.checkin":       { icon: "✅", label: "Checked In",              color: "#0f7a4a", bg: "#dcf5ec", src: "system" },
  "appt.completed":     { icon: "🏁", label: "Appointment Completed",   color: "#065f46", bg: "#d1fae5", src: "system" },
  "appt.cancelled":     { icon: "❌", label: "Appointment Cancelled",   color: "#64748b", bg: "#f1f5f9", src: "system" },
  "appt.noshow":        { icon: "🚫", label: "No-Show",                 color: "#92400e", bg: "#fef3c7", src: "system" },
  "payment.charged":    { icon: "💳", label: "Payment Charged",         color: "#065f46", bg: "#d1fae5", src: "system" },
  "payment.refund":     { icon: "↩️",  label: "Refund Issued",           color: "#991b1b", bg: "#fee2e2", src: "system" },
  "client.created":     { icon: "🆕", label: "Client Record Created",   color: "#1d5fa8", bg: "#dbeafe", src: "system" },
  "client.updated":     { icon: "✏️",  label: "Profile Updated",         color: "#8a7a6a", bg: "#f5ede4", src: "user"   },
  "notes.updated":      { icon: "📝", label: "Notes Updated",           color: "#8a7a6a", bg: "#f5ede4", src: "user"   },
  "touchpoint.logged":  { icon: "☑️",  label: "Touchpoint Checked",     color: "#0f7a4a", bg: "#dcf5ec", src: "user"   },
  "touchpoint.cleared": { icon: "◻️",  label: "Touchpoint Cleared",      color: "#8a7a6a", bg: "#f5ede4", src: "user"   },
  "comm.phone":         { icon: "📞", label: "Phone Call",              color: "#2e2418", bg: "#faf8f5", src: "user"   },
  "comm.text":          { icon: "💬", label: "Text / SMS",              color: "#2e2418", bg: "#faf8f5", src: "user"   },
  "comm.email":         { icon: "✉️",  label: "Email",                   color: "#2e2418", bg: "#faf8f5", src: "user"   },
  "comm.mail":          { icon: "📮", label: "Mail",                    color: "#2e2418", bg: "#faf8f5", src: "user"   },
  "comm.inperson":      { icon: "🤝", label: "In-Person",               color: "#2e2418", bg: "#faf8f5", src: "user"   },
  "vagaro.sync":        { icon: "🔗", label: "Vagaro Sync",             color: "#0c6ebd", bg: "#e8f4fd", src: "system" },
};

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = {
  rebooking: {
    label: "Rebooking — Stress / Monthly", icon: "📅",
    sms: "Hi {{firstName}}! You carry a lot — this is your time to fill back up. Ready to lock in your next session? We'd love to hold your spot: {{bookingLink}}",
    email: {
      subject: "Ready to lock in your next session, {{firstName}}?",
      body: "Hi {{firstName}},\n\nThe best thing we can do is make sure your next session is already on the calendar — no thinking required.\n\nWe also have a Buy 5 Get 1 Free package that a lot of our regulars love. It works out beautifully for someone like you.\n\nBook here: {{bookingLink}}\n\nSee you soon,\nDon & the team at RCTM",
    },
  },
  "post-visit": {
    label: "Post-Visit Follow-Up", icon: "❤️",
    sms: "Hi {{firstName}}! Just checking in after your session — how are you feeling? I noticed some significant tension in your upper traps — would love to know if you're getting some relief. 💛",
    email: {
      subject: "How are you feeling after your session, {{firstName}}?",
      body: "Hi {{firstName}},\n\nI just wanted to check in and see how you're feeling after your visit with us.\n\nA lot of people don't realize how much they're holding until they finally have a chance to let it go. Monthly massage can be a real game-changer for that.\n\nWhenever you're ready to book your next session:\n{{bookingLink}}\n\nTake care,\nDon & the team at RCTM",
    },
  },
  "no-show": {
    label: "No-Show Follow-Up", icon: "🚫",
    sms: "Hi {{firstName}}, we missed you today! We hope everything is okay. Whenever you're ready to rebook, I'll take care of everything for you: {{bookingLink}}",
    email: {
      subject: "We missed you today, {{firstName}}",
      body: "Hi {{firstName}},\n\nWe noticed you weren't able to make your appointment today — no worries at all! Life happens.\n\nWhenever you're ready to rebook, just reach out and I'll take care of everything:\n{{bookingLink}}\n\nWarm regards,\nDon & the team at RCTM",
    },
  },
  birthday: {
    label: "Birthday Offer", icon: "🎂",
    sms: "Happy Birthday {{firstName}}! 🎂 We'd love to help you celebrate — we have something special for you this month. Reply and I'll take care of you!",
    email: {
      subject: "Happy Birthday, {{firstName}}! 🎂 A gift from us",
      body: "Hi {{firstName}},\n\nWishing you the most wonderful birthday! You deserve to be pampered today and every day.\n\nWe'd love to treat you to something special this month — just reply to this email or book online and mention your birthday:\n{{bookingLink}}\n\nHappy Birthday,\nDon & the team at RCTM",
    },
  },
  promo: {
    label: "Promotional Offer", icon: "🎁",
    sms: "Hi {{firstName}}! We're running something special right now that I thought of you for. Would you like details? 😊",
    email: {
      subject: "Something special for you, {{firstName}}",
      body: "Hi {{firstName}},\n\nWe're running a seasonal offering I thought you'd love. Every promotion we create is about elevating access to the care you deserve — not just a discount.\n\nBook here to take advantage:\n{{bookingLink}}\n\nLooking forward to seeing you,\nDon & the team at RCTM",
    },
  },
  lapsed: {
    label: "Win-Back (Lapsed Client)", icon: "🔴",
    sms: "Hi {{firstName}}! This is Don from Rapid City Therapeutic Massage — I'm reaching out to a few clients we haven't seen in a while just to say hello. How have you been? 😊",
    email: {
      subject: "Hi {{firstName}} — checking in from RCTM",
      body: "Hi {{firstName}},\n\nI'm just reaching out to say hello and check in — we haven't seen you in a while and we've been thinking about you.\n\nHow are you doing? If there's ever anything I can help with or if you'd like to come back in, just reach out. I'm here and I'll take care of everything.\n\n{{bookingLink}}\n\nWarm regards,\nDon\nRapid City Therapeutic Massage",
    },
  },
  prenatal: {
    label: "Prenatal Package", icon: "🤰",
    sms: "Hi {{firstName}}! We have a Prenatal Package I'd love to tell you about — designed to support you through each stage of your pregnancy. Can I share the details?",
    email: {
      subject: "Supporting you through every stage, {{firstName}}",
      body: "Hi {{firstName}},\n\nWe have a Prenatal Package I'd love to share with you — it's designed to support your body, nervous system, and spirit through each trimester and into postpartum recovery.\n\nA lot of our moms tell us it's one of the best gifts they gave themselves.\n\nCan I walk you through it? Reply here or book a free consultation:\n{{bookingLink}}\n\nWith care,\nDon & the team at RCTM",
    },
  },
  referral: {
    label: "Referral Reward 🏆", icon: "🏆",
    sms: "{{firstName}}! I just had to reach out — you've sent us amazing clients and we are SO grateful. As a thank you, we'd love to give you a complimentary half-hour add-on at your next visit. It's already in your file — just show up! 💛",
    email: {
      subject: "You're amazing, {{firstName}} — a thank you from us",
      body: "Hi {{firstName}},\n\nI just had to reach out because you've been so generous in sending people our way, and we are truly grateful.\n\nAs a heartfelt thank you, we'd love to give you a complimentary half-hour add-on at your next visit. It's already noted in your file — just show up and let us take care of you.\n\nBook your next session here:\n{{bookingLink}}\n\nWith so much gratitude,\nDon & the team at RCTM",
    },
  },
  "red-light": {
    label: "Red Light Therapy Intro", icon: "💡",
    sms: "Hi {{firstName}}! Before your next visit — have you had a chance to try our Red Light Therapy mat? There's great research behind it and I'd love to build a session right into your next appointment. Interested?",
    email: {
      subject: "Have you tried our Red Light Therapy, {{firstName}}?",
      body: "Hi {{firstName}},\n\nI wanted to share something I think you'd really love — our Red Light Therapy mat. It's a full-body session, incredibly relaxing, and there's excellent research behind it for pain, inflammation, sleep, and recovery.\n\nWe have an intro price right now. Would you like to try it at your next visit? I can build it right into your appointment.\n\nBook here:\n{{bookingLink}}\n\nLet me know!\nDon & the team at RCTM",
    },
  },
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split("T")[0];
const uid = () => crypto.randomUUID();
const fullName = (c) => `${c.firstName} ${c.lastName}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${MONTHS[+m - 1]} ${+day}, ${y}`;
};

const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const fmtStamp = (ts) => {
  const d = new Date(typeof ts === "number" ? ts : ts);
  const mo = MONTHS[d.getMonth()];
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${d.getDate()}, ${d.getFullYear()} · ${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
};

const nowMs = () => Date.now();
const daysSince = (d) =>
  d ? Math.floor((new Date(TODAY) - new Date(d + "T00:00:00")) / 86400000) : null;

// Returns the most recent history event matching a touchpoint category, and how long ago
function getLastSent(client, category) {
  const match = (client.history || [])
    .filter((e) => e.detail && e.detail.startsWith(category + " ·"))
    .sort((a, b) => b.ts - a.ts)[0];
  if (!match) return null;
  const daysAgo = Math.floor((Date.now() - match.ts) / 86400000);
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 30) return `${daysAgo}d ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30)}mo ago`;
  return `${Math.floor(daysAgo / 365)}y ago`;
}

const pastTS = (daysAgo, hour = 10, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};

function lastCompletedDate(client) {
  return (client.appointments || [])
    .filter((a) => a.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ||
    client.lastVisit || null;
}

function deriveStatus(client) {
  // Legacy override: map old flat keys to new two-layer sub-status keys.
  if (client.statusOverride) {
    const legacyMap = {
      "active":    "regular",
      "overdue":   "overdue",
      "lapsed":    "stale",
      "new-lead":  "new",
      "follow-up": "needs-follow-up",
    };
    return legacyMap[client.statusOverride] ?? client.statusOverride;
  }
  return computeClientStatus(client).layer2;
}

/** Returns { layer1, layer2 } for a client. Prefer this over deriveStatus() for new code. */
function clientStatus(client) {
  if (client.statusOverride) {
    const legacyMap = {
      "active":    { layer1: "active",   layer2: "regular" },
      "overdue":   { layer1: "lapsed",   layer2: "overdue" },
      "lapsed":    { layer1: "lapsed",   layer2: "stale"   },
      "new-lead":  { layer1: "lead",     layer2: "new"     },
      "follow-up": { layer1: "active",   layer2: "needs-follow-up" },
    };
    if (legacyMap[client.statusOverride]) return legacyMap[client.statusOverride];
  }
  return computeClientStatus(client);
}

function fillTemplate(text, client) {
  return (text || "")
    .replace(/{{firstName}}/g, client.firstName || "")
    .replace(/{{lastName}}/g, client.lastName || "")
    .replace(/{{bookingLink}}/g, "[Your Vagaro booking link]");
}

// ─── CARE CATEGORIES ─────────────────────────────────────────────────────────
const CARE_CATEGORIES = {
  syndrome:   { label: "Syndrome / Chronic",        icon: "🩺", color: "#991b1b", bg: "#fee2e2", rebook: "Treatment plan — weekly or bi-weekly" },
  stress:     { label: "High-Functioning / Stress",  icon: "💼", color: "#92400e", bg: "#fef3c7", rebook: "Monthly maintenance — Buy 5 Get 1 Free" },
  occasional: { label: "Occasional / Gift Card",     icon: "🎁", color: "#1d5fa8", bg: "#dbeafe", rebook: "Monthly maintenance invite — plant the seed" },
  prenatal:   { label: "Prenatal",                   icon: "🤰", color: "#6d28d9", bg: "#ede9fe", rebook: "Prenatal Package — book next before leaving" },
};

const RED_LIGHT_FUNNEL = {
  null:          { label: "Not offered yet",      icon: "💡", color: "#6b7280", bg: "#f9fafb",  next: "offered",       action: "Offer it",           actionNote: "Offer Red Light Therapy at next contact" },
  offered:       { label: "Offered — no response",icon: "💡", color: "#92400e", bg: "#fef3c7",  next: "interested",    action: "Follow up",          actionNote: "Follow up on Red Light interest" },
  interested:    { label: "Interested",           icon: "⭐", color: "#1d5fa8", bg: "#dbeafe",  next: "intro_booked",  action: "Book intro",         actionNote: "Book Red Light intro session" },
  intro_booked:  { label: "Intro booked",         icon: "📅", color: "#6d28d9", bg: "#ede9fe",  next: "active",        action: "Confirm session",    actionNote: "Confirm Red Light intro session" },
  active:        { label: "Active client",        icon: "✅", color: "#065f46", bg: "#d1fae5",  next: "active",        action: "Log session",        actionNote: "Log Red Light session" },
  declined:      { label: "Declined",             icon: "✗",  color: "#9ca3af", bg: "#f3f4f6",  next: "offered",       action: "Re-offer",           actionNote: "Re-offer Red Light Therapy" },
};

// Keep RED_LIGHT_STATUSES as alias for any legacy references
const RED_LIGHT_STATUSES = RED_LIGHT_FUNNEL;

// ─── HISTORY EVENT FACTORY ────────────────────────────────────────────────────
function mkEvent(type, detail, { by = "System", ts = nowMs() } = {}) {
  return { id: uid(), type, detail, by, ts };
}

const CHAN_TYPE = {
  "Phone": "comm.phone",
  "Text/SMS": "comm.text",
  "Email": "comm.email",
  "Mail": "comm.mail",
  "In-Person": "comm.inperson",
};

// ─── CHANNELS / CATEGORIES / OUTCOMES ────────────────────────────────────────
const CHANNELS = ["Phone", "Text/SMS", "Email", "Mail", "In-Person"];

const CHANNEL_CATEGORIES = {
  "Phone":     ["Rebooking Outreach","Post-Visit Follow-Up","No-Show Follow-Up","New Inquiry","Complaint / Concern","General"],
  "Text/SMS":  ["Appointment Reminder","Rebooking Outreach","Post-Visit Follow-Up","Birthday / Special Offer","Promotional Offer","General"],
  "Email":     ["Appointment Reminder","Rebooking Outreach","Post-Visit Follow-Up","Birthday / Special Offer","Promotional Offer","Newsletter","General"],
  "Mail":      ["Birthday / Special Offer","Promotional Offer","Thank You Card","General"],
  "In-Person": ["Check-In","Post-Visit Chat","Concern Raised","General"],
};

const OUTCOMES = {
  "Phone":     ["Spoke with Client","Left Voicemail","No Answer","Rebooked","Follow-up Needed"],
  "Text/SMS":  ["Replied","Rebooked","No Reply","Opted Out","Follow-up Needed"],
  "Email":     ["Replied","Rebooked","No Reply","Bounced","Follow-up Needed"],
  "Mail":      ["Sent","Returned to Sender"],
  "In-Person": ["Completed","Follow-up Needed"],
};

const QUICK_LOGS = [
  { label: "Called",     channel: "Phone",     category: "Rebooking Outreach",      icon: "📞" },
  { label: "Texted",     channel: "Text/SMS",  category: "Rebooking Outreach",      icon: "💬" },
  { label: "Emailed",    channel: "Email",     category: "Rebooking Outreach",      icon: "✉️" },
  { label: "Post-Visit", channel: "Text/SMS",  category: "Post-Visit Follow-Up",    icon: "❤️" },
  { label: "No-Show",    channel: "Phone",     category: "No-Show Follow-Up",       icon: "🚫" },
  { label: "Birthday",   channel: "Email",     category: "Birthday / Special Offer",icon: "🎂" },
  { label: "In-Person",  channel: "In-Person", category: "Post-Visit Chat",         icon: "🤝" },
];

const TOUCHPOINTS_BY_CATEGORY = {
  default: [
    { key: "reminder",  label: "Appointment Reminder",    icon: "⏰", logPreset: { channel: "Text/SMS", category: "Appointment Reminder"     }, templateKey: null          },
    { key: "postVisit", label: "Post-Visit Follow-Up",    icon: "❤️", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
    { key: "rebooking", label: "Rebooking Outreach",      icon: "📅", logPreset: { channel: "Text/SMS", category: "Rebooking Outreach"       }, templateKey: "rebooking"   },
    { key: "birthday",  label: "Birthday / Special Offer",icon: "🎂", logPreset: { channel: "Email",    category: "Birthday / Special Offer" }, templateKey: "birthday"    },
    { key: "promo",     label: "Promotional Offer",       icon: "🎁", logPreset: { channel: "Email",    category: "Promotional Offer"        }, templateKey: "promo"       },
  ],
  syndrome: [
    { key: "reminder",     label: "Appointment Reminder",      icon: "⏰", logPreset: { channel: "Text/SMS", category: "Appointment Reminder"   }, templateKey: null          },
    { key: "postVisit",    label: "Post-Visit Follow-Up",      icon: "❤️", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"   }, templateKey: "post-visit"  },
    { key: "treatmentPlan",label: "Treatment Plan Check-In",   icon: "🩺", logPreset: { channel: "Phone",    category: "Rebooking Outreach"     }, templateKey: "rebooking"   },
    { key: "nextSession",  label: "Next Session Scheduling",   icon: "📅", logPreset: { channel: "Text/SMS", category: "Rebooking Outreach"     }, templateKey: "rebooking"   },
    { key: "redLight",     label: "Red Light Therapy Intro",   icon: "💡", logPreset: { channel: "Text/SMS", category: "Red Light Therapy"      }, templateKey: "red-light"   },
  ],
  stress: [
    { key: "reminder",  label: "Appointment Reminder",    icon: "⏰", logPreset: { channel: "Text/SMS", category: "Appointment Reminder"     }, templateKey: null          },
    { key: "postVisit", label: "Post-Visit Follow-Up",    icon: "❤️", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
    { key: "rebooking", label: "Rebooking Outreach",      icon: "📅", logPreset: { channel: "Text/SMS", category: "Rebooking Outreach"       }, templateKey: "rebooking"   },
    { key: "package",   label: "Buy 5 Get 1 Free Offer",  icon: "🎁", logPreset: { channel: "Text/SMS", category: "Promotional Offer"        }, templateKey: "promo"       },
    { key: "redLight",  label: "Red Light Therapy Intro", icon: "💡", logPreset: { channel: "Text/SMS", category: "Red Light Therapy"        }, templateKey: "red-light"   },
  ],
  occasional: [
    { key: "reminder",   label: "Appointment Reminder",    icon: "⏰", logPreset: { channel: "Text/SMS", category: "Appointment Reminder"     }, templateKey: null          },
    { key: "postVisit",  label: "Post-Visit Follow-Up",    icon: "❤️", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
    { key: "monthlyInvite",label: "Monthly Care Invitation",icon: "🌱", logPreset: { channel: "Text/SMS", category: "Rebooking Outreach"       }, templateKey: "rebooking"   },
    { key: "redLight",   label: "Red Light Therapy Intro", icon: "💡", logPreset: { channel: "Text/SMS", category: "Red Light Therapy"        }, templateKey: "red-light"   },
    { key: "birthday",   label: "Birthday / Special Offer",icon: "🎂", logPreset: { channel: "Email",    category: "Birthday / Special Offer" }, templateKey: "birthday"    },
  ],
  prenatal: [
    { key: "reminder",    label: "Appointment Reminder",   icon: "⏰", logPreset: { channel: "Text/SMS", category: "Appointment Reminder"     }, templateKey: null          },
    { key: "postVisit",   label: "Post-Visit Follow-Up",   icon: "❤️", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
    { key: "prenatalPkg", label: "Prenatal Package Offer", icon: "🤰", logPreset: { channel: "Text/SMS", category: "Prenatal Package"         }, templateKey: "prenatal"    },
    { key: "trimester",   label: "Trimester Check-In",     icon: "🌙", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
    { key: "postpartum",  label: "Postpartum Follow-Up",   icon: "👶", logPreset: { channel: "Text/SMS", category: "Post-Visit Follow-Up"     }, templateKey: "post-visit"  },
  ],
};

// Get the right touchpoints for a client based on their care category
const getTouchpoints = (client) =>
  TOUCHPOINTS_BY_CATEGORY[client.careCategory] || TOUCHPOINTS_BY_CATEGORY.default;

// Keep a flat reference for Pulse page doneTP lookup compatibility
const TOUCHPOINTS = TOUCHPOINTS_BY_CATEGORY.default;

const apptStatusStyle = (s) =>
  s === "scheduled"  ? { bg: "#ede9fe", c: "#5b21b6" } :
  s === "checked-in" ? { bg: "#dcf5ec", c: "#0f7a4a" } :
  s === "completed"  ? { bg: "#d1fae5", c: "#065f46" } :
  s === "cancelled"  ? { bg: "#f1f5f9", c: "#64748b" } :
  s === "no-show"    ? { bg: "#fef3c7", c: "#92400e" } :
                       { bg: "#fee2e2", c: "#991b1b" };

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const INITIAL_CLIENTS = [];
const WEBHOOK_LOG = [
  { id: "wh1", event: "appointment.booked",     time: new Date(Date.now() - 3 * 60000).toISOString(),    client: "Sarah Mitchell", detail: "Appointment booked for today at 10:00 AM" },
  { id: "wh2", event: "appointment.checked_in", time: new Date(Date.now() - 90 * 60000).toISOString(),   client: "Emily Chen",     detail: "Checked in for Swedish Massage" },
  { id: "wh3", event: "customer.updated",       time: new Date(Date.now() - 3 * 3600000).toISOString(),  client: "Tom Bergstrom",  detail: "Email address updated in Vagaro" },
  { id: "wh4", event: "customer.created",       time: new Date(Date.now() - 5 * 3600000).toISOString(),  client: "Priya Patel",    detail: "New customer record created in Vagaro" },
  { id: "wh5", event: "appointment.completed",  time: new Date(Date.now() - 24 * 3600000).toISOString(), client: "Lisa Drummond",  detail: "Hot Stone 75 min completed" },
];

const INITIAL_TASKS = [];

// ─── TASK MODAL ───────────────────────────────────────────────────────────────
// ─── NEW CLIENT MODAL ─────────────────────────────────────────────────────────
// ─── CSV IMPORT MODAL ────────────────────────────────────────────────────────
function CSVImportModal({ onImport, onClose, usingDB }) {
  const [step, setStep] = useState("upload"); // upload → preview → done
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [headers, setHeaders] = useState([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [errors, setErrors] = useState([]);

  // Vagaro field names → our field names
  const FIELD_MAP = {
    firstName:          ["first name", "firstname", "first_name", "fname"],
    lastName:           ["last name", "lastname", "last_name", "lname", "surname"],
    email:              ["email", "email address", "e-mail"],
    phone:              ["mobile", "phone", "phone number", "cell", "telephone"],
    dayPhone:           ["day", "day phone"],
    birthday:           ["birthdate", "birthday", "birth date", "date of birth", "dob"],
    customerSince:      ["customer since", "member since", "join date", "created"],
    lastVisit:          ["last visited", "last visit", "last visit date"],
    address:            ["address", "street", "street address", "address 1"],
    aptSuite:           ["apt/suite", "apt suite", "apartment", "suite", "unit"],
    city:               ["city"],
    state:              ["state", "province"],
    zip:                ["zip", "zip code", "postal", "postal code"],
    referredBy:         ["refered by", "referred by", "referral", "referral source"],
    membership:         ["membership"],
    tags:               ["tags"],
    appointmentsBooked: ["appointments booked"],
    noShows:            ["no shows/cancellations", "no shows", "cancellations"],
    totalSpent:         ["amount paid", "total spent", "total paid"],
  };

  const autoMap = (hdrs) => {
    const m = {};
    hdrs.forEach((h) => {
      const hl = h.toLowerCase().trim();
      Object.entries(FIELD_MAP).forEach(([field, aliases]) => {
        if (aliases.some((a) => hl.includes(a))) m[field] = h;
      });
    });
    return m;
  };

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    // Handle quoted fields
    const parseLine = (line) => {
      const result = []; let cur = ""; let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === "," && !inQuote) { result.push(cur.trim()); cur = ""; }
        else { cur += c; }
      }
      result.push(cur.trim());
      return result;
    };
    const hdrs = parseLine(lines[0]);
    const data = lines.slice(1).map((l) => {
      const vals = parseLine(l);
      const row = {};
      hdrs.forEach((h, i) => { row[h] = vals[i] || ""; });
      return row;
    }).filter((r) => Object.values(r).some((v) => v));
    return { headers: hdrs, rows: data };
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers: hdrs, rows: data } = parseCSV(e.target.result);
      setHeaders(hdrs);
      setRows(data);
      setMapping(autoMap(hdrs));
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const buildClient = (row) => {
    const get = (field) => (row[mapping[field]] || "").trim();
    const addrParts = [get("address"), get("aptSuite")].filter(Boolean);
    const tags = get("tags").split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    const membership = get("membership");
    if (membership && !tags.includes(membership)) tags.unshift(membership);
    const phone = get("phone") || get("dayPhone");
    const since = get("customerSince") || TODAY;
    const lastVisit = get("lastVisit") || null;
    const apptCount = parseInt(get("appointmentsBooked")) || 0;
    let avgVisitIntervalDays = 30;
    if (apptCount > 1 && since && lastVisit) {
      const span = Math.round((new Date(lastVisit) - new Date(since)) / 86400000);
      if (span > 0) avgVisitIntervalDays = Math.max(7, Math.round(span / apptCount));
    }
    return {
      id:            uid(),
      vagaroId:      null,
      vagaroSynced:  false,
      firstName:     get("firstName"),
      lastName:      get("lastName"),
      email:         get("email"),
      phone,
      birthday:      get("birthday") || null,
      customerSince: since,
      lastVisit,
      referredBy:    get("referredBy"),
      address:       addrParts.join(", "),
      city:          get("city"),
      state:         get("state"),
      zip:           get("zip"),
      avgVisitIntervalDays,
      noShows:       parseInt(get("noShows")) || 0,
      totalSpent:    parseFloat(get("totalSpent").replace(/[$,]/g, "")) || 0,
      careCategory:  null,
      redLightStatus: null,
      waitlisted:    false,
      goldenNuggets: [],
      tags,
      appointments:  [],
      history:       [mkEvent("client.created", "Imported from Vagaro CSV", { by: "System" })],
    };
  };

  const handleImport = async () => {
    setImporting(true);
    const errs = [];
    let count = 0;
    for (const row of rows) {
      const client = buildClient(row);
      if (!client.firstName && !client.lastName) continue;
      try {
        await onImport(client);
        count++;
        setImported(count);
      } catch (e) {
        errs.push(`${client.firstName} ${client.lastName}: ${e.message}`);
      }
    }
    setErrors(errs);
    setImporting(false);
    setStep("done");
  };

  const FIELDS = Object.keys(FIELD_MAP);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...S.card, width: 580, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", animation: "fadeUp 0.15s ease" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>Import clients from Vagaro CSV</div>
            <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: 2 }}>
              Export from Vagaro: Reports → Customers → Action → Export Excel
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>

        {step === "upload" && (
          <div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              style={{ border: "2px dashed #e8d5c0", borderRadius: 14, padding: "40px 20px", textAlign: "center", cursor: "pointer", background: "#fdf9f5" }}
              onClick={() => document.getElementById("csv-file-input").click()}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#4a3828", marginBottom: 4 }}>Drop your CSV file here</div>
              <div style={{ fontSize: "12px", color: "#8a7a6a" }}>or click to browse</div>
              <input id="csv-file-input" type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files[0])} />
            </div>
            <div style={{ marginTop: 16, padding: "12px 14px", background: "#fef3c7", border: "1px solid #f0d090", borderRadius: 10, fontSize: "12px", color: "#92400e" }}>
              <strong>How to export from Vagaro:</strong><br />
              Reports → Customers → Customers → Run Report → Action → Export Excel
            </div>
          </div>
        )}

        {step === "preview" && (
          <div>
            <div style={{ fontSize: "13px", color: "#0f7a4a", background: "#dcf5ec", padding: "8px 12px", borderRadius: 8, marginBottom: 14, fontWeight: "600" }}>
              ✓ {rows.length} clients found — verify field mapping below
            </div>

            {/* Field mapping */}
            <div style={{ marginBottom: 14 }}>
              <label style={S.lbl}>Map CSV columns to Client Pulse fields</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {FIELDS.map((field) => (
                  <div key={field}>
                    <label style={{ fontSize: "10px", fontWeight: "700", color: "#b0a090", textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 3 }}>
                      {field.replace(/([A-Z])/g, " $1").trim()}
                    </label>
                    <select value={mapping[field] || ""} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))} style={{ ...S.inp, fontSize: "12px" }}>
                      <option value="">— Skip —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview table */}
            <div style={{ marginBottom: 14 }}>
              <label style={S.lbl}>Preview (first 5 rows)</label>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e8e0d6" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ background: "#f5ede4" }}>
                      {["firstName","lastName","email","phone","birthday"].map((f) => (
                        <th key={f} style={{ padding: "6px 8px", textAlign: "left", color: "#7a5640", fontWeight: "700", whiteSpace: "nowrap" }}>
                          {f.replace(/([A-Z])/g, " $1").trim()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => {
                      const c = buildClient(row);
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #f0e8de" }}>
                          <td style={{ padding: "5px 8px" }}>{c.firstName}</td>
                          <td style={{ padding: "5px 8px" }}>{c.lastName}</td>
                          <td style={{ padding: "5px 8px" }}>{c.email}</td>
                          <td style={{ padding: "5px 8px" }}>{c.phone}</td>
                          <td style={{ padding: "5px 8px" }}>{c.birthday}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("ghost")} onClick={() => setStep("upload")}>← Back</button>
              <button style={S.btn("primary")} onClick={handleImport} disabled={importing}>
                {importing ? `Importing… (${imported}/${rows.length})` : `Import ${rows.length} clients`}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>{errors.length > 0 ? "⚠️" : "✅"}</div>
            <div style={{ fontSize: "16px", fontWeight: "800", color: errors.length > 0 ? "#92400e" : "#065f46", marginBottom: 8 }}>
              {imported} client{imported !== 1 ? "s" : ""} imported
            </div>
            {!usingDB && (
              <div style={{ fontSize: "12px", color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", padding: "10px", borderRadius: 8, marginBottom: 12, textAlign: "left" }}>
                <strong>Database not connected.</strong> Clients are loaded in memory only and will be lost on refresh. Check Settings → Database to connect Supabase.
              </div>
            )}
            {errors.length > 0 && (
              <div style={{ fontSize: "12px", color: "#dc2626", background: "#fee2e2", padding: "10px", borderRadius: 8, marginBottom: 12, textAlign: "left" }}>
                {errors.length} save error{errors.length !== 1 ? "s" : ""}:<br />{errors.join("\n")}
              </div>
            )}
            <button style={S.btn("primary")} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewClientModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "",
    birthday: "", referredBy: "", careCategory: "",
    address: "", city: "", state: "", zip: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.firstName.trim() && form.lastName.trim();

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    // Small delay to simulate future API call to Vagaro
    await new Promise((r) => setTimeout(r, 400));
    const newClient = {
      id: uid(),
      vagaroId: null,          // will be set when Vagaro API creates the record
      vagaroSynced: false,     // production: POST to Vagaro, set true on success
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      phone:     form.phone.trim(),
      email:     form.email.trim(),
      birthday:  form.birthday || null,
      customerSince: TODAY,
      referredBy: form.referredBy.trim(),
      careCategory: form.careCategory || null,
      address: form.address.trim(),
      city:    form.city.trim(),
      state:   form.state.trim(),
      zip:     form.zip.trim(),
      avgVisitIntervalDays: 30,
      redLightStatus: null,
      waitlisted: false,
      goldenNuggets: [],
      tags: [],
      appointments: [],
      history: [
        mkEvent("client.created", "Client record created in Client Pulse — pending Vagaro sync", { by: "Don Snyder" }),
      ],
    };
    onSave(newClient);
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...S.card, width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", animation: "fadeUp 0.15s ease" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>New client</div>
            <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: 2 }}>Added here now · will sync to Vagaro when connected</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>

        {/* Vagaro sync notice */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fef3c7", border: "1px solid #f0d090", borderRadius: 10, marginBottom: 18, marginTop: 10 }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: "11px", color: "#92400e", fontWeight: "600" }}>
            Production mode will automatically create this client in Vagaro via API. For now, they'll exist in Client Pulse only.
          </span>
        </div>

        {/* Name */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.lbl}>First name <span style={{ color: "#dc2626" }}>*</span></label>
            <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)}
              placeholder="First" style={S.inp} autoFocus />
          </div>
          <div>
            <label style={S.lbl}>Last name <span style={{ color: "#dc2626" }}>*</span></label>
            <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)}
              placeholder="Last" style={S.inp} />
          </div>
        </div>

        {/* Contact */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.lbl}>Phone</label>
            <input value={form.phone} onChange={(e) => set("phone", e.target.value)}
              placeholder="(605) 555-0100" type="tel" style={S.inp} />
          </div>
          <div>
            <label style={S.lbl}>Email</label>
            <input value={form.email} onChange={(e) => set("email", e.target.value)}
              placeholder="email@example.com" type="email" style={S.inp} />
          </div>
        </div>

        {/* Birthday + Referral */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.lbl}>Birthday</label>
            <input value={form.birthday} onChange={(e) => set("birthday", e.target.value)}
              type="date" style={S.inp} />
          </div>
          <div>
            <label style={S.lbl}>Referred by</label>
            <input value={form.referredBy} onChange={(e) => set("referredBy", e.target.value)}
              placeholder="Name, Google, Instagram..." style={S.inp} />
          </div>
        </div>

        {/* Care category */}
        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>Care category</label>
          <select value={form.careCategory} onChange={(e) => set("careCategory", e.target.value)} style={S.inp}>
            <option value="">— Set later —</option>
            {Object.entries(CARE_CATEGORIES).map(([key, c]) => (
              <option key={key} value={key}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>

        {/* Address */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.lbl}>Mailing address <span style={{ fontWeight: 400, color: "#b0a090" }}>(optional)</span></label>
          <input value={form.address} onChange={(e) => set("address", e.target.value)}
            placeholder="Street address" style={{ ...S.inp, marginBottom: 8 }} />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <input value={form.city}  onChange={(e) => set("city",  e.target.value)} placeholder="City"  style={S.inp} />
            <input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="State" style={S.inp} maxLength={2} />
            <input value={form.zip}   onChange={(e) => set("zip",   e.target.value)} placeholder="ZIP"   style={S.inp} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button
            style={{ ...S.btn("primary"), opacity: valid ? 1 : 0.4, cursor: valid ? "pointer" : "not-allowed" }}
            onClick={handleSave}
            disabled={!valid || saving}>
            {saving ? "Creating…" : "Create client"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskModal({ clients, task, onSave, onClose }) {
  const [title,     setTitle]     = useState(task?.title     || "");
  const [dueDate,   setDueDate]   = useState(task?.dueDate   || TODAY);
  const [clientId,  setClientId]  = useState(task?.clientId  || "");
  const [createdBy, setCreatedBy] = useState(task?.createdBy || "Don Snyder");

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id:        task?.id || uid(),
      title:     title.trim(),
      dueDate,
      clientId:  clientId || null,
      createdBy,
      done:      task?.done || false,
      createdAt: task?.createdAt || Date.now(),
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...S.card, width: 460, maxWidth: "100%", animation: "fadeUp 0.15s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>{task ? "Edit task" : "New task"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>Task</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            style={S.inp} autoFocus />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.lbl}>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={S.inp} />
          </div>
          <div>
            <label style={S.lbl}>Staff</label>
            <input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} style={S.inp} />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={S.lbl}>Link to client (optional)</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={S.inp}>
            <option value="">— No client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{fullName(c)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={{ ...S.btn("primary"), opacity: title.trim() ? 1 : 0.5 }} onClick={handleSave}>Save task</button>
        </div>
      </div>
    </div>
  );
}


// ─── GMAIL INTEGRATION ───────────────────────────────────────────────────────
// Module-level ref so LogModal/OutreachComposer can access Gmail without prop drilling
let _gmailClientId = "";
const getGmailClientId = () => _gmailClientId;
const setGlobalGmailClientId = (id) => { _gmailClientId = id; };

// Scopes needed: send only — does NOT read inbox
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function useGmail(clientId) {
  const [token,   setToken]   = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("cp_gmail_token") || "null"); } catch { return null; }
  });
  const [gmailUser, setGmailUser] = useState(() => sessionStorage.getItem("cp_gmail_user") || null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const isConnected = !!(token && gmailUser);

  const connect = () => {
    if (!clientId) { setError("Enter your Google OAuth Client ID in Settings first."); return; }
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  window.location.origin,
      response_type: "token",
      scope:         GMAIL_SCOPE,
      prompt:        "select_account",
    });
    const popup = window.open(
      "https://accounts.google.com/o/oauth2/v2/auth?" + params,
      "gmail_auth", "width=500,height=600,left=200,top=100"
    );
    const poll = setInterval(() => {
      try {
        if (!popup || popup.closed) { clearInterval(poll); setLoading(false); return; }
        const hash = popup.location.hash;
        if (hash && hash.includes("access_token")) {
          const p = new URLSearchParams(hash.slice(1));
          const t = { access_token: p.get("access_token"), expires_at: Date.now() + (+p.get("expires_in") || 3600) * 1000 };
          popup.close(); clearInterval(poll);
          // Fetch user info
          fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + t.access_token } })
            .then((r) => r.json()).then((u) => {
              setToken(t); setGmailUser(u.email || "Connected");
              sessionStorage.setItem("cp_gmail_token", JSON.stringify(t));
              sessionStorage.setItem("cp_gmail_user", u.email || "Connected");
              setLoading(false);
            }).catch(() => { setToken(t); setGmailUser("Connected"); setLoading(false); });
        }
      } catch { /* cross-origin — keep polling */ }
    }, 300);
  };

  const disconnect = () => {
    setToken(null); setGmailUser(null);
    sessionStorage.removeItem("cp_gmail_token");
    sessionStorage.removeItem("cp_gmail_user");
  };

  // Send an email via Gmail API
  const sendEmail = async ({ to, subject, body, from }) => {
    if (!token?.access_token) throw new Error("Gmail not connected");
    if (token.expires_at && Date.now() > token.expires_at) throw new Error("Gmail session expired — please reconnect");
    const raw = btoa(unescape(encodeURIComponent(
      `From: ${from || gmailUser}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || "Gmail send failed");
    }
    return await res.json();
  };

  return { isConnected, gmailUser, loading, error, connect, disconnect, sendEmail, setError };
}

// ─── ATOMS ───────────────────────────────────────────────────────────────────
function StatusPill({ status, client }) {
  // Accept either a pre-computed layer2 key (status) or a full client object.
  let layer1Key, layer2Key;
  if (client) {
    const s = clientStatus(client);
    layer1Key = s.layer1;
    layer2Key = s.layer2;
  } else {
    const cfg2 = LAYER2_CFG[status];
    layer1Key = cfg2?.layer1 ?? "lead";
    layer2Key = status;
  }
  const l1 = LAYER1_CFG[layer1Key] ?? { label: layer1Key, bg: "#e8e0d6", color: "#8a7a6a" };
  const l2 = LAYER2_CFG[layer2Key] ?? { label: layer2Key, bg: "#e8e0d6", color: "#8a7a6a" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
      {/* Layer 1 parent chip */}
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        padding: "3px 8px", borderRadius: "20px 0 0 20px",
        fontSize: "10px", fontWeight: "800", letterSpacing: "0.5px",
        background: l1.bg, color: l1.color,
        borderRight: `1px solid ${l1.color}22`,
      }}>
        <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: l1.color, flexShrink: 0 }} />
        {l1.label.toUpperCase()}
      </span>
      {/* Layer 2 sub-status chip */}
      <span style={{
        display: "inline-flex", alignItems: "center",
        padding: "3px 9px 3px 7px", borderRadius: "0 20px 20px 0",
        fontSize: "11px", fontWeight: "700",
        background: l2.bg, color: l2.color,
      }}>
        {l2.label}
      </span>
    </span>
  );
}

function StatusSelector({ client, status, onUpdate }) {
  const [open, setOpen]           = useState(false);
  const [flagNote, setFlagNote]   = useState("");
  const [showFlagInput, setShowFlagInput] = useState(false);

  const { layer1, layer2 } = clientStatus(client);
  const hasManualOverride = !!client.restrictedStatus || !!client.needsFollowUp || !!client.statusOverride;
  const l2cfg = LAYER2_CFG[layer2] ?? { label: layer2, bg: "#e8e0d6", color: "#8a7a6a" };

  const MANUAL_OPTIONS = [
    { key: "needs-follow-up", label: "Needs Follow Up",
      desc: "Active client — left without booking next appt",
      action: () => { onUpdate(client.id, { needsFollowUp: true, restrictedStatus: null, restrictedNote: null }); setOpen(false); } },
    { key: "deactivated", label: "Deactivate Profile",
      desc: "Hide from dashboards; suppress all communications",
      action: () => { onUpdate(client.id, { restrictedStatus: "deactivated", restrictedNote: null, needsFollowUp: false }); setOpen(false); } },
    { key: "flag-prompt", label: "Flag Profile",
      desc: "Booking intercept — requires a mandatory note",
      action: () => setShowFlagInput(true) },
  ];

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => { setOpen((v) => !v); setShowFlagInput(false); setFlagNote(""); }}
        title={hasManualOverride ? "Status manually set — click to change" : "Click to set manual override"}
        style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          padding: "2px 0", background: "transparent", border: "none", cursor: "pointer",
        }}
      >
        <StatusPill status={layer2} />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={l2cfg.color} strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: "#fff", border: "1px solid #e8e0d6", borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.13)", padding: "8px", minWidth: "240px",
        }}>
          {!showFlagInput ? (
            <>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", letterSpacing: "1px", textTransform: "uppercase", padding: "4px 8px 6px" }}>Manual Overrides</div>
              {MANUAL_OPTIONS.map((opt) => (
                <button key={opt.key} onClick={opt.action} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%",
                  padding: "8px 10px", border: "none", borderRadius: "8px",
                  background: layer2 === opt.key ? "#f5ede4" : "transparent",
                  cursor: "pointer", textAlign: "left", marginBottom: "2px",
                }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: opt.key === "flag-prompt" ? "#881337" : opt.key === "deactivated" ? "#9d174d" : "#5b21b6" }}>{opt.label}</span>
                  <span style={{ fontSize: "10px", color: "#8a7a6a", marginTop: "1px" }}>{opt.desc}</span>
                </button>
              ))}
              {hasManualOverride && (
                <button
                  onClick={() => { onUpdate(client.id, { restrictedStatus: null, restrictedNote: null, needsFollowUp: false, statusOverride: null }); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px", width: "100%",
                    padding: "7px 10px", border: "none", borderRadius: "8px", borderTop: "1px solid #e8e0d6",
                    background: "transparent", color: "#8a7a6a",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer", marginTop: "4px",
                  }}
                >
                  Reset to auto-detect
                </button>
              )}
            </>
          ) : (
            <div style={{ padding: "4px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#881337", marginBottom: "8px" }}>Flag Profile — Reason Required</div>
              <textarea
                autoFocus
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="Describe the policy or safety reason…"
                style={{ ...S.inp, height: "80px", resize: "vertical", marginBottom: "8px" }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  disabled={!flagNote.trim()}
                  onClick={() => {
                    onUpdate(client.id, { restrictedStatus: "flagged", restrictedNote: flagNote.trim(), needsFollowUp: false });
                    setOpen(false); setShowFlagInput(false); setFlagNote("");
                  }}
                  style={{ ...S.sm("danger"), flex: 1, justifyContent: "center", opacity: flagNote.trim() ? 1 : 0.5 }}
                >
                  Confirm Flag
                </button>
                <button onClick={() => setShowFlagInput(false)} style={{ ...S.sm(), padding: "6px 10px" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => { setOpen(false); setShowFlagInput(false); setFlagNote(""); }} />}
    </div>
  );
}

function ApptPill({ status }) {
  const { bg, c } = apptStatusStyle(status);
  const labels = {
    scheduled: "Scheduled", "checked-in": "Checked In",
    completed: "Completed", cancelled: "Cancelled", "no-show": "No-Show",
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 9px", borderRadius: "20px",
      fontSize: "11px", fontWeight: "700",
      background: bg, color: c, flexShrink: 0,
    }}>
      {labels[status] || status}
    </span>
  );
}

function VagaroTag() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "2px 8px", borderRadius: "20px",
      fontSize: "10px", fontWeight: "700",
      background: "#e8f4fd", color: "#0c6ebd", flexShrink: 0,
    }}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
      </svg>
      Vagaro
    </span>
  );
}

function Avatar({ client, size = 36 }) {
  const palettes = [
    ["#f5ede4","#a0785a"],["#dcf5ec","#0f7a4a"],["#dbeafe","#1d5fa8"],
    ["#ede9fe","#5b21b6"],["#fef3c7","#92400e"],["#fee2e2","#991b1b"],
  ];
  const [bg, fg] = palettes[client.id.charCodeAt(1) % palettes.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: "800", flexShrink: 0,
    }}>
      {client.firstName[0]}{client.lastName[0]}
    </div>
  );
}

function TagChip({ label, onRemove }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: "100px",
      fontSize: "11px", fontWeight: "700",
      background: "#f5ede4", color: "#7a5640", border: "1px solid #e8d5c0",
    }}>
      {label}
      {onRemove && (
        <button onClick={onRemove} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#a0785a", fontSize: "13px", lineHeight: 1,
          padding: "0 0 0 2px", fontFamily: "'DM Sans',sans-serif",
        }}>×</button>
      )}
    </span>
  );
}

// ─── SYNC BAR ────────────────────────────────────────────────────────────────
// ─── TEMPLATE PICKER ─────────────────────────────────────────────────────────
function TemplatePicker({ client, templates, onClose }) {
  const [picked, setPicked] = useState(null);
  const [channel, setChannel] = useState("sms");
  const tpl = picked ? templates[picked] : null;
  const text = tpl ? fillTemplate(channel === "sms" ? tpl.sms : tpl.email?.body, client) : "";
  const subj = tpl ? fillTemplate(tpl.email?.subject || "", client) : "";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 500 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal" style={{ ...S.card, width: 520, maxWidth: "100vw", maxHeight: "92vh", overflowY: "auto", animation: "fadeUp 0.15s ease", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>Message templates</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {Object.entries(templates).map(([k, t]) => (
            <button key={k} onClick={() => setPicked(k)} style={{
              fontSize: "12px", padding: "5px 12px", borderRadius: "100px",
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
              border: picked === k ? "1px solid #a0785a" : "1px solid #e8e0d6",
              background: picked === k ? "#f5ede4" : "#faf8f5",
              color: picked === k ? "#7a5640" : "#8a7a6a",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {tpl && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["sms", "email"].map((ch) => (
                <button key={ch} onClick={() => setChannel(ch)} style={{
                  fontSize: "12px", padding: "5px 12px", borderRadius: "8px",
                  cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700", border: "none",
                  background: channel === ch ? "linear-gradient(135deg,#a0785a,#7a5640)" : "#f5ede4",
                  color: channel === ch ? "#fff" : "#6b5244",
                }}>
                  {ch === "sms" ? "Text/SMS" : "Email"}
                </button>
              ))}
            </div>
            {channel === "email" && (
              <div style={{ marginBottom: 8 }}>
                <label style={S.lbl}>Subject</label>
                <div style={{ ...S.inp, color: "#2e2418" }}>{subj}</div>
              </div>
            )}
            <label style={S.lbl}>Message</label>
            <div style={{ ...S.inp, minHeight: 100, whiteSpace: "pre-wrap", lineHeight: "1.6", fontSize: "13px", color: "#2e2418", overflowY: "auto" }}>{text}</div>
            <div style={{ marginTop: 10, fontSize: "11px", color: "#b0a090" }}>
              Copy this message to send via Vagaro, your texting app, or email client.
            </div>
          </>
        )}
        {!picked && <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>Select a template above to preview the message for {client.firstName}.</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button style={S.btn("ghost")} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── LOG INTERACTION MODAL ────────────────────────────────────────────────────
// Template key mapping per quick log category
const CATEGORY_TEMPLATES = {
  "Rebooking Outreach":       ["rebooking", "lapsed"],
  "Post-Visit Follow-Up":     ["post-visit"],
  "No-Show Follow-Up":        ["no-show"],
  "Birthday / Special Offer": ["birthday"],
  "Promotional Offer":        ["promo"],
  "Prenatal Package":         ["prenatal"],
  "Red Light Therapy":        ["red-light"],
  "Referral Reward":          ["referral"],
};

function LogModal({ client, templates, onClose, onSave, preset }) {
  // ALL hooks at the top — no exceptions
  const gmail = useGmail(getGmailClientId());
  const initChannel  = preset?.channel  || "Text/SMS";
  const initCategory = preset?.category && (CHANNEL_CATEGORIES[preset.channel] || []).includes(preset.category)
    ? preset.category
    : CHANNEL_CATEGORIES[initChannel]?.[0] || "General";
  const initTpl = preset?.templateKey ? templates[preset.templateKey] : null;
  const initNotes = initTpl
    ? (initChannel === "Email"
        ? "Subject: " + fillTemplate(initTpl.email?.subject || "", client) + "\n\n" + fillTemplate(initTpl.email?.body || "", client)
        : fillTemplate(initTpl.sms || "", client))
    : "";

  const [channel,      setChannel]      = useState(initChannel);
  const [category,     setCategory]     = useState(initCategory);
  const [outcome,      setOutcome]      = useState(OUTCOMES[initChannel]?.[0] || "Done");
  const [staff,        setStaff]        = useState("Don Snyder");
  const [activeTpl,    setActiveTpl]    = useState(preset?.templateKey || null);
  const [notes,        setNotes]        = useState(initNotes);
  const [gmailSending, setGmailSending] = useState(false);
  const [gmailError,   setGmailError]   = useState(null);
  const [gmailSent,    setGmailSent]    = useState(false);
  const noteMode = !!preset?.noteMode;

  useEffect(() => {
    // Only reset category if current one isn't valid for the new channel
    if (!(CHANNEL_CATEGORIES[channel] || []).includes(category)) {
      setCategory(CHANNEL_CATEGORIES[channel]?.[0] || "General");
      setOutcome(OUTCOMES[channel]?.[0] || "Done");
    } else {
      setOutcome(OUTCOMES[channel]?.[0] || "Done");
    }
  }, [channel]);

  // Templates relevant to this category
  const relevantTplKeys = CATEGORY_TEMPLATES[category] || [];
  const relevantTpls = relevantTplKeys
    .map((k) => templates[k] ? { key: k, ...templates[k] } : null)
    .filter(Boolean);

  const applyTemplate = (key) => {
    const tpl = templates[key];
    if (!tpl) return;
    const isEmail = channel === "Email";
    const text = isEmail
      ? `Subject: ${fillTemplate(tpl.email?.subject || "", client)}\n\n${fillTemplate(tpl.email?.body || "", client)}`
      : fillTemplate(tpl.sms || "", client);
    setNotes(text);
    setActiveTpl(key);
  };

  const handleSave = () => {
    if (!notes.trim()) return;
    if (noteMode) {
      onSave(mkEvent("notes.updated", notes, { by: staff }));
    } else {
      const type = CHAN_TYPE[channel] || "comm.phone";
      const detail = `${category} · Outcome: ${outcome} · Note: ${notes}`;
      onSave(mkEvent(type, detail, { by: staff }));
    }
  };

  const handleSendViaGmail = async () => {
    if (!notes.trim() || !client.email) return;
    setGmailSending(true); setGmailError(null);
    // Parse subject + body from notes if template was loaded (format: "Subject: ...\n\nbody")
    let subject = category;
    let body = notes;
    const subjectMatch = notes.match(/^Subject:\s*(.+)\n\n([\s\S]*)$/);
    if (subjectMatch) { subject = subjectMatch[1]; body = subjectMatch[2]; }
    try {
      await gmail.sendEmail({ to: client.email, subject, body });
      setGmailSent(true);
      // Auto-log after sending
      const detail = `${category} · Outcome: Sent via Gmail · Subject: "${subject}"`;
      onSave(mkEvent("comm.email", detail, { by: staff }));
    } catch (e) {
      setGmailError(e.message || "Failed to send");
      setGmailSending(false);
    }
  };

  // Note mode — simple textarea, no channel/category/outcome
  if (noteMode) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="cp-modal" style={{ ...S.card, width: 480, maxWidth: "100vw", maxHeight: "92vh", overflowY: "auto", animation: "fadeUp 0.15s ease", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>📝 Internal note</div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 16 }}>
            For: <span style={{ color: "#2e2418", fontWeight: "600" }}>{fullName(client)}</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.lbl}>Note</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add an internal note — preferences, flags, anything staff should know..."
              style={{ ...S.inp, minHeight: "120px", resize: "vertical", lineHeight: "1.6" }} autoFocus />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={S.lbl}>Staff</label>
            <input value={staff} onChange={(e) => setStaff(e.target.value)} style={S.inp} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
            <button style={{ ...S.btn("primary"), opacity: notes.trim() ? 1 : 0.5 }} onClick={handleSave}>Save note</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal" style={{ ...S.card, width: 480, maxWidth: "100vw", maxHeight: "92vh", overflowY: "auto", animation: "fadeUp 0.15s ease", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>Log communication</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 16 }}>
          For: <span style={{ color: "#2e2418", fontWeight: "600" }}>{fullName(client)}</span>
        </div>

        {/* Quick log type chips */}
        <label style={S.lbl}>Type</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
          {QUICK_LOGS.map((q) => {
            const isActive = channel === q.channel && category === q.category;
            return (
              <button key={q.label}
                onClick={() => { setChannel(q.channel); setCategory(q.category); setOutcome(OUTCOMES[q.channel]?.[0] || "Done"); setNotes(""); setActiveTpl(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "5px 11px", borderRadius: "100px", fontSize: "12px", fontWeight: "700",
                  cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.12s",
                  border: isActive ? "1px solid #a0785a" : "1px solid #e8e0d6",
                  background: isActive ? "#f5ede4" : "#faf8f5",
                  color: isActive ? "#7a5640" : "#8a7a6a",
                }}>
                {q.icon} {q.label}
              </button>
            );
          })}
        </div>

        {/* Inline template chips — only shown when relevant templates exist */}
        {relevantTpls.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={S.lbl}>Message template — click to load</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {relevantTpls.map((t) => (
                <button key={t.key}
                  onClick={() => activeTpl === t.key ? (setNotes(""), setActiveTpl(null)) : applyTemplate(t.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 13px", borderRadius: "8px", fontSize: "12px", fontWeight: "700",
                    cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.12s",
                    border: activeTpl === t.key ? "1px solid #a0785a" : "1px solid #e8e0d6",
                    background: activeTpl === t.key ? "linear-gradient(135deg,#a0785a,#7a5640)" : "#faf8f5",
                    color: activeTpl === t.key ? "#fff" : "#7a5640",
                  }}>
                  {t.icon} {t.label}
                  {activeTpl === t.key && <span style={{ fontSize: "10px", opacity: 0.8 }}>✓ loaded · click to clear</span>}
                </button>
              ))}
            </div>
            {activeTpl && (
              <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: 6 }}>
                ✏️ Message loaded — edit below before saving
              </div>
            )}
          </div>
        )}

        {/* Outcome */}
        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>Outcome</label>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={S.inp}>
            {(OUTCOMES[channel] || []).map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ ...S.lbl, marginBottom: 0 }}>Notes</label>
            {channel !== "In-Person" && channel !== "System" && (
              <span style={{ fontSize: "11px", color: "#b0a090" }}>
                {channel === "Text/SMS" ? `${notes.length}/160 chars` : ""}
              </span>
            )}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={activeTpl ? "Edit the message above if needed..." : "Describe the interaction or paste a message..."}
            style={{ ...S.inp, minHeight: "90px", resize: "vertical", lineHeight: "1.6" }} />
        </div>

        {/* Staff */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.lbl}>Staff</label>
          <input value={staff} onChange={(e) => setStaff(e.target.value)} style={S.inp} />
        </div>

        {/* Gmail send option — shown when channel is Email */}
        {channel === "Email" && !noteMode && (
          <div style={{ marginBottom: 12 }}>
            {gmail.isConnected ? (
              <div>
                {gmailError && (
                  <div style={{ fontSize: "11px", color: "#dc2626", background: "#fee2e2", padding: "6px 10px", borderRadius: 8, marginBottom: 8 }}>
                    ⚠️ {gmailError}
                  </div>
                )}
                {gmailSent ? (
                  <div style={{ fontSize: "12px", color: "#065f46", background: "#d1fae5", padding: "8px 12px", borderRadius: 8, fontWeight: "600" }}>
                    ✓ Sent via Gmail to {client.email} — logged automatically
                  </div>
                ) : (
                  <button
                    onClick={handleSendViaGmail}
                    disabled={!notes.trim() || !client.email || gmailSending}
                    style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", background: "linear-gradient(135deg,#4285f4,#1a73e8)", opacity: (notes.trim() && client.email) ? 1 : 0.5 }}>
                    {gmailSending ? "Sending…" : `📧 Send via Gmail to ${client.email || "no email on file"}`}
                  </button>
                )}
                <div style={{ fontSize: "10px", color: "#b0a090", marginTop: 4, textAlign: "center" }}>
                  Sending as {gmail.gmailUser} · Email will appear in your Gmail Sent folder
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 10 }}>
                <span style={{ fontSize: 14 }}>📧</span>
                <span style={{ fontSize: "12px", color: "#6b7280" }}>Connect Gmail in Settings to send emails directly.</span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          {!gmailSent && (
            <button style={{ ...S.btn("primary"), opacity: notes.trim() ? 1 : 0.5 }} onClick={handleSave}>
              {channel === "Email" && gmail.isConnected ? "Log only" : "Save log"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TAG EDITOR ──────────────────────────────────────────────────────────────
// ─── GOLDEN NUGGETS ──────────────────────────────────────────────────────────
function GoldenNuggetsCard({ nuggets = [], onAdd, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [staff, setStaff] = useState("Don Snyder");

  const handleAdd = () => {
    if (!text.trim()) return;
    onAdd({ id: uid(), text: text.trim(), date: TODAY, by: staff });
    setText(""); setAdding(false);
  };

  return (
    <div style={{ ...S.card, marginBottom: "14px", background: "linear-gradient(135deg, #fffbf5, #fef9ef)", border: "1px solid #f0d9b0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 16 }}>✨</span>
          <label style={{ ...S.lbl, marginBottom: 0, color: "#92400e" }}>Golden Nuggets</label>
        </div>
        <button onClick={() => setAdding((a) => !a)}
          style={{ fontSize: "11px", fontWeight: "700", color: "#92400e", background: "#fef3c7", border: "1px solid #f0d090", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {nuggets.length === 0 && !adding && (
        <p style={{ margin: 0, fontSize: "12px", color: "#b0a090", fontStyle: "italic" }}>
          No golden nuggets yet — capture meaningful details the client shares.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nuggets.map((n) => (
          <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", background: "#fffdf5", border: "1px solid #f0e0b0", borderRadius: 10 }}>
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>💛</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", color: "#2e2418", lineHeight: "1.5" }}>{n.text}</div>
              <div style={{ fontSize: "10px", color: "#b0a090", marginTop: 3 }}>{fmtDate(n.date)} · {n.by}</div>
            </div>
            <button onClick={() => onDelete(n.id)}
              style={{ background: "none", border: "none", fontSize: "14px", color: "#d4bfaa", cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: "2px 0" }}>×</button>
          </div>
        ))}
      </div>

      {adding && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "#fffdf5", border: "1px dashed #f0d090", borderRadius: 10 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder="What did they share? (upcoming event, health detail, preference, life situation...)"
            style={{ ...S.inp, minHeight: 70, resize: "vertical", lineHeight: "1.6", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={staff} onChange={(e) => setStaff(e.target.value)}
              placeholder="Staff" style={{ ...S.inp, flex: 1 }} />
            <button onClick={handleAdd}
              style={{ ...S.btn("primary"), fontSize: "12px", padding: "7px 14px", whiteSpace: "nowrap" }}>
              Save nugget
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CARE CATEGORY BADGE ─────────────────────────────────────────────────────
function CareCategoryBadge({ category, onChange }) {
  const [open, setOpen] = useState(false);
  const cat = CARE_CATEGORIES[category];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "100px", fontSize: "11px", fontWeight: "700",
          background: cat ? cat.bg : "#f5f5f5", color: cat ? cat.color : "#9ca3af",
          border: `1px solid ${cat ? cat.color + "44" : "#e5e7eb"}`, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
        {cat ? cat.icon : "○"} {cat ? cat.label : "Set care category"} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300, background: "#fff", border: "1px solid #e8e0d6", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6, minWidth: 220 }}>
          {Object.entries(CARE_CATEGORIES).map(([key, c]) => (
            <button key={key} onClick={() => { onChange(key); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 8, border: "none",
                background: category === key ? c.bg : "transparent", color: category === key ? c.color : "#2e2418",
                cursor: "pointer", fontSize: "12px", fontWeight: "700", fontFamily: "'DM Sans',sans-serif", textAlign: "left" }}>
              <span>{c.icon}</span>
              <div>
                <div style={{ fontWeight: "700" }}>{c.label}</div>
                <div style={{ fontSize: "10px", fontWeight: "400", color: "#8a7a6a" }}>{c.rebook}</div>
              </div>
            </button>
          ))}
          <button onClick={() => { onChange(null); setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 8, border: "none",
              background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: "12px", fontFamily: "'DM Sans',sans-serif", textAlign: "left" }}>
            ○ Clear category
          </button>
        </div>
      )}
    </div>
  );
}

// ─── RED LIGHT STATUS ─────────────────────────────────────────────────────────
// ─── RED LIGHT FUNNEL ROW ────────────────────────────────────────────────────
function RedLightRow({ client, onLog, onStageChange }) {
  const [showStages, setShowStages] = useState(false);
  const stage = client.redLightStatus;
  const current = RED_LIGHT_FUNNEL[stage] || RED_LIGHT_FUNNEL[null];
  const lastSent = getLastSent(client, "Red Light Therapy");

  const stageOrder = [null, "offered", "interested", "intro_booked", "active", "declined"];
  const stageIdx = stageOrder.indexOf(stage);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: current.bg, border: `1px solid ${current.color}33`, position: "relative" }}>
      <span style={{ fontSize: "15px", flexShrink: 0 }}>💡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: "700", color: "#1a120b" }}>Red Light Therapy</span>
          {/* Stage pill — clickable to change */}
          <button onClick={() => setShowStages((o) => !o)}
            style={{ fontSize: "10px", fontWeight: "700", color: current.color, background: "#fff", border: `1px solid ${current.color}55`, borderRadius: "100px", padding: "1px 8px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            {current.icon} {current.label} ▾
          </button>
        </div>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: lastSent ? 2 : 0 }}>
          {stageOrder.slice(0, 5).map((s, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i <= stageIdx ? current.color : "#e5e7eb", transition: "background 0.2s" }} />
          ))}
          <span style={{ fontSize: "10px", color: "#b0a090", marginLeft: 4 }}>
            {stage === "active" ? "Active" : stage === null ? "Not started" : `Step ${Math.max(stageIdx, 0) + 1} of 5`}
          </span>
        </div>
        {lastSent && (
          <div style={{ fontSize: "11px", color: "#0f7a4a", fontWeight: "600" }}>Last logged {lastSent}</div>
        )}
      </div>
      <button
        onClick={() => onLog({
          channel: "Text/SMS",
          category: "Red Light Therapy",
          templateKey: "red-light",
          rlAction: current.action,
          // auto-advance stage after logging
          onAfterSave: () => {
            const nextStage = current.next;
            if (nextStage !== stage) onStageChange(nextStage);
          },
        })}
        style={{ fontSize: "11px", fontWeight: "700", color: current.color, background: "#fff", border: `1px solid ${current.color}44`, borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
        {current.action} →
      </button>

      {/* Stage picker dropdown */}
      {showStages && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300, background: "#fff", border: "1px solid #e8e0d6", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6, minWidth: 220 }}
          onMouseLeave={() => setShowStages(false)}>
          <div style={{ fontSize: "10px", fontWeight: "700", color: "#b0a090", textTransform: "uppercase", letterSpacing: "1px", padding: "4px 10px 8px" }}>Set stage manually</div>
          {stageOrder.map((s) => {
            const f = RED_LIGHT_FUNNEL[s];
            return (
              <button key={String(s)} onClick={() => { onStageChange(s); setShowStages(false); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", borderRadius: 8, border: "none",
                  background: stage === s ? f.bg : "transparent", color: stage === s ? f.color : "#2e2418",
                  cursor: "pointer", fontSize: "12px", fontWeight: "700", fontFamily: "'DM Sans',sans-serif", textAlign: "left" }}>
                <span>{f.icon}</span> {f.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (tag) =>
    onChange(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);

  const addCustom = () => {
    const t = custom.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setCustom("");
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {tags.map((t) => <TagChip key={t} label={t} onRemove={() => toggle(t)} />)}
        <button onClick={() => setOpen((o) => !o)} style={{
          fontSize: "11px", padding: "3px 9px", borderRadius: "100px",
          border: "1px dashed #d4bfaa", background: "transparent",
          color: "#a0785a", cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
        }}>+ Tag</button>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100,
          background: "#fff", border: "1px solid #e8e0d6", borderRadius: "12px",
          padding: "12px", boxShadow: "0 8px 30px rgba(46,36,24,0.1)", minWidth: "220px",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {DEFAULT_TAGS.map((t) => (
              <button key={t} onClick={() => toggle(t)} style={{
                fontSize: "11px", padding: "3px 8px", borderRadius: "100px",
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
                border: tags.includes(t) ? "1px solid #a0785a" : "1px solid #e8e0d6",
                background: tags.includes(t) ? "#f5ede4" : "#faf8f5",
                color: tags.includes(t) ? "#7a5640" : "#8a7a6a",
              }}>
                {tags.includes(t) ? "✓ " : ""}{t}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom tag..."
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              style={{ ...S.inp, fontSize: "12px", padding: "6px 10px", flex: 1 }} />
            <button style={S.sm("primary")} onClick={addCustom}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UNIFIED HISTORY FEED ─────────────────────────────────────────────────────
const HIST_FILTERS = [
  { key: "all",         label: "All"            },
  { key: "appt",        label: "Appointments"   },
  { key: "payment",     label: "Payments"       },
  { key: "comm",        label: "Communications" },
  { key: "notes",       label: "Notes"          },
  { key: "touchpoint",  label: "Touchpoints"    },
  { key: "client",      label: "Profile"        },
];

function HistoryFeed({ history, transactions = [], onLog, onNote }) {
  const [filter, setFilter] = useState("all");
  const sorted = [...history].sort((a, b) => b.ts - a.ts);
  const shown  = sorted.filter((e) => filter === "all" || (filter !== "payment" && e.type.startsWith(filter)));

  const txTotal = (t) =>
    (+t.cc_amount||0) + (+t.cash_amount||0) + (+t.check_amount||0) + (+t.ach_amount||0)
    + (+t.package_redemption||0) + (+t.gc_redemption||0) + (+t.bank_account_amount||0)
    + (+t.vagaro_pay_later_amount||0) + (+t.other_amount||0);

  const txMethodLabel = (t) => {
    const parts = [];
    if (+t.cc_amount > 0)               parts.push(`CC $${(+t.cc_amount).toFixed(2)}`);
    if (+t.cash_amount > 0)             parts.push(`Cash $${(+t.cash_amount).toFixed(2)}`);
    if (+t.check_amount > 0)            parts.push(`Check $${(+t.check_amount).toFixed(2)}`);
    if (+t.package_redemption > 0)      parts.push(`Pkg $${(+t.package_redemption).toFixed(2)}`);
    if (+t.gc_redemption > 0)           parts.push(`GC $${(+t.gc_redemption).toFixed(2)}`);
    if (+t.vagaro_pay_later_amount > 0) parts.push(`VPL $${(+t.vagaro_pay_later_amount).toFixed(2)}`);
    if (+t.bank_account_amount > 0)     parts.push(`Bank $${(+t.bank_account_amount).toFixed(2)}`);
    if (+t.other_amount > 0)            parts.push(`Other $${(+t.other_amount).toFixed(2)}`);
    return parts.join(" · ") || "—";
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {HIST_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              fontSize: "11px", padding: "3px 9px", borderRadius: "100px",
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
              border: filter === f.key ? "1px solid #d4bfaa" : "1px solid #e8e0d6",
              background: filter === f.key ? "#f5ede4" : "transparent",
              color: filter === f.key ? "#7a5640" : "#8a7a6a",
            }}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onNote && (
            <button style={{ ...S.sm("ghost"), fontSize: "11px" }} onClick={onNote}>📝 Note</button>
          )}
          <button style={{ ...S.sm("ghost"), fontSize: "11px" }} onClick={onLog}>+ Log</button>
        </div>
      </div>

      {shown.length === 0 && filter !== "payment" && (
        <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>
          No events in this category yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((ev, i) => {
          const cfg = HISTORY_TYPES[ev.type] || { icon: "•", label: ev.type, color: "#8a7a6a", bg: "#faf8f5", src: "system" };
          const isSystem = cfg.src === "system" || ev.by === "System";
          return (
            <div key={ev.id} style={{
              display: "flex", gap: 12, padding: "11px 0",
              borderBottom: i < shown.length - 1 ? "1px solid #f0e8de" : "none",
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", background: cfg.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, flexShrink: 0, marginTop: 1,
              }}>
                {cfg.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: cfg.color }}>{cfg.label}</span>
                  <span style={{ fontSize: "10px", color: "#b0a090", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {fmtStamp(ev.ts)}
                  </span>
                </div>
                <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#2e2418", lineHeight: "1.5" }}>
                  {ev.detail}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "11px", color: "#b0a090" }}>
                  {isSystem ? (
                    <>
                      <span style={{ background: "#e8f4fd", color: "#0c6ebd", padding: "1px 6px", borderRadius: 99, fontWeight: 700, fontSize: 10 }}>System</span>
                      <span>auto-logged</span>
                    </>
                  ) : (
                    <span style={{ background: "#f5ede4", color: "#7a5640", padding: "1px 6px", borderRadius: 99, fontWeight: 700, fontSize: 10 }}>{ev.by}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transaction records in Payments tab */}
      {filter === "payment" && (
        <div>
          {transactions.length === 0 && shown.length === 0 && (
            <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>No payment records yet.</p>
          )}
          {transactions.length > 0 && (
            <>
              {shown.length > 0 && <div style={{ borderTop: "1px solid #f0e8de", margin: "4px 0 12px" }} />}
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>
                Vagaro Transactions
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {transactions.map((t, i) => {
                  const total = txTotal(t);
                  const dateStr = t.transaction_date
                    ? new Date(t.transaction_date.length <= 10
                        ? t.transaction_date + "T12:00:00"
                        : t.transaction_date
                      ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : null;
                  const tipAmt = +t.tip || 0;
                  return (
                    <div key={t.id} style={{
                      display: "flex", gap: 12, padding: "11px 0",
                      borderBottom: i < transactions.length - 1 ? "1px solid #f0e8de" : "none",
                    }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#d1fae5",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0, marginTop: 1 }}>
                        💳
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>
                            {t.item_sold || t.purchase_type || "Transaction"}
                          </span>
                          <span style={{ fontSize: "14px", fontWeight: "800", color: "#065f46", whiteSpace: "nowrap" }}>
                            ${total.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: "#8a7a6a", marginBottom: 3 }}>
                          {[t.purchase_type, t.service_category, dateStr].filter(Boolean).join(" · ")}
                        </div>
                        <div style={{ fontSize: "10px", color: "#b0a090" }}>
                          {txMethodLabel(t)}{tipAmt > 0 ? ` · Tip $${tipAmt.toFixed(2)}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {filter !== "payment" && shown.length === 0 && (
        <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>No events in this category yet.</p>
      )}
    </div>
  );
}


// ─── CLIENT DETAIL ────────────────────────────────────────────────────────────
function ClientDetail({ client, onUpdate, templates, allClients, onBack, supabaseUrl, supabaseAnonKey, usingDB }) {
  const [showLog,      setShowLog]      = useState(false);
  const [showEdit,     setShowEdit]     = useState(false);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    if (!usingDB || !supabaseUrl || !supabaseAnonKey || !client.id) return;
    getSB(supabaseUrl, supabaseAnonKey)
      .from("transactions")
      .select("*")
      .eq("client_id", client.id)
      .order("transaction_date", { ascending: false })
      .then(({ data }) => { if (data) setTransactions(data); });
  }, [client.id, usingDB, supabaseUrl, supabaseAnonKey]);

  const lifetimeTotal = transactions.length > 0
    ? transactions.reduce((sum, t) =>
        sum + (+t.cc_amount||0) + (+t.cash_amount||0) + (+t.check_amount||0) + (+t.ach_amount||0)
            + (+t.package_redemption||0) + (+t.gc_redemption||0) + (+t.bank_account_amount||0)
            + (+t.vagaro_pay_later_amount||0) + (+t.other_amount||0), 0)
    : client.totalSpent || 0;

  const initInfoForm = () => ({
    firstName:          client.firstName          || "",
    lastName:           client.lastName           || "",
    phone:              client.phone              || "",
    email:              client.email              || "",
    birthday:           client.birthday           || "",
    customerSince:      client.customerSince      || "",
    avgVisitIntervalDays: client.avgVisitIntervalDays || "",
    referredBy:         client.referredBy         || "",
    address:            client.address            || "",
    city:               client.city               || "",
    state:              client.state              || "",
    zip:                client.zip                || "",
  });
  const [infoForm, setInfoForm] = useState(initInfoForm);

  useEffect(() => {
    setInfoForm(initInfoForm());
  }, [client.id]);

  const { layer1: statusLayer1, layer2: status } = clientStatus(client);
  const ds = daysSince(lastCompletedDate(client));
  const interval = client.avgVisitIntervalDays || 30;
  const isBirthday = client.birthday && client.birthday.slice(5) === TODAY.slice(5);

  const upcoming = (client.appointments || [])
    .filter((a) => a.date >= TODAY && a.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date));

  const referredClients = allClients.filter(
    (c) => c.id !== client.id && (c.referredBy || "").toLowerCase() === fullName(client).toLowerCase()
  );

  const appendHistory = (event) => {
    onUpdate(client.id, { history: [...(client.history || []), event] });
  };

  const addNugget = (nugget) => {
    const nuggets = [...(client.goldenNuggets || []), nugget];
    onUpdate(client.id, { goldenNuggets: nuggets });
    appendHistory(mkEvent("notes.updated", `Golden Nugget added: "${nugget.text.slice(0, 60)}${nugget.text.length > 60 ? "…" : ""}"`, { by: nugget.by }));
  };

  const deleteNugget = (id) => {
    onUpdate(client.id, { goldenNuggets: (client.goldenNuggets || []).filter((n) => n.id !== id) });
  };

  const updateCareCategory = (cat) => {
    onUpdate(client.id, { careCategory: cat });
    appendHistory(mkEvent("client.updated", `Care category set to: ${cat ? CARE_CATEGORIES[cat]?.label : "none"}`, { by: "Don Snyder" }));
  };

  const updateRedLight = (val) => {
    onUpdate(client.id, { redLightStatus: val });
    appendHistory(mkEvent("client.updated", `Red Light Therapy status: ${val ? RED_LIGHT_STATUSES[val]?.label : "cleared"}`, { by: "Don Snyder" }));
  };

  const addCommunication = (event) => {
    appendHistory(event);
    // Auto-set contactedAt when a comm event is first logged for a Lead,
    // enabling the 14-day Lost Lead countdown.
    if (
      event.type && event.type.startsWith("comm.") &&
      statusLayer1 === "lead" &&
      !client.contactedAt
    ) {
      onUpdate(client.id, { contactedAt: new Date().toISOString() });
    }
    // If the log modal had an onAfterSave callback (e.g. Red Light stage advance), call it
    if (showLog && typeof showLog.onAfterSave === "function") {
      showLog.onAfterSave();
    }
    setShowLog(false);
  };





  const saveInfo = () => {
    const updates = {
      firstName:          infoForm.firstName,
      lastName:           infoForm.lastName,
      phone:              infoForm.phone,
      email:              infoForm.email,
      birthday:           infoForm.birthday,
      customerSince:      infoForm.customerSince,
      avgVisitIntervalDays: infoForm.avgVisitIntervalDays ? Number(infoForm.avgVisitIntervalDays) : client.avgVisitIntervalDays,
      referredBy:         infoForm.referredBy,
      address:            infoForm.address,
      city:               infoForm.city,
      state:              infoForm.state,
      zip:                infoForm.zip,
    };
    onUpdate(client.id, updates);
    setShowEdit(false);
    appendHistory(mkEvent("client.updated", "Client profile updated", { by: "Don Snyder" }));
  };


  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      {showLog && (
        <LogModal client={client} templates={templates} preset={typeof showLog === "object" ? showLog : undefined}
          onClose={() => setShowLog(false)} onSave={addCommunication} />
      )}

      {showEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEdit(false); }}>
          <div style={{ ...S.card, width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", animation: "fadeUp 0.15s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>Edit client profile</div>
              <button onClick={() => setShowEdit(false)} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[
                { label: "First Name",   key: "firstName",   type: "text"  },
                { label: "Last Name",    key: "lastName",    type: "text"  },
                { label: "Phone",        key: "phone",       type: "tel"   },
                { label: "Email",        key: "email",       type: "email" },
                { label: "Birthday",     key: "birthday",    type: "date"  },
                { label: "Client Since", key: "customerSince", type: "date" },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label style={S.lbl}>{label}</label>
                  <input type={type} value={infoForm[key]} onChange={(e) => setInfoForm((f) => ({ ...f, [key]: e.target.value }))} style={S.inp} />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.lbl}>Mailing address</label>
              <input type="text" value={infoForm.address} onChange={(e) => setInfoForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street address" style={{ ...S.inp, marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                <input type="text" value={infoForm.city}  onChange={(e) => setInfoForm((f) => ({ ...f, city:  e.target.value }))} placeholder="City"  style={S.inp} />
                <input type="text" value={infoForm.state} onChange={(e) => setInfoForm((f) => ({ ...f, state: e.target.value }))} placeholder="State" style={S.inp} maxLength={2} />
                <input type="text" value={infoForm.zip}   onChange={(e) => setInfoForm((f) => ({ ...f, zip:   e.target.value }))} placeholder="ZIP"   style={S.inp} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={S.lbl}>Referred by</label>
                <input type="text" value={infoForm.referredBy} onChange={(e) => setInfoForm((f) => ({ ...f, referredBy: e.target.value }))} placeholder="Name, Google, Instagram..." style={S.inp} />
              </div>
              <div>
                <label style={S.lbl}>Avg visit interval (days)</label>
                <input type="number" value={infoForm.avgVisitIntervalDays} onChange={(e) => setInfoForm((f) => ({ ...f, avgVisitIntervalDays: e.target.value }))} placeholder="e.g. 30" style={S.inp} min={1} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("ghost")} onClick={() => setShowEdit(false)}>Cancel</button>
              <button style={S.btn("primary")} onClick={saveInfo}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          color: "#a0785a", fontSize: "13px", fontWeight: "700",
          fontFamily: "'DM Sans',sans-serif", marginBottom: 14, padding: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          All clients
        </button>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
        <Avatar client={client} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "5px" }}>
            <h2 style={{ margin: 0, fontSize: "19px", fontWeight: "800", color: "#1a120b" }}>{fullName(client)}</h2>
            <StatusSelector client={client} status={status} onUpdate={onUpdate} />
            {isBirthday && <span>🎂</span>}
            {client.waitlisted && <span style={{ fontSize: "10px", fontWeight: "700", color: "#1d5fa8", background: "#dbeafe", padding: "2px 8px", borderRadius: "100px" }}>Waitlisted</span>}
            {client.vagaroSynced === false && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "#92400e", background: "#fef3c7", border: "1px solid #f0d090", padding: "2px 8px", borderRadius: "100px" }}>
                ⚠️ Not in Vagaro yet
              </span>
            )}
            <VagaroTag />
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "13px", color: "#7a6a5a", marginBottom: 8 }}>
            <span>{client.email}</span>
            <span>{client.phone}</span>
            {client.birthday && <span>Birthday: {fmtDate(client.birthday)}</span>}
            {lifetimeTotal > 0 && <span style={{ color: "#065f46", fontWeight: "600" }}>Lifetime: ${Number(lifetimeTotal).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>}
            {client.noShows > 0 && <span style={{ color: "#dc2626", fontWeight: "600" }}>No-shows: {client.noShows}</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <CareCategoryBadge category={client.careCategory} onChange={updateCareCategory} />
          </div>
          <TagEditor
            tags={client.tags || []}
            onChange={(tags) => {
              onUpdate(client.id, { tags });
              appendHistory(mkEvent("client.updated", "Client tags updated", { by: "Don Snyder" }));
            }}
          />
        </div>
        {/* Header buttons */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: 8 }}>
          <button
            onClick={() => setShowEdit(true)}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: "8px", fontSize: "12px", fontWeight: "700", color: "#7a5640", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
          >
            ✏️ Edit profile
          </button>
          <button
            onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", background: "#dcf5ec", border: "1px solid #6ee7b7", borderRadius: "8px", fontSize: "12px", fontWeight: "700", color: "#065f46", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
          >
            + Log
          </button>
        </div>
      </div>

      {/* Restricted profile alert banners */}
      {status === "flagged" && (
        <div style={{ background: "#fff1f2", border: "2px solid #fda4af", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#881337", display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "18px", flexShrink: 0 }}>🚨</span>
          <div>
            <strong>FLAGGED PROFILE — Booking Intercept Active.</strong>
            {client.restrictedNote && <div style={{ marginTop: 4, fontWeight: "400" }}>{client.restrictedNote}</div>}
          </div>
        </div>
      )}
      {status === "deactivated" && (
        <div style={{ background: "#fdf2f8", border: "1px solid #f9a8d4", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#9d174d" }}>
          <strong>Profile Deactivated.</strong> All communications suppressed.
        </div>
      )}
      {/* Needs Follow Up alert */}
      {status === "needs-follow-up" && upcoming.length === 0 && (
        <div style={{ background: "#faf5ff", border: "1px solid #c4b5fd", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#5b21b6", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>📋 <strong>Needs Follow Up:</strong> {client.firstName} left without booking their next appointment.</span>
          <button onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#7c3aed", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log outreach →
          </button>
        </div>
      )}
      {/* Overdue / Lapsed banners */}
      {(status === "overdue" || status === "overdue-with-package") && ds && upcoming.length === 0 && (
        <div style={{ background: "#fff8f0", border: "1px solid #f0e0c8", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#92400e", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>⚠️ <strong>Overdue{status === "overdue-with-package" ? " — Has Unused Package!" : ""}:</strong> {client.firstName} last visited {ds} days ago.</span>
          <button onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#d97706", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log outreach →
          </button>
        </div>
      )}
      {(status === "stale" || status === "expired-package") && ds && upcoming.length === 0 && (
        <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>🔴 <strong>Lapsed{status === "expired-package" ? " — Package Expired" : ` (${ds} days)`}:</strong> {client.firstName} needs a win-back sequence.</span>
          <button onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#dc2626", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log outreach →
          </button>
        </div>
      )}
      {status === "first-session-no-show" && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#92400e", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>🚫 <strong>First Session No-Show.</strong> High-priority empathy recovery — contact {client.firstName} to rebook.</span>
          <button onClick={() => setShowLog({ channel: "Phone", category: "No-Show Follow-Up" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#d97706", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log call →
          </button>
        </div>
      )}
      {isBirthday && (
        <div style={{ background: "#fef9ee", border: "1px solid #fde68a", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#78350f" }}>
          Today is {client.firstName}'s birthday — great time to send a birthday offer!
        </div>
      )}


          {/* Golden Nuggets */}
          <GoldenNuggetsCard
            nuggets={client.goldenNuggets || []}
            onAdd={addNugget}
            onDelete={deleteNugget}
          />

          {/* Outreach & touchpoints card */}
          <div style={{ ...S.card, marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={S.lbl}>Outreach &amp; touchpoints</label>
              {client.careCategory && CARE_CATEGORIES[client.careCategory] && (
                <span style={{ fontSize: "10px", fontWeight: "700", color: CARE_CATEGORIES[client.careCategory].color, background: CARE_CATEGORIES[client.careCategory].bg, padding: "2px 8px", borderRadius: "100px" }}>
                  {CARE_CATEGORIES[client.careCategory].icon} {CARE_CATEGORIES[client.careCategory].label}
                </span>
              )}
            </div>
            {client.careCategory && CARE_CATEGORIES[client.careCategory] && (
              <div style={{ fontSize: "11px", color: CARE_CATEGORIES[client.careCategory].color, background: CARE_CATEGORIES[client.careCategory].bg, padding: "5px 10px", borderRadius: 8, marginBottom: 10, fontWeight: "600" }}>
                {CARE_CATEGORIES[client.careCategory].icon} Rebook strategy: {CARE_CATEGORIES[client.careCategory].rebook}
              </div>
            )}
            {!client.careCategory && (
              <div style={{ fontSize: "11px", color: "#8a7a6a", background: "#faf8f5", border: "1px dashed #e8e0d6", padding: "5px 10px", borderRadius: 8, marginBottom: 10 }}>
                Set a care category above to get tailored touchpoints for this client.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: 4 }}>
              {getTouchpoints(client).map((tp) => {
                // Red Light gets its own smart row
                if (tp.key === "redLight") {
                  return (
                    <RedLightRow
                      key="redLight"
                      client={client}
                      onLog={(preset) => setShowLog(preset)}
                      onStageChange={updateRedLight}
                    />
                  );
                }
                const lastSent = getLastSent(client, tp.logPreset.category);
                return (
                  <div key={tp.key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "10px", background: "#faf8f5", border: "1px solid #f0e8de" }}>
                    <span style={{ fontSize: "15px", flexShrink: 0 }}>{tp.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "#4a3828" }}>{tp.label}</div>
                      {lastSent
                        ? <div style={{ fontSize: "11px", color: "#0f7a4a", fontWeight: "600", marginTop: 1 }}>Last sent {lastSent}</div>
                        : <div style={{ fontSize: "11px", color: "#b0a090", marginTop: 1 }}>Never sent</div>
                      }
                    </div>
                    <button
                      onClick={() => setShowLog({ ...tp.logPreset, templateKey: tp.templateKey })}
                      style={{ fontSize: "11px", fontWeight: "700", color: "#7a5640", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
                      Log →
                    </button>
                  </div>
                );
              })}
            </div>
          </div>






      {/* Upcoming appointments */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <label style={{ ...S.lbl, marginBottom: 0 }}>Upcoming appointments</label>
          <VagaroTag />
        </div>
        {upcoming.length === 0
          ? <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>No upcoming appointments. Booking is managed in Vagaro.</p>
          : upcoming.map((a, i) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 0", borderBottom: i < upcoming.length - 1 ? "1px solid #f0e8de" : "none" }}>
                <div style={{ fontSize: "12px", color: "#7a6a5a", minWidth: "80px" }}>
                  <div style={{ fontWeight: "700" }}>{fmtDate(a.date)}</div>
                  <div style={{ color: "#b0a090" }}>{fmtTime(a.time)}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>{a.service}</div>
                  <div style={{ fontSize: "12px", color: "#8a7a6a" }}>{a.duration} min · {a.therapist}</div>
                </div>
                <ApptPill status={a.status} />
              </div>
            ))
        }
      </div>

      {/* Communication history — always visible */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <label style={{ ...S.lbl, marginBottom: 0 }}>History</label>
          <span style={{ fontSize: "11px", color: "#b0a090", fontWeight: "600" }}>{(client.history || []).length} events</span>
        </div>
        <HistoryFeed
          history={client.history || []}
          transactions={transactions}
          onLog={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })}
          onNote={() => setShowLog({ noteMode: true })}
        />
      </div>
    </div>
  );
}


// ─── CLIENT SIDEBAR ───────────────────────────────────────────────────────────
// Filters match on Layer 1 parent key or Layer 2 sub-status key.
const SIDEBAR_FILTERS = [
  { key: "all",        label: "All"      },
  { key: "lead",       label: "Leads"    },
  { key: "active",     label: "Active"   },
  { key: "lapsed",     label: "Lapsed"   },
  { key: "inactive",   label: "Inactive" },
  { key: "restricted", label: "Restricted" },
];

function ClientSidebar({ clients, selected, onSelect, filter, setFilter, search, setSearch, tagFilter, setTagFilter, fullWidth, onAddClient }) {
  const [showNewClient, setShowNewClient] = useState(false);
  const allTags = useMemo(
    () => [...new Set(clients.flatMap((c) => c.tags || []))].sort(),
    [clients]
  );
  const counts = useMemo(() => {
    const c = { all: clients.length };
    clients.forEach((cl) => {
      const s = clientStatus(cl);
      c[s.layer1] = (c[s.layer1] || 0) + 1;
    });
    return c;
  }, [clients]);

  const filtered = useMemo(() =>
    clients
      .filter((cl) => {
        const s = clientStatus(cl);
        const matchF = filter === "all" || s.layer1 === filter || s.layer2 === filter;
        const q = search.toLowerCase();
        const matchS = !q ||
          fullName(cl).toLowerCase().includes(q) ||
          cl.email?.toLowerCase().includes(q) ||
          cl.phone?.includes(q);
        const matchT = !tagFilter || (cl.tags || []).includes(tagFilter);
        return matchF && matchS && matchT;
      })
      .sort((a, b) => {
        const last = (a.lastName || "").localeCompare(b.lastName || "");
        return last !== 0 ? last : (a.firstName || "").localeCompare(b.firstName || "");
      }),
    [clients, filter, search, tagFilter]
  );

  return (
    <div style={{
      width: fullWidth ? "100%" : "270px",
      flexShrink: 0,
      borderRight: fullWidth ? "none" : "1px solid #e8e0d6",
      display: "flex",
      flexDirection: "column",
      background: "#fdfbf8",
    }}>
      {showNewClient && (
        <NewClientModal
          onSave={(c) => { onAddClient(c); setShowNewClient(false); onSelect(c); }}
          onClose={() => setShowNewClient(false)}
        />
      )}
      <div style={{ padding: "14px 14px 8px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: "8px",
            background: "#ffffff", border: "1px solid #e8e0d6",
            borderRadius: "10px", padding: "8px 12px",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              style={{
                border: "none", background: "transparent",
                fontSize: "13px", color: "#2e2418",
                outline: "none", width: "100%",
                fontFamily: "'DM Sans',sans-serif",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "#b0a090", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}
                title="Clear search"
              >×</button>
            )}
          </div>
          <button onClick={() => setShowNewClient(true)}
            style={{ ...S.btn("primary"), fontSize: "12px", padding: "0 12px", whiteSpace: "nowrap", borderRadius: 10, flexShrink: 0 }}
            title="Add new client">
            + New
          </button>
        </div>
      </div>

      <div style={{ padding: "0 12px 6px", display: "flex", flexWrap: "wrap", gap: 4 }}>
        {SIDEBAR_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            fontSize: "11px", padding: "3px 9px", borderRadius: "100px",
            cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
            border: filter === f.key ? "1px solid #d4bfaa" : "1px solid #e8e0d6",
            background: filter === f.key ? "#f5ede4" : "transparent",
            color: filter === f.key ? "#7a5640" : "#8a7a6a",
          }}>
            {f.label}
            {counts[f.key] ? <span style={{ opacity: 0.65 }}> ({counts[f.key]})</span> : null}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div style={{ padding: "0 12px 8px" }}>
          <select
            value={tagFilter || ""}
            onChange={(e) => setTagFilter(e.target.value || null)}
            style={{ ...S.inp, fontSize: "11px", padding: "5px 8px", color: tagFilter ? "#7a5640" : "#8a7a6a" }}
          >
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <p style={{ padding: "20px 16px", fontSize: "13px", color: "#b0a090" }}>No clients match.</p>
        )}
        {filtered.map((cl) => {
          const { layer2: st } = clientStatus(cl);
          const isSel = selected?.id === cl.id;
          const ds = daysSince(lastCompletedDate(cl));
          return (
            <button
              key={cl.id}
              onClick={() => onSelect(cl)}
              style={{
                width: "100%", textAlign: "left", padding: "11px 14px",
                background: isSel ? "#fdf6ef" : "transparent",
                borderLeft: `3px solid ${isSel ? "#a0785a" : "transparent"}`,
                border: "none", borderBottom: "1px solid #f0e8de",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                fontFamily: "'DM Sans',sans-serif", transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#faf8f5"; }}
              onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
            >
              <Avatar client={cl} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: "2px" }}>
                  <span style={{
                    fontSize: "13px", fontWeight: "700", color: "#2e2418",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {fullName(cl)}
                  </span>
                  <StatusPill status={st} />
                </div>
                <div style={{ fontSize: "11px", color: "#b0a090" }}>
                  {ds !== null ? `Last visit ${ds}d ago` : "No visits yet"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ clients, tasks = [], onGoToClient, onSaveTask, onToggleTask, onDeleteTask, onFilterClients }) {
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [selectedDate, setSelectedDate] = useState(TODAY);

  const isToday = selectedDate === TODAY;
  const selDateObj = new Date(selectedDate + "T12:00:00");
  const prevDate = new Date(selDateObj); prevDate.setDate(selDateObj.getDate() - 1);
  const nextDate = new Date(selDateObj); nextDate.setDate(selDateObj.getDate() + 1);
  const prevStr = prevDate.toISOString().split("T")[0];
  const nextStr = nextDate.toISOString().split("T")[0];
  const weekday = selDateObj.toLocaleDateString("en-US", { weekday: "long" }); // "Monday", "Wednesday", etc.

  // "tomorrow" relative to selected date for reminder logic
  const tomorrowStr = nextStr;
  // "7 days from selected" for birthday window
  const in7Obj = new Date(selDateObj); in7Obj.setDate(selDateObj.getDate() + 7);

  // 7 days before selected date (for new client review on Mondays)
  const weekAgoStr = new Date(selDateObj.getTime() - 7 * 86400000).toISOString().split("T")[0];

  const dayLabel = isToday
    ? "Today"
    : selectedDate === prevStr
    ? "Yesterday"
    : selDateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Weekday-specific context banner
  const weekdayContext = {
    Monday:    { msg: "Monday — new client review day. Check last week's new clients. Did they rebook?", color: "#1d5fa8", bg: "#dbeafe" },
    Wednesday: { msg: "Wednesday — lapsed client outreach day. Make 5–10 warm calls or texts.", color: "#065f46", bg: "#d1fae5" },
    Friday:    { msg: "Friday — data & metrics review. Update your tracking spreadsheets.", color: "#6d28d9", bg: "#ede9fe" },
  }[weekday];

  const counts = useMemo(() => {
    const c = { lead: 0, active: 0, lapsed: 0, inactive: 0, restricted: 0 };
    clients.forEach((cl) => { const s = clientStatus(cl); if (c[s.layer1] !== undefined) c[s.layer1]++; });
    return c;
  }, [clients]);

  const statCards = [
    { label: "Active",     value: counts.active,     bg: "#dcf5ec", color: "#0f7a4a", filter: "active"     },
    { label: "Lapsed",     value: counts.lapsed,     bg: "#fee2e2", color: "#991b1b", filter: "lapsed"     },
    { label: "Leads",      value: counts.lead,       bg: "#dbeafe", color: "#1d5fa8", filter: "lead"       },
    { label: "Inactive",   value: counts.inactive,   bg: "#f1f5f9", color: "#64748b", filter: "inactive"   },
  ];

  // Build daily action items
  const actions = useMemo(() => {
    const items = [];

    // MONDAY: new clients from last 7 days who haven't rebooked
    if (weekday === "Monday" || true) { // always check, highlight on Monday
      clients.forEach((c) => {
        const firstAppt = (c.appointments || [])
          .filter((a) => a.status === "completed")
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (!firstAppt) return;
        const daysAgo = Math.floor((new Date(selectedDate + "T12:00:00") - new Date(firstAppt.date + "T12:00:00")) / 86400000);
        if (daysAgo < 1 || daysAgo > 7) return;
        // Did they rebook?
        const hasRebook = (c.appointments || []).some((a) => a.date > firstAppt.date && a.status !== "cancelled");
        if (hasRebook) return;
        items.push({ type: "newNoRebook", priority: 0, client: c, reason: `New client ${daysAgo}d ago — hasn't rebooked yet`, icon: "🆕", color: "#1d5fa8", bg: "#dbeafe", isMonday: weekday === "Monday" });
      });
    }

    // 1. Appointment reminders — has appt tomorrow, no reminder logged today or yesterday
    clients.forEach((c) => {
      const hasTomorrow = (c.appointments || []).some((a) => a.date === tomorrowStr && (a.status === "scheduled" || a.status === "checked-in"));
      if (!hasTomorrow) return;
      const lastReminder = getLastSent(c, "Appointment Reminder");
      const alreadySent = lastReminder === "today" || lastReminder === "yesterday";
      if (!alreadySent) items.push({ type: "reminder", priority: 0, client: c, reason: `Appointment tomorrow — no reminder sent yet`, icon: "⏰", color: "#5b21b6", bg: "#ede9fe" });
    });

    // 2. Post-visit follow-up — completed appt 1-3 days ago, no post-visit logged since
    clients.forEach((c) => {
      const recentCompleted = (c.appointments || []).find((a) => {
        if (a.status !== "completed") return false;
        const d = Math.floor((new Date(selectedDate + "T12:00:00") - new Date(a.date + "T12:00:00")) / 86400000);
        return d >= 1 && d <= 3;
      });
      if (!recentCompleted) return;
      const lastPV = getLastSent(c, "Post-Visit Follow-Up");
      const alreadySent = lastPV === "today" || lastPV === "yesterday";
      if (!alreadySent) items.push({ type: "postVisit", priority: 1, client: c, reason: `Visit ${daysSince(recentCompleted.date)}d ago — follow-up not yet sent`, icon: "❤️", color: "#be185d", bg: "#fce7f3" });
    });

    // 3. Win-back — lapsed/stale clients with no upcoming appointment
    clients.forEach((c) => {
      const { layer1 } = clientStatus(c);
      if (layer1 !== "lapsed") return;
      const hasUpcoming = (c.appointments || []).some((a) => a.date >= selectedDate && a.status !== "cancelled");
      if (hasUpcoming) return;
      const ds = daysSince(lastCompletedDate(c));
      items.push({ type: "lapsed", priority: 2, client: c, reason: `Lapsed — ${ds} days since last visit`, icon: "🔴", color: "#991b1b", bg: "#fee2e2" });
    });

    // 4. Reach out — overdue clients with no upcoming appointment
    clients.forEach((c) => {
      const { layer2 } = clientStatus(c);
      if (layer2 !== "overdue" && layer2 !== "overdue-with-package") return;
      const hasUpcoming = (c.appointments || []).some((a) => a.date >= selectedDate && a.status !== "cancelled");
      if (hasUpcoming) return;
      const ds = daysSince(lastCompletedDate(c));
      const pkgNote = layer2 === "overdue-with-package" ? " — has unused package!" : "";
      items.push({ type: "overdue", priority: 3, client: c, reason: `Overdue — ${ds} days since last visit${pkgNote}`, icon: layer2 === "overdue-with-package" ? "📦" : "🟡", color: "#92400e", bg: "#fef3c7" });
    });

    // 5. Red Light — interested clients who haven't booked after 5+ days
    clients.forEach((c) => {
      if (c.redLightStatus !== "interested") return;
      const lastRL = (c.history || [])
        .filter((e) => e.detail && e.detail.includes("Red Light"))
        .sort((a, b) => b.ts - a.ts)[0];
      const daysSinceRL = lastRL ? Math.floor((Date.now() - lastRL.ts) / 86400000) : 999;
      if (daysSinceRL < 5) return;
      items.push({ type: "redLightFollow", priority: 2, client: c, reason: `Red Light — interested, no booking in ${daysSinceRL}d`, icon: "⭐", color: "#1d5fa8", bg: "#dbeafe" });
    });

    // 6. Red Light — not offered to any client with 1+ completed visits
    clients.forEach((c) => {
      if (c.redLightStatus != null) return;
      const hasVisit = (c.appointments || []).some((a) => a.status === "completed");
      if (!hasVisit) return;
      items.push({ type: "redLightOffer", priority: 5, client: c, reason: "Red Light Therapy — hasn't been offered yet", icon: "💡", color: "#6b7280", bg: "#f9fafb" });
    });

    // 7. Birthdays this week — no birthday outreach logged yet
    clients.forEach((c) => {
      if (!c.birthday) return;
      const bm = +c.birthday.slice(5, 7) - 1;
      const bd = +c.birthday.slice(8, 10);
      const bDate = new Date(selDateObj.getFullYear(), bm, bd);
      if (bDate < new Date(selDateObj.getFullYear(), selDateObj.getMonth(), selDateObj.getDate())) bDate.setFullYear(selDateObj.getFullYear() + 1);
      if (bDate > in7Obj) return;
      const lastB = getLastSent(c, "Birthday / Special Offer");
      const alreadySent = lastB === "today" || lastB === "yesterday";
      if (!alreadySent) {
        const isBday = bDate.toISOString().split("T")[0] === selectedDate;
        items.push({ type: "birthday", priority: isBday ? 0 : 4, client: c, reason: isBday ? "Birthday today!" : `Birthday in ${Math.ceil((bDate - selDateObj) / 86400000)} days`, icon: "🎂", color: "#78350f", bg: "#fef9ee" });
      }
    });

    return items.sort((a, b) => a.priority - b.priority);
  }, [clients, selectedDate, weekday]);

  const PRESET_MAP = {
    reminder: { channel: "Text/SMS", category: "Appointment Reminder",    templateKey: null },
    postVisit: { channel: "Text/SMS", category: "Post-Visit Follow-Up",   templateKey: "post-visit" },
    lapsed:   { channel: "Text/SMS", category: "Rebooking Outreach",      templateKey: "lapsed" },
    overdue:  { channel: "Text/SMS", category: "Rebooking Outreach",      templateKey: "rebooking" },
    birthday: { channel: "Email",    category: "Birthday / Special Offer", templateKey: "birthday" },
  };

  // Tasks due on selectedDate or overdue relative to it
  const dueTasks = tasks.filter((t) => !t.done && t.dueDate <= selectedDate);
  const totalActionCount = actions.length + dueTasks.length;

  // Referral milestones — clients who have hit 3 referrals
  const referralMilestones = useMemo(() => {
    return clients.filter((c) => {
      const count = clients.filter((x) => (x.referredBy || "").toLowerCase() === fullName(c).toLowerCase()).length;
      return count >= 3;
    }).map((c) => ({
      client: c,
      count: clients.filter((x) => (x.referredBy || "").toLowerCase() === fullName(c).toLowerCase()).length,
    }));
  }, [clients]);

  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      {(showTaskModal || editTask) && (
        <TaskModal
          clients={clients}
          task={editTask}
          onSave={(t) => { onSaveTask(t); setShowTaskModal(false); setEditTask(null); }}
          onClose={() => { setShowTaskModal(false); setEditTask(null); }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: "21px", fontWeight: "800", color: "#1a120b" }}>
            {isToday ? "Good morning" : dayLabel}
          </h2>
          <p style={{ margin: 0, fontSize: "13px", color: "#8a7a6a" }}>
            {selDateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Date navigator */}
          <button onClick={() => setSelectedDate(prevStr)}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#7a5640", fontFamily: "'DM Sans',sans-serif" }}>
            ‹
          </button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            style={{ ...S.inp, width: "auto", fontSize: "12px", fontWeight: "700", padding: "5px 10px", cursor: "pointer" }} />
          <button onClick={() => setSelectedDate(nextStr)}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#7a5640", fontFamily: "'DM Sans',sans-serif" }}>
            ›
          </button>
          {!isToday && (
            <button onClick={() => setSelectedDate(TODAY)}
              style={{ fontSize: "11px", fontWeight: "700", color: "#7a5640", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              Today
            </button>
          )}
          <button onClick={() => { setEditTask(null); setShowTaskModal(true); }}
            style={{ ...S.btn("primary"), fontSize: "12px", padding: "7px 14px", whiteSpace: "nowrap" }}>
            + Task
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 22 }} />

      {/* Weekday context banner */}
      {isToday && weekdayContext && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: weekdayContext.bg, border: `1px solid ${weekdayContext.color}33`, marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>📅</span>
          <span style={{ fontSize: "12px", fontWeight: "600", color: weekdayContext.color }}>{weekdayContext.msg}</span>
        </div>
      )}

      {/* Referral milestones */}
      {referralMilestones.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid #f0d9b0", background: "linear-gradient(135deg,#fffbf5,#fef9ef)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>🏆</span>
            <label style={{ ...S.lbl, marginBottom: 0, color: "#92400e" }}>Referral milestones — reward these clients!</label>
          </div>
          {referralMilestones.map(({ client: c, count }) => (
            <div key={c.id} onClick={() => onGoToClient(c.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "#fffdf5", border: "1px solid #f0e0b0", marginBottom: 6, cursor: "pointer" }}>
              <Avatar client={c} size={30} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#1a120b" }}>{fullName(c)}</span>
                <span style={{ fontSize: "12px", color: "#92400e", marginLeft: 8 }}>{count} referrals — send a complimentary half-hour!</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onGoToClient(c.id); }}
                style={{ fontSize: "11px", fontWeight: "700", color: "#92400e", background: "#fef3c7", border: "1px solid #f0d090", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                Open →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid-4col" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "28px" }}>
        {statCards.map((s) => (
          <div
            key={s.label}
            onClick={() => onFilterClients && onFilterClients(s.filter)}
            style={{
              background: s.bg, borderRadius: "14px", padding: "16px 18px",
              cursor: onFilterClients ? "pointer" : "default",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { if (onFilterClients) e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            <div style={{ fontSize: "10px", fontWeight: "700", color: s.color, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "6px" }}>{s.label}</div>
            <div style={{ fontSize: "30px", fontWeight: "800", color: s.color, lineHeight: 1 }}>{s.value}</div>
            {onFilterClients && <div style={{ fontSize: "10px", color: s.color, opacity: 0.6, marginTop: 4 }}>View all →</div>}
          </div>
        ))}
      </div>

      {/* Daily action list */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <label style={{ ...S.lbl, marginBottom: 0 }}>Today's action list</label>
          <span style={{ fontSize: "11px", fontWeight: "700",
            color: totalActionCount > 0 ? "#991b1b" : "#0f7a4a",
            background: totalActionCount > 0 ? "#fee2e2" : "#dcf5ec",
            padding: "2px 10px", borderRadius: "100px" }}>
            {totalActionCount > 0 ? `${totalActionCount} need attention` : "All clear ✓"}
          </span>
        </div>

        {totalActionCount === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: "28px", marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f7a4a" }}>You're all caught up</div>
            <div style={{ fontSize: "13px", color: "#b0a090", marginTop: 4 }}>No outreach or tasks needed today.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

            {/* Manual tasks due today */}
            {dueTasks.map((task) => {
              const linkedClient = task.clientId ? clients.find((c) => c.id === task.clientId) : null;
              const isOverdue = task.dueDate < TODAY;
              return (
                <div key={task.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 12,
                  background: isOverdue ? "#fff5f5" : "#fafafa",
                  border: `1px solid ${isOverdue ? "#fca5a5" : "#e8e0d6"}`,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>📋</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a120b", marginBottom: 2 }}>{task.title}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {isOverdue && <span style={{ fontSize: "11px", fontWeight: "700", color: "#991b1b" }}>Overdue — due {fmtDate(task.dueDate)}</span>}
                      {linkedClient && (
                        <span onClick={() => onGoToClient(linkedClient.id)}
                          style={{ fontSize: "11px", fontWeight: "600", color: "#7a5640", background: "#f5ede4", padding: "1px 8px", borderRadius: "100px", cursor: "pointer" }}>
                          {fullName(linkedClient)}
                        </span>
                      )}
                      <span style={{ fontSize: "11px", color: "#b0a090" }}>{task.createdBy}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setEditTask(task)}
                      style={{ fontSize: "11px", fontWeight: "700", color: "#8a7a6a", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                      Edit
                    </button>
                    <button onClick={() => onToggleTask(task.id)}
                      style={{ fontSize: "11px", fontWeight: "700", color: "#065f46", background: "#dcf5ec", border: "1px solid #6ee7b7", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                      Done ✓
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Auto-generated client action items */}
            {actions.map((item) => {
              const c = item.client;
              return (
                <div key={`${item.type}-${c.id}`} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 12,
                  background: item.bg, border: `1px solid ${item.color}22`,
                  cursor: "pointer", transition: "all 0.15s",
                }}
                  onClick={() => onGoToClient(c.id)}
                  onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.97)"}
                  onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                  <Avatar client={c} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13px", fontWeight: "800", color: "#1a120b" }}>{fullName(c)}</span>
                      {c.phone && <span style={{ fontSize: "12px", color: "#7a6a5a" }}>{c.phone}</span>}
                      {c.email && <span style={{ fontSize: "12px", color: "#7a6a5a" }}>{c.email}</span>}
                    </div>
                    <div style={{ fontSize: "12px", color: item.color, fontWeight: "600" }}>{item.reason}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onGoToClient(c.id); }}
                    style={{ fontSize: "11px", fontWeight: "700", color: item.color, background: "#fff", border: `1px solid ${item.color}44`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
                    Open →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Completed tasks today */}
        {tasks.filter((t) => t.done && t.dueDate === selectedDate).length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f0e8de" }}>
            <div style={{ fontSize: "10px", fontWeight: "700", color: "#b0a090", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>
              Completed ({tasks.filter((t) => t.done && t.dueDate === selectedDate).length})
            </div>
            {tasks.filter((t) => t.done && t.dueDate === selectedDate).map((task) => (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f5f0e8" }}>
                <span style={{ fontSize: "13px", color: "#0f7a4a" }}>✓</span>
                <span style={{ fontSize: "13px", color: "#b0a090", flex: 1, textDecoration: "line-through" }}>{task.title}</span>
                <button onClick={() => onToggleTask(task.id)}
                  style={{ fontSize: "10px", color: "#b0a090", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  Undo
                </button>
                <button onClick={() => onDeleteTask(task.id)}
                  style={{ fontSize: "10px", color: "#fca5a5", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── OUTREACH COMPOSER ────────────────────────────────────────────────────────
function OutreachComposer({ client, triggerId, templates, onLog, onClose }) {
  const tpl = templates[triggerId] || templates["rebooking"];
  const [channel,      setChannel]      = useState("sms");
  const [editedSms,    setEditedSms]    = useState(fillTemplate(tpl?.sms || "", client));
  const [editedSubject,setEditedSubject] = useState(fillTemplate(tpl?.email?.subject || "", client));
  const [editedBody,   setEditedBody]   = useState(fillTemplate(tpl?.email?.body || "", client));
  const [gmailSending, setGmailSending] = useState(false);
  const [gmailSent,    setGmailSent]    = useState(false);
  const [gmailError,   setGmailError]   = useState(null);
  const gmail = useGmail(getGmailClientId());

  const doLog = () => {
    onLog && onLog({
      id: uid(),
      channel: channel === "sms" ? "Text/SMS" : "Email",
      category: "Rebooking Outreach",
      outcome: "Sent",
      notes: channel === "sms"
        ? `${tpl?.label} sent via SMS: "${editedSms.slice(0, 80)}${editedSms.length > 80 ? "…" : ""}"`
        : `${tpl?.label} sent via Gmail — Subject: "${editedSubject}"`,
      date: TODAY,
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
      logTime: Date.now(),
      createdBy: "Don Snyder",
    });
  };

  const handleSendGmail = async () => {
    if (!client.email) return;
    setGmailSending(true); setGmailError(null);
    try {
      await gmail.sendEmail({ to: client.email, subject: editedSubject, body: editedBody });
      setGmailSent(true);
      doLog();
      setTimeout(onClose, 1500);
    } catch (e) {
      setGmailError(e.message || "Send failed");
      setGmailSending(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: "16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal" style={{ ...S.card, width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", animation: "fadeUp 0.15s ease" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>Send Outreach</div>
            <div style={{ fontSize: "12px", color: "#8a7a6a", marginTop: 2 }}>{client.firstName} {client.lastName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}>×</button>
        </div>

        {/* Template badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", background: "#fdf6ef", border: "1px solid #e8d5c0", borderRadius: 10, marginBottom: 16 }}>
          <span style={{ fontSize: "15px" }}>{tpl?.icon}</span>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#7a5640" }}>{tpl?.label}</span>
        </div>

        {/* Channel toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[{ v: "sms", l: "💬 Text/SMS" }, { v: "email", l: "✉️ Email" }].map((c) => (
            <button key={c.v} onClick={() => setChannel(c.v)} style={{
              padding: "7px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700",
              cursor: "pointer", border: "none", fontFamily: "'DM Sans',sans-serif",
              background: channel === c.v ? "linear-gradient(135deg,#a0785a,#7a5640)" : "#f5ede4",
              color: channel === c.v ? "#fff" : "#7a5640",
            }}>{c.l}</button>
          ))}
        </div>

        {/* SMS */}
        {channel === "sms" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={S.lbl}>Message</label>
              <span style={{ fontSize: "11px", color: editedSms.length > 160 ? "#c0392b" : "#b0a090" }}>{editedSms.length}/160</span>
            </div>
            <textarea style={{ ...S.inp, minHeight: 120, resize: "vertical", lineHeight: "1.6" }}
              value={editedSms} onChange={(e) => setEditedSms(e.target.value)} />
            <div style={{ fontSize: "11px", color: "#b0a090", marginTop: 6 }}>To: {client.phone || "No phone on file"}</div>
          </div>
        )}

        {/* Email */}
        {channel === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={S.lbl}>Subject</label>
              <input style={S.inp} value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} />
            </div>
            <div>
              <label style={S.lbl}>Body</label>
              <textarea style={{ ...S.inp, minHeight: 180, resize: "vertical", lineHeight: "1.7" }}
                value={editedBody} onChange={(e) => setEditedBody(e.target.value)} />
            </div>
            <div style={{ fontSize: "11px", color: "#b0a090" }}>To: {client.email || "No email on file"}</div>
          </div>
        )}

        {/* Merge tags */}
        <div style={{ background: "#faf8f5", border: "1px solid #f0e8de", borderRadius: 8, padding: "10px 14px", marginTop: 14 }}>
          <div style={{ fontSize: "10px", fontWeight: "700", color: "#b0a090", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>Merge tags — click to insert</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["{{firstName}}", "{{lastName}}", "{{bookingLink}}"].map((tag) => (
              <span key={tag} onClick={() => {
                if (channel === "sms") setEditedSms((s) => s + " " + tag);
                else setEditedBody((s) => s + " " + tag);
              }} style={{ fontSize: "11px", fontWeight: "600", color: "#7a5640", background: "#f5ede4", padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button style={S.btn()} onClick={onClose}>Cancel</button>
          {channel === "email" && gmail.isConnected && !gmailSent && (
            <div style={{ marginBottom: 8 }}>
              {gmailError && <div style={{ fontSize: "11px", color: "#dc2626", marginBottom: 6 }}>⚠️ {gmailError}</div>}
              <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", background: "linear-gradient(135deg,#4285f4,#1a73e8)" }}
                onClick={handleSendGmail} disabled={gmailSending || !client.email}>
                {gmailSending ? "Sending…" : `📧 Send via Gmail to ${client.email || "no email on file"}`}
              </button>
              <div style={{ fontSize: "10px", color: "#b0a090", marginTop: 4, textAlign: "center" }}>Sending as {gmail.gmailUser}</div>
            </div>
          )}
          {gmailSent && (
            <div style={{ fontSize: "12px", color: "#065f46", background: "#d1fae5", padding: "8px 12px", borderRadius: 8, marginBottom: 8, fontWeight: "600" }}>
              ✓ Sent via Gmail — logged automatically
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={S.btn()} onClick={onClose}>Cancel</button>
            <button style={S.btn("primary")} onClick={() => { doLog(); onClose(); }}>
              {channel === "email" && gmail.isConnected ? "Log only" : `Send ${channel === "sms" ? "Text" : "Email"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PULSE PAGE ───────────────────────────────────────────────────────────────
function PulsePage({ clients, templates, onGoToClient, onUpdateClient }) {
  const [groupTab, setGroupTab] = useState("lapsed");
  const [selected, setSelected] = useState(new Set());
  const [showGroupTpl, setShowGroupTpl] = useState(false);
  const [groupTplKey, setGroupTplKey] = useState("rebooking");
  const [composer, setComposer] = useState(null); // { client, triggerId }

  const lapsed = clients
    .filter((c) => {
      const { layer1 } = clientStatus(c);
      return layer1 === "lapsed" && !(c.appointments || []).some((a) => a.date >= TODAY && a.status !== "cancelled");
    })
    .sort((a, b) => (daysSince(lastCompletedDate(b)) || 0) - (daysSince(lastCompletedDate(a)) || 0));

  const overdue = clients
    .filter((c) => {
      const { layer2 } = clientStatus(c);
      return (layer2 === "overdue" || layer2 === "overdue-with-package") &&
        !(c.appointments || []).some((a) => a.date >= TODAY && a.status !== "cancelled");
    })
    .sort((a, b) => (daysSince(lastCompletedDate(b)) || 0) - (daysSince(lastCompletedDate(a)) || 0));

  const now2 = new Date();
  const in14 = new Date(now2.getTime() + 14 * 86400000);
  const birthdays = clients.filter((c) => {
    if (!c.birthday) return false;
    const bm = +c.birthday.slice(5, 7) - 1;
    const bd = +c.birthday.slice(8, 10);
    const bDate = new Date(now2.getFullYear(), bm, bd);
    if (bDate < new Date(now2.getFullYear(), now2.getMonth(), now2.getDate())) {
      bDate.setFullYear(now2.getFullYear() + 1);
    }
    return bDate <= in14;
  });

  const groupMap = { lapsed, overdue, birthdays };
  const activeGroup = groupMap[groupTab] || [];
  const allSelected = activeGroup.length > 0 && activeGroup.every((c) => selected.has(c.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(activeGroup.map((c) => c.id)));

  const toggleOne = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selectedClients = activeGroup.filter((c) => selected.has(c.id));
  const tpl = templates[groupTplKey];
  const previewText = tpl && selectedClients[0] ? fillTemplate(tpl.sms, selectedClients[0]) : "";

  const groupTabs = [
    { key: "lapsed",    label: `Lapsed (${lapsed.length})`      },
    { key: "overdue",   label: `Overdue (${overdue.length})`     },
    { key: "birthdays", label: `Birthdays (${birthdays.length})` },
  ];

  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "21px", fontWeight: "800", color: "#1a120b" }}>Client Pulse</h2>
      <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#8a7a6a" }}>
        Clients that need your personal attention today.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {groupTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setGroupTab(t.key); setSelected(new Set()); }}
            style={{
              fontSize: "12px", padding: "6px 14px", borderRadius: "100px",
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: "700",
              border: groupTab === t.key ? "1px solid #d4bfaa" : "1px solid #e8e0d6",
              background: groupTab === t.key ? "#f5ede4" : "transparent",
              color: groupTab === t.key ? "#7a5640" : "#8a7a6a",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeGroup.length > 0 && (
        <div style={{ ...S.card, marginBottom: 14, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                style={{ width: 14, height: 14, accentColor: "#a0785a", cursor: "pointer" }}
              />
              {allSelected ? "Deselect all" : "Select all"} ({activeGroup.length})
            </label>
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: "12px", color: "#8a7a6a" }}>{selected.size} selected</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={groupTplKey}
                    onChange={(e) => setGroupTplKey(e.target.value)}
                    style={{ ...S.inp, width: "auto", fontSize: "12px", padding: "5px 10px" }}
                  >
                    {Object.entries(templates).map(([k, t]) => (
                      <option key={k} value={k}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                  <button style={S.sm("primary")} onClick={() => setShowGroupTpl(true)}>
                    Preview message
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showGroupTpl && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowGroupTpl(false); }}
        >
          <div className="cp-modal" style={{ ...S.card, width: 500, maxWidth: "100vw", maxHeight: "92vh", overflowY: "auto", animation: "fadeUp 0.15s ease", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: "15px", fontWeight: "800", color: "#1a120b" }}>
                Group outreach — {tpl?.label}
              </div>
              <button
                onClick={() => setShowGroupTpl(false)}
                style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#8a7a6a", lineHeight: 1 }}
              >×</button>
            </div>
            <div style={{ marginBottom: 12, fontSize: "12px", color: "#8a7a6a" }}>
              Sending to <strong style={{ color: "#2e2418" }}>{selectedClients.length} clients</strong>: {selectedClients.map((c) => c.firstName).join(", ")}
            </div>
            <label style={S.lbl}>Message preview (first client)</label>
            <div style={{ ...S.inp, minHeight: 80, whiteSpace: "pre-wrap", lineHeight: "1.6", color: "#2e2418", marginBottom: 14 }}>
              {previewText}
            </div>
            <div style={{ background: "#fff8f0", border: "1px solid #f0e0c8", borderRadius: "10px", padding: "10px 12px", fontSize: "12px", color: "#92400e", marginBottom: 16 }}>
              Copy and send individually via Vagaro, your texting app, or email. Each message will be personalized.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {selectedClients.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "#faf8f5", borderRadius: "8px", border: "1px solid #f0e8de" }}>
                  <Avatar client={c} size={26} />
                  <span style={{ fontSize: "13px", fontWeight: "600", flex: 1 }}>{fullName(c)}</span>
                  <span style={{ fontSize: "11px", color: "#8a7a6a" }}>{c.phone || c.email}</span>
                </div>
              ))}
            </div>
            <button style={S.btn("ghost")} onClick={() => setShowGroupTpl(false)}>Close</button>
          </div>
        </div>
      )}

      <div style={S.card}>
        <label style={S.lbl}>{activeGroup.length} clients</label>
        {activeGroup.length === 0 ? (
          <p style={{ margin: 0, fontSize: "13px", color: "#b0a090" }}>None in this group right now.</p>
        ) : (
          activeGroup.map((c, i) => {
            const ds = daysSince(lastCompletedDate(c));
            const ivl = c.avgVisitIntervalDays || 30;
            return (
              <div key={c.id} style={{ display: "flex", gap: "12px", alignItems: "center", padding: "12px 0", borderBottom: i < activeGroup.length - 1 ? "1px solid #f0e8de" : "none" }}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleOne(c.id)}
                  style={{ width: 14, height: 14, accentColor: "#a0785a", cursor: "pointer", flexShrink: 0 }}
                />
                <Avatar client={c} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>{fullName(c)}</span>
                    <StatusPill client={c} />
                    {(c.tags || []).slice(0, 2).map((t) => <TagChip key={t} label={t} />)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8a7a6a" }}>
                    Last visit {ds ? `${ds}d ago` : "—"} · usual interval {ivl}d
                  </div>

                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {(groupTab === "lapsed" || groupTab === "overdue") && (
                    <button style={{ ...S.sm("primary"), fontSize: "11px" }}
                      onClick={(e) => { e.stopPropagation(); setComposer({ client: c, triggerId: groupTab === "lapsed" ? "lapsed" : "rebooking" }); }}>
                      💬 Reach out
                    </button>
                  )}
                  {groupTab === "birthdays" && (
                    <button style={{ ...S.sm("primary"), fontSize: "11px", background: "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", color: "#fff" }}
                      onClick={(e) => { e.stopPropagation(); setComposer({ client: c, triggerId: "birthday" }); }}>
                      🎂 Send offer
                    </button>
                  )}
                  <button style={S.sm("ghost")} onClick={() => onGoToClient(c.id)}>View</button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {composer && (
        <OutreachComposer
          client={composer.client}
          triggerId={composer.triggerId}
          templates={templates}
          onLog={(entry) => {
            if (onUpdateClient) {
              const c = composer.client;
              const newHistory = [...(c.history || []), mkEvent("comm.text", entry.notes, { by: entry.createdBy })];
              onUpdateClient(c.id, { history: newHistory });
            }
          }}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  );
}


// ─── TEMPLATES PAGE ───────────────────────────────────────────────────────────
function TemplatesPage({ templates, onSave, embedded = false }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);

  const startEdit = (key) => {
    setEditing(key);
    setForm(JSON.parse(JSON.stringify(templates[key])));
  };
  const save = () => { onSave(editing, form); setEditing(null); };

  const content = (
    <div>
      <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#8a7a6a" }}>
        Use <code style={{ background: "#f5ede4", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>{"{{firstName}}"}</code> and{" "}
        <code style={{ background: "#f5ede4", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>{"{{bookingLink}}"}</code> as placeholders.
      </p>
      {Object.entries(templates).map(([key, tpl]) => (
        <div key={key} style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: editing === key ? 14 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>{tpl.icon}</span>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#1a120b" }}>{tpl.label}</div>
            </div>
            {editing === key
              ? <div style={{ display: "flex", gap: 6 }}>
                  <button style={S.sm("ghost")} onClick={() => setEditing(null)}>Cancel</button>
                  <button style={S.sm("primary")} onClick={save}>Save</button>
                </div>
              : <button style={S.sm("ghost")} onClick={() => startEdit(key)}>Edit</button>
            }
          </div>
          {editing === key && form ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={S.lbl}>SMS / Text</label>
                <textarea value={form.sms || ""} onChange={(e) => setForm((f) => ({ ...f, sms: e.target.value }))}
                  style={{ ...S.inp, minHeight: 80, resize: "vertical", lineHeight: "1.6" }} />
                <div style={{ fontSize: "11px", color: form.sms?.length > 160 ? "#c0392b" : "#b0a090", marginTop: 4 }}>
                  {form.sms?.length || 0}/160 chars
                </div>
              </div>
              <div>
                <label style={S.lbl}>Email subject</label>
                <input value={form.email?.subject || ""} onChange={(e) => setForm((f) => ({ ...f, email: { ...f.email, subject: e.target.value } }))} style={S.inp} />
              </div>
              <div>
                <label style={S.lbl}>Email body</label>
                <textarea value={form.email?.body || ""} onChange={(e) => setForm((f) => ({ ...f, email: { ...f.email, body: e.target.value } }))}
                  style={{ ...S.inp, minHeight: 140, resize: "vertical", lineHeight: "1.7" }} />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "#b0a090", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>SMS preview</div>
              <div style={{ fontSize: "13px", color: "#7a6a5a", background: "#faf8f5", borderRadius: 8, padding: "8px 12px", lineHeight: "1.55", whiteSpace: "pre-wrap" }}>
                {tpl.sms}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (embedded) return content;
  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: 700 }}>
      <h2 style={{ margin: "0 0 16px", fontSize: "21px", fontWeight: "800", color: "#1a120b" }}>Message templates</h2>
      {content}
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
// ─── STAFF MANAGER ────────────────────────────────────────────────────────────
function StaffManager({ supabaseUrl, supabaseAnonKey, usingDB }) {
  const [staffList, setStaffList]   = useState([]);
  const [loading,   setLoading]     = useState(false);
  const [showInvite,setShowInvite]  = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName,  setInviteName]  = useState("");
  const [inviteRole,  setInviteRole]  = useState("staff");
  const [inviting,  setInviting]    = useState(false);
  const [inviteMsg, setInviteMsg]   = useState(null);
  const [error,     setError]       = useState(null);
  const [resetSent, setResetSent]   = useState({});
  const [editingId, setEditingId]   = useState(null);
  const [editDraft, setEditDraft]   = useState({});

  const sb = () => getSB(supabaseUrl, supabaseAnonKey);

  const loadStaff = async () => {
    if (!usingDB) return;
    setLoading(true);
    try {
      // Get staff profiles
      const { data: staffRows, error: sErr } = await sb().from("staff").select("*").order("created_at");
      if (sErr) throw sErr;

      // Get auth users via admin — note: anon key can't list users
      // So we just show the staff table which has what we need
      setStaffList(staffRows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStaff(); }, [usingDB]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    setInviting(true); setInviteMsg(null); setError(null);
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/staff-invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          full_name: inviteName.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      setInviteMsg(`Invite sent to ${inviteEmail.trim()} — they'll receive an email with a link to join.`);
      setInviteEmail(""); setInviteName(""); setInviteRole("staff");
      loadStaff();
    } catch (e) {
      setError(e.message || "Failed to invite staff member");
    } finally {
      setInviting(false);
    }
  };

  const updateRole = async (id, role) => {
    try {
      await sb().from("staff").update({ role }).eq("id", id);
      setStaffList((s) => s.map((m) => m.id === id ? { ...m, role } : m));
    } catch (e) { setError(e.message); }
  };

  const toggleActive = async (id, active) => {
    try {
      await sb().from("staff").update({ active: !active }).eq("id", id);
      setStaffList((s) => s.map((m) => m.id === id ? { ...m, active: !active } : m));
    } catch (e) { setError(e.message); }
  };

  const sendReset = async (id, email) => {
    if (!email) return;
    try {
      const { error: err } = await sb().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (err) throw err;
      setResetSent((s) => ({ ...s, [id]: true }));
      setTimeout(() => setResetSent((s) => { const n = { ...s }; delete n[id]; return n; }), 4000);
    } catch (e) { setError(e.message); }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const { error: err } = await sb().from("staff").update({ full_name: editDraft.full_name, email: editDraft.email }).eq("id", editingId);
      if (err) throw err;
      setStaffList((s) => s.map((m) => m.id === editingId ? { ...m, ...editDraft } : m));
      setEditingId(null);
    } catch (e) { setError(e.message); }
  };

  const ROLES = ["admin", "manager", "staff"];
  const ROLE_COLORS = { admin: { bg: "#fee2e2", color: "#991b1b" }, manager: { bg: "#fef3c7", color: "#92400e" }, staff: { bg: "#dbeafe", color: "#1d5fa8" } };

  return (
    <div>
      {!usingDB && (
        <div style={{ ...S.card, background: "#fef3c7", border: "1px solid #f0d090", marginBottom: 14 }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#92400e" }}>⚠️ Database required</div>
          <div style={{ fontSize: "12px", color: "#92400e", marginTop: 4 }}>Connect Supabase in the Database tab first to manage staff.</div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: "12px", color: "#dc2626", background: "#fee2e2", padding: "8px 12px", borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Current staff */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <label style={{ ...S.lbl, marginBottom: 0 }}>Staff members</label>
          <button style={S.sm("primary")} onClick={() => setShowInvite((s) => !s)}>
            {showInvite ? "Cancel" : "+ Invite staff"}
          </button>
        </div>

        {loading ? (
          <div style={{ fontSize: "13px", color: "#b0a090" }}>Loading…</div>
        ) : staffList.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#b0a090" }}>No staff found. Invite your first team member below.</div>
        ) : (
          staffList.map((member) => (
            <React.Fragment key={member.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: editingId === member.id ? "none" : "1px solid #f0e8de" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: member.active ? "linear-gradient(135deg,#a0785a,#7a5640)" : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "800", color: member.active ? "#fff" : "#9ca3af", flexShrink: 0 }}>
                  {(member.full_name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: member.active ? "#1a120b" : "#9ca3af" }}>
                    {member.full_name || "Unnamed"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: 1 }}>
                    {member.email ? member.email : (member.active ? "Active" : "Deactivated")}
                    {member.email && !member.active && " · Deactivated"}
                  </div>
                </div>
                <select
                  value={member.role || "staff"}
                  onChange={(e) => updateRole(member.id, e.target.value)}
                  disabled={!member.active}
                  style={{ fontSize: "11px", fontWeight: "700", color: ROLE_COLORS[member.role]?.color || "#1d5fa8", background: ROLE_COLORS[member.role]?.bg || "#dbeafe", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
                <button
                  onClick={() => { if (editingId === member.id) { setEditingId(null); } else { setEditingId(member.id); setEditDraft({ full_name: member.full_name || "", email: member.email || "" }); } }}
                  style={{ fontSize: "11px", fontWeight: "700", color: editingId === member.id ? "#8a7a6a" : "#6b5244", background: editingId === member.id ? "#f0e8de" : "#f5ede4", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  {editingId === member.id ? "Cancel" : "Edit"}
                </button>
                {member.email && member.active && (
                  <button
                    onClick={() => sendReset(member.id, member.email)}
                    style={{ fontSize: "11px", fontWeight: "700", color: resetSent[member.id] ? "#065f46" : "#6b5244", background: resetSent[member.id] ? "#d1fae5" : "#f5ede4", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap" }}>
                    {resetSent[member.id] ? "Sent!" : "Reset pw"}
                  </button>
                )}
                <button
                  onClick={() => toggleActive(member.id, member.active)}
                  style={{ fontSize: "11px", fontWeight: "700", color: member.active ? "#dc2626" : "#065f46", background: member.active ? "#fee2e2" : "#d1fae5", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  {member.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
              {editingId === member.id && (
                <div style={{ padding: "12px 0 14px 48px", borderBottom: "1px solid #f0e8de" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 4 }}>Full name</label>
                      <input
                        value={editDraft.full_name}
                        onChange={(e) => setEditDraft((d) => ({ ...d, full_name: e.target.value }))}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e8e0d6", fontSize: "13px", fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 4 }}>Email</label>
                      <input
                        type="email"
                        value={editDraft.email}
                        onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e8e0d6", fontSize: "13px", fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <button
                    onClick={saveEdit}
                    disabled={!editDraft.full_name.trim()}
                    style={{ fontSize: "12px", fontWeight: "700", color: "#fff", background: "linear-gradient(135deg,#a0785a,#7a5640)", border: "none", borderRadius: 8, padding: "7px 18px", cursor: editDraft.full_name.trim() ? "pointer" : "not-allowed", opacity: editDraft.full_name.trim() ? 1 : 0.5, fontFamily: "'DM Sans',sans-serif" }}>
                    Save changes
                  </button>
                </div>
              )}
            </React.Fragment>
          ))
        )}
      </div>

      {/* Invite form */}
      {showInvite && (
        <div style={{ ...S.card, marginBottom: 14, border: "1px solid #e8d5c0", background: "#fdf9f5" }}>
          <label style={S.lbl}>Invite a staff member</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={S.lbl}>Full name</label>
              <input value={inviteName} onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Smith" style={S.inp} />
            </div>
            <div>
              <label style={S.lbl}>Email</label>
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="jane@rctmassage.com" style={S.inp} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.lbl}>Role</label>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={S.inp}>
              <option value="staff">Staff — can log communications, view clients</option>
              <option value="manager">Manager — can edit clients, manage outreach</option>
              <option value="admin">Admin — full access including settings</option>
            </select>
          </div>
          {inviteMsg && (
            <div style={{ fontSize: "12px", color: "#065f46", background: "#d1fae5", padding: "8px 12px", borderRadius: 8, marginBottom: 10 }}>
              {inviteMsg}
            </div>
          )}
          <div style={{ fontSize: "11px", color: "#8a7a6a", marginBottom: 12, background: "#f5f0e8", padding: "8px 12px", borderRadius: 8 }}>
            They'll receive an invitation email with a sign-in link. Once they click it, they can set their password and log in.
          </div>
          <button style={{ ...S.btn("primary"), opacity: (inviteEmail.trim() && inviteName.trim()) ? 1 : 0.5 }}
            onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !inviteName.trim()}>
            {inviting ? "Sending invite…" : "Send invite"}
          </button>
        </div>
      )}
    </div>
  );
}

function VagaroSyncCard({ supabaseUrl }) {
  const [syncing, setSyncing]   = useState(false);
  const [result,  setResult]    = useState(null);

  const runSync = async () => {
    if (!supabaseUrl) { setResult({ error: "Connect to Supabase first (Database tab)." }); return; }
    setSyncing(true);
    setResult(null);
    const data = await syncVagaroClients(supabaseUrl);
    setResult(data);
    setSyncing(false);
  };

  return (
    <div style={{ ...S.card, marginBottom: "14px" }}>
      <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Sync Vagaro IDs</div>
      <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 14 }}>
        Fetches all customers from Vagaro, matches them to your existing clients by name, and links their Vagaro IDs.
        Run this once to connect your imported clients to live webhook data.
      </div>
      <button style={S.btn("primary")} onClick={runSync} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync all clients from Vagaro"}
      </button>
      {result && (
        <div style={{ marginTop: 14, fontSize: "12px", borderRadius: 10, padding: "12px 14px",
          background: result.error ? "#fee2e2" : "#dcf5ec",
          border: `1px solid ${result.error ? "#fca5a5" : "#86efac"}`,
          color: result.error ? "#991b1b" : "#065f46", lineHeight: 1.7 }}>
          {result.error ? (
            <>⚠️ {result.error}</>
          ) : (<>
            <strong>✓ Sync complete</strong><br />
            {result.matched} of {result.total} Vagaro customers linked to ClientPulse profiles.<br />
            {result.unmatched > 0 && <>
              {result.unmatched} unmatched (not in ClientPulse or different name).
              {result.unmatchedSample?.length > 0 && <> First few: {result.unmatchedSample.join(", ")}.</>}
            </>}
          </>)}
        </div>
      )}
    </div>
  );
}

// ─── DUPLICATE MERGE MODAL ───────────────────────────────────────────────────
function DuplicateMergeModal({ clients, supabaseUrl, onMerged, onClose }) {
  const groups = useMemo(() => findDuplicates(clients), [clients]);
  const bestPrimary = (g) => g.clients.find((c) => c.vagaroId)?.id ?? g.clients[0].id;
  const [primaryMap, setPrimaryMap] = useState(() => Object.fromEntries(groups.map((g, i) => [i, bestPrimary(g)])));
  const [merging, setMerging] = useState(null);
  const [resolved, setResolved] = useState(new Set());
  const [error, setError] = useState(null);

  const handleMerge = async (idx) => {
    const group = groups[idx];
    const primaryId = primaryMap[idx];
    const dupIds = group.clients.filter((c) => c.id !== primaryId).map((c) => c.id);
    setMerging(idx); setError(null);
    try {
      for (const dupId of dupIds) {
        const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/merge-clients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryId, duplicateId: dupId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Merge failed");
        onMerged(primaryId, dupId, data.merged);
      }
      setResolved((r) => new Set([...r, idx]));
    } catch (e) { setError(e.message); }
    setMerging(null);
  };

  const pending = groups.filter((_, i) => !resolved.has(i));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(46,36,24,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 600, padding: "24px 16px", overflowY: "auto" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...S.card, width: 660, maxWidth: "100%", animation: "fadeUp 0.15s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: "17px", fontWeight: "800", color: "#1a120b" }}>Duplicate Clients</div>
            <div style={{ fontSize: "12px", color: "#8a7a6a", marginTop: 2 }}>
              {pending.length > 0 ? `${pending.length} group${pending.length !== 1 ? "s" : ""} found — click a card to choose which record to keep` : "All duplicates resolved"}
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.sm("ghost"), fontSize: "17px", padding: "4px 10px" }}>✕</button>
        </div>

        {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: "12px", color: "#991b1b" }}>{error}</div>}

        {pending.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#0f7a4a", fontWeight: "700", fontSize: "14px" }}>✓ No duplicates found</div>
        )}

        {groups.map((group, i) => {
          if (resolved.has(i)) return null;
          const primaryId = primaryMap[i];
          const firstReasons = Object.values(group.reasons)[0] ?? [];
          const reasonLabel = firstReasons.map((r) => `Same ${r}`).join(" · ");
          return (
            <div key={i} style={{ border: "1px solid #e8e0d6", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#a0785a", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>{reasonLabel || "Possible duplicate"}</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${group.clients.length}, 1fr)`, gap: 10, marginBottom: 12 }}>
                {group.clients.map((c) => {
                  const isPrimary = c.id === primaryId;
                  return (
                    <div key={c.id} onClick={() => setPrimaryMap((m) => ({ ...m, [i]: c.id }))} style={{
                      border: `2px solid ${isPrimary ? "#a0785a" : "#e8e0d6"}`,
                      borderRadius: 10, padding: 12, cursor: "pointer",
                      background: isPrimary ? "#fdf6ef" : "#faf8f5", transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ fontSize: "14px", fontWeight: "800", color: "#1a120b" }}>{c.firstName} {c.lastName}</div>
                        {isPrimary && <span style={{ fontSize: "9px", fontWeight: "800", color: "#7a5640", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 4, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "1px", whiteSpace: "nowrap" }}>Keep</span>}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b5244", lineHeight: 1.8 }}>
                        {c.email    && <div>{c.email}</div>}
                        {c.phone    && <div>{c.phone}</div>}
                        {c.lastVisit && <div style={{ color: "#8a7a6a" }}>Last visit: {c.lastVisit}</div>}
                        {c.vagaroId  ? <div style={{ color: "#a0785a" }}>Vagaro linked</div> : <div style={{ color: "#b0a090" }}>No Vagaro ID</div>}
                        {c.totalSpent > 0 && <div style={{ color: "#0f7a4a" }}>${c.totalSpent.toFixed(2)} spent</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => handleMerge(i)} disabled={merging === i} style={{ ...S.btn("primary"), fontSize: "12px" }}>
                  {merging === i ? "Merging…" : "Merge — keep selected"}
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button onClick={onClose} style={S.btn("ghost")}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── TRANSACTION CSV IMPORT ──────────────────────────────────────────────────

function parseCSVLine(line) {
  const cols = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { cols.push(cur); cur = ""; }
    else { cur += line[i]; }
  }
  cols.push(cur);
  return cols;
}

function parseMoney(v) {
  if (!v || v === "-" || v.trim() === "") return 0;
  return parseFloat(v.replace(/[$,\s]/g, "")) || 0;
}

function parseVagaroDate(v) {
  if (!v || !v.trim()) return null;
  const s = v.trim();
  // "May 21, 2026 - 8:24 AM" (Vagaro CSV export format)
  const longMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (longMatch) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const m = months[longMatch[1].toLowerCase().slice(0, 3)];
    if (m) return `${longMatch[3]}-${String(m).padStart(2,"0")}-${longMatch[2].padStart(2,"0")}`;
  }
  // M/D/YYYY or MM/DD/YYYY
  const slashParts = s.split("/");
  if (slashParts.length === 3) {
    const [m, d, y] = slashParts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Last resort: native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toLocaleDateString("en-CA");
  return null;
}

function parseVagaroTransactionCSV(text) {
  // Strip Excel BOM (U+FEFF) and normalize line endings
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());
  const idx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const COL = {
    checkoutDate:   idx("Checkout Date"),
    checkedOutBy:   idx("CheckedOut By"),
    transactionId:  idx("Transaction ID"),
    customer:       idx("Customer"),
    itemSold:       idx("Service/Product/GC/Package/Membership/Class"),
    txType:         idx("Transaction Type"),
    provider:       idx("Service Provider"),
    qty:            idx("Qty"),
    tax:            idx("Tax"),
    tip:            idx("Tip"),
    disc:           idx("Disc"),
    cash:           idx("Cash"),
    check:          idx("Check"),
    gcRedeem:       idx("GC redeem"),
    pkg:            idx("Pkg"),
    mbsp:           idx("Mbsp"),
    cc:             idx("CC"),
    bank:           idx("BankAccount"),
    vpl:            idx("Buy Now, Pay Later"),
    other:          idx("OtherAmount"),
  };

  const get = (cols, i) => (i >= 0 && i < cols.length ? cols[i]?.trim() ?? "" : "");

  return lines.slice(1).map(line => {
    const c = parseCSVLine(line);
    const customerRaw = get(c, COL.customer);
    let firstName = "", lastName = "";
    if (customerRaw.includes(", ")) {
      [lastName, firstName] = customerRaw.split(", ");
    } else {
      const parts = customerRaw.split(" ");
      firstName = parts.slice(0, -1).join(" ");
      lastName  = parts[parts.length - 1] || "";
    }
    const checkoutDateRaw = get(c, COL.checkoutDate);
    return {
      checkoutDate:     parseVagaroDate(checkoutDateRaw),
      checkoutDateRaw,
      checkedOutBy:  get(c, COL.checkedOutBy),
      transactionId: get(c, COL.transactionId),
      customerRaw,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      itemSold:  get(c, COL.itemSold),
      txType:    get(c, COL.txType),
      provider:  get(c, COL.provider),
      qty:       parseInt(get(c, COL.qty)) || 1,
      tax:       parseMoney(get(c, COL.tax)),
      tip:       parseMoney(get(c, COL.tip)),
      disc:      parseMoney(get(c, COL.disc)),
      cash:      parseMoney(get(c, COL.cash)),
      check:     parseMoney(get(c, COL.check)),
      gcRedeem:  parseMoney(get(c, COL.gcRedeem)),
      pkg:       parseMoney(get(c, COL.pkg)),
      mbsp:      parseMoney(get(c, COL.mbsp)),
      cc:        parseMoney(get(c, COL.cc)),
      bank:      parseMoney(get(c, COL.bank)),
      vpl:       parseMoney(get(c, COL.vpl)),
      other:     parseMoney(get(c, COL.other)),
    };
  }).filter(r => r.itemSold || r.transactionId);
}

function TransactionCSVImport({ supabaseUrl, supabaseAnonKey }) {
  const [rows,      setRows]      = useState(null);
  const [importing, setImporting] = useState(false);
  const [result,    setResult]    = useState(null);
  const [progress,  setProgress]  = useState(0);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setRows(parseVagaroTransactionCSV(ev.target.result));
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!rows?.length) return;
    setImporting(true);
    setProgress(0);
    const sb = getSB(supabaseUrl, supabaseAnonKey);

    const { data: clients } = await sb.from("clients").select("id,first_name,last_name");
    const nameMap = {};
    for (const c of clients || []) {
      const key = `${(c.first_name || "").toLowerCase().trim()} ${(c.last_name || "").toLowerCase().trim()}`;
      nameMap[key] = c.id;
    }

    let imported = 0, skipped = 0, matched = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      setProgress(Math.round((i / rows.length) * 100));

      // Dedup check — update missing fields on existing rows
      if (r.transactionId && r.itemSold) {
        const { data: ex } = await sb.from("transactions")
          .select("id, transaction_date, client_id")
          .eq("vagaro_transaction_id", r.transactionId)
          .eq("item_sold", r.itemSold)
          .maybeSingle();
        if (ex) {
          const patch = {};
          if (!ex.transaction_date && r.checkoutDate) patch.transaction_date = r.checkoutDate + "T12:00:00Z";
          const nameKey2 = `${r.firstName.toLowerCase()} ${r.lastName.toLowerCase()}`;
          const cId = nameMap[nameKey2] || null;
          if (!ex.client_id && cId) patch.client_id = cId;
          if (Object.keys(patch).length > 0) await sb.from("transactions").update(patch).eq("id", ex.id);
          skipped++;
          continue;
        }
      }

      const nameKey = `${r.firstName.toLowerCase()} ${r.lastName.toLowerCase()}`;
      const clientId = nameMap[nameKey] || null;
      if (clientId) matched++;

      const { error } = await sb.from("transactions").insert({
        vagaro_transaction_id:     r.transactionId  || null,
        vagaro_customer_id:        r.customerRaw    || null,
        vagaro_service_provider_id: r.provider      || null,
        client_id:                 clientId,
        transaction_date:          r.checkoutDate ? r.checkoutDate + "T12:00:00Z" : null,
        item_sold:                 r.itemSold       || null,
        purchase_type:             r.txType         || null,
        quantity:                  r.qty,
        tax:                       r.tax,
        tip:                       r.tip,
        discount:                  r.disc,
        cash_amount:               r.cash,
        check_amount:              r.check,
        gc_redemption:             r.gcRedeem,
        package_redemption:        r.pkg,
        membership_amount:         r.mbsp,
        cc_amount:                 r.cc,
        bank_account_amount:       r.bank,
        vagaro_pay_later_amount:   r.vpl,
        other_amount:              r.other,
        created_by:                r.checkedOutBy   || null,
      });
      if (!error) imported++;
    }

    setResult({ imported, skipped, matched, total: rows.length });
    setImporting(false);
    setRows(null);
  };

  return (
    <div style={{ ...S.card, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: rows ? 14 : 0 }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Import transaction history from Vagaro</div>
          <div style={{ fontSize: "12px", color: "#8a7a6a" }}>Vagaro → Reports → Deposit Report → Export</div>
        </div>
        <label style={{ ...S.btn("primary"), fontSize: "12px", whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}>
          {rows ? `${rows.length} rows loaded` : "Choose CSV"}
          <input type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {result && (
        <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "10px 14px", fontSize: "12px", color: "#065f46", marginBottom: rows ? 10 : 0 }}>
          ✓ Imported {result.imported} transactions ({result.matched} matched to clients, {result.skipped} duplicates skipped)
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 8 }}>
            Preview — first 3 rows of {rows.length}:
          </div>
          {rows[0]?.checkoutDateRaw === "" && (
            <div style={{ background: "#fff7ed", borderRadius: 8, padding: "8px 12px", fontSize: "11px", color: "#92400e", marginBottom: 8 }}>
              ⚠️ Date column not detected. Raw first-col sample: "{rows[0]?.checkoutDateRaw ?? "n/a"}"
            </div>
          )}
          <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #e8e0d6", marginBottom: 12 }}>
            {rows.slice(0, 3).map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px",
                background: i % 2 === 0 ? "#faf8f5" : "#fff", fontSize: "12px", borderBottom: i < 2 ? "1px solid #f0ece6" : "none" }}>
                <span style={{ color: "#2e2418", fontWeight: "600" }}>{r.customerRaw || "—"}</span>
                <span style={{ color: "#5a4a3a" }}>{r.itemSold || "—"}</span>
                <span style={{ color: "#0f7a4a", fontWeight: "700" }}>
                  ${(r.cc + r.cash + r.check + r.gcRedeem + r.pkg + r.mbsp + r.bank + r.vpl + r.other).toFixed(2)}
                </span>
                <span style={{ color: r.checkoutDate ? "#065f46" : "#dc2626", fontWeight: r.checkoutDate ? "400" : "700" }}>
                  {r.checkoutDate || (r.checkoutDateRaw ? `raw: ${r.checkoutDateRaw}` : "⚠️ no date col")}
                </span>
              </div>
            ))}
          </div>
          <button onClick={handleImport} disabled={importing} style={{ ...S.btn("primary"), fontSize: "12px" }}>
            {importing ? `Importing… ${progress}%` : `Import ${rows.length} transactions`}
          </button>
        </>
      )}
    </div>
  );
}

function SettingsPage({ clientId, setClientId, clientSecret, setClientSecret, vagaroRegion, setVagaroRegion, webhookLog, templates, onSaveTemplate, gmailClientId, setGmailClientId, supabaseUrl, setSupabaseUrl, supabaseAnonKey, setSupabaseAnonKey, usingDB, dbError, onAddClient, onFindDuplicates }) {
  const [activeTab, setActiveTab] = useState("database");
  const [showSecret, setShowSecret] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState(() => localStorage.getItem("cp_webhook_secret") || "");
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [liveWebhookLog, setLiveWebhookLog] = useState(null);
  const [webhookLogLoading, setWebhookLogLoading] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const gmail = useGmail(getGmailClientId());

  const [expandedWebhook, setExpandedWebhook] = useState(null);

  const webhookUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/vagaro-webhook` : null;

  const refreshWebhookLog = useCallback(async () => {
    if (!usingDB || !supabaseUrl || !supabaseAnonKey) return;
    setWebhookLogLoading(true);
    try {
      const sb = getSB(supabaseUrl, supabaseAnonKey);
      const { data } = await sb.from("webhook_log").select("*").order("received_at", { ascending: false }).limit(25);
      if (data) setLiveWebhookLog(data);
    } catch {}
    setWebhookLogLoading(false);
  }, [usingDB, supabaseUrl, supabaseAnonKey]);

  useEffect(() => { if (activeTab === "connection") refreshWebhookLog(); }, [activeTab, refreshWebhookLog]);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testVagaroConnection(supabaseUrl, vagaroRegion, clientId, clientSecret);
    setTestResult(result);
    setTesting(false);
  };

  const fmtWebhookTS = (iso) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });

  const webhookEvents = [
    { e: "Appointments",   d: "Booked, rescheduled, checked-in, completed, cancelled, no-show — auto-logged to client history" },
    { e: "Customers",      d: "Created or updated — profile change logged to history" },
    { e: "Transactions",   d: "Payments and refunds — logged to history with amount and method" },
    { e: "Employees",      d: "Created or updated — syncs staff roster" },
    { e: "Form Responses", d: "Intake completions — logged as a system note" },
  ];

  const thresholds = [
    { s: "new-client",          d: "First completed visit — onboarding phase" },
    { s: "regular",             d: "2+ visits, last check-in within 30 days" },
    { s: "package-holder",      d: "Active credits remaining, last visit ≤30 days" },
    { s: "overdue-with-package",d: "31–60 days since last visit — has unused package" },
    { s: "overdue",             d: "31–60 days since last visit, no package" },
    { s: "stale",               d: "61–90 days since last visit — pre-dormant" },
    { s: "past-client",         d: "90+ days since last visit, no upcoming appointment" },
    { s: "new",                 d: "Profile created, no outreach yet" },
    { s: "first-session-booked",d: "First appointment scheduled, not yet visited" },
  ];

  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: "680px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "21px", fontWeight: "800", color: "#1a120b" }}>Settings</h2>
      <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#8a7a6a" }}>Configure your integration and outreach templates.</p>

      {/* Tab strip */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #e8e0d6" }}>
        {[{ key: "database", label: "Database" }, { key: "connection", label: "Vagaro" }, { key: "gmail", label: "Gmail" }, { key: "staff", label: "Staff" }, { key: "templates", label: "Templates" }].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: "700",
            cursor: "pointer", background: "none", border: "none",
            fontFamily: "'DM Sans',sans-serif",
            borderBottom: activeTab === t.key ? "2px solid #a0785a" : "2px solid transparent",
            color: activeTab === t.key ? "#7a5640" : "#8a7a6a",
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === "database" && (
        <div>
          {/* Status */}
          <div style={{ ...S.card, marginBottom: 14, background: usingDB ? "#f0fdf4" : "#fefce8", border: `1px solid ${usingDB ? "#86efac" : "#fde68a"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: usingDB ? "#22c55e" : "#f59e0b", flexShrink: 0 }} />
              <div style={{ fontSize: "13px", fontWeight: "700", color: usingDB ? "#065f46" : "#92400e" }}>
                {usingDB ? "Connected to Supabase — data is live and persistent" : "Not connected — using local mock data"}
              </div>
            </div>
            {dbError && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: 8 }}>⚠️ {dbError}</div>}
          </div>

          {/* Credentials */}
          <div style={{ ...S.card, marginBottom: 14 }}>
            <label style={S.lbl}>Supabase Project URL</label>
            <input
              value={supabaseUrl}
              onChange={(e) => { setSupabaseUrl(e.target.value); localStorage.setItem("cp_sb_url", e.target.value); }}
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              style={{ ...S.inp, fontFamily: "monospace", fontSize: "12px", marginBottom: 12 }}
            />
            <label style={S.lbl}>Supabase Anon Key (public)</label>
            <input
              value={supabaseAnonKey}
              onChange={(e) => { setSupabaseAnonKey(e.target.value); localStorage.setItem("cp_sb_anon", e.target.value); }}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{ ...S.inp, fontFamily: "monospace", fontSize: "11px" }}
            />
            <div style={{ fontSize: "11px", color: "#b0a090", marginTop: 6 }}>
              Stored in your browser's localStorage. The anon key is safe to use client-side — it's controlled by your Row Level Security policies.
            </div>
          </div>

          {/* Seed data option */}
          {usingDB && (
            <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #86efac", marginBottom: 14 }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#065f46", marginBottom: 6 }}>✓ Database connected</div>
              <div style={{ fontSize: "12px", color: "#166534" }}>
                Client Pulse is loading and saving all data to Supabase. Changes persist across devices and browser refreshes.
              </div>
            </div>
          )}

          {usingDB && (
            <div style={{ ...S.card, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Duplicate clients</div>
                  <div style={{ fontSize: "12px", color: "#8a7a6a" }}>Find and merge clients that appear more than once</div>
                </div>
                <button onClick={onFindDuplicates} style={{ ...S.btn("ghost"), fontSize: "12px", whiteSpace: "nowrap", flexShrink: 0 }}>
                  Find duplicates
                </button>
              </div>
            </div>
          )}
          {usingDB && <TransactionCSVImport supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} />}
        </div>
      )}

      {activeTab === "connection" && (<>

      {showImport && (
        <CSVImportModal
          onImport={async (client) => { await onAddClient(client); }}
          onClose={() => setShowImport(false)}
          usingDB={usingDB}
        />
      )}

      {/* CSV Import */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Import clients from Vagaro</div>
            <div style={{ fontSize: "12px", color: "#8a7a6a" }}>Export from Vagaro: Reports → Customers → Action → Export Excel</div>
          </div>
          <button onClick={() => setShowImport(true)} style={{ ...S.btn("primary"), fontSize: "12px", whiteSpace: "nowrap", flexShrink: 0 }}>
            Import CSV
          </button>
        </div>
      </div>

      {/* API credentials */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Vagaro API credentials</div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 16 }}>
          Find these in Vagaro: <strong>Settings → Developers → APIs &amp; Webhooks</strong>
        </div>
        <label style={S.lbl}>Region</label>
        <input
          type="text"
          value={vagaroRegion}
          onChange={(e) => { setVagaroRegion(e.target.value); localStorage.setItem("cp_vagaro_region", e.target.value); }}
          placeholder="e.g. us04  (from your Vagaro URL subdomain)"
          style={{ ...S.inp, fontFamily: "monospace", marginBottom: 12 }}
        />
        <label style={S.lbl}>Client ID</label>
        <input
          type="text"
          value={clientId}
          onChange={(e) => { setClientId(e.target.value); localStorage.setItem("cp_vagaro_client_id", e.target.value); }}
          placeholder="Your Vagaro Client ID"
          style={{ ...S.inp, fontFamily: "monospace", marginBottom: 12 }}
        />
        <label style={S.lbl}>Client Secret Key</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type={showSecret ? "text" : "password"}
            value={clientSecret}
            onChange={(e) => { setClientSecret(e.target.value); localStorage.setItem("cp_vagaro_client_secret_key", e.target.value); }}
            placeholder="Your Vagaro Client Secret Key"
            style={{ ...S.inp, fontFamily: "monospace", flex: 1 }}
          />
          <button style={S.sm("ghost")} onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button style={S.btn("ghost")} onClick={testConnection} disabled={testing}>
            {testing ? "Testing..." : "Test connection"}
          </button>
          {testResult && (
            <span style={{ fontSize: "12px", fontWeight: "600", color: testResult.ok ? "#0f7a4a" : "#991b1b" }}>
              {testResult.ok ? "✓ Connected" : "✗ Failed"}: {testResult.msg}
            </span>
          )}
        </div>
      </div>

      {/* Vagaro ID sync */}
      <VagaroSyncCard supabaseUrl={supabaseUrl} />

      {/* Webhook receiver */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Webhook receiver</div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 16 }}>
          This is the URL you paste into Vagaro when creating a webhook.
          In Vagaro: <strong>Settings → Developers → APIs &amp; Webhooks → Create Webhook</strong>
        </div>

        {/* Webhook URL */}
        <label style={S.lbl}>Your webhook URL</label>
        {webhookUrl ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              readOnly
              value={webhookUrl}
              style={{ ...S.inp, fontFamily: "monospace", fontSize: "12px", flex: 1, color: "#1d5fa8", background: "#dbeafe", border: "1px solid #93c5fd" }}
            />
            <button
              style={S.sm(copiedWebhook ? "primary" : "ghost")}
              onClick={() => { navigator.clipboard.writeText(webhookUrl).catch(() => {}); setCopiedWebhook(true); setTimeout(() => setCopiedWebhook(false), 2000); }}
            >
              {copiedWebhook ? "Copied ✓" : "Copy"}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "#92400e", background: "#fef3c7", border: "1px solid #f0d090", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            ⚠️ Connect to Supabase first (Database tab) — the webhook URL is derived from your Supabase project URL.
          </div>
        )}

        {/* Webhook secret */}
        <label style={S.lbl}>Webhook secret <span style={{ fontWeight: 400, color: "#b0a090", textTransform: "none", letterSpacing: 0 }}>(optional but recommended)</span></label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type={showWebhookSecret ? "text" : "password"}
            value={webhookSecret}
            onChange={(e) => { setWebhookSecret(e.target.value); localStorage.setItem("cp_webhook_secret", e.target.value); }}
            placeholder="Any strong random string"
            style={{ ...S.inp, fontFamily: "monospace", flex: 1 }}
          />
          <button style={S.sm("ghost")} onClick={() => setShowWebhookSecret((s) => !s)}>
            {showWebhookSecret ? "Hide" : "Show"}
          </button>
          <button style={S.sm("ghost")} onClick={() => {
            const s = crypto.randomUUID().replace(/-/g, "");
            setWebhookSecret(s);
            localStorage.setItem("cp_webhook_secret", s);
            setShowWebhookSecret(true);
          }}>Generate</button>
        </div>
        {webhookSecret && (
          <div style={{ fontSize: "12px", color: "#8a7a6a", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 10, padding: "10px 14px", marginBottom: 16, lineHeight: 1.6 }}>
            Enter this value in Vagaro when creating the webhook (Header: <code style={{ fontFamily: "monospace" }}>x-webhook-secret</code>).
          </div>
        )}

        {/* Events handled */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#2e2418", marginBottom: 8 }}>Events handled automatically</div>
          {webhookEvents.map((w, i) => (
            <div key={w.e} style={{ display: "flex", gap: "10px", padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid #f0e8de" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#a0785a", marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#2e2418" }}>{w.e}</div>
                <div style={{ fontSize: "11px", color: "#8a7a6a" }}>{w.d}</div>
              </div>
            </div>
          ))}
          <div style={{ background: "#fff8f0", border: "1px solid #f0e0c8", borderRadius: "10px", padding: "10px 14px", marginTop: 12, fontSize: "12px", color: "#92400e", lineHeight: "1.5" }}>
            Webhooks require the <strong>APIs &amp; Webhooks add-on</strong> ($10/mo). Contact Vagaro Enterprise to enable.
          </div>
        </div>
      </div>

      {/* Live webhook log */}
      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418" }}>Recent webhook events</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {liveWebhookLog && <span style={{ fontSize: "10px", fontWeight: "700", color: "#0f7a4a", background: "#dcf5ec", padding: "2px 8px", borderRadius: 100 }}>Live</span>}
            {!liveWebhookLog && !usingDB && <span style={{ fontSize: "11px", color: "#b0a090" }}>Connect DB to see live events</span>}
            {usingDB && (
              <button style={S.sm("ghost")} onClick={refreshWebhookLog} disabled={webhookLogLoading}>
                {webhookLogLoading ? "Loading…" : "Refresh"}
              </button>
            )}
          </div>
        </div>
        {(liveWebhookLog || webhookLog).length === 0 ? (
          <div style={{ fontSize: "13px", color: "#b0a090", textAlign: "center", padding: "24px 0" }}>No webhook events received yet.</div>
        ) : (liveWebhookLog || webhookLog).map((ev, i, arr) => {
          const isLive    = !!liveWebhookLog;
          const event     = isLive ? ev.event_type : ev.event;
          const time      = isLive ? ev.received_at : ev.time;
          const detail    = isLive ? (ev.payload ? JSON.stringify(ev.payload).slice(0, 80) : "—") : `${ev.client} · ${ev.detail}`;
          const hasErr    = isLive && ev.error;
          const expanded  = expandedWebhook === ev.id;
          const canExpand = isLive && ev.payload;
          return (
            <div key={ev.id} style={{ borderBottom: i < arr.length - 1 ? "1px solid #f0e8de" : "none" }}>
              <div
                onClick={() => canExpand && setExpandedWebhook(expanded ? null : ev.id)}
                style={{ display: "flex", gap: "10px", padding: "9px 0", cursor: canExpand ? "pointer" : "default" }}
              >
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: hasErr ? "#991b1b" : "#0f7a4a", marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#7a5640", fontWeight: "700" }}>{event}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", color: "#b0a090" }}>{fmtWebhookTS(time)}</span>
                      {canExpand && <span style={{ fontSize: "10px", color: "#a0785a" }}>{expanded ? "▲" : "▼"}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: hasErr ? "#991b1b" : "#7a6a5a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {hasErr ? `Error: ${ev.error}` : detail}
                  </div>
                </div>
              </div>
              {expanded && (
                <pre style={{
                  margin: "0 0 10px 17px", padding: "12px 14px",
                  background: "#1a120b", color: "#e8d5b0",
                  borderRadius: 10, fontSize: "11px", fontFamily: "monospace",
                  lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap",
                  wordBreak: "break-all", maxHeight: 320, overflowY: "auto",
                }}>
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      <div style={S.card}>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 12 }}>Status thresholds</div>
        {thresholds.map((r, i) => (
          <div key={r.s} style={{ display: "flex", gap: "10px", alignItems: "center", padding: "8px 0", borderBottom: i < thresholds.length - 1 ? "1px solid #f0e8de" : "none" }}>
            <StatusPill status={r.s} />
            <span style={{ fontSize: "13px", color: "#7a6a5a" }}>{r.d}</span>
          </div>
        ))}
        <p style={{ margin: "12px 0 0", fontSize: "12px", color: "#b0a090" }}>
          Each client's interval is derived from their Vagaro appointment history.
        </p>
      </div>
      </>)}

      {activeTab === "gmail" && (
        <div>
          {/* What this does */}
          <div style={{ ...S.card, marginBottom: 14, background: "#f0fdf4", border: "1px solid #86efac" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#065f46", marginBottom: 6 }}>📧 What Gmail integration does</div>
            <div style={{ fontSize: "12px", color: "#166534", lineHeight: "1.7" }}>
              When connected, Client Pulse can send emails directly from your Google Workspace account when you click "Send via Gmail" in the email compose window. Emails appear in your Gmail Sent folder just like any other email. The integration only has permission to <strong>send</strong> — it cannot read your inbox.
            </div>
          </div>

          {/* Setup instructions */}
          <div style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418", marginBottom: 10 }}>Setup (one-time)</div>
            {[
              { n: "1", t: "Create a Google Cloud project", d: "Go to console.cloud.google.com → New project" },
              { n: "2", t: "Enable Gmail API", d: "APIs & Services → Library → search \"Gmail API\" → Enable" },
              { n: "3", t: "Create OAuth 2.0 credentials", d: "APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application" },
              { n: "4", t: "Add authorized origin", d: `Under \"Authorized JavaScript origins\" add: ${window.location.origin}` },
              { n: "5", t: "Copy your Client ID", d: "Paste it in the field below and save" },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #f5f0e8" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#a0785a", color: "#fff", fontSize: "11px", fontWeight: "800", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{s.n}</div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>{s.t}</div>
                  <div style={{ fontSize: "12px", color: "#8a7a6a", marginTop: 2 }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Client ID input */}
          <div style={{ ...S.card, marginBottom: 14 }}>
            <label style={S.lbl}>Google OAuth Client ID</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={gmailClientId}
                onChange={(e) => {
                  setGmailClientId(e.target.value);
                  localStorage.setItem("cp_gmail_client_id", e.target.value);
                }}
                placeholder="xxxxxxxxxx-xxxxxxxx.apps.googleusercontent.com"
                style={{ ...S.inp, flex: 1, fontFamily: "monospace", fontSize: "12px" }}
              />
              {gmailClientId && <button style={S.sm("ghost")} onClick={() => { setGmailClientId(""); localStorage.removeItem("cp_gmail_client_id"); }}>Clear</button>}
            </div>
            <div style={{ fontSize: "11px", color: "#b0a090", marginTop: 6 }}>
              Stored locally in your browser — never sent to any server.
            </div>
          </div>

          {/* Connect / status */}
          <div style={{ ...S.card }}>
            {gmail.isConnected ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#065f46" }}>Connected as {gmail.gmailUser}</div>
                </div>
                <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 14 }}>
                  Emails composed in Client Pulse will be sent from this account. Session expires when you close the browser.
                </div>
                <button style={S.btn("ghost")} onClick={gmail.disconnect}>Disconnect Gmail</button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e5e7eb", flexShrink: 0 }} />
                  <div style={{ fontSize: "13px", color: "#6b7280" }}>Not connected</div>
                </div>
                {gmail.error && (
                  <div style={{ fontSize: "12px", color: "#dc2626", background: "#fee2e2", padding: "8px 12px", borderRadius: 8, marginBottom: 12 }}>{gmail.error}</div>
                )}
                <button
                  style={{ ...S.btn("primary"), opacity: gmailClientId ? 1 : 0.5 }}
                  onClick={gmail.connect}
                  disabled={!gmailClientId || gmail.loading}>
                  {gmail.loading ? "Connecting…" : "Connect Gmail"}
                </button>
                {!gmailClientId && (
                  <div style={{ fontSize: "11px", color: "#b0a090", marginTop: 8 }}>Enter your Client ID above first.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "staff" && (
        <StaffManager supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} usingDB={usingDB} />
      )}

      {activeTab === "templates" && (
        <TemplatesPage templates={templates} onSave={onSaveTemplate} embedded />
      )}
    </div>
  );
}

// ─── MOBILE CLIENT SHELL ──────────────────────────────────────────────────────
function MobileClientShell({ clients, selected, setSelected, filter, setFilter, search, setSearch, tagFilter, setTagFilter, updateClient, templates, onAddClient, supabaseUrl, supabaseAnonKey, usingDB }) {
  const isMobile = useIsMobile();
  const showDetail = isMobile && selected;
  const showList = !isMobile || !selected;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {showList && (
        <ClientSidebar
          clients={clients}
          selected={selected}
          onSelect={(c) => setSelected(c)}
          filter={filter}
          setFilter={setFilter}
          search={search}
          setSearch={setSearch}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
          fullWidth={isMobile}
          onAddClient={onAddClient}
        />
      )}
      {(!isMobile || showDetail) && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#fdfbf8" }}>
          {selected ? (
            <ClientDetail
              key={selected.id}
              client={clients.find((c) => c.id === selected.id) || selected}
              onUpdate={updateClient}
              templates={templates}
              allClients={clients}
              onBack={isMobile ? () => setSelected(null) : null}
              supabaseUrl={supabaseUrl}
              supabaseAnonKey={supabaseAnonKey}
              usingDB={usingDB}
            />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "#b0a090" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span style={{ fontSize: "14px", fontWeight: "600" }}>Select a client to view their profile</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SALES DASHBOARD ─────────────────────────────────────────────────────────
const SALES_GOALS = {
  monthly: 30000, servicesPerWeek: 79, sessionsPerDay: 15.8,
  packageTotal: 10000, ownerPackages: 5000, teamPackages: 5000,
};

const SALES_THERAPISTS = [
  { name: "Becky",     color: "#a0785a", rebookGoal: null, sessionLow: 12, sessionHigh: 15, redLightGoal: null, role: "Owner / LMT" },
  { name: "Maria",     color: "#5b21b6", rebookGoal: 20,   sessionLow: 16, sessionHigh: 16, redLightGoal: null, role: "LMT" },
  { name: "Angelique", color: "#92400e", rebookGoal: 20,   sessionLow: 12, sessionHigh: 15, redLightGoal: null, role: "LMT" },
  { name: "Alleiyah",  color: "#1d5fa8", rebookGoal: 17,   sessionLow: 10, sessionHigh: 12, redLightGoal: null, role: "LMT" },
  { name: "Don",       color: "#0f7a4a", rebookGoal: 17,   sessionLow: 7,  sessionHigh: 9,  redLightGoal: 12,   role: "Studio Coordinator / LMT" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDollar(n) { return "$" + Math.round(n).toLocaleString(); }
function salPct(a, b) { return b === 0 ? 0 : Math.min((a / b) * 100, 100); }

function Ring({ value, size = 110, stroke = 9, color, bg = "#e8e0d6", children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(value / 100, 1) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1.1s cubic-bezier(.4,0,.2,1)" }} />
      <foreignObject x={stroke/2} y={stroke/2} width={size-stroke} height={size-stroke}>
        <div xmlns="http://www.w3.org/1999/xhtml"
          style={{ width:"100%", height:"100%", display:"flex", alignItems:"center",
            justifyContent:"center", transform:"rotate(90deg)" }}>
          {children}
        </div>
      </foreignObject>
    </svg>
  );
}

function SalesBar({ value, color, bg = "#e8e0d6", h = 7 }) {
  return (
    <div style={{ background: bg, borderRadius: 99, height: h, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(value, 100)}%`, height: "100%", background: color,
        borderRadius: 99, transition: "width 1.1s cubic-bezier(.4,0,.2,1)" }} />
    </div>
  );
}

function SalesNumInput({ value, onChange, color }) {
  return (
    <input type="number" min={0} value={value}
      onChange={e => onChange(Math.max(0, Number(e.target.value)))}
      style={{ width: 64, padding: "5px 8px", borderRadius: 8, textAlign: "center",
        border: `1.5px solid #ddd6cc`, fontSize: 13, fontWeight: 700,
        color: "#2e2418", background: "#faf8f5", outline: "none",
        fontFamily: "'DM Sans',sans-serif" }} />
  );
}

function salesStorageKey(year, month) { return `rctm_sales_${year}_${month}`; }

function loadSalesData(year, month) {
  try {
    const raw = localStorage.getItem(salesStorageKey(year, month));
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    ownerSales: 0, teamSales: 0, monthlySales: 0,
    stats: Object.fromEntries(SALES_THERAPISTS.map(t => [t.name, { sessions: 0, rebooked: 0, redLight: 0 }])),
  };
}

function saveSalesData(year, month, data) {
  try { localStorage.setItem(salesStorageKey(year, month), JSON.stringify(data)); } catch {}
}

function SalesDashboard({ supabaseUrl, supabaseAnonKey, usingDB }) {
  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [animated, setAnimated] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [data, setData] = useState(() => loadSalesData(now.getFullYear(), now.getMonth() + 1));
  const [liveData,    setLiveData]    = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    setData(loadSalesData(selYear, selMonth));
    setAnimated(false);
    setTimeout(() => setAnimated(true), 120);
  }, [selYear, selMonth]);

  useEffect(() => { setTimeout(() => setAnimated(true), 120); }, []);

  useEffect(() => {
    if (!usingDB || !supabaseUrl || !supabaseAnonKey) { setLiveData(null); return; }
    setLiveLoading(true);
    const startDate = new Date(selYear, selMonth - 1, 1).toISOString();
    const endDate   = new Date(selYear, selMonth,     1).toISOString();
    getSB(supabaseUrl, supabaseAnonKey)
      .from("transactions")
      .select("purchase_type,cc_amount,cash_amount,check_amount,ach_amount,package_redemption,gc_redemption,bank_account_amount,vagaro_pay_later_amount,other_amount,tip,tax,item_sold,transaction_date,vagaro_service_provider_id")
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .order("transaction_date", { ascending: false })
      .then(({ data: rows }) => {
        if (!rows) { setLiveLoading(false); return; }
        const totalRevenue = rows.reduce((s, t) =>
          s + (+t.cc_amount||0) + (+t.cash_amount||0) + (+t.check_amount||0) + (+t.ach_amount||0)
            + (+t.package_redemption||0) + (+t.gc_redemption||0) + (+t.bank_account_amount||0)
            + (+t.vagaro_pay_later_amount||0) + (+t.other_amount||0), 0);
        const totalTips = rows.reduce((s, t) => s + (+t.tip||0), 0);
        const byType = {};
        for (const t of rows) {
          const pt = t.purchase_type || "Other";
          const amt = (+t.cc_amount||0) + (+t.cash_amount||0) + (+t.check_amount||0) + (+t.ach_amount||0)
            + (+t.package_redemption||0) + (+t.gc_redemption||0) + (+t.bank_account_amount||0)
            + (+t.vagaro_pay_later_amount||0) + (+t.other_amount||0);
          byType[pt] = (byType[pt] || 0) + amt;
        }
        const packageRevenue = (byType["Package"] || 0) + (byType["Membership"] || 0);
        const serviceRevenue = byType["Service"] || 0;
        setLiveData({ totalRevenue, totalTips, byType, packageRevenue, serviceRevenue,
          count: rows.length, recent: rows.slice(0, 8) });
        setLiveLoading(false);
      });
  }, [usingDB, supabaseUrl, supabaseAnonKey, selYear, selMonth]);

  const updateData = (updates) => {
    setData(prev => {
      const next = { ...prev, ...updates };
      saveSalesData(selYear, selMonth, next);
      return next;
    });
  };

  const updStat = (name, field, val) => {
    const next = { ...data.stats, [name]: { ...data.stats[name], [field]: Math.max(0, val) } };
    updateData({ stats: next });
  };

  const monthName  = MONTH_NAMES[selMonth - 1];
  const monthLabel = `${monthName} ${selYear}`;
  const pkgTotal   = data.ownerSales + data.teamSales;
  const pkgPct     = salPct(pkgTotal,          SALES_GOALS.packageTotal);
  const ownerPct   = salPct(data.ownerSales,   SALES_GOALS.ownerPackages);
  const teamPct    = salPct(data.teamSales,    SALES_GOALS.teamPackages);
  const monthlyPct = salPct(data.monthlySales, SALES_GOALS.monthly);
  const goalUnlocked = ownerPct >= 100 && teamPct >= 100;
  const totalSessionsWeek = SALES_THERAPISTS.reduce((s, t) => s + (data.stats[t.name]?.sessions || 0), 0);
  const studioSessionsPct = salPct(totalSessionsWeek, SALES_GOALS.servicesPerWeek);

  const yearOpts = [];
  for (let y = 2024; y <= now.getFullYear() + 1; y++) yearOpts.push(y);

  const slbl = { fontSize: "10px", fontWeight: "700", color: "#8a7a6a", letterSpacing: "1.5px",
    textTransform: "uppercase", display: "block", marginBottom: 6 };

  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: "800", color: "#1a120b" }}>
            Sales &amp; Performance
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#8a7a6a" }}>{monthLabel}</p>
        </div>
        {/* Month / year picker */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}
            style={{ ...S.inp, width: "auto", padding: "7px 12px", cursor: "pointer" }}>
            {MONTH_NAMES.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
            style={{ ...S.inp, width: "auto", padding: "7px 12px", cursor: "pointer" }}>
            {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Live Revenue from Vagaro */}
      {usingDB && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <label style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", letterSpacing: "1.5px", textTransform: "uppercase" }}>
              Live Revenue — {MONTH_NAMES[selMonth - 1]} {selYear}
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {liveLoading && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a0785a", animation: "pulse 1s infinite" }} />}
              <span style={{ fontSize: "10px", color: "#8a7a6a" }}>{liveData ? `${liveData.count} transactions` : "Loading…"}</span>
            </div>
          </div>
          {liveData ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                {[
                  { l: "Total Revenue", v: fmtDollar(liveData.totalRevenue), c: "#0f7a4a", bg: "#dcf5ec" },
                  { l: "Services",      v: fmtDollar(liveData.serviceRevenue), c: "#1d5fa8", bg: "#dbeafe" },
                  { l: "Packages/Mbr", v: fmtDollar(liveData.packageRevenue), c: "#a0785a", bg: "#f5ede4" },
                ].map(({ l, v, c, bg }) => (
                  <div key={l} style={{ background: bg, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: "18px", fontWeight: "800", color: c }}>{v}</div>
                    <div style={{ fontSize: "9px", color: c, opacity: 0.7, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: liveData.recent.length ? 14 : 0 }}>
                {Object.entries(liveData.byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, amt]) => (
                    <div key={type} style={{ background: "#f5f0ea", borderRadius: 8, padding: "5px 10px", fontSize: "11px", color: "#5a4a3a" }}>
                      <span style={{ fontWeight: "700" }}>{type}</span>
                      <span style={{ color: "#8a7a6a", marginLeft: 6 }}>{fmtDollar(amt)}</span>
                    </div>
                  ))}
              </div>
              {liveData.recent.length > 0 && (
                <div style={{ borderTop: "1px solid #e8e0d6", paddingTop: 12 }}>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>Recent Transactions</div>
                  {liveData.recent.map((t, i) => {
                    const amt = (+t.cc_amount||0) + (+t.cash_amount||0) + (+t.check_amount||0) + (+t.ach_amount||0)
                      + (+t.package_redemption||0) + (+t.gc_redemption||0) + (+t.bank_account_amount||0)
                      + (+t.vagaro_pay_later_amount||0) + (+t.other_amount||0);
                    const dateStr = t.transaction_date ? new Date(t.transaction_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "6px 0", borderBottom: i < liveData.recent.length - 1 ? "1px solid #f0ece6" : "none" }}>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: "600", color: "#2e2418" }}>{t.item_sold || t.purchase_type || "Transaction"}</div>
                          <div style={{ fontSize: "10px", color: "#8a7a6a" }}>{t.purchase_type}{dateStr ? ` · ${dateStr}` : ""}</div>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f7a4a" }}>{fmtDollar(amt)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: "13px", color: "#8a7a6a", textAlign: "center", padding: "16px 0" }}>
              {liveLoading ? "Loading transactions…" : "No transactions found for this month"}
            </div>
          )}
        </div>
      )}

      {/* Vagaro reminder */}
      <div style={{ ...S.card, marginBottom: 16, padding: "0", overflow: "hidden" }}>
        <div onClick={() => setShowNote(p => !p)}
          style={{ padding: "14px 20px", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "space-between",
            background: "#fef3c7", borderBottom: showNote ? "1px solid #e8e0d6" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>📌</span>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#92400e" }}>Staff Note — Rebooking in Vagaro</div>
              <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: 1 }}>Click to {showNote ? "collapse" : "read"} — important for accurate data</div>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: showNote ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        {showNote && (
          <div style={{ padding: "16px 20px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "13px", lineHeight: 1.7, color: "#2e2418" }}>
              <strong style={{ color: "#991b1b" }}>⚠️ When rebooking a client, you MUST use the Rebooking Feature in Vagaro</strong> — not just schedule a new appointment manually.
              The rebooking feature is what captures the data that shows up in rebooking percentage reports.
              If you schedule without using it, that rebook is invisible and your numbers will not reflect your actual performance.
            </p>
            <p style={{ margin: 0, fontSize: "12px", color: "#8a7a6a", fontStyle: "italic", lineHeight: 1.7 }}>
              This matters for your personal goals, Monday tracking, and for Becky to see the full picture of how we are growing together.
            </p>
          </div>
        )}
      </div>

      {/* Package challenge */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <label style={slbl}>{monthLabel} Package Challenge</label>
        <div style={{ fontSize: "20px", fontWeight: "800", color: "#1a120b", marginBottom: 2 }}>$10,000 in Package Sales</div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 20, fontStyle: "italic" }}>
          Both goals hit = Becky takes the whole team to the hot springs 🌊
        </div>
        <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
          <Ring value={animated ? pkgPct : 0} size={130} stroke={11} color="#a0785a" bg="#e8e0d6">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a120b" }}>{Math.round(pkgPct)}%</div>
              <div style={{ fontSize: "9px", color: "#8a7a6a", letterSpacing: "0.08em" }}>OF GOAL</div>
            </div>
          </Ring>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 14 }}>
              {[
                { l: "Total Raised",   v: fmtDollar(pkgTotal),                                      c: "#1a120b" },
                { l: "Remaining",      v: fmtDollar(Math.max(0, SALES_GOALS.packageTotal - pkgTotal)), c: "#991b1b" },
                { l: "Daily Target",   v: fmtDollar(SALES_GOALS.packageTotal / 30),                 c: "#1d5fa8" },
                { l: "Goal",           v: fmtDollar(SALES_GOALS.packageTotal),                      c: "#0f7a4a" },
              ].map(({ l, v, c }) => (
                <div key={l}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a7a6a", marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <SalesBar value={animated ? pkgPct : 0} color="#a0785a" bg="#e8e0d6" h={10} />
          </div>
        </div>

        {/* Becky vs Team sub-goals */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { name: "Becky", goal: SALES_GOALS.ownerPackages, val: data.ownerSales, color: "#a0785a", bg: "#f5ede4", key: "ownerSales" },
            { name: "Team",  goal: SALES_GOALS.teamPackages,  val: data.teamSales,  color: "#1d5fa8", bg: "#dbeafe", key: "teamSales"  },
          ].map(({ name, goal, val, color, bg, key }) => {
            const p = salPct(val, goal);
            return (
              <div key={name} style={{ background: bg, borderRadius: 12, padding: "16px 18px", border: `1px solid ${color}22` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <label style={{ ...slbl, color }}>{name}'s Goal</label>
                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#1a120b" }}>{fmtDollar(val)}</div>
                    <div style={{ fontSize: "11px", color: "#8a7a6a" }}>of {fmtDollar(goal)}</div>
                  </div>
                  <Ring value={animated ? p : 0} size={60} stroke={6} color={color} bg="#e8e0d6">
                    <span style={{ fontSize: "11px", fontWeight: "700", color }}>{Math.round(p)}%</span>
                  </Ring>
                </div>
                <SalesBar value={animated ? p : 0} color={color} bg="#e8e0d6" h={6} />
                <div style={{ marginTop: 10 }}>
                  <input type="range" min={0} max={goal * 1.2} value={val}
                    onChange={e => updateData({ [key]: Number(e.target.value) })}
                    style={{ width: "100%", accentColor: color }} />
                </div>
                <div style={{ marginTop: 4, fontSize: "11px", color: "#8a7a6a" }}>
                  {val >= goal ? "🎉 Goal hit!" : `${fmtDollar(Math.max(0, goal - val))} to go`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Studio weekly total + monthly revenue — side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        {/* Studio weekly */}
        <div style={{ ...S.card }}>
          <label style={slbl}>Studio Total — This Week</label>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
            <Ring value={animated ? studioSessionsPct : 0} size={72} stroke={7} color="#1d5fa8" bg="#e8e0d6">
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "14px", fontWeight: "800", color: "#1a120b" }}>{totalSessionsWeek}</div>
                <div style={{ fontSize: "7px", color: "#8a7a6a" }}>sessions</div>
              </div>
            </Ring>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a120b" }}>
                {totalSessionsWeek}
                <span style={{ fontSize: "13px", fontWeight: "400", color: "#8a7a6a" }}> / {SALES_GOALS.servicesPerWeek}</span>
              </div>
              <SalesBar value={animated ? studioSessionsPct : 0} color="#1d5fa8" bg="#e8e0d6" h={7} />
              <div style={{ marginTop: 6, fontSize: "11px", color: "#8a7a6a" }}>
                {totalSessionsWeek >= SALES_GOALS.servicesPerWeek
                  ? "🎉 Weekly goal hit!"
                  : `${SALES_GOALS.servicesPerWeek - totalSessionsWeek} sessions to goal`}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { l: "Per Day", v: SALES_GOALS.sessionsPerDay, c: "#92400e", bg: "#fef3c7" },
              { l: "Weekly",  v: SALES_GOALS.servicesPerWeek, c: "#1d5fa8", bg: "#dbeafe" },
              { l: "Revenue", v: fmtDollar(SALES_GOALS.monthly), c: "#0f7a4a", bg: "#dcf5ec" },
            ].map(({ l, v, c, bg }) => (
              <div key={l} style={{ background: bg, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: "16px", fontWeight: "800", color: c }}>{v}</div>
                <div style={{ fontSize: "9px", color: c, opacity: 0.7, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly revenue */}
        <div style={{ ...S.card }}>
          <label style={slbl}>Monthly Revenue — {monthLabel}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
            <Ring value={animated ? monthlyPct : 0} size={72} stroke={7} color="#0f7a4a" bg="#e8e0d6">
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f7a4a" }}>{Math.round(monthlyPct)}%</div>
              </div>
            </Ring>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a120b" }}>
                {fmtDollar(data.monthlySales)}
                <span style={{ fontSize: "13px", fontWeight: "400", color: "#8a7a6a" }}> / {fmtDollar(SALES_GOALS.monthly)}</span>
              </div>
              <SalesBar value={animated ? monthlyPct : 0} color="#0f7a4a" bg="#e8e0d6" h={7} />
              <div style={{ marginTop: 6, fontSize: "11px", color: "#8a7a6a" }}>
                {monthlyPct >= 100 ? "🎉 Monthly goal achieved!" : `${fmtDollar(SALES_GOALS.monthly - data.monthlySales)} remaining`}
              </div>
            </div>
          </div>
          <input type="range" min={0} max={SALES_GOALS.monthly * 1.2} value={data.monthlySales}
            onChange={e => updateData({ monthlySales: Number(e.target.value) })}
            style={{ width: "100%", accentColor: "#0f7a4a" }} />
        </div>
      </div>

      {/* Therapist cards */}
      <label style={{ ...slbl, marginBottom: 12 }}>Individual Goals — Weekly Sessions &amp; Rebooking %</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14, marginBottom: 16 }}>
        {SALES_THERAPISTS.map(t => {
          const s        = data.stats[t.name] || { sessions: 0, rebooked: 0, redLight: 0 };
          const midGoal  = (t.sessionLow + t.sessionHigh) / 2;
          const sessP    = salPct(s.sessions, midGoal);
          const rebookP  = s.sessions > 0 ? (s.rebooked / s.sessions) * 100 : 0;
          const rebookGoalP = t.rebookGoal ? salPct(rebookP, t.rebookGoal) : null;
          const redLightP   = t.redLightGoal ? salPct(s.redLight, t.redLightGoal) : null;
          const rangeLabel  = t.sessionLow === t.sessionHigh ? `${t.sessionLow}` : `${t.sessionLow}–${t.sessionHigh}`;
          const atSessGoal  = s.sessions >= t.sessionLow;
          const atRebook    = t.rebookGoal && rebookP >= t.rebookGoal;
          const colorBg     = `${t.color}12`;

          return (
            <div key={t.name} style={{ ...S.card, padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: "800", color: "#1a120b" }}>{t.name}</div>
                  <div style={{ fontSize: "10px", color: "#8a7a6a", marginTop: 1 }}>{t.role}</div>
                </div>
                <Ring value={animated ? sessP : 0} size={64} stroke={6} color={t.color} bg="#e8e0d6">
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "13px", fontWeight: "800", color: "#1a120b" }}>{s.sessions}</div>
                    <div style={{ fontSize: "6px", color: "#8a7a6a" }}>sessions</div>
                  </div>
                </Ring>
              </div>

              {/* Weekly sessions */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: "11px", color: "#8a7a6a" }}>Weekly Sessions</span>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: atSessGoal ? "#0f7a4a" : t.color }}>
                    {s.sessions} / {rangeLabel}{atSessGoal ? " ✓" : ""}
                  </span>
                </div>
                <SalesBar value={animated ? sessP : 0} color={t.color} bg="#e8e0d6" h={6} />
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <SalesNumInput value={s.sessions} onChange={v => updStat(t.name, "sessions", v)} color={t.color} />
                  <span style={{ fontSize: "10px", color: "#8a7a6a" }}>sessions this week</span>
                </div>
              </div>

              {/* Red light — Don only */}
              {t.redLightGoal && (
                <div style={{ marginBottom: 12, padding: "10px 12px", background: "#dcf5ec",
                  borderRadius: 10, border: "1px solid #86efac" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: "11px", color: "#0f7a4a", fontWeight: "600" }}>💡 Red Light Sessions</span>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#0f7a4a" }}>
                      {s.redLight} / {t.redLightGoal}{s.redLight >= t.redLightGoal ? " ✓" : ""}
                    </span>
                  </div>
                  <SalesBar value={animated ? (redLightP || 0) : 0} color="#0f7a4a" bg="#a7f3d0" h={6} />
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <SalesNumInput value={s.redLight} onChange={v => updStat(t.name, "redLight", v)} color="#0f7a4a" />
                    <span style={{ fontSize: "10px", color: "#8a7a6a" }}>red light this week</span>
                  </div>
                </div>
              )}

              {/* Rebook % */}
              {t.rebookGoal && (
                <div style={{ borderTop: "1px solid #e8e0d6", paddingTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: "11px", color: "#8a7a6a" }}>Rebook %</span>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: atRebook ? "#0f7a4a" : t.color }}>
                      {s.sessions > 0 ? rebookP.toFixed(1) : "0.0"}% / {t.rebookGoal}% goal{atRebook ? " 🎉" : ""}
                    </span>
                  </div>
                  <SalesBar value={animated ? (rebookGoalP || 0) : 0} color={t.color} bg="#e8e0d6" h={6} />
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <SalesNumInput value={s.rebooked} onChange={v => updStat(t.name, "rebooked", v)} color={t.color} />
                    <span style={{ fontSize: "10px", color: "#8a7a6a" }}>clients rebooked</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: "11px", color: "#8a7a6a", fontStyle: "italic" }}>
                    {s.sessions > 0 ? `${s.rebooked} of ${s.sessions} clients rebooked` : "Enter sessions + rebooks above"}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hot springs tracker */}
      <div style={{
        ...S.card,
        textAlign: "center",
        background: goalUnlocked
          ? "linear-gradient(135deg,#a0785a,#7a5640)"
          : "#fff",
        border: goalUnlocked ? "none" : "1px solid #e8e0d6",
        transition: "background 0.6s ease",
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{goalUnlocked ? "🌊" : "💧"}</div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: goalUnlocked ? "#fff" : "#1a120b", marginBottom: 6 }}>
          {goalUnlocked ? "HOT SPRINGS TRIP UNLOCKED!" : "Hot Springs Awaits…"}
        </div>
        <div style={{ fontSize: "13px", color: goalUnlocked ? "rgba(255,255,255,0.85)" : "#8a7a6a" }}>
          {goalUnlocked
            ? "Becky + the whole team hit their package goals. Pack your bags! 🎉"
            : `Becky needs ${fmtDollar(Math.max(0, SALES_GOALS.ownerPackages - data.ownerSales))} more · Team needs ${fmtDollar(Math.max(0, SALES_GOALS.teamPackages - data.teamSales))} more`}
        </div>
        {!goalUnlocked && (
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
            {[
              { label: "Becky", p: ownerPct, color: "#a0785a", bg: "#f5ede4" },
              { label: "Team",  p: teamPct,  color: "#1d5fa8", bg: "#dbeafe" },
            ].map(({ label, p, color, bg }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "#8a7a6a", marginBottom: 6 }}>{label}</div>
                <div style={{ width: 120, height: 7, background: "#e8e0d6", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(p, 100)}%`, height: "100%",
                    background: color, borderRadius: 99, transition: "width 1s ease" }} />
                </div>
                <div style={{ fontSize: "12px", color, fontWeight: "700", marginTop: 5 }}>{Math.round(p)}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    id: "dashboard", label: "Overview", short: "Home",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  { id: "pulse",     label: "Pulse",     short: "Pulse",     isPulse: true },
  {
    id: "sales", label: "Sales", short: "Sales",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    id: "clients", label: "Clients", short: "Clients",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    id: "settings", label: "Settings", short: "Settings",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

function NavIcon({ item, size = 15 }) {
  if (item.isPulse) {
    return (
      <svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 32 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M2 10 Q6 2 10 10 Q14 18 18 10 Q22 2 26 10 Q28 14 30 10" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={item.icon} />
    </svg>
  );
}

// ─── SUPABASE INTEGRATION ─────────────────────────────────────────────────────
let _sbClient = null;
let _sbUrl = '';
let _sbKey = '';

function getSB(url, key) {
  if (!url || !key) return null;
  if (_sbClient && url === _sbUrl && key === _sbKey) return _sbClient;
  _sbClient = createClient(url, key);
  _sbUrl = url; _sbKey = key;
  return _sbClient;
}

const rowToClient = (row) => ({
  id: row.id, vagaroId: row.vagaro_id, vagaroSynced: row.vagaro_synced,
  firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone,
  birthday: row.birthday, customerSince: row.customer_since, lastVisit: row.last_visit || null,
  avgVisitIntervalDays: row.avg_visit_interval_days, referredBy: row.referred_by,
  careCategory: row.care_category, redLightStatus: row.red_light_status,
  waitlisted: row.waitlisted, address: row.address, city: row.city, state: row.state, zip: row.zip,
  tags: row.tags || [], goldenNuggets: row.golden_nuggets || [],
  noShows: row.no_shows || 0, totalSpent: row.total_spent || 0,
  statusOverride: row.status_override || null,
  // Two-layer status fields
  completedAppointmentsCount: row.completed_appointments_count || 0,
  packageCreditsRemaining: row.package_credits_remaining || 0,
  packageExpirationDate: row.package_expiration_date || null,
  giftCardBalance: row.gift_card_balance || 0,
  giftCardPurchaseDate: row.gift_card_purchase_date || null,
  contactedAt: row.contacted_at || null,
  needsFollowUp: row.needs_follow_up || false,
  restrictedStatus: row.restricted_status || null,
  restrictedNote: row.restricted_note || null,
  appointments: [], history: [],
});

const clientToRow = (c) => ({
  vagaro_id: c.vagaroId || null, vagaro_synced: c.vagaroSynced || false,
  first_name: c.firstName, last_name: c.lastName, email: c.email || null, phone: c.phone || null,
  birthday: c.birthday || null, customer_since: c.customerSince || null, last_visit: c.lastVisit || null,
  avg_visit_interval_days: c.avgVisitIntervalDays || 30, referred_by: c.referredBy || null,
  care_category: c.careCategory || null, red_light_status: c.redLightStatus || null,
  waitlisted: c.waitlisted || false, address: c.address || null, city: c.city || null,
  state: c.state || null, zip: c.zip || null, tags: c.tags || [], golden_nuggets: c.goldenNuggets || [],
  no_shows: c.noShows || 0, total_spent: c.totalSpent || 0,
  status_override: c.statusOverride || null,
  // Two-layer status fields
  completed_appointments_count: c.completedAppointmentsCount || 0,
  package_credits_remaining: c.packageCreditsRemaining || 0,
  package_expiration_date: c.packageExpirationDate || null,
  gift_card_balance: c.giftCardBalance || 0,
  gift_card_purchase_date: c.giftCardPurchaseDate || null,
  contacted_at: c.contactedAt || null,
  needs_follow_up: c.needsFollowUp || false,
  restricted_status: c.restrictedStatus || null,
  restricted_note: c.restrictedNote || null,
});

const rowToAppt = (r) => ({ id: r.id, date: r.date, time: r.time, service: r.service, duration: r.duration, therapist: r.therapist, status: r.status });
const rowToHistory = (r) => ({ id: r.id, type: r.type, detail: r.detail, by: r.by, ts: r.ts, source: r.source, direction: r.direction });
const rowToTask = (r) => ({ id: r.id, title: r.title, dueDate: r.due_date, clientId: r.client_id, createdBy: r.created_by, done: r.done, createdAt: new Date(r.created_at).getTime() });

async function dbLoadAll(url, key) {
  const sb = getSB(url, key); if (!sb) throw new Error('Not connected');
  const [{ data: cr, error: ce }, { data: ar, error: ae }, { data: hr, error: he }, { data: tr, error: te }] = await Promise.all([
    sb.from('clients').select('*').order('created_at', { ascending: false }),
    sb.from('appointments').select('*').order('date', { ascending: false }),
    sb.from('history').select('*').order('ts', { ascending: false }),
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
  ]);
  if (ce) throw ce; if (ae) throw ae; if (he) throw he; if (te) throw te;
  const clients = (cr || []).map((row) => {
    const c = rowToClient(row); c.appointments = (ar||[]).filter((a)=>a.client_id===row.id).map(rowToAppt); c.history = (hr||[]).filter((h)=>h.client_id===row.id).map(rowToHistory); return c;
  });
  return { clients, tasks: (tr||[]).map(rowToTask) };
}

async function dbSaveClient(url, key, client) {
  const sb = getSB(url, key); if (!sb) return;
  const { error } = await sb.from('clients').upsert({ id: client.id, ...clientToRow(client) }); if (error) throw error;
}

async function dbUpdateClient(url, key, id, updates) {
  const sb = getSB(url, key); if (!sb) return;
  const m = {};
  const map = { firstName:'first_name', lastName:'last_name', email:'email', phone:'phone', birthday:'birthday', customerSince:'customer_since', lastVisit:'last_visit', avgVisitIntervalDays:'avg_visit_interval_days', referredBy:'referred_by', careCategory:'care_category', redLightStatus:'red_light_status', waitlisted:'waitlisted', address:'address', city:'city', state:'state', zip:'zip', tags:'tags', goldenNuggets:'golden_nuggets', noShows:'no_shows', totalSpent:'total_spent', vagaroId:'vagaro_id', vagaroSynced:'vagaro_synced', statusOverride:'status_override', completedAppointmentsCount:'completed_appointments_count', packageCreditsRemaining:'package_credits_remaining', packageExpirationDate:'package_expiration_date', giftCardBalance:'gift_card_balance', giftCardPurchaseDate:'gift_card_purchase_date', contactedAt:'contacted_at', needsFollowUp:'needs_follow_up', restrictedStatus:'restricted_status', restrictedNote:'restricted_note' };
  Object.entries(map).forEach(([k,v]) => { if (updates[k] !== undefined) m[v] = updates[k]; });
  if (Object.keys(m).length > 0) { const { error } = await sb.from('clients').update(m).eq('id', id); if (error) throw error; }
  if (updates.history?.length > 0) {
    const e = updates.history[updates.history.length - 1];
    await sb.from('history').insert({ id: e.id||uid(), client_id: id, type: e.type, detail: e.detail, by: e.by||'System', ts: e.ts||Date.now(), source: 'manual', direction: e.type.startsWith('comm.') ? 'outbound' : 'internal' }).catch(console.warn);
  }
}

async function dbSaveTask(url, key, task) {
  const sb = getSB(url, key); if (!sb) return;
  const { error } = await sb.from('tasks').upsert({ id: task.id, title: task.title, due_date: task.dueDate, client_id: task.clientId||null, created_by: task.createdBy, done: task.done }); if (error) throw error;
}

async function dbDeleteTask(url, key, id) {
  const sb = getSB(url, key); if (!sb) return;
  const { error } = await sb.from('tasks').delete().eq('id', id); if (error) throw error;
}

async function dbMergeClients(url, _key, primaryId, duplicateId) {
  const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/merge-clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primaryId, duplicateId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Merge failed");
  return data.merged;
}

// ─── SUPABASE AUTH HOOK ───────────────────────────────────────────────────────
function useSupabaseAuth(url, key) {
  const [user,    setUser]    = useState(null);
  const [staff,   setStaff]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!url || !key) { setLoading(false); return; }
    const sb = getSB(url, key);
    if (!sb) { setLoading(false); return; }
    let unsub;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        sb.from('staff').select('*').eq('id', session.user.id).single()
          .then(({ data }) => setStaff(data || { role:'staff', full_name:'Staff' }))
          .catch(() => setStaff({ role:'staff', full_name:'Staff' }))
          .finally(() => setLoading(false));
      } else { setLoading(false); }
    }).catch(() => setLoading(false));

    const { data } = sb.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        setUser(session.user);
        sb.from('staff').select('*').eq('id', session.user.id).single()
          .then(({ data: d }) => setStaff(d || { role:'staff', full_name:'Staff' }))
          .catch(() => setStaff({ role:'staff', full_name:'Staff' }))
          .finally(() => setLoading(false));
      } else { setUser(null); setStaff(null); setLoading(false); }
    });
    unsub = data.subscription;
    return () => unsub?.unsubscribe();
  }, [url, key]);

  const signIn = async (email, password) => {
    setError(null);
    const sb = getSB(url, key); if (!sb) { setError('Database not configured'); return false; }
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); return false; }
    return true;
  };

  const signOut = async () => {
    const sb = getSB(url, key); if (sb) await sb.auth.signOut();
    setUser(null); setStaff(null);
  };

  const resetPassword = async (email) => {
    const sb = getSB(url, key); if (!sb) return false;
    const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (err) { setError(err.message); return false; }
    return true;
  };

  return { user, staff, loading, error, signIn, signOut, resetPassword, setError };
}


// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, error, loading, onForgotPassword, noSupabase }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [forgot,   setForgot]   = useState(false);
  const [sentReset, setSentReset] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    await onLogin(email, password);
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    const ok = await onForgotPassword(email);
    if (ok) setSentReset(true);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #fdf6ef 0%, #f5e8d8 100%)",
      fontFamily: "'DM Sans', sans-serif", padding: 16,
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#a0785a,#7a5640)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 4px 20px rgba(160,120,90,0.3)" }}>
            <span style={{ fontSize: 24, color: "#fff", fontWeight: "800" }}>CP</span>
          </div>
          <div style={{ fontSize: "22px", fontWeight: "800", color: "#1a120b" }}>Client Pulse</div>
          <div style={{ fontSize: "13px", color: "#8a7a6a", marginTop: 4 }}>Rapid City Therapeutic Massage</div>
        </div>

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 8px 40px rgba(46,36,24,0.12)", padding: 32 }}>
          {noSupabase ? (
            <div>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#92400e", marginBottom: 8 }}>⚠️ Database not configured</div>
              <div style={{ fontSize: "13px", color: "#8a7a6a", lineHeight: "1.6" }}>
                Add your Supabase URL and anon key to enable login. Until then the app runs in demo mode.
              </div>
              <button
                onClick={() => onLogin("demo", "demo")}
                style={{ width: "100%", marginTop: 20, padding: "13px", borderRadius: 12, background: "linear-gradient(135deg,#a0785a,#7a5640)", color: "#fff", border: "none", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                Continue in demo mode
              </button>
            </div>
          ) : forgot ? (
            <div>
              <div style={{ fontSize: "17px", fontWeight: "800", color: "#1a120b", marginBottom: 6 }}>Reset password</div>
              {sentReset ? (
                <div style={{ fontSize: "13px", color: "#065f46", background: "#d1fae5", padding: "12px 16px", borderRadius: 10, marginBottom: 16 }}>
                  ✓ Password reset email sent — check your inbox
                </div>
              ) : (
                <form onSubmit={handleForgot}>
                  <div style={{ fontSize: "13px", color: "#8a7a6a", marginBottom: 16 }}>Enter your email and we'll send a reset link.</div>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com" required
                    style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e8e0d6", fontSize: "14px", marginBottom: 12, fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" }} />
                  {error && <div style={{ fontSize: "12px", color: "#dc2626", marginBottom: 10 }}>{error}</div>}
                  <button type="submit"
                    style={{ width: "100%", padding: "13px", borderRadius: 12, background: "linear-gradient(135deg,#a0785a,#7a5640)", color: "#fff", border: "none", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                    Send reset link
                  </button>
                </form>
              )}
              <button onClick={() => { setForgot(false); setSentReset(false); }}
                style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 10, background: "none", border: "none", fontSize: "13px", color: "#8a7a6a", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                ← Back to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin}>
              <div style={{ fontSize: "17px", fontWeight: "800", color: "#1a120b", marginBottom: 20 }}>Sign in</div>
              {error && (
                <div style={{ fontSize: "12px", color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 14 }}>
                  {error}
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: "11px", fontWeight: "700", color: "#8a7a6a", textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com" required autoFocus
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e8e0d6", fontSize: "14px", fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: "11px", fontWeight: "700", color: "#8a7a6a", textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" required
                    style={{ width: "100%", padding: "12px 44px 12px 14px", borderRadius: 10, border: "1.5px solid #e8e0d6", fontSize: "14px", fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" }} />
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#8a7a6a", fontSize: "13px" }}>
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading}
                style={{ width: "100%", padding: "13px", borderRadius: 12, background: "linear-gradient(135deg,#a0785a,#7a5640)", color: "#fff", border: "none", fontSize: "14px", fontWeight: "700", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: loading ? 0.7 : 1 }}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" onClick={() => setForgot(true)}
                style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 10, background: "none", border: "none", fontSize: "13px", color: "#8a7a6a", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                Forgot password?
              </button>
            </form>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: "11px", color: "#b0a090" }}>
          Client Pulse · Rapid City Therapeutic Massage
        </div>
      </div>
    </div>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error.message || "Unknown error", stack: error.stack || "" };
  }
  componentDidCatch(error, info) {
    console.error("=== CLIENT PULSE ERROR ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    console.error("Component stack:", info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fdf6ef", fontFamily: "'DM Sans',sans-serif", padding: 24 }}>
          <div style={{ maxWidth: 540, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "#1a120b", marginBottom: 8 }}>Something went wrong</div>
            <div style={{ fontSize: "12px", color: "#8a7a6a", background: "#fee2e2", padding: "10px 16px", borderRadius: 10, marginBottom: 12, textAlign: "left", fontFamily: "monospace", wordBreak: "break-all" }}>
              {this.state.error}
            </div>
            <div style={{ fontSize: "11px", color: "#8a7a6a", background: "#f5f5f5", padding: "8px 12px", borderRadius: 8, marginBottom: 20, textAlign: "left", fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
              {this.state.stack}
            </div>
            <div style={{ fontSize: "11px", color: "#8a7a6a", marginBottom: 16 }}>📋 Open browser console (F12) for full details</div>
            <button onClick={() => window.location.reload()}
              style={{ padding: "10px 24px", borderRadius: 10, background: "linear-gradient(135deg,#a0785a,#7a5640)", color: "#fff", border: "none", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────
function App() {
  // ── ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS ──
  const [clients, setClients]           = useState(INITIAL_CLIENTS);
  const [templates, setTemplates]       = useState(DEFAULT_TEMPLATES);
  const [tasks, setTasks]               = useState(INITIAL_TASKS);
  const [tab, setTab]                   = useState("dashboard");
  const [selected, setSelected]         = useState(null);
  const [filter, setFilter]             = useState("all");
  const [tagFilter, setTagFilter]       = useState(null);
  const [search, setSearch]             = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [showGS, setShowGS]             = useState(false);
  const [clientId, setClientId]             = useState(() => localStorage.getItem("cp_vagaro_client_id") || "");
  const [clientSecret, setClientSecret]     = useState(() => localStorage.getItem("cp_vagaro_client_secret_key") || "");
  const [vagaroRegion, setVagaroRegion]     = useState(() => localStorage.getItem("cp_vagaro_region") || "");
  const [gmailClientId, setGmailClientId] = useState(() => localStorage.getItem("cp_gmail_client_id") || "");
  const [supabaseUrl,     setSupabaseUrl]     = useState(() => "https://dewsznqxagzahtkpriuk.supabase.co");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRld3N6bnF4YWd6YWh0a3ByaXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDQ5MTcsImV4cCI6MjA5NDc4MDkxN30.PdVejzd-Mi3utM9xF7s2i3AU7UeBgNBE71eDFhjmteo");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbLoadError, setDbLoadError] = useState(null);
  const [usingDB, setUsingDB] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  setGlobalGmailClientId(gmailClientId);

  const noSupabase = !supabaseUrl || !supabaseAnonKey;
  const auth = useSupabaseAuth(supabaseUrl, supabaseAnonKey);

  const lapseCount = useMemo(
    () => clients.filter((c) => {
      const { layer1, layer2 } = clientStatus(c);
      return layer1 === "lapsed" || layer2 === "overdue" || layer2 === "overdue-with-package";
    }).length,
    [clients]
  );

  // Load from Supabase on mount / when credentials change
  useEffect(() => {
    if (usingDB) return;
    if (!supabaseUrl || !supabaseAnonKey) return;
    setDbLoading(true); setDbLoadError(null);
    dbLoadAll(supabaseUrl, supabaseAnonKey)
      .then(({ clients: dbClients, tasks: dbTasks }) => {
        if (dbClients.length > 0 || dbTasks.length > 0) {
          setClients(dbClients);
          setTasks(dbTasks);
        }
        setUsingDB(true);
        setDbLoading(false);
      })
      .catch((e) => {
        setDbLoadError(e.message || "Failed to load from database");
        setDbLoading(false);
      });
  }, [supabaseUrl, supabaseAnonKey]);

  const searchResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const q = globalSearch.toLowerCase();
    return clients
      .filter((c) =>
        fullName(c).toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [clients, globalSearch]);

  const updateClient = useCallback(
    (id, updates) => {
      setClients((cs) => cs.map((c) => (c.id === id ? { ...c, ...updates } : c)));
      if (usingDB) dbUpdateClient(supabaseUrl, supabaseAnonKey, id, updates).catch((e) => console.warn("DB updateClient:", e));
    },
    [usingDB, supabaseUrl, supabaseAnonKey]
  );

  const addClient = useCallback(
    async (newClient) => {
      setClients((cs) => [newClient, ...cs]);
      if (usingDB) await dbSaveClient(supabaseUrl, supabaseAnonKey, newClient);
    },
    [usingDB, supabaseUrl, supabaseAnonKey]
  );

  const saveTemplate = useCallback(
    (key, tpl) => setTemplates((t) => ({ ...t, [key]: tpl })),
    []
  );

  const goToClient = useCallback(
    (id) => {
      const c = clients.find((c) => c.id === id);
      if (c) { setSelected(c); setTab("clients"); }
    },
    [clients]
  );

  const handleSaveTask = useCallback(
    (t) => {
      setTasks((ts) => ts.some((x) => x.id === t.id) ? ts.map((x) => x.id === t.id ? t : x) : [...ts, t]);
      if (usingDB) dbSaveTask(supabaseUrl, supabaseAnonKey, t).catch((e) => console.warn("DB saveTask:", e));
    },
    [usingDB, supabaseUrl, supabaseAnonKey]
  );

  const handleToggleTask = useCallback(
    (id) => {
      setTasks((ts) => {
        const updated = ts.map((t) => t.id === id ? { ...t, done: !t.done } : t);
        const task = updated.find((t) => t.id === id);
        if (usingDB && task) dbSaveTask(supabaseUrl, supabaseAnonKey, task).catch((e) => console.warn("DB saveTask:", e));
        return updated;
      });
    },
    [usingDB, supabaseUrl, supabaseAnonKey]
  );

  const handleDeleteTask = useCallback(
    (id) => {
      setTasks((ts) => ts.filter((t) => t.id !== id));
      if (usingDB) dbDeleteTask(supabaseUrl, supabaseAnonKey, id).catch((e) => console.warn("DB deleteTask:", e));
    },
    [usingDB, supabaseUrl, supabaseAnonKey]
  );


    // Auth gate — only active when Supabase is configured
  if (!noSupabase) {
    if (auth.loading) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#fdf6ef,#f5e8d8)", fontFamily: "'DM Sans',sans-serif" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#a0785a,#7a5640)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: "0 4px 20px rgba(160,120,90,0.3)" }}>
              <span style={{ fontSize: 24, color: "#fff", fontWeight: "800" }}>CP</span>
            </div>
            <div style={{ fontSize: "14px", color: "#8a7a6a" }}>Loading…</div>
          </div>
        </div>
      );
    }
    if (!auth.user) {
      return (
        <LoginScreen
          onLogin={auth.signIn}
          onForgotPassword={auth.resetPassword}
          error={auth.error}
          loading={auth.loading}
          noSupabase={false}
        />
      );
    }
  }
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(160,120,90,0.3); border-radius: 4px; }
    input, select, textarea { font-family: 'DM Sans', sans-serif; color: #2e2418; }
    input::placeholder, textarea::placeholder { color: #b0a090; }
    button:hover { opacity: 0.88; }
    @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    .mobile-bottom-nav { display: none; }
    .header-search { display: flex; }
    .header-user-label { display: flex; }
    @media (max-width: 639px) {
      .desktop-nav { display: none !important; }
      .mobile-bottom-nav { display: flex !important; position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e8e0d6; z-index: 600; padding: 6px 0 max(6px, env(safe-area-inset-bottom)); }
      .main-scroll { padding-bottom: 72px !important; }
      .header-search { display: none !important; }
      .header-user-label { display: none !important; }
      .page-pad { padding: 16px !important; }
      .grid-2col { grid-template-columns: 1fr !important; }
      .grid-4col { grid-template-columns: 1fr 1fr !important; }
      .cp-card { padding: 16px !important; border-radius: 12px !important; }
      .sync-bar { font-size: 11px !important; padding: 6px 14px !important; }
      .cp-modal { width: 100vw !important; max-width: 100vw !important; border-radius: 16px 16px 0 0 !important; }
    }
    @media (min-width: 640px) and (max-width: 1023px) {
      .nav-label { display: none !important; }
      .grid-4col { grid-template-columns: 1fr 1fr !important; }
    }
  `;

  return (
    <div style={{ minHeight: "100vh", background: "#faf8f5", fontFamily: "'DM Sans',sans-serif", color: "#2e2418", display: "flex", flexDirection: "column" }}>
      <style>{CSS}</style>
      <header style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d6", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 500, gap: "12px" }}>
        <div onClick={() => setTab("dashboard")} style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0, cursor: "pointer" }}>
          <div style={{ width: "34px", height: "34px", background: "linear-gradient(135deg,#a0785a,#7a5640)", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 10px rgba(160,120,90,0.22)", flexShrink: 0 }}>
            <svg width="18" height="12" viewBox="0 0 32 20" fill="none">
              <path d="M2 10 Q6 2 10 10 Q14 18 18 10 Q22 2 26 10 Q28 14 30 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "800", color: "#1a120b", letterSpacing: "-0.3px" }}>ClientPulse</div>
        </div>

        <div className="header-search" style={{ flex: 1, maxWidth: "340px", position: "relative" }}>
          <svg style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search clients..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            onFocus={() => setShowGS(true)}
            onBlur={() => setTimeout(() => setShowGS(false), 200)}
            style={{ ...S.inp, paddingLeft: "32px", fontSize: "13px" }}
          />
          {showGS && globalSearch && searchResults.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", border: "1px solid #e8e0d6", borderRadius: "12px", overflow: "hidden", zIndex: 200, boxShadow: "0 12px 40px rgba(46,36,24,0.12)" }}>
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  onMouseDown={() => { goToClient(c.id); setGlobalSearch(""); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "none", border: "none", borderBottom: "1px solid #f0e8de", cursor: "pointer", textAlign: "left", fontFamily: "'DM Sans',sans-serif" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#fdf6ef"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>{fullName(c)}</div>
                    <div style={{ fontSize: "11px", color: "#8a7a6a", marginTop: "1px" }}>{c.phone || c.email}</div>
                  </div>
                  <StatusPill client={c} />
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="desktop-nav" style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "7px 11px", borderRadius: "9px",
                fontSize: "13px", fontWeight: "600",
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                transition: "all 0.15s", position: "relative",
                border: tab === item.id ? "1px solid #d4bfaa" : "1px solid transparent",
                background: tab === item.id ? "#f5ede4" : "transparent",
                color: tab === item.id ? "#7a5640" : "#8a7a6a",
              }}
            >
              <NavIcon item={item} size={15} />
              <span className="nav-label">{item.label}</span>
              {item.isPulse && lapseCount > 0 && (
                <span style={{ position: "absolute", top: "3px", right: "3px", width: "15px", height: "15px", background: "#c0392b", borderRadius: "50%", fontSize: "9px", fontWeight: "800", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {lapseCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 10px 5px 5px", background: "#f5ede4", borderRadius: "10px", border: "1px solid #e8e0d6", flexShrink: 0 }}>
          <div style={{ width: "28px", height: "28px", background: "linear-gradient(135deg,#a0785a,#7a5640)", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "800", color: "#fff" }}>D</div>
          <div className="header-user-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#2e2418", lineHeight: 1 }}>
                {auth.staff?.full_name?.split(" ")[0] || "Staff"}
              </div>
              <div style={{ fontSize: "9px", color: "#a0785a", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", marginTop: "1px" }}>
                {auth.staff?.role || "staff"}
              </div>
            </div>
            {auth.user && (
              <button onClick={auth.signOut}
                style={{ fontSize: "10px", fontWeight: "700", color: "#8a7a6a", background: "#f5ede4", border: "1px solid #e8d5c0", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main-scroll" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {tab === "dashboard" && <Dashboard clients={clients} tasks={tasks} onGoToClient={goToClient}
            onSaveTask={handleSaveTask}
            onToggleTask={handleToggleTask}
            onDeleteTask={handleDeleteTask}
            onFilterClients={(f) => { setFilter(f); setTab("clients"); }}
          />}
        {tab === "pulse"     && <PulsePage clients={clients} templates={templates} onGoToClient={goToClient} onUpdateClient={updateClient} />}
        {tab === "sales"     && <SalesDashboard supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} usingDB={usingDB} />}
        {tab === "settings"  && (
          <SettingsPage
            clientId={clientId} setClientId={setClientId}
            clientSecret={clientSecret} setClientSecret={setClientSecret}
            vagaroRegion={vagaroRegion} setVagaroRegion={setVagaroRegion}
            webhookLog={WEBHOOK_LOG}
            templates={templates} onSaveTemplate={saveTemplate}
            gmailClientId={gmailClientId} setGmailClientId={(id) => { setGmailClientId(id); }}
            supabaseUrl={supabaseUrl} setSupabaseUrl={setSupabaseUrl}
            supabaseAnonKey={supabaseAnonKey} setSupabaseAnonKey={setSupabaseAnonKey}
            usingDB={usingDB} dbError={dbLoadError}
            onAddClient={addClient}
            onFindDuplicates={() => setShowDuplicates(true)}
          />
        )}

        {showDuplicates && (
          <DuplicateMergeModal
            clients={clients}
            supabaseUrl={supabaseUrl}
            onMerged={(primaryId, duplicateId, merged) => {
              setClients((cs) => {
                const updated = cs.map((c) => c.id === primaryId ? { ...c, ...rowToClient({ id: primaryId, ...merged }) } : c);
                return updated.filter((c) => c.id !== duplicateId);
              });
            }}
            onClose={() => setShowDuplicates(false)}
          />
        )}
        {tab === "clients" && (
          <MobileClientShell
            clients={clients}
            selected={selected}
            setSelected={setSelected}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            updateClient={updateClient}
            templates={templates}
            onAddClient={addClient}
            supabaseUrl={supabaseUrl}
            supabaseAnonKey={supabaseAnonKey}
            usingDB={usingDB}
          />
        )}
      </main>

      <nav className="mobile-bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: "3px", padding: "6px 4px",
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif", position: "relative",
              color: tab === item.id ? "#a0785a" : "#b0a090",
            }}
          >
            <NavIcon item={item} size={20} />
            <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.2px" }}>{item.short}</span>
            {item.isPulse && lapseCount > 0 && (
              <span style={{ position: "absolute", top: "4px", left: "50%", marginLeft: "4px", width: "14px", height: "14px", background: "#c0392b", borderRadius: "50%", fontSize: "8px", fontWeight: "800", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {lapseCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

const WrappedApp = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default WrappedApp;
