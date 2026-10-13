import json
from pathlib import Path
from PIL import Image

def sync_scenes():
    manifest_path = Path("data/local-assets.json")
    if not manifest_path.exists():
        manifest_path = Path("public/data/local-assets.json")
    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    groups = doc.setdefault("groups", {})

    scene_dir = Path("public/assets/local/scene")
    stages = [p.name for p in scene_dir.iterdir() if p.is_dir() and p.name != "tex"]
    print("Stages found:", stages)

    for st in stages:
        st_group = f"scene/{st}"
        g = groups.setdefault(st_group, {})
        bin_path = scene_dir / st / "scene.bin"
        if bin_path.exists():
            g["bin"] = {"path": f"/assets/local/scene/{st}/scene.bin", "kind": "SceneData", "bytes": bin_path.stat().st_size}
        json_path = scene_dir / st / "scene.json"
        if json_path.exists():
            st_json = json.loads(json_path.read_text(encoding="utf-8"))
            g["scene"] = {"path": f"/assets/local/scene/{st}/scene.json", "kind": "Scene", "chunks": len(st_json.get("chunks", []))}
        for lm_file in (scene_dir / st).glob("lm*.png"):
            name = lm_file.stem
            webp_file = lm_file.with_suffix(".webp")
            has_webp = webp_file.exists()
            chosen = f"{name}.webp" if has_webp else f"{name}.png"
            with Image.open(lm_file) as im:
                w, h = im.size
            entry = {"path": f"/assets/local/scene/{st}/{chosen}", "w": w, "h": h, "kind": "Lightmap"}
            if has_webp:
                entry["png"] = f"/assets/local/scene/{st}/{name}.png"
            g[name] = entry

    tex_group = "scene/tex"
    tg = groups.setdefault(tex_group, {})
    tex_dir = scene_dir / "tex"
    if tex_dir.exists():
        for tex_file in tex_dir.glob("*.png"):
            name = tex_file.stem
            webp_file = tex_file.with_suffix(".webp")
            has_webp = webp_file.exists()
            chosen = f"{name}.webp" if has_webp else f"{name}.png"
            with Image.open(tex_file) as im:
                w, h = im.size
            entry = {"path": f"/assets/local/scene/tex/{chosen}", "w": w, "h": h, "kind": "Texture2D"}
            if has_webp:
                entry["png"] = f"/assets/local/scene/tex/{name}.png"
            tg[name] = entry

    doc["count"] = sum(len(v) for v in groups.values())
    raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    Path("data/local-assets.json").write_text(raw, encoding="utf-8")
    Path("public/data/local-assets.json").write_text(raw, encoding="utf-8")
    print(f"Success! Total manifest entries: {doc['count']}")

if __name__ == "__main__":
    sync_scenes()
