# -*- coding: utf-8 -*-
"""解析 QQ 群官网 (qun.qq.com) 群成员接口返回的 JSON，提取昵称。

用法：
  1) 浏览器打开 qun.qq.com，进入任一「卫戍协议 鸢」群 → 群成员
  2) F12 → Network → 筛选 "member" 或 "get_group_member_list"
  3) 右键请求 → Copy → Copy response
  4) 存成 .cache/qq-member-N.json
  5) python tools/parse-qq-members.py
"""
import json, glob, os, sys, re

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache', 'qq-names.json')

def dig_names(node, acc):
    """递归找所有可能的昵称字段。"""
    if isinstance(node, dict):
        for k, v in node.items():
            kl = k.lower()
            if kl in ('nick', 'nickname', 'name', 'card', 'remark', 'member_name', 'uin_nick'):
                if isinstance(v, str) and v.strip():
                    acc.add(v.strip())
            else:
                dig_names(v, acc)
    elif isinstance(node, list):
        for v in node:
            dig_names(v, acc)

def main():
    files = sorted(glob.glob(os.path.join(CACHE, 'qq-member-*.json')))
    if not files:
        print('  没找到 .cache/qq-member-*.json')
        print('  请把接口响应存成 .cache/qq-member-1.json … qq-member-8.json')
        return
    all_names = set()
    for f in files:
        raw = open(f, encoding='utf-8', errors='replace').read().strip()
        # 接口有时返回 JSONP: callback({...})
        m = re.match(r'^[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$', raw)
        if m:
            raw = m.group(1)
        try:
            data = json.loads(raw)
        except Exception as e:
            print(f'  {os.path.basename(f)}: 解析失败 {e}')
            continue
        before = len(all_names)
        dig_names(data, all_names)
        print(f'  {os.path.basename(f)}: 新增 {len(all_names) - before} 个昵称')
    names = sorted(all_names)
    json.dump(names, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print()
    print(f'  共 {len(names)} 个唯一昵称 → {OUT}')
    for n in names[:20]:
        print('    ' + n)

if __name__ == '__main__':
    main()
