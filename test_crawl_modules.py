import urllib.request
import re
import sys
from urllib.parse import urljoin

base_url = 'http://101.37.150.107:3000/'
visited = set()
queue = ['/js/main.js', '/fullscreen-guide.js']
errors = []

# preact, hooks, htm mapped in import map
import_map = {
    'preact': '/vendor/preact.module.js',
    'preact/hooks': '/vendor/hooks.module.js',
    'htm': '/vendor/htm.module.js'
}

while queue:
    curr = queue.pop(0)
    if curr in visited:
        continue
    visited.add(curr)
    full_url = urljoin(base_url, curr)
    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            # find real imports (exclude comment lines)
            lines = [l for l in content.split('\n') if not l.strip().startswith('//') and not l.strip().startswith('*')]
            code = '\n'.join(lines)
            import_matches = re.findall(r"(?:import|export)\s+.*?from\s+['\"](.*?)['\"]", code)
            import_matches += re.findall(r"import\s*\(\s*['\"](.*?)['\"]", code)
            for m in import_matches:
                if m in import_map:
                    resolved = import_map[m]
                elif m.startswith('http://') or m.startswith('https://') or m.startswith('//'):
                    continue
                else:
                    resolved = urljoin(curr, m)
                if resolved not in visited and resolved not in queue:
                    queue.append(resolved)
    except Exception as e:
        errors.append((curr, str(e)))

print(f"Total checked: {len(visited)}")
print(f"Errors: {errors}")
