// public/js/ui/modZipParser.js — thin shell over shared/modZip.js (CF_MOD_TRI_PLAN.md §2-D1-5).
// The legacy hand-rolled EOCD/central-directory walk and the pack-specific path hardcodes
// (former :144-149) are gone; metadata extraction lives on the shared dual-platform reader.

import { unpackModZip } from '../../shared/modZip.js';

/**
 * Parse a mod zip archive from File/Blob/ArrayBuffer and extract display metadata
 * (for the local-import flow in the mod manager UI). Content sections are NOT
 * persisted here — consumption goes through modStorage blobs + unpackModZip.
 */
export async function parseModZip(fileOrBuffer) {
  const arrayBuffer = fileOrBuffer instanceof ArrayBuffer
    ? fileOrBuffer
    : await fileOrBuffer.arrayBuffer();
  const { meta, sections, kits, art } = await unpackModZip(new Uint8Array(arrayBuffer));

  const packJson = meta ?? null;
  const readmeEntry = null; // README handled below via a light second pass if needed

  // README is a text member; find it via a fresh listing to keep this shell dumb.
  const { listZipEntries, readZipEntry } = await import('../../shared/modZip.js');
  const entries = listZipEntries(new Uint8Array(arrayBuffer));
  let readme = null;
  const readmeEntryMeta = entries.find((e) => e.name === 'README.md' || e.name.endsWith('/README.md'));
  if (readmeEntryMeta) {
    try {
      const bytes = await readZipEntry(new Uint8Array(arrayBuffer), readmeEntryMeta);
      readme = new TextDecoder('utf-8').decode(bytes);
    } catch { /* unreadable README is non-fatal for display */ }
  }

  const features = [];
  if (readme) {
    for (const line of readme.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('* **') || trimmed.startsWith('- **')) {
        features.push(trimmed.replace(/^[*\-]\s*\*\*/, '').replace(/\*\*[:：]?\s*/, '：').replace(/\*\*$/, ''));
      }
    }
  }
  const sectionNames = Object.keys(sections);
  if (!features.length) {
    if (sectionNames.includes('chess')) features.push('自定义干员与棋子扩展');
    if (sectionNames.includes('items') || sectionNames.includes('records')) features.push('自定义装备与盟约效果');
  }

  return {
    id: packJson?.id || 'mod',
    name: packJson?.name || '未知模组',
    version: packJson?.version || '1.0.0',
    app: packJson?.app || '>=0.2.0',
    credits: packJson?.credits || '社区同人作品',
    summary: packJson?._doc || `包含 ${entries.length} 个文件的自定义模组扩展包。`,
    readme,
    features,
    fileCount: entries.length,
    totalBytes: arrayBuffer.byteLength,
    packJson,
    manifestJson: null,
  };
}
