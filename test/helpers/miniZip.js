// test/helpers/miniZip.js — shared minimal zip builder for mod pipeline tests.
// Single implementation lives in server/mod/zipWriter.js (the publish pipeline uses the
// same writer, so fixtures and produced archives are byte-compatible); re-exported here
// so existing tests keep their import path.
import { createHash } from 'node:crypto';
import { buildZip, crc32 } from '../../server/mod/zipWriter.js';

export { buildZip, crc32 };

export function shaOf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
