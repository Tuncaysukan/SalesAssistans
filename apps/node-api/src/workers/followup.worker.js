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

async function getConversation(id) {
  const base = process.env.LARAVEL_URL || `http://localhost:${process.env.NODE_API_PORT || 3001}`
  const url = `${base}/internal/conversations/${id}`
  const bodyJson = '{}'
  const { sig, ts } = signInternal(bodyJson)
  const r = await axios.get(url, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
  return r.data && r.data.conversation ? r.data.conversation : null
}

async function markOverdue(conversation_id) {
  const base = process.env.LARAVEL_URL || `http://localhost:${process.env.NODE_API_PORT || 3001}`
  const url = `${base}/internal/followup/overdue`
  const payload = { conversation_id }
  const bodyJson = JSON.stringify(payload)
  const { sig, ts } = signInternal(bodyJson)
  await axios.post(url, payload, { headers: sig ? { 'X-Internal-Signature': sig, 'X-Internal-Timestamp': ts } : {} })
}

const worker = new Worker('followup', async job => {
  const conv = await getConversation(job.data.convId)
  if (!conv) return
  const now = Date.now()
  const agentAnswered = !!conv.last_agent_message_at && conv.last_agent_message_at > conv.last_customer_message_at
  if (!agentAnswered) {
    await markOverdue(conv.id)
  }
}, { connection })

worker.on('completed', () => {})
worker.on('failed', () => {})