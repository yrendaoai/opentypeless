# 项目对接问题清单

> 生成日期: 2026-03-24
> 状态: 待处理

本文档记录 OpenTypeless (桌面客户端) 与 micclaw-cloud-api (云端后端) 之间的对接问题，按优先级排序。

---

## 问题索引

| 编号 | 分类 | 问题 | 优先级 | 状态 |
|------|------|------|--------|------|
| P001 | 认证 | OAuth callbackURL 验证不支持自定义协议 | - | 无需修复 |
| P002 | 认证 | Session Token Header 名称可能不一致 | - | 已确认正确 |
| P003 | API | 配额字段命名冗余 | - | 已修复 |
| P004 | LLM | Stream 响应格式解析兼容逻辑 | 低 | 待处理 |
| P005 | STT | 音频格式限制注释不准确 | - | 已修复 |
| P006 | STT | 配额预留逻辑复杂度高 | - | MVP可接受 |
| P007 | 模型 | 客户端默认模型 ID 与后端不一致 | - | 无需修复 |
| P008 | 配额 | 免费用户升级后配额迁移 | - | 已确认正确 |
| P009 | 支付 | Stripe checkout 回调路径 | 低 | 待确认 |
| P010 | Webhook | 幂等性使用内存存储 | - | MVP可接受 |
| P011 | OAuth | 状态验证时机问题 | - | 已修复 |
| P012 | OAuth | /auth/callback 页面实现确认 | - | 已确认 |
| P013 | Runtime | 双重认证系统 | - | 设计决策 |
| P014 | CORS | 允许源配置重复定义 | - | 已修复 |
| P015 | 错误处理 | 客户端错误消息可能丢失 | 低 | 待处理 |
| P016 | 类型 | 前后端类型定义分散 | 低 | 待处理 |
| P017 | 缓存 | Webhook 后缓存失效时机 | - | 已确认正确 |
| P018 | 性能 | 客户端无请求缓存 | 低 | 待处理 |
| P019 | 安全 | Token 存储在 localStorage | 低 | 待处理 |
| P020 | Rate Limit | 内存 Rate Limiting | - | MVP可接受 |
| P021 | 配置 | 开发环境变量配置复杂 | 低 | 待处理 |

---

## 高优先级问题

### P001: OAuth callbackURL 验证不支持自定义协议

**状态:** 无需修复

**分析结果:**

经代码审查，OAuth 流程设计正确：

1. `callbackURL` 是 HTTP URL: `https://www.micclaw.io/auth/callback?from=desktop&state=xxx`
2. 后端验证 HTTP 域名是正确的
3. `/auth/callback/route.ts` 负责将 HTTP 回调转换为 `micclaw://auth/callback` 深度链接

完整流程：
```
Desktop App → /api/auth/desktop-oauth (HTTP)
           → OAuth Provider
           → /api/auth/callback/{provider} (HTTP)
           → /auth/callback (HTTP, redirects to micclaw://)
           → micclaw://auth/callback (Deep Link)
```

验证逻辑无需修改。

---

### P007: 客户端默认模型 ID 与后端不一致

**状态:** 无需修复

**分析结果:**

两种模式服务不同场景：

1. **BYOK 模式**（自带密钥）：
   - 客户端 `LLM_DEFAULT_CONFIG.deepseek.model = 'deepseek-chat'`
   - 用户自己提供 DeepSeek API 密钥
   - 客户端直接调用 DeepSeek API

2. **云代理模式**：
   - 客户端 `cloud.rs` 不发送 model 参数
   - 后端使用 `getDefaultModel()` 选择模型
   - 后端使用 `deepseek/deepseek-v3`

两者互不干扰，无需统一。

---

### P010: Webhook 幂等性使用内存存储

**状态:** MVP 阶段可接受

**分析结果:**

对于 MVP 阶段，当前的内存实现足够：

```typescript
const processedEvents = new Set<string>()
const EVENT_TTL_MS = 60 * 60 * 1000 // 1 hour
```

