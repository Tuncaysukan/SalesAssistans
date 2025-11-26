import express from 'express'
import crypto from 'crypto'
import axios from 'axios'
import dotenv from 'dotenv'
import { Queue } from 'bullmq'
import { sendText, sendTemplate } from './wa/send.js'
import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'

dotenv.config()

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0.1)
  })
}

const app = express()
app.use(express.json({ type: '*/*' }))
app.use(express.static('public'))
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler())
}

app.use((req, res, next) => {
  const id = req.headers['x-trace-id'] || Math.random().toString(16).slice(2) + Date.now().toString(16)
  req.traceId = id
  res.setHeader('X-Trace-Id', id)
  const t0 = Date.now()
  res.on('finish', () => {
    const dt = Date.now() - t0
    console.log(`[${id}] ${req.method} ${req.path} ${res.statusCode} ${dt}ms`)
  })
  next()
})

const redisHost = process.env.REDIS_HOST || '127.0.0.1'
const redisPort = Number(process.env.REDIS_PORT || 6379)
const classifyQueue = new Queue('classify', { connection: { host: redisHost, port: redisPort } })
const draftQueue = new Queue('draft', { connection: { host: redisHost, port: redisPort } })
const followupQueue = new Queue('followup', { connection: { host: redisHost, port: redisPort } })

function verifyMetaSignature(req) {
  const secret = process.env.META_APP_SECRET
  if (!secret) return true
  const signature = req.headers['x-hub-signature-256']
  if (!signature) return false
  const body = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : ''
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return signature === `sha256=${hmac}`
}

function heuristicIntent(text) {
  if (!text) return { intent: 'other', confidence: 0 }
  const t = text.toLowerCase()
  if (/(fiyat|ne kadar|kaç tl|ücret)/i.test(t)) return { intent: 'price_inquiry', confidence: 0.9 }
  if (/(randevu|tarih|saat|uygun musunuz)/i.test(t)) return { intent: 'appointment', confidence: 0.9 }
  if (/(kargo|teslimat|kaç günde|adres)/i.test(t)) return { intent: 'shipping', confidence: 0.9 }
  return { intent: 'other', confidence: 0.5 }
}

function signInternal(bodyJson) {
  const secret = process.env.INTERNAL_SECRET
  if (!secret) return {}
  const ts = Date.now().toString()
  const h = crypto.createHmac('sha256', secret).update(bodyJson).digest('hex')
  return { sig: `sha256=${h}`, ts }
}

function extractWaTenantKey(body) {
  try {
    return body.entry[0].changes[0].value.metadata.phone_number_id
  } catch {
    return undefined
  }
}

function extractIgTenantKey(body) {
  try {
    return body.entry[0].changes[0].value.page_id
  } catch {
    return undefined
  }
}

async function callInternalIngest(tenantKey, channel, message) {
  const url = process.env.LARAVEL_URL || `http://localhost:${port}`
  if (!url) return
  const payload = {
    channel,
    tenant_key: tenantKey,
    external_contact_id: message.from,
    external_message_id: message.id,
    direction: 'in',
    type: 'text',
    body: message.text || '',
    timestamp: message.timestamp || Date.now(),
    meta: { raw: message.meta || {} }
  }
  try {
    const bodyJson = JSON.stringify(payload)
    const { sig, ts } = signInternal(bodyJson)
    const r = await axios.post(`${url}/internal/ingest`, payload, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
    const convId = r.data && r.data.conversation_id ? r.data.conversation_id : null
    const debugMs = Number(process.env.FOLLOWUP_DEBUG_MS || 0)
    const slaMs = debugMs > 0 ? debugMs : 6 * 60 * 60 * 1000
    if (convId) {
      await followupQueue.add('followup', { convId }, { delay: slaMs, jobId: `followup_${convId}`, removeOnComplete: true, removeOnFail: false })
    }
  } catch {}
}

app.post('/webhooks/whatsapp', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.status(401).send('invalid signature')
  const tenantKey = extractWaTenantKey(req.body)
  const messages = (() => {
    try {
      return req.body.entry[0].changes[0].value.messages || []
    } catch {
      return []
    }
  })()
  for (const m of messages) {
    const text = m.text && m.text.body ? m.text.body : ''
    const intent = heuristicIntent(text)
    await callInternalIngest(tenantKey, 'wa', { id: m.id, from: m.from, text, timestamp: Number(m.timestamp || Date.now()) * 1000 })
    if (intent.confidence < 0.75) {
      await classifyQueue.add('classify', { tenantKey, channel: 'whatsapp', messageId: m.id, text }, { removeOnComplete: true, removeOnFail: false })
    }
    await draftQueue.add('draft', { tenantKey, channel: 'whatsapp', messageId: m.id, text }, { removeOnComplete: true, removeOnFail: false })
  }
  res.json({ ok: true })
})

