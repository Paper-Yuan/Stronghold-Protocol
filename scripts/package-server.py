#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/package-server.py — Package Stronghold Protocol Server for Linux Deployment
Generates E:\\Workbox\\Stronghold-Protocol-v0.2.6-Server.tar.gz
"""

import os
import sys
import tarfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_TAR = os.path.abspath(os.path.join(ROOT, "..", "Stronghold-Protocol-v0.2.6-Server.tar.gz"))

# Also place a copy inside repo root for convenience
LOCAL_TAR = os.path.join(ROOT, "Stronghold-Protocol-v0.2.6-Server-Clean.tar.gz")

ITEMS = [
    "server",
    "shared",
    "data",
    "public",
    "node_modules",
    "deploy",
    "package.json",
    "package-lock.json",
    "deploy.sh",
    "start.sh",
    "start-windows.bat",
    "run-server.bat",
    "docker-compose.yml",
    "Dockerfile",
    "stronghold.service",
    "DEPLOY-README.md",
    "LICENSE",
    "NOTICE.md",
    "THIRD-PARTY-NOTICES.md",
]

def exclude_filter(tarinfo):
    name = tarinfo.name.replace("\\", "/")
    # Ignore git, cache, temp, test, android dirs inside items
    if "/.git" in name or name.startswith(".git"):
        return None
    if "/.cache" in name:
        return None
    if "/test" in name and not name.startswith("public/"):
        return None
    if name.endswith(".tmp") or name.endswith(".bak"):
        return None
    return tarinfo

def build_server_tar():
    print(f"[package-server] 打包服务器端...")
    print(f"  源工程目录: {ROOT}")
    print(f"  目标输出包: {OUTPUT_TAR}")

    start_time = time.time()

    with tarfile.open(OUTPUT_TAR, "w:gz", compresslevel=6) as tar:
        for item in ITEMS:
            full_path = os.path.join(ROOT, item)
            if not os.path.exists(full_path):
                print(f"  [跳过] 不存在: {item}")
                continue
            print(f"  -> 归档: {item}")
            tar.add(full_path, arcname=item, filter=exclude_filter)

    size_mb = os.path.getsize(OUTPUT_TAR) / (1024 * 1024)
    elapsed = time.time() - start_time
    print(f"[package-server] 完成! 大小: {size_mb:.2f} MB, 耗时: {elapsed:.1f} 秒")
    print(f"  文件已就绪: {OUTPUT_TAR}")

if __name__ == "__main__":
    build_server_tar()