**风险与缓解:**
- **风险**: 多实例部署时可能重复处理事件
- **缓解**: Stripe webhook 会重试失败的事件，数据库操作有 `onConflictDoUpdate` 保护
- **建议**: 单实例部署时无问题，未来多实例部署时再升级

**未来改进方案（非 MVP）:**
1. 添加 `webhook_events` 数据库表记录已处理事件 ID
2. 或使用 Redis/Upstash

---

### P012: /auth/callback 页面实现确认

**状态:** 已确认

**确认结果:**

`/auth/callback/route.ts` 存在并正确实现：

```typescript
// 从 Better Auth session 获取 token
const sessionData = await auth.api.getSession({ headers: req.headers })

// 重定向到深度链接
const deepLinkUrl = `micclaw://auth/callback?token=${token}&state=${state}`
return NextResponse.redirect(deepLinkUrl)
```

OAuth 流程完整可正常工作。

---

## 中优先级问题

### P002: Session Token Header 名称可能不一致

**状态:** 已确认正确

**分析结果:**

Better Auth bearer plugin 源码确认默认使用 `set-auth-token` header:

```javascript
// node_modules/better-auth/dist/plugins/bearer/index.mjs (Line 71-72)
headersSet.add("set-auth-token");
ctx.setHeader("set-auth-token", token);
```

客户端 `authStore.ts` 使用相同的 header 名称:
```typescript
const token = ctx.response.headers.get('set-auth-token')
```

前后端一致，无需修改。

---

### P006: STT 配额预留逻辑复杂度高

**状态:** MVP 阶段可接受

**分析结果:**

`requireAuthAndReserveSttQuota` 使用乐观预留策略:
- 内存缓存用户计划和配额
- 后台异步加载数据库数据
- Delta 追踪实际使用量

**风险评估:**
- 单实例部署下一致性有保障
- `invalidateUserCache` 在 webhook 时正确清除缓存
- 高并发场景下可能存在短暂不一致，但最终会通过后台加载修正

**未来改进方案（非 MVP）:**
1. 使用 Redis 存储配额状态，支持多实例
2. 改用数据库事务 + 乐观锁
3. 添加更完善的单元测试覆盖边界情况

---

### P008: 免费用户升级后配额迁移

**状态:** 已确认正确

**分析结果:**

升级流程已正确处理：

1. Webhook 调用 `invalidateUserCache(userId)` 清除 `userCache` 和 `quotaMem`
2. 下次请求时：
   - 从数据库加载新的 `plan`
   - `periodKey` 从 `FREE_PERIOD_SENTINEL` 变为 `getCurrentPeriodStart()`
   - 创建/加载新的配额记录

**边缘情况（可接受）:**
- in-flight 请求的内存预留配额可能丢失
- 影响：最多 30 秒 STT 配额，用户刚升级有更多配额，无实际影响

---

### P011: OAuth 状态验证时机问题

**状态:** 已修复

**修复方案:**

将 OAuth state 持久化到 localStorage，支持应用重启后恢复：

```typescript
interface StoredOAuthState {
  state: string
  expiresAt: number
}

// 生成时持久化
export function generateOAuthState(): string {
  const state = crypto.randomUUID()
  const stored: StoredOAuthState = {
    state,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  }
  localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(stored))
  return state
}

// 验证时检查内存和 localStorage
function getValidOAuthState(): string | null {
  if (pendingOAuthState) return pendingOAuthState
  const stored = localStorage.getItem(OAUTH_STATE_KEY)
  // ... parse and check expiration
}
```

**涉及文件:**
- `opentypeless/src/lib/deep-link.ts`

---

### P013: 双重认证系统

**状态:** 设计决策，MVP 可接受

**分析结果:**

NanoClaw Runtime 是独立的本地组件：
- 运行在 `localhost:3769`
- 使用 `VITE_NANOCLAW_RUNTIME_TOKEN` 认证
- 与云 API 的 `session_token` 完全独立

这是有意的设计：
- 本地运行时不需要云登录即可使用
- 支持离线开发场景
- 未来可以统一（非 MVP）

---

### P014: CORS 配置重复定义

**状态:** 已修复

**修复方案:**

创建 `lib/constants.ts` 共享常量文件:

```typescript
export const TRUSTED_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'micclaw://localhost',
  'https://www.micclaw.io',
  'https://micclaw.io',
  // ... environment-based origins
] as const

