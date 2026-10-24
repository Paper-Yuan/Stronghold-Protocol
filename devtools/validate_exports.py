import os
import re

IMPORT_NAMED_RE = re.compile(r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]")
EXPORT_NAMED_RE = re.compile(r"export\s+(?:const|let|var|function|class)\s+([a-zA-Z0-9_$]+)")
EXPORT_LIST_RE = re.compile(r"export\s*\{([^}]+)\}")

files = {}
for root, dirs, fnames in os.walk('public/js'):
    for f in fnames:
        if f.endswith('.js'):
            p = os.path.normpath(os.path.join(root, f)).replace('\\', '/')
            with open(p, 'r', encoding='utf-8', errors='ignore') as fp:
                files[p] = fp.read()

def get_exports(path):
    if path not in files:
        return None
    c = files[path]
    exports = set()
    for m in EXPORT_NAMED_RE.finditer(c):
        exports.add(m.group(1))
    for m in EXPORT_LIST_RE.finditer(c):
        for item in m.group(1).split(','):
            parts = item.strip().split()
            if 'as' in parts:
                exports.add(parts[-1])
            elif parts:
                exports.add(parts[0])
    return exports

errors = []
for p, c in files.items():
    # clean comments
    lines = [l for l in c.split('\n') if not l.strip().startswith('//') and not l.strip().startswith('*')]
    clean = '\n'.join(lines)
    for m in IMPORT_NAMED_RE.finditer(clean):
        names = [n.strip().split()[0] for n in m.group(1).split(',') if n.strip()]
        spec = m.group(2)
        if spec.startswith('.'):
            target = os.path.normpath(os.path.join(os.path.dirname(p), spec)).replace('\\', '/')
            if not target.endswith('.js'):
                target += '.js'
            if target.startswith('public/js/'):
                target_exports = get_exports(target)
                if target_exports is not None:
                    for name in names:
                        if name not in target_exports:
                            errors.append(f"{p}: imports '{name}' from '{target}', but target only exports {sorted(list(target_exports))[:5]}...")

print(f"Total files analyzed: {len(files)}")
print(f"Export/Import mismatch errors: {len(errors)}")
for err in errors:
    print("  ->", err)
