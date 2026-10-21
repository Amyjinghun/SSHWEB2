const express = require('express');
const rateLimit = require('express-rate-limit');
const https = require('https');
const db = require('../db');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { code: 429, message: 'AI 请求过于频繁，请稍后再试' }
});

const DEFAULTS = {
  ai_enabled: 'false',
  ai_provider: 'openai',
  ai_base_url: '',
  ai_api_key: '',
  ai_model: '',
  ai_max_tokens: '1024'
};

async function getAIConfig() {
  const rows = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE "ai_%"');
  const cfg = { ...DEFAULTS };
  rows.forEach(r => { cfg[r.setting_key] = r.setting_value ?? cfg[r.setting_key]; });
  return {
    enabled: cfg.ai_enabled === 'true',
    provider: cfg.ai_provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: (cfg.ai_base_url || '').trim().replace(/\/+$/, ''),
    apiKey: (cfg.ai_api_key || '').trim(),
    model: (cfg.ai_model || '').trim(),
    maxTokens: Math.min(Math.max(parseInt(cfg.ai_max_tokens, 10) || 1024, 128), 8192)
  };
}

// GET /api/ai/status — 登录用户探测 AI 是否可用（不回 Key）
router.get('/status', async (req, res) => {
  try {
    const cfg = await getAIConfig();
    const ok = cfg.enabled && !!cfg.apiKey && !!(cfg.baseUrl || cfg.provider === 'anthropic');
    res.json({ code: 0, data: { enabled: ok, provider: cfg.provider, model: cfg.model || (cfg.provider === 'anthropic' ? 'claude' : 'gpt') } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

function requestUpstream(options, body, onUpstreamRes) {
  return new Promise((resolve, reject) => {
    const u = new URL(options.url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      // agent:false 每次新建连接,避免进程内共享 agent 状态异常导致请求排队
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...options.headers
      },
      timeout: options.timeoutMs || 120000
    }, (res) => { onUpstreamRes(res, resolve, reject, req); });
    req.on('timeout', () => req.destroy(new Error(`连接 ${u.hostname} 超时`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 统一把上游 SSE 流解析成 data: JSON 帧，回调返回 payload 对象（{delta} / {reasoning}）
function pipeSSE(upstreamRes, res, extractPayload, upstreamReq) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  let buffer = '';
  upstreamRes.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { res.write('data: [DONE]\n\n'); return; }
      try {
        const json = JSON.parse(payload);
        const frame = extractPayload(json);
        if (frame) res.write(`data: ${JSON.stringify(frame)}\n\n`);
      } catch {}
    }
  });
  upstreamRes.on('end', () => res.end());
  upstreamRes.on('error', () => { try { res.end(); } catch {} });
  // 客户端断开时同时中断上游，避免白白消耗 token
  res.on('close', () => {
    try { upstreamReq?.destroy(); } catch {}
    try { res.destroy(); } catch {}
  });
}

function errorResponse(res, status, message) {
  if (res.headersSent) {
    try { res.write(`data: ${JSON.stringify({ error: message })}\n\n`); res.end(); } catch {}
  } else {
    res.json({ code: status, message });
  }
}

// POST /api/ai/chat  body: { messages: [{role, content}], stream?: bool }
router.post('/chat', aiLimiter, async (req, res) => {
  let cfg;
  try { cfg = await getAIConfig(); } catch (err) { return errorResponse(res, 500, err.message); }
  if (!cfg.enabled) return errorResponse(res, 403, 'AI 助手未启用，请联系管理员在系统设置中开启');
  if (!cfg.apiKey) return errorResponse(res, 400, '未配置 AI API Key');

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const cleaned = messages
    .filter(m => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }))
    .slice(-20);
  if (!cleaned.length) return errorResponse(res, 400, '消息内容为空');

  try {
    if (cfg.provider === 'anthropic') {
      const system = cleaned.find(m => m.role === 'system');
      const rest = cleaned.filter(m => m.role !== 'system');
      const body = JSON.stringify({
        model: cfg.model || 'claude-3-5-sonnet-latest',
        max_tokens: cfg.maxTokens,
        stream: true,
        ...(system ? { system: system.content } : {}),
        messages: rest
      });
      await requestUpstream({
        url: `${cfg.baseUrl || 'https://api.anthropic.com'}/v1/messages`,
        headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
      }, body, (up, resolve, reject) => {
        if (up.statusCode < 200 || up.statusCode >= 300) {
          let raw = '';
          up.on('data', c => raw += c);
          up.on('end', () => reject(new Error(`AI 接口 HTTP ${up.statusCode}: ${raw.slice(0, 300)}`)));
          return;
        }
        resolve();
        // Anthropic SSE: content_block_delta → delta.text
        pipeSSE(up, res, (json) => {
          if (json.type === 'content_block_delta') {
            if (json.delta?.text) return { delta: json.delta.text };
            if (json.delta?.thinking) return { reasoning: json.delta.thinking };
          }
          return null;
        }, req);
      });
    } else {
      if (!cfg.baseUrl) return errorResponse(res, 400, '未配置 AI 接口地址（Base URL）');
      const body = JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        stream: true,
        messages: cleaned
      });
      await requestUpstream({
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${cfg.apiKey}` }
      }, body, (up, resolve, reject) => {
        if (up.statusCode < 200 || up.statusCode >= 300) {
          let raw = '';
          up.on('data', c => raw += c);
          up.on('end', () => reject(new Error(`AI 接口 HTTP ${up.statusCode}: ${raw.slice(0, 300)}`)));
          return;
        }
        resolve();
        // OpenAI SSE: choices[0].delta.content
        // OpenAI SSE: choices[0].delta.content 正文;reasoning_content 为推理模型的思考阶段
        pipeSSE(up, res, (json) => {
          const d = json.choices?.[0]?.delta || {};
          if (d.content) return { delta: d.content };
          if (d.reasoning_content) return { reasoning: d.reasoning_content };
          return null;
        }, req);
      });
    }
    writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      action: 'ai_chat',
      detail: { messages: cleaned.length, chars: cleaned.reduce((n, m) => n + m.content.length, 0) }
    }).catch(() => {});
  } catch (err) {
    errorResponse(res, 502, err.message);
  }
});

// POST /api/ai/test — 管理员验证配置（可传临时配置，便于保存前测试）
router.post('/test', aiLimiter, roleMiddleware('superadmin', 'admin'), async (req, res) => {
  try {
    const saved = await getAIConfig();
    const b = req.body || {};
    const cfg = {
      enabled: true,
      provider: b.ai_provider === 'anthropic' ? 'anthropic' : (b.ai_provider === 'openai' ? 'openai' : saved.provider),
      baseUrl: String(b.ai_base_url ?? saved.baseUrl).trim().replace(/\/+$/, ''),
      apiKey: String(b.ai_api_key ?? saved.apiKey).trim(),
      model: String(b.ai_model ?? saved.model).trim(),
      maxTokens: 64
    };
    if (!cfg.apiKey) return res.json({ code: 400, message: '请先填写 API Key' });
    const body = cfg.provider === 'anthropic'
      ? JSON.stringify({ model: cfg.model || 'claude-3-5-sonnet-latest', max_tokens: 512, messages: [{ role: 'user', content: '回复「OK」两个字母即可' }] })
      : JSON.stringify({ model: cfg.model, max_tokens: 512, messages: [{ role: 'user', content: '回复「OK」两个字母即可' }] });
    const url = cfg.provider === 'anthropic'
      ? `${cfg.baseUrl || 'https://api.anthropic.com'}/v1/messages`
      : `${cfg.baseUrl}/chat/completions`;
    const headers = cfg.provider === 'anthropic'
      ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${cfg.apiKey}` };
    const text = await requestUpstream({ url, headers, timeoutMs: 15000 }, body, (up, resolve2, reject2) => {
      let raw = '';
      up.on('data', c => raw += c);
      up.on('end', () => {
        if (up.statusCode < 200 || up.statusCode >= 300) return reject2(new Error(`HTTP ${up.statusCode}: ${raw.slice(0, 300)}`));
        try {
          const json = JSON.parse(raw);
          // 推理模型(GLM-5.3 等)小额度下 content 可能为空,回退取 reasoning_content
          const msg = json.choices?.[0]?.message || {};
          const t = cfg.provider === 'anthropic'
            ? (json.content?.map?.(x => x.text).filter(Boolean).join('') || '')
            : (msg.content || msg.reasoning_content || '');
          resolve2(t || '（空响应）');
        } catch (e) { reject2(e); }
      });
      up.on('error', reject2);
    });
    res.json({ code: 0, message: '连接成功', data: { reply: String(text).slice(0, 100) } });
  } catch (err) {
    const hint = /超时/.test(err.message)
      ? `（面板服务器连不上 AI 供应商，请在面板所在机器 curl 测试出网；若在海外需换可直连的服务商或配代理）`
      : '';
    res.json({ code: 502, message: `连接失败: ${err.message}${hint}` });
  }
});

module.exports = router;
