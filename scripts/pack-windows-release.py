import os
import shutil
import sys
import zipfile
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def sync_dir(src, dst):
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        target_dir = os.path.join(dst, rel)
        os.makedirs(target_dir, exist_ok=True)
        for f in files:
            s_file = os.path.join(root, f)
            d_file = os.path.join(target_dir, f)
            if not os.path.exists(d_file) or os.path.getmtime(s_file) > os.path.getmtime(d_file):
                shutil.copy2(s_file, d_file)

def main():
    root = r"E:\Workbox\sp-upgrade-2.1"
    win_dir = r"E:\Workbox\Stronghold-Protocol-Windows"
    app_dir = os.path.join(win_dir, "app")
    
    print("1. 同步 public/assets 到便携包目录...")
    sync_dir(os.path.join(root, "public", "assets"), os.path.join(app_dir, "public", "assets"))
    
    print("2. 同步 data/assets.json、public/js、shared 与 server 脚本...")
    if os.path.exists(os.path.join(root, "data", "assets.json")):
        shutil.copy2(os.path.join(root, "data", "assets.json"), os.path.join(app_dir, "data", "assets.json"))
    sync_dir(os.path.join(root, "public", "js"), os.path.join(app_dir, "public", "js"))
    sync_dir(os.path.join(root, "shared"), os.path.join(app_dir, "shared"))
    sync_dir(os.path.join(root, "server"), os.path.join(app_dir, "server"))
    
    # 验证关键文件
    test_skel = os.path.join(app_dir, "public", "assets", "spine", "op", "char_003_kalts", "front", "char_003_kalts.skel")
    test_skill = os.path.join(app_dir, "public", "assets", "skill", "skchr_kalts_3.png")
    assert os.path.exists(test_skel), f"Missing: {test_skel}"
    assert os.path.exists(test_skill), f"Missing: {test_skill}"
    print("[OK] 关键资产验证通过：Spine 骨架与技能图标均已就位！")
    
    print("3. 打包为 鸢-0.2.1-Windows-x64.zip...")
    out_zip = r"E:\Workbox\鸢-0.2.1-Windows-x64.zip"
    tmp_zip = out_zip + ".tmp"
    if os.path.exists(tmp_zip): os.remove(tmp_zip)
    
    file_count = 0
    total_bytes = 0
    t0 = time.time()
    
    with zipfile.ZipFile(tmp_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for r_dir, dirs, files in os.walk(win_dir):
            for f in files:
                abs_p = os.path.join(r_dir, f)
                rel_p = os.path.relpath(abs_p, os.path.dirname(win_dir))
                
                info = zipfile.ZipInfo.from_file(abs_p, rel_p)
                info.flag_bits |= 0x800  # UTF-8
                
                with open(abs_p, 'rb') as fp:
                    z.writestr(info, fp.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
                
                file_count += 1
                total_bytes += os.path.getsize(abs_p)
                if file_count % 1000 == 0:
                    print(f"  已压缩 {file_count} 个文件 ({total_bytes / (1024*1024):.1f} MB)...")
                    
    if os.path.exists(out_zip): os.remove(out_zip)
    os.rename(tmp_zip, out_zip)
    print(f"\n[OK] Windows 包打包完成: {out_zip} ({os.path.getsize(out_zip) / (1024*1024):.1f} MB), 耗时 {time.time() - t0:.1f} 秒\n")

if __name__ == "__main__":
    main()