app.post('/webhooks/instagram', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.status(401).send('invalid signature')
  const tenantKey = extractIgTenantKey(req.body)
  const changes = (() => {
    try {
      return req.body.entry[0].changes || []
    } catch {
      return []
    }
  })()
  for (const c of changes) {
    const m = c.value && c.value.messages && c.value.messages[0] ? c.value.messages[0] : undefined
    if (!m) continue
    const text = m.text || ''
    const intent = heuristicIntent(text)
    await callInternalIngest(tenantKey, 'ig', { id: m.id, from: m.from, text, timestamp: Number(m.timestamp || Date.now()) * 1000 })
    if (intent.confidence < 0.75) {
      await classifyQueue.add('classify', { tenantKey, channel: 'instagram', messageId: m.id, text }, { removeOnComplete: true, removeOnFail: false })
    }
    await draftQueue.add('draft', { tenantKey, channel: 'instagram', messageId: m.id, text }, { removeOnComplete: true, removeOnFail: false })
  }
  res.json({ ok: true })
})

app.get('/health/node', (req, res) => {
  res.json({ ok: true, ts: Date.now(), uptime_s: Math.floor(process.uptime()) })
})
const port = Number(process.env.NODE_API_PORT || 3001)
const store = {
  tenants: new Map(),
  contacts: new Map(),
  conversations: new Map(),
  messages: new Map(),
  messageIndex: new Map(),
  aiJobs: [],
  reports: []
}

function timingEqual(a, b) {
  try {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return crypto.timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function verifyInternal(req) {
  const secret = process.env.INTERNAL_SECRET
  if (!secret) return true
  const sig = req.headers['x-internal-signature']
  if (!sig) return false
  const body = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : ''
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return timingEqual(sig, `sha256=${h}`)
}

async function internalGet(path) {
  const base = process.env.LARAVEL_URL || `http://localhost:${port}`
  const bodyJson = ''
  const { sig, ts } = signInternal(bodyJson)
  let r
  try {
    r = await axios.get(`${base}${path}`, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
  } catch (e) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e)
    throw e
  }
  return r.data
}

function seedTenants() {
  const wa = process.env.WA_PHONE_NUMBER_ID
  const ig = process.env.IG_PAGE_ID
  if (wa && !store.tenants.has(wa)) store.tenants.set(wa, { id: wa, channel: 'wa', wa_config: { templates: { followup: { name: 'followup_1', category: 'utility', language: 'tr' } } } })
  if (ig && !store.tenants.has(ig)) store.tenants.set(ig, { id: ig, channel: 'ig' })
  const demoWa = '123456'
  if (!store.tenants.has(demoWa)) store.tenants.set(demoWa, { id: demoWa, channel: 'wa', wa_config: { templates: { followup: { name: 'followup_1', category: 'utility', language: 'tr' } } } })
}

seedTenants()

function makeKey(tenant, contact, channel) {
  return `${tenant}:${channel}:${contact}`
}

app.post('/internal/ingest', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const p = req.body || {}
  const tenant = store.tenants.get(p.tenant_key)
  if (!tenant) return res.json({ ok: true, status: 'unknown_tenant' })
  const contactKey = `${p.tenant_key}:${p.external_contact_id}`
  if (!store.contacts.has(contactKey)) store.contacts.set(contactKey, { tenant_key: p.tenant_key, external_contact_id: p.external_contact_id })
  const convKey = makeKey(p.tenant_key, p.external_contact_id, p.channel)
  let conv = store.conversations.get(convKey)
  if (!conv) {
    conv = { id: `conv_${store.conversations.size + 1}`, tenant_key: p.tenant_key, contact_id: p.external_contact_id, channel: p.channel, status: 'new', intent: null, lead_score: null, last_customer_message_at: null, last_agent_message_at: null, ai_summary: null }
    store.conversations.set(convKey, conv)
  }
  if (!store.messages.has(conv.id)) store.messages.set(conv.id, [])
  if (!store.messageIndex.has(p.external_message_id)) {
    store.messages.get(conv.id).push({ conversation_id: conv.id, direction: p.direction, external_message_id: p.external_message_id, type: p.type, body: p.body, meta: p.meta, timestamp: p.timestamp })
    store.messageIndex.set(p.external_message_id, conv.id)
    if (p.direction === 'in') conv.last_customer_message_at = p.timestamp
    const debugMs = Number(process.env.FOLLOWUP_DEBUG_MS || 0)
    const slaMs = debugMs > 0 ? debugMs : 6 * 60 * 60 * 1000
    followupQueue.add('followup', { convId: conv.id, tenant_key: p.tenant_key, channel: p.channel }, { delay: slaMs, jobId: `followup_${conv.id}`, removeOnComplete: true, removeOnFail: false })
  }
  res.json({ ok: true, conversation_id: conv.id })
})

