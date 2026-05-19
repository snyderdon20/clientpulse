import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

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

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CFG = {
  "active":    { label: "Active",    bg: "#dcf5ec", color: "#0f7a4a" },
  "overdue":   { label: "Overdue",   bg: "#fef3c7", color: "#92400e" },
  "lapsed":    { label: "Lapsed",    bg: "#fee2e2", color: "#991b1b" },
  "new-lead":  { label: "New Lead",  bg: "#dbeafe", color: "#1d5fa8" },
  "follow-up": { label: "Follow-up", bg: "#ede9fe", color: "#5b21b6" },
};

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
const uid = () => Math.random().toString(36).slice(2, 8);
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
  const lastDate = lastCompletedDate(client);
  if (!lastDate) return "new-lead";
  const ds = daysSince(lastDate);
  const ivl = client.avgVisitIntervalDays || 30;
  if (ds > ivl * 2) return "lapsed";
  if (ds > ivl * 1.25) return "overdue";
  return "active";
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
const INITIAL_CLIENTS = [
  {
    id: "c1", firstName: "Sarah", lastName: "Mitchell",
    email: "sarah@email.com", phone: "(402) 555-0142",
    birthday: "1988-03-15", customerSince: "2022-01-10",
    avgVisitIntervalDays: 21, referredBy: "Google",
    tags: ["Deep Tissue", "Regular", "VIP"],
    careCategory: "stress",
    redLightStatus: "interested",
    waitlisted: false,
    goldenNuggets: [
      { id: "gn1", text: "Daughter's wedding in August — wants to look and feel her best", date: "2026-04-20", by: "Don Snyder" },
      { id: "gn2", text: "Loves lavender — always use it", date: "2026-03-30", by: "Jane Smith" },
      { id: "gn3", text: "Works at a desk all day — right shoulder is her trouble spot", date: "2026-02-10", by: "Jane Smith" },
    ],
    notes: "Prefers firm pressure on shoulders. Loves lavender. Great tipper — always goes 20%.",
    touchpoints: { reminder: true, postVisit: true, rebooking: false, birthday: false, promo: false },
    vagaroId: "vg-1001",
    appointments: [
      { id: "a1", date: TODAY,        time: "10:00", service: "Deep Tissue",     duration: 90, therapist: "Jane Smith", status: "scheduled"  },
      { id: "a2", date: "2026-04-20", time: "11:00", service: "Swedish Massage", duration: 60, therapist: "Jane Smith", status: "completed"  },
      { id: "a3", date: "2026-03-30", time: "11:00", service: "Deep Tissue",     duration: 90, therapist: "Jane Smith", status: "completed"  },
    ],
    history: [
      mkEvent("appt.scheduled",    "Deep Tissue 90 min with Jane Smith scheduled for today at 10:00 AM",                          { by: "System",     ts: pastTS(2, 9, 5)   }),
      mkEvent("comm.text",         "Appointment Reminder · Outcome: Sent · Automated reminder",                                   { by: "System",     ts: pastTS(1, 8, 0)   }),
      mkEvent("touchpoint.logged", "Touchpoint marked complete: Appointment Reminder",                                            { by: "Don Snyder", ts: pastTS(1, 8, 1)   }),
      mkEvent("comm.text",         "Rebooking Outreach · Outcome: Rebooked · Note: Texted re: next appt — she rebooked right away!", { by: "Don Snyder", ts: pastTS(24, 14, 30)}),
      mkEvent("touchpoint.logged", "Touchpoint marked complete: Post-Visit Follow-Up",                                            { by: "Don Snyder", ts: pastTS(25, 10, 0)  }),
      mkEvent("comm.phone",        "Post-Visit Follow-Up · Outcome: Spoke with Client · Note: Called after deep tissue. She loved it, asked about memberships.", { by: "Don Snyder", ts: pastTS(25, 10, 15)}),
      mkEvent("appt.completed",    "Swedish Massage 60 min with Jane Smith completed",                                            { by: "System",     ts: pastTS(26, 12, 5)  }),
      mkEvent("payment.charged",   "$96.00 charged (incl. $16.00 tip) — Swedish Massage · Method: Card on file",                 { by: "System",     ts: pastTS(26, 12, 7)  }),
      mkEvent("appt.checkin",      "Checked in for Swedish Massage at 10:58 AM",                                                  { by: "System",     ts: pastTS(26, 10, 58) }),
      mkEvent("appt.scheduled",    "Swedish Massage 60 min with Jane Smith scheduled for Apr 20 at 11:00 AM",                    { by: "System",     ts: pastTS(40, 9, 0)   }),
      mkEvent("appt.completed",    "Deep Tissue 90 min with Jane Smith completed",                                                { by: "System",     ts: pastTS(47, 13, 0)  }),
      mkEvent("payment.charged",   "$150.00 charged (incl. $25.00 tip) — Deep Tissue · Method: Card on file",                   { by: "System",     ts: pastTS(47, 13, 2)  }),
      mkEvent("client.created",    "Client record created via Vagaro",                                                            { by: "System",     ts: pastTS(500, 9, 0)  }),
    ],
  },
  {
    id: "c2", firstName: "Marcus", lastName: "Johnson",
    email: "marcus@email.com", phone: "(402) 555-0198",
    customerSince: "2023-06-01", avgVisitIntervalDays: 28, referredBy: "Lisa Drummond",
    tags: ["Sports", "Deep Tissue"],
    careCategory: "syndrome",
    redLightStatus: "offered",
    waitlisted: false,
    goldenNuggets: [
      { id: "gn4", text: "Training for a marathon — runs 40+ miles/week", date: "2026-02-10", by: "Jane Smith" },
      { id: "gn5", text: "No scents ever — allergic to most essential oils", date: "2023-06-01", by: "Don Snyder" },
    ],
    notes: "Tight hip flexors from running. Prefers no scent. Works out daily.",
    touchpoints: { reminder: true, postVisit: true, rebooking: true, birthday: false, promo: false },
    vagaroId: "vg-1002",
    appointments: [
      { id: "a4", date: "2026-02-10", time: "14:00", service: "Hot Stone",       duration: 75, therapist: "Jane Smith", status: "completed" },
      { id: "a5", date: "2025-12-15", time: "14:00", service: "Swedish Massage", duration: 60, therapist: "Jane Smith", status: "completed" },
    ],
    history: [
      mkEvent("comm.phone",        "Rebooking Outreach · Outcome: Left Voicemail · Note: Called, left voicemail. Try again next week.", { by: "Don Snyder", ts: pastTS(71, 15, 0)  }),
      mkEvent("touchpoint.logged", "Touchpoint marked complete: Rebooking Outreach",                                              { by: "Don Snyder", ts: pastTS(71, 15, 1)  }),
      mkEvent("appt.completed",    "Hot Stone 75 min with Jane Smith completed",                                                   { by: "System",     ts: pastTS(95, 15, 30) }),
      mkEvent("payment.charged",   "$125.00 charged (incl. $20.00 tip) — Hot Stone · Method: Card on file",                      { by: "System",     ts: pastTS(95, 15, 32) }),
      mkEvent("appt.checkin",      "Checked in for Hot Stone at 1:55 PM",                                                         { by: "System",     ts: pastTS(95, 13, 55) }),
      mkEvent("appt.scheduled",    "Hot Stone 75 min with Jane Smith scheduled for Feb 10 at 2:00 PM",                           { by: "System",     ts: pastTS(100, 9, 0)  }),
      mkEvent("client.created",    "Client record created via Vagaro — referred by Lisa Drummond",                                { by: "System",     ts: pastTS(700, 9, 0)  }),
    ],
  },
  {
    id: "c3", firstName: "Emily", lastName: "Chen",
    email: "emily.chen@email.com", phone: "(402) 555-0077",
    birthday: TODAY.slice(0, 5) + TODAY.slice(5),
    customerSince: "2024-02-14", avgVisitIntervalDays: 30, referredBy: "Sarah Mitchell",
    tags: ["Prenatal", "Relaxation"],
    careCategory: "prenatal",
    redLightStatus: null,
    waitlisted: false,
    goldenNuggets: [
      { id: "gn6", text: "Due in September — first baby, very nervous", date: "2026-04-01", by: "Jane Smith" },
      { id: "gn7", text: "Having trouble sleeping — hip pain at night", date: "2026-04-01", by: "Jane Smith" },
    ],
    notes: "Referred by Sarah Mitchell. Prenatal client — side-lying only, no essential oils.",
    touchpoints: { reminder: true, postVisit: false, rebooking: false, birthday: false, promo: false },
    vagaroId: "vg-1003",
    appointments: [
      { id: "a6", date: TODAY,        time: "10:00", service: "Swedish Massage", duration: 60, therapist: "Jane Smith", status: "checked-in" },
      { id: "a7", date: "2026-04-01", time: "10:00", service: "Swedish Massage", duration: 60, therapist: "Jane Smith", status: "completed"  },
    ],
    history: [
      mkEvent("appt.checkin",      "Checked in for Swedish Massage at 9:57 AM",                                                   { by: "System",     ts: nowMs() - 3600000  }),
      mkEvent("comm.email",        "Appointment Reminder · Outcome: Replied · Note: Sent reminder, she confirmed.",               { by: "Don Snyder", ts: nowMs() - 5400000  }),
      mkEvent("touchpoint.logged", "Touchpoint marked complete: Appointment Reminder",                                            { by: "Don Snyder", ts: nowMs() - 5399000  }),
      mkEvent("appt.scheduled",    "Swedish Massage 60 min with Jane Smith scheduled for today at 10:00 AM",                     { by: "System",     ts: pastTS(3, 9, 0)    }),
      mkEvent("appt.completed",    "Swedish Massage 60 min with Jane Smith completed",                                            { by: "System",     ts: pastTS(45, 11, 0)  }),
      mkEvent("payment.charged",   "$92.00 charged (incl. $12.00 tip) — Swedish Massage · Method: Card on file",                 { by: "System",     ts: pastTS(45, 11, 2)  }),
      mkEvent("client.created",    "Client record created via Vagaro — referred by Sarah Mitchell",                               { by: "System",     ts: pastTS(460, 10, 0) }),
    ],
  },
  {
    id: "c4", firstName: "Robert", lastName: "Tanner",
    email: "btanner@email.com", phone: "(402) 555-0334",
    customerSince: "2021-08-20", avgVisitIntervalDays: 35, referredBy: "",
    tags: ["Deep Tissue", "Corporate"],
    careCategory: "syndrome",
    redLightStatus: "declined",
    waitlisted: false,
    goldenNuggets: [
      { id: "gn8", text: "Chronic lower back — L4/L5 herniation diagnosed 2019", date: "2021-08-20", by: "Jane Smith" },
      { id: "gn9", text: "Retired — has flexibility on schedule, prefers mornings", date: "2022-01-01", by: "Don Snyder" },
    ],
    notes: "Long-time client. Chronic lower back pain. Very particular about pressure — always check in first.",
    touchpoints: { reminder: false, postVisit: true, rebooking: true, birthday: false, promo: true },
    vagaroId: "vg-1004",
    appointments: [
      { id: "a8", date: "2025-10-05", time: "09:00", service: "Deep Tissue", duration: 90, therapist: "Jane Smith", status: "completed" },
      { id: "a9", date: "2025-08-12", time: "09:00", service: "Deep Tissue", duration: 90, therapist: "Jane Smith", status: "completed" },
    ],
    history: [
      mkEvent("appt.completed",   "Deep Tissue 90 min with Jane Smith completed",                                                 { by: "System",     ts: pastTS(223, 10, 30) }),
      mkEvent("payment.charged",  "$150.00 charged (incl. $25.00 tip) — Deep Tissue · Method: Card on file",                    { by: "System",     ts: pastTS(223, 10, 32) }),
      mkEvent("appt.checkin",     "Checked in for Deep Tissue at 8:58 AM",                                                       { by: "System",     ts: pastTS(223, 8, 58)  }),
      mkEvent("appt.scheduled",   "Deep Tissue 90 min with Jane Smith scheduled for Oct 5 at 9:00 AM",                          { by: "System",     ts: pastTS(235, 14, 0)  }),
      mkEvent("appt.completed",   "Deep Tissue 90 min with Jane Smith completed",                                                 { by: "System",     ts: pastTS(277, 10, 30) }),
      mkEvent("payment.charged",  "$145.00 charged (incl. $20.00 tip) — Deep Tissue · Method: Card on file",                    { by: "System",     ts: pastTS(277, 10, 32) }),
      mkEvent("client.created",   "Client record created via Vagaro",                                                             { by: "System",     ts: pastTS(1200, 9, 0)  }),
    ],
  },
  {
    id: "c5", firstName: "Priya", lastName: "Patel",
    email: "priya@email.com", phone: "(402) 555-0251",
    customerSince: "2026-05-01", avgVisitIntervalDays: null, referredBy: "Instagram",
    tags: ["Prenatal", "Needs Follow-up"],
    careCategory: "prenatal",
    redLightStatus: null,
    waitlisted: true,
    goldenNuggets: [
      { id: "gn10", text: "Found us on Instagram — saw our prenatal post", date: "2026-05-01", by: "Don Snyder" },
    ],
    notes: "Inquired via Instagram. Interested in prenatal massage. Send info packet.",
    touchpoints: { reminder: false, postVisit: false, rebooking: false, birthday: false, promo: false },
    vagaroId: "vg-1005",
    appointments: [],
    history: [
      mkEvent("comm.text",     "General · Outcome: Replied · Note: Inquired about prenatal pricing. Sent info and package options.", { by: "Don Snyder", ts: pastTS(14, 11, 30) }),
      mkEvent("client.created","Client record created via Vagaro — source: Instagram inquiry",                                     { by: "System",     ts: pastTS(15, 10, 0)  }),
    ],
  },
  {
    id: "c6", firstName: "Lisa", lastName: "Drummond",
    email: "ldrummond@email.com", phone: "(402) 555-0189",
    customerSince: "2022-11-30", avgVisitIntervalDays: 28, referredBy: "",
    tags: ["Hot Stone", "Regular", "Monthly"],
    careCategory: "stress",
    redLightStatus: "active",
    waitlisted: false,
    goldenNuggets: [
      { id: "gn11", text: "Nurse — on her feet all day, carries everything in her shoulders", date: "2022-11-30", by: "Don Snyder" },
      { id: "gn12", text: "Has referred Marcus Johnson and Tom Bergstrom", date: "2023-06-01", by: "Don Snyder" },
      { id: "gn13", text: "Loves hot stone — says it's the only thing that gets her shoulders to release", date: "2024-01-15", by: "Amy Reed" },
    ],
    notes: "Hot stone regular. Usually books Amy. Has a bad right shoulder — don't overwork it.",
    touchpoints: { reminder: true, postVisit: true, rebooking: true, birthday: true, promo: false },
    vagaroId: "vg-1006",
    appointments: [
      { id: "a10", date: "2026-03-28", time: "13:00", service: "Hot Stone", duration: 75, therapist: "Amy Reed", status: "completed" },
    ],
    history: [
      mkEvent("comm.phone",    "Rebooking Outreach · Outcome: No Answer · Note: Tried to call, no answer. Will try again next week.", { by: "Don Snyder", ts: pastTS(31, 14, 0)  }),
      mkEvent("appt.completed","Hot Stone 75 min with Amy Reed completed",                                                           { by: "System",     ts: pastTS(49, 14, 30) }),
      mkEvent("payment.charged","$120.00 charged (incl. $15.00 tip) — Hot Stone · Method: Card on file",                            { by: "System",     ts: pastTS(49, 14, 32) }),
      mkEvent("appt.checkin",  "Checked in for Hot Stone at 12:57 PM",                                                              { by: "System",     ts: pastTS(49, 12, 57) }),
      mkEvent("appt.scheduled","Hot Stone 75 min with Amy Reed scheduled for Mar 28 at 1:00 PM",                                    { by: "System",     ts: pastTS(55, 9, 0)   }),
      mkEvent("client.created","Client record created via Vagaro",                                                                  { by: "System",     ts: pastTS(850, 9, 0)  }),
    ],
  },
  {
    id: "c7", firstName: "Tom", lastName: "Bergstrom",
    email: "tomberg@email.com", phone: "(402) 555-0422",
    customerSince: "2023-03-15", avgVisitIntervalDays: 30, referredBy: "Lisa Drummond",
    tags: ["Deep Tissue", "Monthly"],
    careCategory: "stress",
    redLightStatus: "interested",
    waitlisted: false,
    goldenNuggets: [
      { id: "gn14", text: "Construction manager — physical and mental stress both high", date: "2023-03-15", by: "Don Snyder" },
      { id: "gn15", text: "Wants to go monthly — lock in recurring appointment", date: "2026-04-25", by: "Amy Reed" },
    ],
    notes: "Deep tissue only. Very communicative about pressure. Wants to go monthly.",
    touchpoints: { reminder: true, postVisit: true, rebooking: false, birthday: false, promo: false },
    vagaroId: "vg-1007",
    appointments: [
      { id: "a11", date: "2026-05-20", time: "09:00", service: "Deep Tissue", duration: 60, therapist: "Amy Reed", status: "scheduled"  },
      { id: "a12", date: "2026-04-25", time: "09:00", service: "Deep Tissue", duration: 60, therapist: "Amy Reed", status: "completed" },
    ],
    history: [
      mkEvent("appt.scheduled",    "Deep Tissue 60 min with Amy Reed scheduled for May 20 at 9:00 AM",                          { by: "System",     ts: pastTS(5, 11, 0)   }),
      mkEvent("comm.text",         "Post-Visit Follow-Up · Outcome: Replied · Note: He loved it and wants to go monthly.",      { by: "Don Snyder", ts: pastTS(18, 10, 0)  }),
      mkEvent("touchpoint.logged", "Touchpoint marked complete: Post-Visit Follow-Up",                                          { by: "Don Snyder", ts: pastTS(18, 10, 1)  }),
      mkEvent("appt.completed",    "Deep Tissue 60 min with Amy Reed completed",                                                  { by: "System",     ts: pastTS(21, 10, 0)  }),
      mkEvent("payment.charged",   "$108.00 charged (incl. $18.00 tip) — Deep Tissue · Method: Card on file",                   { by: "System",     ts: pastTS(21, 10, 2)  }),
      mkEvent("appt.checkin",      "Checked in for Deep Tissue at 8:55 AM",                                                      { by: "System",     ts: pastTS(21, 8, 55)  }),
      mkEvent("appt.scheduled",    "Deep Tissue 60 min with Amy Reed scheduled for Apr 25 at 9:00 AM",                          { by: "System",     ts: pastTS(26, 14, 0)  }),
      mkEvent("client.created",    "Client record created via Vagaro — referred by Lisa Drummond",                               { by: "System",     ts: pastTS(780, 9, 0)  }),
    ],
  },
];

