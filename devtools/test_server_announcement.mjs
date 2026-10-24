import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseAnnouncements, activeAnnouncement } from './shared/announcements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const announcementFile = process.env.SP_ANNOUNCEMENTS_FILE || path.join(ROOT, 'config/announcements.json');

console.log('announcementFile:', announcementFile, 'exists:', fs.existsSync(announcementFile));
const raw = fs.readFileSync(announcementFile, 'utf8');
const doc = JSON.parse(raw);
console.log('doc:', doc);
const rows = parseAnnouncements(doc);
console.log('rows:', rows);
const active = activeAnnouncement(rows, Date.now());
console.log('active:', active, 'now:', Date.now());
