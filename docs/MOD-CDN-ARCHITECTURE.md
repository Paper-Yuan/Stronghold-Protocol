# 模组（Mod）上 CDN 方案与架构说明

## 一、Mod 上 CDN 是完全支持且推荐的
是的，Mod 挂在 CDN 上下发，不仅可行，而且能够彻底免除服务器带宽瓶颈。

---

## 二、Mod 在 CDN 上的分发架构

```
[管理员后台 /admin/] 
        │ 上传并启用 Mod ZIP 包
        ▼
[生产服务器 (101.37.150.107:3000)]
   解压落盘至: data/workshop/kits/<modId>/
        ▲
        │ 首次访问自动回源并全局缓存 7~30 天
        ▼
[Cloudflare Pages CDN (weishucdn.jiangjiangze.icu)]
   路由拦截: /workshop/* 与 /mods/*
        │
        ├─── CDN 极速边缘下发 ───→ [PC 浏览器客户端] (秒级 import 执行)
        └─── CDN 极速边缘下发 ───→ [安卓 APK 客户端] (WebView 免下直接跑)
```

---

## 三、Mod 上 CDN 带来的 3 大核心优势

1. **服务器真正「0 带宽压力」**：
   - 如果一个对战房间启用了 Mod，全房间 4 位玩家（PC端/安卓端）同时进入时，Mod 脚本和贴图全部从 CDN 边缘节点拉取，**生产服 1 KB 流量都不用耗费**；
2. **免重启、免手动上传 CDN 存储桶**：
   - 我们已在 Cloudflare Pages Functions 中配置了自动回源路由：
     当 CDN 节点收到 `/workshop/kits/<modId>/...` 请求时，如果 CDN 节点没有缓存，会自动找游戏生产服抓取一次，随后在 CDN 边缘节点永久缓存；
   - 管理员在后台上传完 Mod，CDN 就会自动生效，无需手工登录云存储传文件！
3. **安卓端无感极速体验**：
   - 安卓玩家进房时，WebView 访问 CDN 的延迟只有十几毫秒，Mod 脚本在进入对战前瞬间就绪，绝不会出现因为下载 Mod 导致卡房或超时。
