import urllib.request
import json
import sys

msg = sys.argv[1] if len(sys.argv) > 1 else '【全服维护警告】服务器将于 60 秒后进行冷启动升级维护，届时连接将短暂重置！'
data = json.dumps({'message': msg}).encode('utf-8')
req = urllib.request.Request('http://127.0.0.1:3000/api/admin/broadcast', data=data, headers={
    'Cookie': 'admin_token=stronghold-admin-2026',
    'Content-Type': 'application/json'
})
try:
    with urllib.request.urlopen(req) as resp:
        print('Broadcast success:', resp.read().decode('utf-8'))
except Exception as e:
    print('Broadcast error:', e)
