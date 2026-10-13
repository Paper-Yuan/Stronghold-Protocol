import os

# 读取安装包 lobby.js
with open('.cache/ui-hub-package/payload/public/js/screens/lobby.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 剥离无限火力:
# 1. CAN_FIREPOWER 设为 false
content = content.replace("const CAN_FIREPOWER = HAS('room.setRandom');", "const CAN_FIREPOWER = false; // 剥离无限火力")

# 2. initialSimulation 遇到 firepower 时回退为 standard
content = content.replace("if (loadPref('lobby.random', false) === true) return 'firepower';", "// 剥离无限火力: 不恢复 firepower\n  // if (loadPref('lobby.random', false) === true) return 'firepower';")

with open('public/js/screens/lobby.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Successfully stripped firepower from lobby.js and installed to public/js/screens/lobby.js')