const WEBHOOK_LOG = [
  { id: "wh1", event: "appointment.booked",     time: new Date(Date.now() - 3 * 60000).toISOString(),    client: "Sarah Mitchell", detail: "Appointment booked for today at 10:00 AM" },
  { id: "wh2", event: "appointment.checked_in", time: new Date(Date.now() - 90 * 60000).toISOString(),   client: "Emily Chen",     detail: "Checked in for Swedish Massage" },
  { id: "wh3", event: "customer.updated",       time: new Date(Date.now() - 3 * 3600000).toISOString(),  client: "Tom Bergstrom",  detail: "Email address updated in Vagaro" },
  { id: "wh4", event: "customer.created",       time: new Date(Date.now() - 5 * 3600000).toISOString(),  client: "Priya Patel",    detail: "New customer record created in Vagaro" },
  { id: "wh5", event: "appointment.completed",  time: new Date(Date.now() - 24 * 3600000).toISOString(), client: "Lisa Drummond",  detail: "Hot Stone 75 min completed" },
];

const INITIAL_TASKS = [
  { id: "t1", title: "Order more massage oil — running low on lavender", dueDate: TODAY, clientId: null, createdBy: "Don Snyder", done: false, createdAt: pastTS(1, 9, 0) },
  { id: "t2", title: "Call insurance rep about coverage question", dueDate: TODAY, clientId: null, createdBy: "Don Snyder", done: false, createdAt: pastTS(1, 14, 0) },
  { id: "t3", title: "Update cancellation policy sign in lobby", dueDate: TODAY, clientId: null, createdBy: "Don Snyder", done: true,  createdAt: pastTS(2, 10, 0) },
];


