<h1 align="center">🎬 Emby Proxy Worker</h1>

<p align="center">
  <strong>基于 Cloudflare Worker 的 Emby 反向代理，支持别名管理、智能选线、多线路故障转移</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Emby-Media%20Server-52B54B?logo=emby&logoColor=white" alt="Emby">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License">
</p>

---

## ✨ 核心特性

| 特性 | 说明 |
|:----:|------|
| 🎯 别名管理 | 通过短路径 `/别名` 快捷访问 Emby 服务，支持多线路配置 |
| ⚡ 智能选线 | 自动测速，按延迟排序选择最优线路，后台异步更新 |
| 🔄 故障转移 | 线路不可用时自动切换到下一条（502/503/504 自动 failover） |
| 📊 使用统计 | 记录播放次数、链接获取次数，支持按天查看 |
| 🌐 域名测速 | 测试 CF 优选域名延迟，自动推荐最快域名 |
| 🛡️ 安全防护 | 管理后台密码保护、PikPak 域名自动重定向、恶意请求拦截 |
| 🎨 现代化 UI | 深蓝渐变风格管理后台，卡片式路由管理 |
| 💾 D1 数据库 | 数据持久化存储，自动建表，无需手动初始化 |

---

## 🚀 快速开始

两种部署方式任选其一：

- 👉 [手动部署教程](./DEPLOY.md#方式一手动部署推荐新手) — 适合新手，全程网页操作
- 👉 [GitHub Actions 自动部署](./DEPLOY.md#方式二github-actions-自动部署) — 适合开发者，Fork 即用

---

## 📖 使用方式

### 🔗 直接代理

```
https://proxy.example.com/https://emby.example.com:8096
```

### 🏷️ 别名代理（推荐）

1. 登录管理后台 `/admin`
2. 添加路由：路径 `myemby`，目标 `https://emby.example.com:8096`
3. 访问 `https://proxy.example.com/myemby`

### 🛤️ 多线路配置

目标地址填写多个 URL（逗号分隔）：

```
https://emby1.example.com:8096,https://emby2.example.com:8096
```

系统会自动测速并选择延迟最低的线路。

---

## 📁 项目结构

```
├── worker.js          # 主 Worker 脚本
├── wrangler.toml      # Wrangler 配置文件
├── DEPLOY.md          # 详细部署教程
├── .github/
│   └── workflows/
│       └── deploy.yml # GitHub Actions 自动部署
└── .gitignore
```

---

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
|--------|:----:|------|
| `ADMIN_PASSWORD` | ✅ | 管理后台登录密码 |
| `BASE_DOMAIN` | ✅ | 你的域名（如 `example.com`） |
| `CF_API_TOKEN` | ❌ | Cloudflare API Token（自动部署需要） |
| `CF_ZONE_ID` | ❌ | Cloudflare Zone ID（自动部署需要） |

---

## 🔗 访问地址

| 页面 | 地址 |
|------|------|
| 🏠 首页 | `https://proxy.example.com/` |
| 🔐 管理后台 | `https://proxy.example.com/admin` |
| 📊 统计 | `https://proxy.example.com/stats` |
| 💚 健康检查 | `https://proxy.example.com/health` |

---

## 📝 更新日志

### v4.0 (2026-05)

- 🔄 重构为 routes 单表结构
- ⚡ 智能选线：自动测速 + 延迟排序 + 后台异步更新
- 🔄 多线路故障转移
- 🎨 全新卡片式管理后台 UI
- 💾 自动建表，无需手动初始化数据库

---

## 📄 许可证

[MIT License](./LICENSE)
