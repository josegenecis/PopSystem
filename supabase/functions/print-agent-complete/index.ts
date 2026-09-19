// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-print-agent-token',
  'Content-Type': 'application/json'
}

const getEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key)
    if (value) return value
  }
  return ''
}

const sha256Hex = async (input: string) => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(digest))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = req.headers.get('x-print-agent-token') || ''
    if (!token) return new Response(JSON.stringify({ ok: false, error: 'missing_token' }), { status: 401, headers: corsHeaders })

    const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ ok: false, error: 'missing_env' }), { status: 500, headers: corsHeaders })

    const supabase = createClient(supabaseUrl, serviceKey)
    const tokenHash = await sha256Hex(token)

    const { data: agent, error: agentErr } = await supabase
      .from('print_agent_tokens')
      .select('id, restaurant_user_id, revoked')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (agentErr) return new Response(JSON.stringify({ ok: false, error: 'db_error', details: agentErr }), { status: 500, headers: corsHeaders })
    if (!agent || agent.revoked) return new Response(JSON.stringify({ ok: false, error: 'invalid_token' }), { status: 401, headers: corsHeaders })

    let body: any = {}
    try { body = await req.json() } catch { body = {} }

    const jobId = String(body?.jobId || '')
    const ok = !!body?.ok
    const errorText = body?.error ? String(body.error).slice(0, 2000) : null

    if (!jobId) return new Response(JSON.stringify({ ok: false, error: 'missing_job_id' }), { status: 400, headers: corsHeaders })

    const { data: job, error: jobErr } = await supabase
      .from('print_jobs')
      .select('id, restaurant_user_id, status, attempts')
      .eq('id', jobId)
      .maybeSingle()

    if (jobErr) return new Response(JSON.stringify({ ok: false, error: 'db_error', details: jobErr }), { status: 500, headers: corsHeaders })
    if (!job || job.restaurant_user_id !== agent.restaurant_user_id) return new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404, headers: corsHeaders })

    const shouldRetry = !ok && Number(job.attempts || 0) < 5
    const update: any = {
      status: ok ? 'printed' : shouldRetry ? 'queued' : 'failed',
      error: ok ? null : errorText,
      printed_at: ok ? new Date().toISOString() : null,
      picked_at: shouldRetry ? null : undefined,
      picked_by: shouldRetry ? null : undefined,
      updated_at: new Date().toISOString(),
    }
    if (update.picked_at === undefined) delete update.picked_at
    if (update.picked_by === undefined) delete update.picked_by

    const { error: updErr } = await supabase
      .from('print_jobs')
      .update(update)
      .eq('id', jobId)

    if (updErr) return new Response(JSON.stringify({ ok: false, error: 'db_error', details: updErr }), { status: 500, headers: corsHeaders })

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message }), { status: 500, headers: corsHeaders })
  }
})
