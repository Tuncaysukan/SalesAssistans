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

async function classifyText(text) {
  const t = (text || '').toLowerCase()
  if (/(fiyat|ne kadar|kaç tl|ücret)/i.test(t)) return { intent: 'price_inquiry', confidence: 0.9 }
  if (/(randevu|tarih|saat|uygun musunuz)/i.test(t)) return { intent: 'appointment', confidence: 0.9 }
  if (/(kargo|teslimat|kaç günde|adres)/i.test(t)) return { intent: 'shipping', confidence: 0.9 }
  return { intent: 'other', confidence: 0.5 }
}

async function llmClassify(text) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return classifyText(text)
  const model = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini'
  const url = 'https://api.openai.com/v1/chat/completions'
  const sys = 'You are an intent classifier. Return strict JSON: {"intent":"price_inquiry|appointment|shipping|other","confidence":0.0,"entities":{},"urgency":"low|normal|high","suggested_stage":"new|qualified|proposal|won|lost"}.'
  const user = `Text: ${text}`
  try {
    const r = await axios.post(url, { model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }, { headers: { Authorization: `Bearer ${key}` } })
    const c = r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content ? r.data.choices[0].message.content : '{}'
    const o = JSON.parse(c)
    return { intent: o.intent || 'other', confidence: o.confidence || 0.6, entities: o.entities || {}, urgency: o.urgency || 'normal', suggested_stage: o.suggested_stage || 'qualified' }
  } catch {
    return classifyText(text)
  }
}

async function sendClassified(result) {
  const url = process.env.LARAVEL_URL
  if (!url) return
  const payload = result
  const bodyJson = JSON.stringify(payload)
  const { sig, ts } = signInternal(bodyJson)
  try {
    await axios.post(`${url}/internal/ai/classified`, payload, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
  } catch {}
}

const worker = new Worker('classify', async job => {
  const intent = await llmClassify(job.data.text)
  const payload = {
    tenant_key: job.data.tenantKey,
    channel: job.data.channel === 'whatsapp' ? 'wa' : 'ig',
    external_message_id: job.data.messageId,
    intent: intent.intent,
    confidence: intent.confidence,
    entities: intent.entities || {},
    urgency: intent.urgency || 'normal',
    suggested_stage: intent.suggested_stage || 'qualified'
  }
  await sendClassified(payload)
  return payload
}, { connection })

worker.on('completed', () => {})
worker.on('failed', () => {})