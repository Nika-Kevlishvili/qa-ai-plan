import fs from "fs";

const planPath = new URL("../plan.json", import.meta.url);
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_API_TOKEN || "";
const base = (process.env.JIRA_BASE_URL || "https://oppa-support.atlassian.net").replace(/\/+$/, "");

if (!email || !token) {
  console.error("Missing JIRA_EMAIL or JIRA_API_TOKEN");
  process.exit(1);
}

const auth = Buffer.from(`${email}:${token}`).toString("base64");

function tbilisiDate(iso) {
  if (!iso) return "";
  const normalized = String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function nowTbilisi() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}+04:00`;
}

async function jira(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${path} ${body.slice(0, 180)}`);
  }
  return response.json();
}

async function loadIssue(key) {
  const issue = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=status,resolutiondate,priority&expand=changelog`);
  const histories = [...(issue.changelog?.histories || [])];
  let startAt = histories.length;
  const total = issue.changelog?.total || histories.length;
  while (startAt < total) {
    const page = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`);
    histories.push(...(page.values || []));
    startAt += (page.values || []).length || 100;
    if (!(page.values || []).length) break;
  }
  const status = issue.fields?.status?.name || "";
  const transitions = [];
  for (const history of histories) {
    for (const item of history.items || []) {
      if (item.field === "status") transitions.push({ at: history.created, to: item.toString || "" });
    }
  }
  const latestTo = (name) => {
    const hits = transitions.filter((item) => item.to === name);
    hits.sort((a, b) => new Date(a.at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) - new Date(b.at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
    return hits.length ? hits[hits.length - 1].at : "";
  };
  let since = "";
  let done = "";
  if (status === "In Progress") since = tbilisiDate(latestTo("In Progress"));
  if (status === "Done") done = tbilisiDate(issue.fields?.resolutiondate) || tbilisiDate(latestTo("Done"));
  return { status, since, done, priority: issue.fields?.priority?.name || "" };
}

const PRIORITY_RANK = { Urgent: "high", Highest: "high", High: "high", Medium: "medium", Low: "low", Lowest: "low" };
const PRIORITY_ORDER = { high: 3, medium: 2, low: 1 };

function planPriority(name) {
  return PRIORITY_RANK[name] || "";
}

function applyRowPriority(item, issues) {
  const keys = Array.isArray(item.links) && item.links.length
    ? item.links.map((link) => link.key).filter(Boolean)
    : (item.jira ? [item.jira] : []);
  if (!keys.length) return;
  let best = "";
  let bestRank = 0;
  for (const key of keys) {
    const mapped = planPriority(issues.get(key)?.priority);
    const rank = PRIORITY_ORDER[mapped] || 0;
    if (rank > bestRank) {
      best = mapped;
      bestRank = rank;
    }
  }
  if (best) item.priority = best;
}

function planStamp(plan) {
  const lines = [];
  for (const quarter of plan.quarters || []) {
    for (const item of quarter.items || []) {
      const bits = [quarter.id, item.id, item.priority || ""];
      if (Array.isArray(item.links) && item.links.length) {
        for (const link of item.links) if (link.key) bits.push(stamp(link));
      } else if (item.jira) {
        bits.push(stamp(item));
      }
      lines.push(bits.join("|"));
    }
  }
  return lines.join("\n");
}

function linkedTargets(plan) {
  const targets = [];
  for (const quarter of plan.quarters || []) {
    for (const item of quarter.items || []) {
      if (Array.isArray(item.links) && item.links.length) {
        for (const link of item.links) {
          if (link.key) targets.push(link);
        }
      } else if (item.jira) {
        targets.push(item);
      }
    }
  }
  return targets;
}

function stamp(target) {
  return [target.key || target.jira, target.status || "", target.since || "", target.done || ""].join("|");
}

async function mapPool(items, limit, worker) {
  const results = new Map();
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const key = items[cursor];
      cursor += 1;
      results.set(key, await worker(key));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const targets = linkedTargets(plan);
const keys = [...new Set(targets.map((target) => target.key || target.jira))];
const before = planStamp(plan);
const issues = await mapPool(keys, 6, loadIssue);

for (const target of targets) {
  const key = target.key || target.jira;
  const info = issues.get(key);
  if (!info || !info.status) throw new Error(`No status for ${key}`);
  target.status = info.status;
  if (info.status === "In Progress") {
    if (info.since) target.since = info.since;
    else delete target.since;
    delete target.done;
  } else if (info.status === "Done") {
    if (info.done) target.done = info.done;
    else delete target.done;
    delete target.since;
  } else {
    delete target.since;
    delete target.done;
  }
}

for (const quarter of plan.quarters || []) {
  for (const item of quarter.items || []) applyRowPriority(item, issues);
}

const after = planStamp(plan);
if (before === after) {
  console.log(`unchanged ${keys.length} tickets`);
  process.exit(0);
}
plan.updatedAt = nowTbilisi();
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
console.log(`updated ${keys.length} tickets`);
