#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/build-windows-zip.py
Pack E:\\Workbox\\Stronghold-Protocol-Windows into a standard UTF-8 encoded ZIP archive.
Ensures ZIP flag bit 11 (0x800 - Language Encoding Flag) is set so Chinese filenames
like '启动游戏.bat' and 'README-开箱即用.md' never garble in Windows Explorer, 7-Zip, WinRAR, etc.
"""

import os
import sys
import time
import zipfile

# Ensure console output doesn't crash on Windows GBK consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def build_zip(source_dir, output_zip):
    print(f"打包源目录: {source_dir}")
    print(f"目标 ZIP:  {output_zip}")

    if not os.path.isdir(source_dir):
        print(f"错误: 源目录不存在: {source_dir}", file=sys.stderr)
        sys.exit(1)

    parent_dir = os.path.dirname(os.path.abspath(source_dir))
    root_folder_name = os.path.basename(os.path.abspath(source_dir))

    tmp_zip = output_zip + ".tmp"
    if os.path.exists(tmp_zip):
        os.remove(tmp_zip)

    start_time = time.time()
    file_count = 0
    total_bytes = 0

    with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(source_dir):
            # Sort for deterministic archive order
            dirs.sort()
            files.sort()

            # Record directories
            for d in dirs:
                full_path = os.path.join(root, d)
                rel_path = os.path.relpath(full_path, parent_dir).replace("\\", "/") + "/"
                st = os.stat(full_path)
                mtime = time.localtime(st.st_mtime)
                date_time = (mtime.tm_year, mtime.tm_mon, mtime.tm_mday, mtime.tm_hour, mtime.tm_min, mtime.tm_sec)

                zinfo = zipfile.ZipInfo(filename=rel_path, date_time=date_time)
                zinfo.external_attr = 0o755 << 16 | 0x10  # directory attribute
                zinfo.flag_bits |= 0x800  # Enforce UTF-8 encoding flag
                z.writestr(zinfo, b"")

            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, parent_dir).replace("\\", "/")
                st = os.stat(full_path)
                mtime = time.localtime(st.st_mtime)
                date_time = (mtime.tm_year, mtime.tm_mon, mtime.tm_mday, mtime.tm_hour, mtime.tm_min, mtime.tm_sec)

                zinfo = zipfile.ZipInfo(filename=rel_path, date_time=date_time)
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                zinfo.external_attr = 0o644 << 16  # standard file attribute
                zinfo.flag_bits |= 0x800  # Enforce UTF-8 encoding flag

                with open(full_path, "rb") as fp:
                    data = fp.read()
                    z.writestr(zinfo, data)

                file_count += 1
                total_bytes += len(data)
                if file_count % 2000 == 0:
                    print(f"  已压缩 {file_count} 个文件 ({total_bytes / (1024*1024):.1f} MB)...")

    if os.path.exists(output_zip):
        os.remove(output_zip)
    os.rename(tmp_zip, output_zip)

    elapsed = time.time() - start_time
    zip_size = os.path.getsize(output_zip)
    print(f"\n✔ 打包完成: {output_zip}")
    print(f"  文件总数: {file_count} 个")
    print(f"  原始大小: {total_bytes / (1024*1024):.1f} MB")
    print(f"  压缩后:   {zip_size / (1024*1024):.1f} MB")
    print(f"  耗时:     {elapsed:.1f} 秒\n")

    # Verify UTF-8 flags
    print("正在自检 ZIP 文件名编码与 UTF-8 标记...")
    with zipfile.ZipFile(output_zip, "r") as z:
        checked_non_ascii = 0
        for info in z.infolist():
            has_utf8 = bool(info.flag_bits & 0x800)
            if any(ord(c) > 127 for c in info.filename):
                checked_non_ascii += 1
                assert has_utf8, f"文件 {info.filename} 未包含 UTF-8 标记位!"
                print(f"  ✔ 验证非 ASCII 条目: {info.filename} [flag={hex(info.flag_bits)}, UTF-8={has_utf8}]")
        print(f"✔ 自检通过: 全部 {len(z.infolist())} 个条目均符合 UTF-8 规范 (其中非 ASCII 条目 {checked_non_ascii} 个)")

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else r"E:\Workbox\Stronghold-Protocol-Windows"
    dst = sys.argv[2] if len(sys.argv) > 2 else r"E:\Workbox\Stronghold-Protocol-v0.1.6-pre-skin-Windows-x64.zip"
    build_zip(src, dst)
