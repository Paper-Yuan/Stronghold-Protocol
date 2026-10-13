import os

# 读取安装包 room.js
with open('.cache/ui-hub-package/payload/public/js/screens/room.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 剥离无限火力:
# 1. firepower 强制为 false
content = content.replace("const firepower = room?.random === true;", "const firepower = false; // 剥离无限火力")

# 2. 避免无意义的 setVariant 调用
content = content.replace("const setVariant = (v) => run('variant', () => net.request('room.setRandom', { random: true, variant: v }));", "const setVariant = () => {}; // 剥离无限火力")

with open('public/js/screens/room.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Successfully stripped firepower from room.js and installed to public/js/screens/room.js')
