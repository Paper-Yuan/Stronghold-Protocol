#!/usr/bin/env python3
"""tools/import-namecards.py — 导入「明日方舟个人名片合集」并生成索引。

WHAT THIS IS. 业主的素材包（`明日方舟个人名片合集.zip`，约 182 MB / 461 文件）是一堆按名片的文件夹：

    明日方舟个人名片/<名片名>/个人名片_<名片名>_侧标.png     (以及 _2 … _5 变体)
    明日方舟个人名片/<名片名>/个人名片_<名片名>_入口.png     (以及 _2 … _5)
    明日方舟个人名片/<名片名>/个人名片_<名片名>_预览1.png / 预览1+.png / 预览2.png …

本脚本把它们落成站点能直接吃的形状（**只写目标目录，不碰仓库里的其它文件**）：

    <out>/<ascii-slug>/side.webp  side_2.webp …  入口 entry.webp …  预览 preview.webp / preview_2.webp …
    <out>/index.json                              → 复制成 data/namecards.json（服务端 loadData 自动读取）

* **体积**：`_预览1+` 级别的原图 3.5 MB，所以统一转 **webp（宽 ≤1920、质量 88）**；原 png 不落进 public/。
* **命名**：中文名按 `ascii-slug` 归一（小写 + 下划线，去括号/标点），索引里保留 `name` 原文 —— 界面显示中文，
  路径只用 ascii（URL 里不出现中文，也不受大小写/百分号转义影响）。
* **不污染玩法包**：名片是通用大厅素材，不属于任何玩法包，不给 `annOnly` / `zjOnly` 之类标记。

USAGE
    python tools/import-namecards.py [--zip <path>] [--out <dir>] [--index <path>] [--max-width 1920] [--quality 88] [--dry-run]

    --out 默认 public/assets/namecard；`--index` 默认 <out>/index.json
    （本仓的沙箱里 public/assets/** 可能不可写，那就 `--out _annbuild/namecard`，再整体搬进去。）
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

from PIL import Image

DEFAULT_ZIP = str(Path.home() / 'Downloads' / '明日方舟个人名片合集.zip')
KINDS = {'侧标': 'side', '入口': 'entry', '预览': 'preview'}


def slugify(name: str) -> str:
    """中文/全角名 → ascii slug：规范化 → 只留字母数字 → 小写 + 下划线。空则回落到 hash 前缀。"""
    s = unicodedata.normalize('NFKD', name)
    s = re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_').lower()
    s = re.sub(r'_+', '_', s)
    if not s:
        # 纯中文/符号的名字没有 ascii 形式：用名字的稳定短哈希（ascii、确定、不撞车），绝不退化成空串
        s = 'card_' + hashlib.sha1(name.encode('utf-8')).hexdigest()[:8]
    return s[:64]


def classify(filename: str):
    """`个人名片_<名>_<kind><variant?>.png` → (kind, variant)。kind ∈ side/entry/preview；variant 是 '' 或 `_2`/`+`。"""
    stem = Path(filename).stem
    m = re.search(r'个人名片_(.+?)_(侧标|入口|预览)(.*)$', stem)
    if not m:
        return None, None
    kind = KINDS[m.group(2)]
    rest = m.group(3) or ''
    if rest.startswith('+'):
        rest = rest[1:] or ''
        variant = '_plus'
    elif rest.startswith('_'):
        variant = rest
    else:
        variant = ''
    variant = variant.replace('+', '_plus')
    if kind == 'preview' and variant.endswith('_plus'):
        variant = variant[: -len('_plus')] + '_plus'
    return kind, variant


def to_webp(data: bytes, max_width: int, quality: int) -> tuple[bytes, tuple[int, int]]:
    """PNG/JPEG 字节 → webp 字节（宽 ≤ max_width，等比缩）。"""
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert('RGB') if im.mode not in ('RGB', 'RGBA') else im
        w, h = im.size
        if w > max_width:
            im = im.resize((max_width, round(h * max_width / w)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=quality, method=4)
        return buf.getvalue(), im.size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', default=DEFAULT_ZIP)
    ap.add_argument('--out', default='public/assets/namecard')
    ap.add_argument('--index', default=None)
    ap.add_argument('--max-width', type=int, default=1920)
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    zpath = Path(args.zip)
    if not zpath.exists():
        print(f'zip not found: {zpath}', file=sys.stderr)
        return 1
    out = Path(args.out)
    index_path = Path(args.index) if args.index else out / 'index.json'

    with zipfile.ZipFile(zpath) as z:
        names = [n for n in z.namelist() if n.lower().endswith(('.png', '.jpg', '.jpeg'))]
        # <名片名> 是 `<根目录>/<名片名>/` 的那一段
        cards: dict[str, dict] = {}
        for n in names:
            parts = n.split('/')
            if len(parts) < 3:
                continue
            card_name = parts[-2]
            kind, variant = classify(parts[-1])
            if not kind:
                continue
            cards.setdefault(card_name, {}).setdefault(kind, {})[variant] = n

        print(f'{len(names)} images, {len(cards)} cards')
        if args.dry_run:
            for name, kinds in list(cards.items())[:3]:
                print(' ', name, '→', json.dumps({k: sorted(v) for k, v in kinds.items()}, ensure_ascii=False))
            return 0

        out.mkdir(parents=True, exist_ok=True)
        index = []
        seen_slugs: dict[str, str] = {}
        total_in = total_out = 0
        skipped = []
        for name in sorted(cards):
            kinds = cards[name]
            slug = slugify(name)
            base, n = slug, 1
            while slug in seen_slugs:
                n += 1
                slug = f'{base}_{n}'
            seen_slugs[slug] = name
            entry = {'id': slug, 'name': name, 'side': None, 'entry': None, 'preview': None, 'variants': {}}
            (out / slug).mkdir(parents=True, exist_ok=True)
            for kind, variants in kinds.items():
                entry['variants'][kind] = []
                for variant, member in sorted(variants.items()):
                    data = z.read(member)
                    total_in += len(data)
                    try:
                        webp, size = to_webp(data, args.max_width, args.quality)
                    except Exception as e:  # 一张坏图不该毁掉整批
                        skipped.append(f'{member}: {e}')
                        continue
                    total_out += len(webp)
                    fname = f'{kind}{variant}.webp'
                    (out / slug / fname).write_bytes(webp)
                    url = f'/assets/namecard/{slug}/{fname}'
                    entry['variants'][kind].append(url)
                    if entry[kind] is None:
                        entry[kind] = url  # 默认取第一个（预览 → 预览1 优先，见下面重排）
            # preview 默认值：优先 `预览1`（无变体），其次任意
            if kinds.get('preview'):
                first = next(iter(sorted(kinds['preview'])), None)
                if first is not None:
                    entry['preview'] = f"/assets/namecard/{slug}/preview{first}.webp"
            index.append(entry)

        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(json.dumps({
            '_doc': '明日方舟个人名片合集 的索引 —— 由 tools/import-namecards.py 生成（源包：明日方舟个人名片合集.zip）。'
                    'id = ascii slug，name = 中文原名；side/entry/preview 是默认可用的三张，variants 是全部变体（webp）。',
            'version': 1,
            'count': len(index),
            'cards': index,
        }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    print(f'wrote {len(index)} cards → {out}  (index: {index_path})')
    print(f'bytes: png in {total_in / 1e6:.1f} MB → webp out {total_out / 1e6:.1f} MB '
          f'({(total_out / total_in * 100) if total_in else 0:.1f} %)')
    if skipped:
        print(f'skipped {len(skipped)} image(s):')
        for s in skipped[:8]:
            print('  ', s)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
