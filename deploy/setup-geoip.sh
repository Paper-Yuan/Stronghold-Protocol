#!/usr/bin/env bash
# /opt/setup-geoip.sh — 配置仅允许中国大陆及合法监控节点访问，屏蔽所有国外 IP
set -euo pipefail

LOG_FILE="/var/log/stronghold/geoip.log"
mkdir -p /var/log/stronghold
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "[GEOIP] 开始配置中国大陆 IP 白名单防护 (基于 ipset + iptables)..."

# 1. 确保 ipset 与 curl 存在
if ! command -v ipset >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y ipset curl
fi

# 2. 创建临时 ipset 集合
ipset create cn_rules_tmp hash:net maxelem 65536 2>/dev/null || ipset flush cn_rules_tmp
ipset create cn_rules hash:net maxelem 65536 2>/dev/null || true

# 3. 下载中国大陆最新的 CIDR 列表
IP_TMP="/tmp/cn_ip.txt"
log "[GEOIP] 正在下载中国大陆最新 IP 网段列表..."
curl -s -m 20 "https://ispip.clang.cn/all_cn.txt" -o "$IP_TMP" || \
curl -s -m 20 "https://raw.githubusercontent.com/17mon/china_ip_list/master/china_ip_list.txt" -o "$IP_TMP"

if [[ ! -s "$IP_TMP" ]]; then
    log "[ERROR] IP 列表下载失败，保持现有规则以防误封！"
    exit 1
fi

# 4. 加载中国大陆 IP 网段到临时集合
log "[GEOIP] 正在装载 IP 规则 (约几千条 CIDR)..."
while read -r line; do
    [[ -n "$line" && ! "$line" =~ ^# ]] && ipset add cn_rules_tmp "$line" -exist 2>/dev/null || true
done < "$IP_TMP"

# 5. 添加内网和合法监控节点白名单（香港探测端、回环网络、私有网段）
log "[GEOIP] 添加白名单 (本地环回、内网网段、香港/广州跨服探测节点)..."
ipset add cn_rules_tmp 127.0.0.0/8 -exist
ipset add cn_rules_tmp 10.0.0.0/8 -exist
ipset add cn_rules_tmp 172.16.0.0/12 -exist
ipset add cn_rules_tmp 192.168.0.0/16 -exist
ipset add cn_rules_tmp 100.64.0.0/10 -exist

# 香港探测端与联机服务器
ipset add cn_rules_tmp 47.76.85.97 -exist       # 香港2/探测
ipset add cn_rules_tmp 8.218.227.79 -exist      # 香港1
ipset add cn_rules_tmp 101.33.199.173 -exist    # 香港服核心
ipset add cn_rules_tmp 111.230.139.242 -exist   # 广州服核心

# 6. 原子切换生效 (毫秒级切换，零断网)
ipset swap cn_rules_tmp cn_rules
ipset destroy cn_rules_tmp 2>/dev/null || true

# 7. 应用 iptables 规则 (针对游戏端口 3000 和 80 限制国外 IP)
log "[GEOIP] 应用 iptables 规则 (仅对 3000 和 80 端口放行国内 IP，拒绝国外)..."

# 保证已建立的连接正常通信
iptables -C INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
iptables -I INPUT 1 -m state --state ESTABLISHED,RELATED -j ACCEPT

# 确保 SSH 22 端口永不被误封 (防止失联)
iptables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || \
iptables -I INPUT 2 -p tcp --dport 22 -j ACCEPT

# 对 3000 端口：如果在 cn_rules 集合内则放行
iptables -C INPUT -p tcp --dport 3000 -m set --match-set cn_rules src -j ACCEPT 2>/dev/null || \
iptables -I INPUT 3 -p tcp --dport 3000 -m set --match-set cn_rules src -j ACCEPT

# 对 3000 端口：非中国 IP 直接拒绝
iptables -C INPUT -p tcp --dport 3000 -j DROP 2>/dev/null || \
iptables -A INPUT -p tcp --dport 3000 -j DROP

# 对 80 端口同理防护
iptables -C INPUT -p tcp --dport 80 -m set --match-set cn_rules src -j ACCEPT 2>/dev/null || \
iptables -I INPUT 4 -p tcp --dport 80 -m set --match-set cn_rules src -j ACCEPT
iptables -C INPUT -p tcp --dport 80 -j DROP 2>/dev/null || \
iptables -A INPUT -p tcp --dport 80 -j DROP

rm -f "$IP_TMP"
log "[SUCCESS] 国外 IP 访问屏蔽已完全就绪并生效！仅允许国内及授权白名单节点连接游戏端口。"