// ─── TASK MODAL ───────────────────────────────────────────────────────────────
// ─── NEW CLIENT MODAL ─────────────────────────────────────────────────────────
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
function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, bg: "#e8e0d6", color: "#8a7a6a" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "3px 10px", borderRadius: "20px",
      fontSize: "11px", fontWeight: "700",
      background: cfg.bg, color: cfg.color, flexShrink: 0,
    }}>
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
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
function SyncBar({ mockMode, dbLoading, usingDB, dbError }) {
  if (dbLoading) return (
    <div className="sync-bar" style={{ background: "#ede9fe", borderBottom: "1px solid #c4b5fd", padding: "7px 24px", fontSize: "12px", fontWeight: "600", color: "#5b21b6", display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
      Loading client data from database…
    </div>
  );
  if (dbError) return (
    <div className="sync-bar" style={{ background: "#fee2e2", borderBottom: "1px solid #fca5a5", padding: "7px 24px", fontSize: "12px", fontWeight: "600", color: "#991b1b", display: "flex", alignItems: "center", gap: "8px" }}>
      ⚠️ Database error: {dbError} — showing local data
    </div>
  );
  if (usingDB) return (
    <div className="sync-bar" style={{ background: "#dcf5ec", borderBottom: "1px solid #86efac", padding: "7px 24px", fontSize: "12px", fontWeight: "600", color: "#0f7a4a", display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#0f7a4a" }} />
      Connected to Supabase — data is live and persistent
    </div>
  );
  if (mockMode) {
    return (
      <div className="sync-bar" style={{
        background: "#fef3c7", borderBottom: "1px solid #fde68a",
        padding: "7px 24px", fontSize: "12px", fontWeight: "600",
        color: "#92400e", display: "flex", alignItems: "center", gap: "8px",
      }}>
        Demo mode — displaying mock data. Add Supabase credentials in <strong style={{ marginLeft: 3 }}>Settings → Database</strong> to go live.
      </div>
    );
  }
  return (
    <div className="sync-bar" style={{
      background: "#dcf5ec", borderBottom: "1px solid #86efac",
      padding: "7px 24px", fontSize: "12px", fontWeight: "600",
      color: "#0f7a4a", display: "flex", alignItems: "center", gap: "8px",
    }}>
      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#0f7a4a" }} />
      Connected to Vagaro · Last sync: just now
    </div>
  );
}

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

function HistoryFeed({ history, onLog, onNote }) {
  const [filter, setFilter] = useState("all");
  const sorted = [...history].sort((a, b) => b.ts - a.ts);
  const shown  = sorted.filter((e) => filter === "all" || e.type.startsWith(filter));

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

      {shown.length === 0 && (
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
    </div>
  );
}


// ─── CLIENT DETAIL ────────────────────────────────────────────────────────────
function ClientDetail({ client, onUpdate, templates, allClients, onBack }) {
  const [showLog, setShowLog] = useState(false);

  const [showEdit, setShowEdit] = useState(false);

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

  const status = deriveStatus(client);
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
            <StatusPill status={status} />
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

      {status === "overdue" && ds && upcoming.length === 0 && (
        <div style={{ background: "#fff8f0", border: "1px solid #f0e0c8", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#92400e", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>⚠️ <strong>Attention:</strong> {client.firstName} last visited {ds} days ago, past their usual {interval}-day interval.</span>
          <button onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#d97706", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log outreach →
          </button>
        </div>
      )}
      {status === "lapsed" && ds && upcoming.length === 0 && (
        <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: "10px", padding: "11px 14px", marginBottom: "14px", fontSize: "13px", color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>🔴 <strong>Lapsed:</strong> {client.firstName} has not visited in {ds} days — more than 2x their usual interval.</span>
          <button onClick={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })} style={{ fontSize: "11px", fontWeight: "700", color: "#fff", background: "#dc2626", border: "none", borderRadius: "8px", padding: "5px 12px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
            Log outreach →
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
          onLog={() => setShowLog({ channel: "Text/SMS", category: "Rebooking Outreach" })}
          onNote={() => setShowLog({ noteMode: true })}
        />
      </div>
    </div>
  );
}


// ─── CLIENT SIDEBAR ───────────────────────────────────────────────────────────
const SIDEBAR_FILTERS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "overdue",  label: "Overdue"  },
  { key: "lapsed",   label: "Lapsed"   },
  { key: "new-lead", label: "New Lead" },
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
      const s = deriveStatus(cl);
      c[s] = (c[s] || 0) + 1;
    });
    return c;
  }, [clients]);

  const filtered = useMemo(() =>
    clients.filter((cl) => {
      const matchF = filter === "all" || deriveStatus(cl) === filter;
      const q = search.toLowerCase();
      const matchS = !q ||
        fullName(cl).toLowerCase().includes(q) ||
        cl.email?.toLowerCase().includes(q) ||
        cl.phone?.includes(q);
      const matchT = !tagFilter || (cl.tags || []).includes(tagFilter);
      return matchF && matchS && matchT;
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
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
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
          const st = deriveStatus(cl);
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
function Dashboard({ clients, tasks = [], onGoToClient, onSaveTask, onToggleTask, onDeleteTask }) {
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
    const c = { active: 0, overdue: 0, lapsed: 0, "new-lead": 0 };
    clients.forEach((cl) => { const s = deriveStatus(cl); if (c[s] !== undefined) c[s]++; });
    return c;
  }, [clients]);

  const statCards = [
    { label: "Active",    value: counts.active,       bg: "#dcf5ec", color: "#0f7a4a" },
    { label: "Overdue",   value: counts.overdue,       bg: "#fef3c7", color: "#92400e" },
    { label: "Lapsed",    value: counts.lapsed,        bg: "#fee2e2", color: "#991b1b" },
    { label: "New Leads", value: counts["new-lead"],   bg: "#dbeafe", color: "#1d5fa8" },
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

    // 3. Win-back — lapsed clients with no upcoming appointment
    clients.forEach((c) => {
      if (deriveStatus(c) !== "lapsed") return;
      const hasUpcoming = (c.appointments || []).some((a) => a.date >= selectedDate && a.status !== "cancelled");
      if (hasUpcoming) return;
      const ds = daysSince(lastCompletedDate(c));
      items.push({ type: "lapsed", priority: 2, client: c, reason: `Lapsed — ${ds} days since last visit`, icon: "🔴", color: "#991b1b", bg: "#fee2e2" });
    });

    // 4. Reach out — overdue clients with no upcoming appointment
    clients.forEach((c) => {
      if (deriveStatus(c) !== "overdue") return;
      const hasUpcoming = (c.appointments || []).some((a) => a.date >= selectedDate && a.status !== "cancelled");
      if (hasUpcoming) return;
      const ds = daysSince(lastCompletedDate(c));
      items.push({ type: "overdue", priority: 3, client: c, reason: `Overdue — ${ds} days since last visit (usually every ${c.avgVisitIntervalDays || 30}d)`, icon: "🟡", color: "#92400e", bg: "#fef3c7" });
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
          <div key={s.label} style={{ background: s.bg, borderRadius: "14px", padding: "16px 18px" }}>
            <div style={{ fontSize: "10px", fontWeight: "700", color: s.color, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "6px" }}>{s.label}</div>
            <div style={{ fontSize: "30px", fontWeight: "800", color: s.color, lineHeight: 1 }}>{s.value}</div>
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
    .filter((c) => deriveStatus(c) === "lapsed" && !(c.appointments || []).some((a) => a.date >= TODAY && a.status !== "cancelled"))
    .sort((a, b) => (daysSince(lastCompletedDate(b)) || 0) - (daysSince(lastCompletedDate(a)) || 0));

  const overdue = clients
    .filter((c) => deriveStatus(c) === "overdue" && !(c.appointments || []).some((a) => a.date >= TODAY && a.status !== "cancelled"))
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
                    <StatusPill status={deriveStatus(c)} />
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
function SettingsPage({ mockMode, setMockMode, apiKey, setApiKey, businessId, setBusinessId, webhookLog, templates, onSaveTemplate, gmailClientId, setGmailClientId, supabaseUrl, setSupabaseUrl, supabaseAnonKey, setSupabaseAnonKey, usingDB, dbError }) {
  const [activeTab, setActiveTab] = useState("database");
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const gmail = useGmail(getGmailClientId());

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    await new Promise((r) => setTimeout(r, 1400));
    if (mockMode) {
      setTestResult({ ok: true, msg: "Mock mode — connection simulated." });
    } else if (!apiKey || !businessId) {
      setTestResult({ ok: false, msg: "Missing API key or Business ID." });
    } else {
      setTestResult({ ok: false, msg: "Could not reach Vagaro API. Requires Vagaro Enterprise API access." });
    }
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
    { s: "active",   d: "Visited within their usual interval" },
    { s: "overdue",  d: "1.25x past their usual interval with no return" },
    { s: "lapsed",   d: "2x past their usual interval — win-back territory" },
    { s: "new-lead", d: "No completed visits yet" },
  ];

  return (
    <div className="page-pad" style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: "680px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "21px", fontWeight: "800", color: "#1a120b" }}>Settings</h2>
      <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#8a7a6a" }}>Configure your integration and outreach templates.</p>

      {/* Tab strip */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #e8e0d6" }}>
        {[{ key: "database", label: "Database" }, { key: "connection", label: "Vagaro" }, { key: "gmail", label: "Gmail" }, { key: "templates", label: "Templates" }].map((t) => (
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

          {/* Setup instructions */}
          <div style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418", marginBottom: 10 }}>Setup (one-time, ~5 minutes)</div>
            {[
              { n: "1", t: "Create a Supabase account", d: "Go to supabase.com → sign up free with Google" },
              { n: "2", t: "Create a new project", d: "Name it \"clientpulse\" · Region: US East · save your password" },
              { n: "3", t: "Run the database schema", d: "Go to SQL Editor → New query → paste the schema SQL → Run" },
              { n: "4", t: "Get your credentials", d: "Settings → API → copy Project URL and anon/public key" },
              { n: "5", t: "Paste them below", d: "Save and Client Pulse will connect automatically" },
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

          {/* Schema download */}
          <div style={{ ...S.card, marginBottom: 14, background: "#f8f7ff", border: "1px solid #e0d9ff" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418", marginBottom: 6 }}>📋 Step 3 — Database schema SQL</div>
            <div style={{ fontSize: "11px", color: "#8a7a6a", marginBottom: 10 }}>Copy this and paste it into Supabase SQL Editor → Run</div>
            <textarea
              readOnly
              value={`-- Client Pulse Database Schema
-- Paste this into Supabase SQL Editor and click Run

create extension if not exists "uuid-ossp";

create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  vagaro_id text unique, vagaro_synced boolean default false,
  first_name text not null, last_name text not null,
  email text, phone text, birthday date, customer_since date,
  avg_visit_interval_days integer default 30, referred_by text,
  care_category text, red_light_status text, waitlisted boolean default false,
  address text, city text, state text, zip text,
  tags text[] default '{}', golden_nuggets jsonb default '[]',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  vagaro_appt_id text unique, date date not null, time text,
  service text, duration integer, therapist text,
  status text, created_at timestamptz default now()
);

create table if not exists history (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  type text not null, detail text, by text default 'System',
  source text default 'manual', direction text,
  ts bigint not null default extract(epoch from now()) * 1000,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null, due_date date, client_id uuid references clients(id) on delete set null,
  created_by text default 'Don Snyder', done boolean default false,
  created_at timestamptz default now()
);

alter table clients enable row level security;
alter table appointments enable row level security;
alter table history enable row level security;
alter table tasks enable row level security;

create policy "Allow all" on clients for all using (true);
create policy "Allow all" on appointments for all using (true);
create policy "Allow all" on history for all using (true);
create policy "Allow all" on tasks for all using (true);`}
              onClick={(e) => { e.target.select(); document.execCommand("copy"); }}
              style={{ ...S.inp, minHeight: 120, fontSize: "10px", fontFamily: "monospace", lineHeight: "1.5", cursor: "pointer", resize: "vertical" }}
            />
            <div style={{ fontSize: "10px", color: "#b0a090", marginTop: 4 }}>Click to select all · then Ctrl+C / Cmd+C to copy</div>
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
            <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #86efac" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#065f46", marginBottom: 6 }}>✓ Database connected</div>
              <div style={{ fontSize: "12px", color: "#166534" }}>
                Client Pulse is loading and saving all data to Supabase. Changes persist across devices and browser refreshes.
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "connection" && (<>

      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Demo / mock mode</div>
            <div style={{ fontSize: "12px", color: "#8a7a6a" }}>Use realistic sample data instead of live Vagaro data</div>
          </div>
          <button
            onClick={() => setMockMode((m) => !m)}
            style={{ width: "46px", height: "26px", borderRadius: "100px", border: "none", cursor: "pointer", transition: "background 0.2s", background: mockMode ? "#a0785a" : "#ddd6cc", position: "relative", flexShrink: 0 }}
          >
            <span style={{ position: "absolute", top: "3px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", left: mockMode ? "23px" : "3px" }} />
          </button>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: "14px", opacity: mockMode ? 0.55 : 1 }}>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Vagaro API credentials</div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 16 }}>
          Requires Vagaro Enterprise API access —{" "}
          <a href="https://docs.vagaro.com" target="_blank" rel="noreferrer" style={{ color: "#a0785a" }}>
            docs.vagaro.com
          </a>
        </div>
        <label style={S.lbl}>API key</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your Vagaro Enterprise API key"
            disabled={mockMode}
            style={{ ...S.inp, fontFamily: "monospace", flex: 1 }}
          />
          <button style={S.sm("ghost")} onClick={() => setShowKey((s) => !s)} disabled={mockMode}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <label style={S.lbl}>Business ID</label>
        <input
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          placeholder="Your Vagaro Business ID"
          disabled={mockMode}
          style={{ ...S.inp, marginBottom: 16 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button style={S.btn("ghost")} onClick={testConnection} disabled={testing || mockMode}>
            {testing ? "Testing..." : "Test connection"}
          </button>
          {testResult && (
            <span style={{ fontSize: "12px", fontWeight: "600", color: testResult.ok ? "#0f7a4a" : "#991b1b" }}>
              {testResult.ok ? "Connected" : "Failed"}: {testResult.msg}
            </span>
          )}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418", marginBottom: 3 }}>Webhook setup guide</div>
        <div style={{ fontSize: "12px", color: "#8a7a6a", marginBottom: 14 }}>
          In Vagaro: <strong>Settings &rarr; Developers &rarr; APIs &amp; Webhooks &rarr; Create Webhook</strong>
        </div>
        {webhookEvents.map((w, i) => (
          <div key={w.e} style={{ display: "flex", gap: "10px", padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid #f0e8de" }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#a0785a", marginTop: 5, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#2e2418" }}>{w.e}</div>
              <div style={{ fontSize: "12px", color: "#8a7a6a" }}>{w.d}</div>
            </div>
          </div>
        ))}
        <div style={{ background: "#fff8f0", border: "1px solid #f0e0c8", borderRadius: "10px", padding: "11px 14px", marginTop: 14, fontSize: "12px", color: "#92400e", lineHeight: "1.5" }}>
          Webhooks require the <strong>APIs &amp; Webhooks add-on</strong> ($10/mo). Contact Vagaro Enterprise to enable.
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#2e2418" }}>Recent webhook events</div>
          <span style={{ fontSize: "11px", color: "#b0a090" }}>Mock data</span>
        </div>
        {webhookLog.map((ev, i) => (
          <div key={ev.id} style={{ display: "flex", gap: "10px", padding: "9px 0", borderBottom: i < webhookLog.length - 1 ? "1px solid #f0e8de" : "none" }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#0f7a4a", marginTop: 5, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#7a5640", fontWeight: "700" }}>{ev.event}</span>
                <span style={{ fontSize: "11px", color: "#b0a090" }}>{fmtWebhookTS(ev.time)}</span>
              </div>
              <div style={{ fontSize: "12px", color: "#7a6a5a" }}>{ev.client} · {ev.detail}</div>
            </div>
          </div>
        ))}
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

      {activeTab === "templates" && (
        <TemplatesPage templates={templates} onSave={onSaveTemplate} embedded />
      )}
    </div>
  );
}

// ─── MOBILE CLIENT SHELL ──────────────────────────────────────────────────────
function MobileClientShell({ clients, selected, setSelected, filter, setFilter, search, setSearch, tagFilter, setTagFilter, updateClient, templates, onAddClient }) {
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

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    id: "dashboard", label: "Overview", short: "Home",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  { id: "pulse",     label: "Pulse",     short: "Pulse",     isPulse: true },
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
  birthday: row.birthday, customerSince: row.customer_since,
  avgVisitIntervalDays: row.avg_visit_interval_days, referredBy: row.referred_by,
  careCategory: row.care_category, redLightStatus: row.red_light_status,
  waitlisted: row.waitlisted, address: row.address, city: row.city, state: row.state, zip: row.zip,
  tags: row.tags || [], goldenNuggets: row.golden_nuggets || [], appointments: [], history: [],
});

const clientToRow = (c) => ({
  vagaro_id: c.vagaroId || null, vagaro_synced: c.vagaroSynced || false,
  first_name: c.firstName, last_name: c.lastName, email: c.email || null, phone: c.phone || null,
  birthday: c.birthday || null, customer_since: c.customerSince || null,
  avg_visit_interval_days: c.avgVisitIntervalDays || 30, referred_by: c.referredBy || null,
  care_category: c.careCategory || null, red_light_status: c.redLightStatus || null,
  waitlisted: c.waitlisted || false, address: c.address || null, city: c.city || null,
  state: c.state || null, zip: c.zip || null, tags: c.tags || [], golden_nuggets: c.goldenNuggets || [],
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
  const map = { firstName:'first_name', lastName:'last_name', email:'email', phone:'phone', birthday:'birthday', customerSince:'customer_since', avgVisitIntervalDays:'avg_visit_interval_days', referredBy:'referred_by', careCategory:'care_category', redLightStatus:'red_light_status', waitlisted:'waitlisted', address:'address', city:'city', state:'state', zip:'zip', tags:'tags', goldenNuggets:'golden_nuggets', vagaroId:'vagaro_id', vagaroSynced:'vagaro_synced' };
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
  const [mockMode, setMockMode]         = useState(true);
  const [apiKey, setApiKey]             = useState("");
  const [businessId, setBusinessId]     = useState("");
  const [gmailClientId, setGmailClientId] = useState(() => localStorage.getItem("cp_gmail_client_id") || "");
  const [supabaseUrl,     setSupabaseUrl]     = useState(() => localStorage.getItem("cp_sb_url")  || "");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => localStorage.getItem("cp_sb_anon") || "");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbLoadError, setDbLoadError] = useState(null);
  const [usingDB, setUsingDB] = useState(false);

  setGlobalGmailClientId(gmailClientId);

  const noSupabase = !supabaseUrl || !supabaseAnonKey;
  const auth = useSupabaseAuth(supabaseUrl, supabaseAnonKey);

  const lapseCount = useMemo(
    () => clients.filter((c) => ["overdue", "lapsed"].includes(deriveStatus(c))).length,
    [clients]
  );

  // Load from Supabase when authenticated
  useEffect(() => {
    if (usingDB) return;
    if (!supabaseUrl || !supabaseAnonKey) return;
    if (!auth.user && !noSupabase) return;
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
  }, [supabaseUrl, supabaseAnonKey, auth.user]);

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
    (newClient) => {
      setClients((cs) => [newClient, ...cs]);
      if (usingDB) dbSaveClient(supabaseUrl, supabaseAnonKey, newClient).catch((e) => console.warn("DB saveClient:", e));
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
      <SyncBar mockMode={mockMode} dbLoading={dbLoading} usingDB={usingDB} dbError={dbLoadError} />

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
                  <StatusPill status={deriveStatus(c)} />
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
          />}
        {tab === "pulse"     && <PulsePage clients={clients} templates={templates} onGoToClient={goToClient} onUpdateClient={updateClient} />}
        {tab === "settings"  && (
          <SettingsPage
            mockMode={mockMode} setMockMode={setMockMode}
            apiKey={apiKey} setApiKey={setApiKey}
            businessId={businessId} setBusinessId={setBusinessId}
            webhookLog={WEBHOOK_LOG}
            templates={templates} onSaveTemplate={saveTemplate}
            gmailClientId={gmailClientId} setGmailClientId={(id) => { setGmailClientId(id); }}
            supabaseUrl={supabaseUrl} setSupabaseUrl={setSupabaseUrl}
            supabaseAnonKey={supabaseAnonKey} setSupabaseAnonKey={setSupabaseAnonKey}
            usingDB={usingDB} dbError={dbLoadError}
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