app.post('/internal/ai/classified', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const p = req.body || {}
  const convId = store.messageIndex.get(p.external_message_id)
  if (!convId) return res.json({ ok: true, status: 'message_not_found' })
  const convKey = [...store.conversations.keys()].find(k => store.conversations.get(k).id === convId)
  if (convKey) {
    const conv = store.conversations.get(convKey)
    conv.intent = p.intent
    conv.lead_score = p.confidence
    store.aiJobs.push({ type: 'classified', payload: p })
    const debugMs = Number(process.env.FOLLOWUP_DEBUG_MS || 0)
    const map = { price_inquiry: 2 * 60 * 60 * 1000, appointment: 60 * 60 * 1000, other: 6 * 60 * 60 * 1000 }
    const slaMs = debugMs > 0 ? debugMs : (map[p.intent] || map.other)
    followupQueue.add('followup', { convId: conv.id, tenant_key: conv.tenant_key, channel: conv.channel }, { delay: slaMs, jobId: `followup_${conv.id}`, removeOnComplete: true, removeOnFail: false })
  }
  res.json({ ok: true })
})

app.post('/internal/ai/draft', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const p = req.body || {}
  store.aiJobs.push({ type: 'draft', payload: p })
  res.json({ ok: true })
})

app.post('/internal/intent', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const p = req.body || {}
  const convId = store.messageIndex.get(p.external_message_id)
  if (!convId) return res.json({ ok: true, status: 'message_not_found' })
  const convKey = [...store.conversations.keys()].find(k => store.conversations.get(k).id === convId)
  if (convKey) {
    const conv = store.conversations.get(convKey)
    conv.intent = p.intent
    conv.lead_score = p.lead_score || null
  }
  res.json({ ok: true })
})

app.post('/conversations/:id/send', (req, res) => {
  const id = req.params.id
  const conversations = [...store.conversations.values()]
  const conv = conversations.find(c => c.id === id)
  if (!conv) return res.status(404).json({ ok: false })
  const now = Date.now()
  const within24h = conv.last_customer_message_at && (now - conv.last_customer_message_at < 24 * 60 * 60 * 1000)
  const type = within24h ? 'text' : 'template'
  const body = req.body && req.body.text ? req.body.text : ''
  if (conv.channel === 'wa') {
    if (type === 'text') {
      sendText(conv.tenant_key, conv.contact_id, body)
    } else {
      const tpl = (store.tenants.get(conv.tenant_key)?.wa_config?.templates?.followup?.name) || 'followup_1'
      sendTemplate(conv.tenant_key, conv.contact_id, tpl)
    }
  }
  if (!store.messages.has(conv.id)) store.messages.set(conv.id, [])
  store.messages.get(conv.id).push({ conversation_id: conv.id, direction: 'out', external_message_id: `out_${Date.now()}`, type, body, meta: {}, timestamp: now })
  conv.last_agent_message_at = now
  res.json({ ok: true, type })
})

app.post('/conversations/:id/status', (req, res) => {
  const id = req.params.id
  const conversations = [...store.conversations.values()]
  const conv = conversations.find(c => c.id === id)
  if (!conv) return res.status(404).json({ ok: false })
  const status = req.body && req.body.status ? req.body.status : null
  if (!status) return res.status(400).json({ ok: false })
  conv.status = status
  res.json({ ok: true })
})

app.get('/debug/state', (req, res) => {
  res.json({ tenants: store.tenants.size, contacts: store.contacts.size, conversations: store.conversations.size, messages: [...store.messages.entries()].map(([k, v]) => ({ conversation_id: k, count: v.length })), aiJobs: store.aiJobs.length, overdue: [...store.conversations.values()].filter(c => c.overdue).map(c => c.id) })
})

app.get('/reports/daily', (req, res) => {
  const convs = [...store.conversations.values()]
  const msgs = [...store.messages.values()].flat()
  const inbound = msgs.filter(m => m.direction === 'in').length
  const outbound = msgs.filter(m => m.direction === 'out').length
  const firstRespTimes = convs.map(c => {
    const ins = msgs.filter(m => m.conversation_id === c.id && m.direction === 'in').sort((a,b)=>a.timestamp-b.timestamp)
    const outs = msgs.filter(m => m.conversation_id === c.id && m.direction === 'out').sort((a,b)=>a.timestamp-b.timestamp)
    if (!ins.length || !outs.length) return null
    const firstOutAfterIn = outs.find(o => o.timestamp >= ins[0].timestamp)
    if (!firstOutAfterIn) return null
    return firstOutAfterIn.timestamp - ins[0].timestamp
  }).filter(Boolean)
  const avgFirstResponseMs = firstRespTimes.length ? Math.round(firstRespTimes.reduce((a,b)=>a+b,0)/firstRespTimes.length) : null
  const intentDist = convs.reduce((acc,c)=>{const k=c.intent||'unknown';acc[k]=(acc[k]||0)+1;return acc},{})
  const funnel = convs.reduce((acc,c)=>{const s=c.status||'new';acc[s]=(acc[s]||0)+1;return acc},{})
  res.json({ inbound, outbound, avg_first_response_ms: avgFirstResponseMs, intent_distribution: intentDist, funnel })
})

