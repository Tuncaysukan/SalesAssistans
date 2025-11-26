import dotenv from 'dotenv'
import axios from 'axios'
dotenv.config()

async function graphPost(phoneNumberId, payload) {
  const token = process.env.WA_TOKEN
  if (!token) return { ok: true, id: `wa_fake_${Date.now()}` }
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`
  const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } })
  return r.data || { ok: true }
}

export async function sendText(tenant, to, text) {
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
  return graphPost(tenant, payload)
}

export async function sendTemplate(tenant, to, templateName) {
  const language = 'tr'
  const payload = { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: language } } }
  return graphPost(tenant, payload)
}