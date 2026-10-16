# 安卓端 Mod 获取与运行机制规范

## 一、联机模式（连接主服务器 / 局域网服务器）
**体验：100% 自动透明下发，玩家零操作、免下载**

1. **下发流程**：
   - 房主（无论是 PC 玩家还是安卓玩家）在建房弹窗勾选要启用的 Mod。
   - 安卓玩家加入房间后，房间状态（`RoomState.mods`）同步该房间启用的 Mod 清单。
   - 客户端前端调用 `import('/workshop/kits/<modId>/...')` 动态加载 Mod 脚本。
2. **底层放行机制**：
   - 安卓端 `MainActivity.kt` 中的 `shouldInterceptRequest` 对所有 `/workshop/` 和 `/api/mods` 请求完全放行走网络；
   - 安卓端直接从服务器/CDN 秒级拉取对应 Mod 的脚本与资源并在 WebView 内执行，完全不需要安卓端玩家在手机上预先安装或手动导入任何 Mod 文件。

---

## 二、单机离线模式（Local 模式运行内置 Node 服务）
**如果安卓玩家脱机/单机单人想开 Mod，提供三种获取途径：**

### 途径 1：游戏内后台直接上传 ZIP（已修复支持）
- 启动单机服务后，在手机游戏内打开 `/admin/` 后台的创意工坊页面；
- 点击「拖拽或上传 ZIP 模组包」；
- 我们已将 [MainActivity.kt](file:///e:/Workbox/系统/android/app/src/main/java/com/paper/stronghold/MainActivity.kt) 中文件选择器由原先写死的 `image/*` 修复为支持全文件类型（`*/*`）；
- 安卓端会直接呼出系统文件管理器，选中手机里下载好的 Mod `.zip` 压缩包，内置 Node 服务即可自动解包并加载。

### 途径 2：手机文件管理器手动放置
- 安卓本地 Node 服务的模组存放路径：
  `/Android/data/com.paper.stronghold/files/bundle/data/workshop/kits/<modId>/`
- 玩家使用手机上的 MT 管理器、ZArchiver 等，把 Mod 解压文件夹放进该目录，重新启动本地服务即可识别。

### 途径 3：云端模组市场一键同步（可选方案）
- 可在安卓端的设置面板中提供「从官方服同步 Mod 列表」按钮；
- 联网时点击一下，安卓内置服务会调用 `/api/mods` 批量将官方服务器已发布的 Mod 下载镜像到本地，供离线单机自由选用。
