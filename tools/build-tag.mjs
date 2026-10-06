#!/usr/bin/env node
// tools/build-tag.mjs — the ONE identity both packagers must agree on.
//
// The tag names the SOURCE TREE, never the zip's bytes: the built-in app_bundle.zip carries
// public/assets (~361 MB) while a lean hot-update bundle deliberately does not, so a content hash of
// either archive can never equal the other's. UpdateManager compares this tag against
// bundle/.bundle_version to decide whether an update exists — a mismatch it can never converge from
// means "offer the same update on every cold start" forever.
//
// `-dirty` is part of the identity on purpose: an APK built from uncommitted fixes and an R2 bundle
// published later from the committed tree are different code, and one extra download is the honest
// result of that (it converges after applying, since the applied tag is written to .bundle_version).

import { spawnSync } from 'node:child_process';

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : null;
}

/** Short HEAD hash, or null when the tree isn't a git checkout / git is unavailable. */
export function gitShortHash(root) {
  const out = git(['rev-parse', '--short', 'HEAD'], root);
  const hash = (out || '').trim();
  return hash ? hash : null;
}

/** Any tracked or genuinely untracked change at all (git already skips ignored paths). */
export function isWorkingTreeDirty(root) {
  const out = git(['status', '--porcelain'], root);
  return out !== null && out.trim() !== '';
}

/**
 * @param {string} root repo root (where git runs)
 * @param {string} version package.json version shared by both packagers
 */
export function computeBuildTag(root, version) {
  const hash = gitShortHash(root);
  if (!hash) return `${version}-nogit`;
  return `${version}-${hash}${isWorkingTreeDirty(root) ? '-dirty' : ''}`;
}