app.get('/debug/conversations', async (req, res) => {
  try {
    const data = await internalGet('/internal/conversations')
    res.json(data)
  } catch (e) {
    res.status(500).json({ ok: false })
  }
})

function computeReport() {
  const r = {};
  const convs = [...store.conversations.values()]
  const msgs = [...store.messages.values()].flat()
  r.inbound = msgs.filter(m => m.direction === 'in').length
  r.outbound = msgs.filter(m => m.direction === 'out').length
  const firstRespTimes = convs.map(c => {
    const ins = msgs.filter(m => m.conversation_id === c.id && m.direction === 'in').sort((a,b)=>a.timestamp-b.timestamp)
    const outs = msgs.filter(m => m.conversation_id === c.id && m.direction === 'out').sort((a,b)=>a.timestamp-b.timestamp)
    if (!ins.length || !outs.length) return null
    const firstOutAfterIn = outs.find(o => o.timestamp >= ins[0].timestamp)
    if (!firstOutAfterIn) return null
    return firstOutAfterIn.timestamp - ins[0].timestamp
  }).filter(Boolean)
  r.avg_first_response_ms = firstRespTimes.length ? Math.round(firstRespTimes.reduce((a,b)=>a+b,0)/firstRespTimes.length) : null
  r.intent_distribution = convs.reduce((acc,c)=>{const k=c.intent||'unknown';acc[k]=(acc[k]||0)+1;return acc},{})
  r.funnel = convs.reduce((acc,c)=>{const s=c.status||'new';acc[s]=(acc[s]||0)+1;return acc},{})
  r.ts = Date.now()
  store.reports.push(r)
}

function startCronReporting() {
  const debugMs = Number(process.env.REPORT_DEBUG_CRON_MS || 0)
  if (debugMs > 0) {
    setInterval(() => computeReport(), debugMs)
  }
}

app.get('/reports/nightly/latest', (req, res) => {
  const last = store.reports.length ? store.reports[store.reports.length - 1] : null
  res.json({ ok: true, report: last })
})

app.get('/reports/nightly/all', (req, res) => {
  res.json({ ok: true, reports: store.reports })
})

app.get('/conversations', (req, res) => {
  const list = [...store.conversations.values()].map(c => ({ id: c.id, channel: c.channel, status: c.status, intent: c.intent, overdue: !!c.overdue }))
  res.json({ ok: true, conversations: list })
})

app.get('/conversations/:id/messages', (req, res) => {
  const id = req.params.id
  const msgs = (store.messages.get(id) || []).sort((a,b)=>a.timestamp-b.timestamp)
  res.json({ ok: true, messages: msgs })
})

app.get('/ai/drafts/latest/:id', (req, res) => {
  const id = req.params.id
  const msgs = (store.messages.get(id) || []).filter(m => m.direction === 'in').sort((a,b)=>b.timestamp-a.timestamp)
  if (!msgs.length) return res.json({ ok: true, draft: null })
  const lastInboundId = msgs[0].external_message_id
  const jobs = store.aiJobs.filter(j => j.type === 'draft' && j.payload && j.payload.external_message_id === lastInboundId)
  if (!jobs.length) return res.json({ ok: true, draft: null })
  const payload = jobs[jobs.length - 1].payload
  res.json({ ok: true, draft: { text: payload.draft, next_action: payload.next_action } })
})

startCronReporting()
app.listen(port, () => {})
app.get('/internal/conversations/:id', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const id = req.params.id
  const conv = [...store.conversations.values()].find(c => c.id === id)
  if (!conv) return res.status(404).json({ ok: false })
  res.json({ ok: true, conversation: conv })
})

app.post('/internal/followup/overdue', (req, res) => {
  if (!verifyInternal(req)) return res.status(401).json({ ok: false })
  const p = req.body || {}
  const conv = [...store.conversations.values()].find(c => c.id === p.conversation_id)
  if (!conv) return res.status(404).json({ ok: false })
  conv.overdue = true
  res.json({ ok: true })
})
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler())
}
app.get('/debug/error', (req, res) => {
  try {
    throw new Error('debug error')
  } catch (e) {
    if (process.env.SENTRY_DSN) Sentry.captureException(e)
    res.status(500).json({ ok: false })
  }
})
