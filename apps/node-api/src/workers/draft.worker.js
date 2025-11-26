import { Worker } from 'bullmq'
import axios from 'axios'
import dotenv from 'dotenv'
import crypto from 'crypto'

dotenv.config()

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) }

function signInternal(bodyJson) {
  const secret = process.env.INTERNAL_SECRET
  if (!secret) return {}
  const ts = Date.now().toString()
  const h = crypto.createHmac('sha256', secret).update(bodyJson).digest('hex')
  return { sig: `sha256=${h}`, ts }
}

function draftReply(text) {
  const t = text || ''
  if (/(fiyat|ne kadar|kaç tl|ücret)/i.test(t)) return { draft: 'Fiyatımızı paylaşmamı ister misiniz?', next_action: 'share_price' }
  if (/(randevu|tarih|saat|uygun musunuz)/i.test(t)) return { draft: 'Hangi tarih ve saat sizin için uygun?', next_action: 'ask_schedule' }
  if (/(kargo|teslimat|kaç günde|adres)/i.test(t)) return { draft: 'Teslimat süremiz ve kargo bilgilerini paylaşayım mı?', next_action: 'share_shipping' }
  return { draft: 'Size nasıl yardımcı olabilirim?', next_action: 'ask_clarify' }
}

async function llmDraft(text) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return draftReply(text)
  const model = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini'
  const url = 'https://api.openai.com/v1/chat/completions'
  const sys = 'You write short polite Turkish replies for sales DM. Return strict JSON: {"draft":"...","next_action":"share_price|ask_schedule|share_shipping|ask_clarify"}.'
  const user = `Last message: ${text}`
  try {
    const r = await axios.post(url, { model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }, { headers: { Authorization: `Bearer ${key}` } })
    const c = r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content ? r.data.choices[0].message.content : '{}'
    const o = JSON.parse(c)
    return { draft: o.draft || draftReply(text).draft, next_action: o.next_action || draftReply(text).next_action }
  } catch {
    return draftReply(text)
  }
}

async function sendDraft(result) {
  const url = process.env.LARAVEL_URL
  if (!url) return
  const payload = result
  const bodyJson = JSON.stringify(payload)
  const { sig, ts } = signInternal(bodyJson)
  try {
    await axios.post(`${url}/internal/ai/draft`, payload, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
  } catch {}
}

const worker = new Worker('draft', async job => {
  const d = await llmDraft(job.data.text)
  const payload = {
    tenant_key: job.data.tenantKey,
    channel: job.data.channel === 'whatsapp' ? 'wa' : 'ig',
    external_message_id: job.data.messageId,
    draft: d.draft,
    next_action: d.next_action
  }
  await sendDraft(payload)
  return payload
}, { connection })

worker.on('completed', () => {})
worker.on('failed', () => {})