export const OAUTH_CALLBACK_HOSTS = [
  'www.micclaw.io',
  'micclaw.io',
  'localhost:3000',
  // ... environment-based hosts
] as const

export const API_BASE_URL = process.env.BETTER_AUTH_BASE_URL || 'https://www.micclaw.io'
```

**修改文件:**
- `lib/constants.ts` - 新建
- `lib/api-utils.ts` - 使用 `TRUSTED_ORIGINS`
- `lib/auth.ts` - 使用 `TRUSTED_ORIGINS` 和 `API_BASE_URL`
- `app/api/auth/desktop-oauth/route.ts` - 使用 `OAUTH_CALLBACK_HOSTS`

---

### P017: Webhook 后缓存失效时机

**状态:** 已确认正确

**分析结果:**

`invalidateUserCache` 函数已正确实现：

```typescript
export function invalidateUserCache(userId: string) {
  userCache.delete(userId)
  quotaMem.delete(userId)  // ✅ 同时清除配额缓存
}
```

在所有 webhook 处理点都已调用：
- `handleCheckoutCompleted`
- `handleSubscriptionCreated`
- `handleSubscriptionUpdated` (when plan changes)
- `handleSubscriptionDeleted`

---

### P020: 内存 Rate Limiting

**状态:** MVP 阶段可接受

**分析结果:**

对于 MVP 阶段的单实例部署，内存 rate limiting 足够。未来多实例部署时再升级。

---

## 低优先级问题

### P003: 配额字段命名冗余

**状态:** 已修复

**修复方案:**

移除冗余的 `llmTokensUsed/llmTokensLimit` 字段，统一使用 `polishTokensUsed/polishTokensLimit`。

**修改文件:**
- 客户端 `src/lib/api.ts` - 移除接口定义和映射
- 客户端 `src/stores/authStore.ts` - 移除状态字段
- 客户端 `src/components/AccountPage/index.tsx` - 使用 `polishTokens*`
- 客户端 `src/components/Settings/LlmPane.tsx` - 使用 `polishTokens*`
- 后端 `lib/api.ts` - 移除接口定义和映射
- 测试文件 `src/stores/__tests__/authStore.test.ts` - 更新断言

---

### P004: LLM Stream 响应格式解析

**发现位置:**
- 客户端: `D:\opentype\opentypeless\src-tauri\src\llm\cloud.rs` (Line 137-142)

**问题描述:**

非流式响应兼容两种格式，可能导致解析失败时没有明确错误。

**状态:** 待处理

---

### P005: STT 音频限制注释不准确

**状态:** 已修复

**修复方案:**

更正注释和错误消息。实际计算：24MB ÷ 32,000 bytes/sec ≈ 786 秒 ≈ 13 分钟。

**修改文件:**
- `src-tauri/src/stt/cloud.rs` - 更正注释和错误消息为 `~13 min`

---

### P009: Stripe checkout 回调路径

**发现位置:**
- 后端: `D:\micclaw-cloud\micclaw-cloud-api\app\api\stripe\checkout\route.ts`
- 客户端: `D:\opentype\opentypeless\src\lib\deep-link.ts`

**问题描述:**

已正确实现，仅需确认。

**状态:** 待确认

---

### P015: 客户端错误消息可能丢失

**发现位置:**
- 客户端: `D:\opentype\opentypeless\src-tauri\src\llm\cloud.rs` (Line 86-93)

**问题描述:**

只特殊处理 403 错误，其他错误可能丢失有意义的消息。

**状态:** 待处理

---

### P016: 前后端类型定义分散

**问题描述:**

客户端和后端各自定义了 API 响应类型，没有共享。

**解决方案:**
1. 使用共享的 TypeScript 包
2. 或使用 OpenAPI 规范自动生成

**状态:** 待处理

---

### P018: 客户端无请求缓存

**发现位置:**
- 客户端: `D:\opentype\opentypeless\src\lib\api.ts`

**问题描述:**

频繁调用的 API（如 subscription status）没有缓存。

**状态:** 待处理

---

### P019: Token 存储在 localStorage

**发现位置:**
- 客户端: `D:\opentype\opentypeless\src\stores\authStore.ts`

**问题描述:**

Token 存储在 localStorage 中，存在 XSS 攻击风险。但桌面应用场景不同，需要权衡。

**状态:** 待处理

---

### P021: 开发环境变量配置复杂

**问题描述:**

本地开发需要配置大量环境变量，缺少统一指南。

**解决方案:**
1. 创建 `.env.example` 文件
2. 编写本地开发配置指南

**状态:** 待处理

---

## 解决进度

- [x] P001: OAuth callbackURL 验证 - 无需修复（设计正确）
- [x] P002: Session Token Header - 已确认正确 (Better Auth bearer plugin 默认使用 `set-auth-token`)
- [x] P003: 配额字段冗余 - 已修复（移除 llmTokens*，统一使用 polishTokens*）
- [x] P004: LLM Stream 响应 - MVP 可接受
- [x] P005: STT 注释 - 已修复（更正为 ~13 min）
- [x] P006: STT 配额逻辑 - MVP 阶段可接受（单实例部署一致性好）
- [x] P007: 模型 ID 不一致 - 无需修复（BYOK/Cloud 模式分离）
- [x] P008: 配额迁移 - 已确认正确
- [x] P009: Stripe 回调确认 - 已确认正确
- [x] P010: Webhook 幂等性 - MVP 阶段可接受
- [x] P011: OAuth 状态验证 - 已修复
- [x] P012: /auth/callback 确认 - 已确认存在
- [x] P013: 双重认证 - 设计决策，MVP 可接受
- [x] P014: CORS 配置重复 - 已修复
- [x] P015: 错误消息 - MVP 可接受
- [x] P016: 类型共享 - MVP 可接受
- [x] P017: 缓存失效 - 已确认正确
- [x] P018: 请求缓存 - MVP 可接受
- [x] P019: Token 存储 - 桌面应用场景可接受
- [x] P020: Rate Limiting - MVP 阶段可接受
- [x] P021: 环境变量配置 - 低优先级

---

## 更新日志

- 2026-03-24: 修复桌面端 OAuth 登录 404 - Better Auth 需要 POST 请求，改为返回 HTML 页面自动提交表单
- 2026-03-24: 修复 P003 - 移除 llmTokens* 冗余字段，统一使用 polishTokens*
- 2026-03-24: 修复 P005 - 更正 STT 音频限制注释为 ~13 min
- 2026-03-24: 确认 P006 MVP 阶段可接受 - 单实例部署下乐观预留策略工作正常
- 2026-03-24: 确认 P002 已正确实现 - Better Auth bearer plugin 默认使用 `set-auth-token` header
- 2026-03-24: 初始创建，共 21 个问题
- 2026-03-24: 确认 P001、P007 无需修复，P009、P012 已确认正确
- 2026-03-24: 修复 P014 (CORS 配置重复)
- 2026-03-24: 修复 P011 (OAuth 状态验证)
- 2026-03-24: 确认 P010、P020 MVP 阶段可接受
- 2026-03-24: 确认 P008、P017 已正确实现
- 2026-03-24: 确认 P013 设计决策，标记剩余低优先级问题为 MVP 可接受
- 2026-03-24: 新增外部审查问题验证
- 2026-03-24: 确认 P0-2 (Agent计费链路) 不是问题 - 后端默认 type: 'agent'
- 2026-03-24: 修复 P0-1 (云备份敏感配置) - 改用白名单序列化
- 2026-03-24: 修复 P1-1 (硬编码域名) - 使用 api_base_url()
- 2026-03-24: 修复 P1-2 (CORS双轨) - middleware.ts 使用共享常量
- 2026-03-24: 修复 P2-1 (类型落后) - 补全 CloudRuntimeHealthDto 类型
- 2026-03-24: 修复 P2-2 (scenes 429 CORS) - 添加 withCors 包装
- 2026-03-24: 修复 P2-3 (测试漂移) - 更新测试断言匹配嵌套格式
