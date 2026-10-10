# 无限 · 纯单机安卓变体

这个文件夹定义并驱动「无限」打包变体：**只承载单机（solo）模式的纯安卓端**。它不是仓库分叉——
共享内核（`server/` `shared/` `data/` `public/`）与主包逐字节一致，全部差异只有两份
`capabilities.js` 在**打包暂存期**被改写（仓库源文件永不改动）。

> 命名与范围的说明：文件夹沿用「无限模式抽离」的语境命名。当前变体 = 纯单机（四档难度皆可，
> 服务端拒绝一切多人房间）；无尽模式的引擎与数据仍在共享内核里，但客户端入口（标题按钮 /
> 大厅卡片 / 房内切换 / 排行榜）已从主线整体移除——**变体目前没有无尽专属入口**。要把它变回
> 「无尽专属端」，恢复 `shared/capabilities.js` 的 `endless` 能力位与入口、把服务端门禁收紧回
> `solo + isEndlessDifficulty` 即可（机制是现成的，见 git 历史）。

## 变体定义

[capabilities.json](capabilities.json)：

| 能力位 | 值 | 含义 |
|---|---|---|
| `mods` | `false` | 不显示 MOD 管理入口（kit 字节仍在包里但不可达，见「诚实边界」） |
| `multiplayer` | `false` | 无匹配/加入同盟入口；服务端拒绝一切非 solo 房间 |

## 三道门（客户端入口只是第一道）

1. **客户端渲染门控**（`public/js/screens/lobby.js` 等，渲染期读 `LOCAL_FEATURES`）：
   变体大厅只保留单机难度选择与创建按钮（模式锁 solo、无公开/私密开关）；匹配、加入同盟、
   模组区不渲染。
2. **服务端门禁**（`server/lobby.js`，请求期读同一份 capabilities）：变体的内嵌 Node 服务器
   拒绝一切非 solo 的 `room.create` / `room.setDifficulty`，`match.queue` 整体拒绝
   （`ERR.BAD_MSG`）——不信任客户端，改协议消息也开不出多人房。
3. **打包期自检**（`tools/bundle-android.mjs --capabilities`）：暂存副本改写后按目标文件实际
   声明的能力位逐键校验（内核已移除的键自动跳过并提示），改写失败即熔断。

## 打包

```bash
node 无限/build.mjs                # debug APK → 无限/dist/Stronghold-Protocol-Endless-debug.apk
node 无限/build.mjs --release      # release APK（签名沿用 scripts/build-android.mjs 的 zipalign + apksigner 流程）
node 无限/build.mjs --bundle-only  # 只产出并校验变体 app_bundle.zip，不调 Gradle
```

- 与主包共存：`-PappIdSuffix=.endless -PversionNameSuffix=-endless`（`android/app/build.gradle`
  读取；debug 包 id 再叠加 `.debug`）。主包构建不传属性，行为不变。
- `无限/dist/` 是构建产物（git 忽略）；`SHA256.txt` 供分发核对。
- **变体构建会把 `android/app/src/main/assets/app_bundle.zip` 覆盖为变体内容**；下一次主包
  构建跑自己的 bundle 步骤时会自动重新生成主包内容，不会互相污染。
- 打包取当前工作树：未提交的改动会被带进包里（与主包构建一致）。

## 诚实边界（如实说明，不是遗漏）

- **mod/多人代码仍在包里**：`mods: false` / `multiplayer: false` 的含义是「入口不存在 +
  服务端拒绝」，不是「物理剥离字节」。kit installer 在模块加载时无条件执行，物理剥离需要改
  内容注册机制；而 kit JS 相对素材体积是噪声，剥离不划算（ENDLESS_MOD_DUAL_PLATFORM_PLAN.md
  门禁 3 / 决策 D26 的同一结论）。
- **深链兜底**：`?modal=` / `?room=` 深链在变体里最多到达一个功能收窄的大厅或一条错误提示，
  服务端门禁保证开不出多人房。
- **局域网可见**：变体内嵌服务器仍监听 `0.0.0.0:3000`，同网设备可以观战你的房间（只读）。
  要彻底单机需改壳层绑 `127.0.0.1`，属壳层后续工作。
- **进行中的局不落盘**：服务器对局全在内存，进程被杀即丢。断点续玩（种子 + 意图重放）是
  独立设计项，见 docs/ANDROID.md §9 的「后续工作」。

## 后续工作（按优先级）

1. **无尽入口的归属拍板**：见顶部说明——要么恢复无尽入口（能力位机制现成），要么接受
   「单机通用」定位并把文件夹/文档更名。
2. **断点续玩**：持久化 `{seed, 难度, 版本, 每回合意图}`，恢复时用 VirtualScheduler 快进重放
   （工具链现成：`tools/matchrun.mjs` / botbench）。移动端单机的第一优先级。
3. **计时语义**：切后台即暂停；限时做成可选挑战模式。
4. **本地成绩**：服务器端无尽排行榜已随无尽入口移除；单机成绩改设备本地存储（localStorage）。
5. **壳层收口**（可选）：服务器绑定改 `127.0.0.1`，彻底关闭局域网入口。
