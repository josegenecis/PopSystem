import { supabase } from '@/integrations/supabase/client'

const sha256Hex = async (input: string) => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(digest))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const createPrintAgentToken = async (params: { restaurantUserId: string; name?: string }) => {
  const token = randomToken()
  const tokenHash = await sha256Hex(token)

  const { error } = await supabase
    .from('print_agent_tokens' as any)
    .insert({
      restaurant_user_id: params.restaurantUserId,
      name: params.name || null,
      token_hash: tokenHash,
      revoked: false,
    } as any)

  if (error) throw error
  return { token }
}

export const enqueuePrintJob = async (params: { restaurantUserId: string; jobType: string; payload: any; idempotencyKey?: string }) => {
  const row = {
    restaurant_user_id: params.restaurantUserId,
    status: 'queued',
    job_type: params.jobType,
    payload: params.payload,
    idempotency_key: params.idempotencyKey || null,
  } as any
  const query = params.idempotencyKey
    ? supabase.from('print_jobs' as any).upsert(row, {
        onConflict: 'restaurant_user_id,idempotency_key',
        ignoreDuplicates: true,
      })
    : supabase.from('print_jobs' as any).insert(row)
  const { data, error } = await query
    .select('id')
    .maybeSingle()

  if (error) throw error
  return { id: data?.id as string | undefined }
}
