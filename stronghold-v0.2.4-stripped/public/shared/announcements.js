// Temporary site notices use absolute server times, independent of rooms, rounds and client clocks.
export const ANNOUNCEMENT_LEVELS = Object.freeze({ info: 0, warning: 1, urgent: 2 });
export const ANNOUNCEMENT_MAX_TEXT = 500;
export const ANNOUNCEMENT_MAX_COUNT = 100;

const own = (obj, key) => Object.hasOwn(obj, key);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
function validTime(value) {
  if (typeof value !== 'string' || !TIME.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

/** Validate the whole document atomically: a half-written edit never replaces the last valid schedule. */
export function parseAnnouncements(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.announcements)
      || doc.announcements.length > ANNOUNCEMENT_MAX_COUNT) throw new Error('announcements must be an array of at most 100 entries');
  const ids = new Set();
  return doc.announcements.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid announcement');
    const { id, text, startAt, durationSeconds, level = 'info', enabled = true } = row;
    if (own(row, 'title') && (typeof row.title !== 'string' || !row.title.trim() || row.title.trim().length > 80)) {
      throw new Error(`${id}: title must contain 1..80 characters`);
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('announcement ids must be unique (1..64 letters, numbers, _ or -)');
    ids.add(id);
    if (typeof text !== 'string' || !text.trim() || [...text].length > ANNOUNCEMENT_MAX_TEXT
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${id}: text must contain 1..500 printable characters`);
    if (!validTime(startAt)) throw new Error(`${id}: startAt requires a valid ISO date with an explicit timezone`);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) throw new Error(`${id}: durationSeconds must be 1..86400`);
    if (typeof level !== 'string' || !own(ANNOUNCEMENT_LEVELS, level) || typeof enabled !== 'boolean') throw new Error(`${id}: invalid level or enabled flag`);
    const at = Date.parse(startAt);
    return { id, ...(own(row, 'title') ? { title: row.title.trim() } : {}),
      text: text.trim().replace(/\s+/g, ' '), startAt: at, endAt: at + durationSeconds * 1000, level, enabled };
  });
}

export function announcementLive(notice, now) {
  return !!notice && Number.isFinite(now) && Number.isFinite(notice.startAt) && Number.isFinite(notice.endAt)
    && notice.startAt <= now && now < notice.endAt;
}

/** Higher severity first; earliest start first among equals. Original file order breaks exact ties. */
export function activeAnnouncement(rows, now) {
  let best = null;
  for (const row of rows) {
    if (!row.enabled || !announcementLive(row, now)) continue;
    if (!best || ANNOUNCEMENT_LEVELS[row.level] > ANNOUNCEMENT_LEVELS[best.level]
        || (row.level === best.level && row.startAt < best.startAt)) best = row;
  }
  if (!best) return null;
  const { enabled, ...notice } = best;
  return notice;
}

/** Incoming public frame: accept only display fields; expiry is checked independently by the UI. */
export function announcementFromMessage(msg) {
  const n = msg?.announcement;
  if (!n || typeof n.id !== 'string' || typeof n.text !== 'string' || !n.text || [...n.text].length > ANNOUNCEMENT_MAX_TEXT
      || typeof n.level !== 'string' || !own(ANNOUNCEMENT_LEVELS, n.level) || !Number.isFinite(n.startAt) || !Number.isFinite(n.endAt)
      || n.endAt <= n.startAt) return null;
  return { id: n.id, text: n.text, level: n.level, startAt: n.startAt, endAt: n.endAt };
}
