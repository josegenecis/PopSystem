import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { SUPABASE_URL, supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

interface PixSettingsRow {
  id?: string
  user_id: string
  provider: string
  credentials: any
  webhook_secret: string
  enabled: boolean
  mp_waiter_enabled?: boolean
}

const PixIntegrationSettings: React.FC = () => {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<PixSettingsRow | null>(null)
  const [provider, setProvider] = useState('custom')
  const [apiKey, setApiKey] = useState('')
  const [mpWaiterEnabled, setMpWaiterEnabled] = useState(false)

  const endpoint = useMemo(() => {
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '')
    return `${baseUrl}/functions/v1/pix-webhook`
  }, [])

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('pix_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!error && data) {
        setSettings(data as PixSettingsRow)
        setProvider((data as any).provider || 'custom')
        setApiKey(((data as any).credentials?.api_key) || '')
        setMpWaiterEnabled(Boolean((data as any).mp_waiter_enabled))
      }
    } catch (e) {
      // Tabela pode não existir ainda
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user?.id])

  const generateSecret = () => {
    const arr = new Uint8Array(16)
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(arr)
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  const save = async () => {
    if (!user) return
    setLoading(true)
    try {
      const payload = {
        user_id: user.id,
        provider,
        credentials: { api_key: apiKey },
        webhook_secret: settings?.webhook_secret || generateSecret(),
        enabled: true,
        mp_waiter_enabled: !!mpWaiterEnabled,
      }
      if (settings?.id) {
        const { error } = await supabase.from('pix_settings').update(payload).eq('id', settings.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('pix_settings').insert(payload).select('*').maybeSingle()
        if (error) throw error
        if (data) setSettings(data as PixSettingsRow)
      }
      toast({ title: 'Salvo', description: 'Configurações PIX atualizadas.' })
    } catch (e) {
      toast({ title: 'Erro', description: 'Não foi possível salvar. Aguarde a ativação do recurso no servidor.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const rotateSecret = async () => {
    if (!user) return
    setLoading(true)
    try {
      const newSecret = generateSecret()
      if (!settings?.id) {
        setSettings({ user_id: user.id, provider, credentials: { api_key: apiKey }, webhook_secret: newSecret, enabled: true })
        toast({ title: 'Gerado', description: 'Novo segredo criado. Salve para aplicar.' })
        return
      }
      const { error } = await supabase.from('pix_settings').update({ webhook_secret: newSecret }).eq('id', settings.id)
      if (error) throw error
      setSettings(prev => prev ? { ...prev, webhook_secret: newSecret } : prev)
      toast({ title: 'Segredo rotacionado', description: 'Webhook secret atualizado.' })
    } catch (e) {
      toast({ title: 'Erro', description: 'Não foi possível rotacionar o segredo.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>PIX</CardTitle>
        <CardDescription>Configure seu provedor de PIX e o webhook de confirmação por restaurante.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Input value={provider} onChange={e => setProvider(e.target.value)} placeholder="mercado_pago | gerencianet | asaas | custom" />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="chave do provedor" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Endpoint do Webhook</Label>
          <Input value={endpoint} readOnly />
        </div>

        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label>Gerar QR Code Mercado Pago no App Garçom</Label>
              <p className="mt-1 text-sm text-emerald-800">
                Ative para o garçom receber PIX online pelo celular, web ou POS.
              </p>
            </div>
            <Button
              type="button"
              variant={mpWaiterEnabled ? 'default' : 'outline'}
              onClick={() => setMpWaiterEnabled((current) => !current)}
            >
              {mpWaiterEnabled ? 'Ativo' : 'Inativo'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Webhook Secret</Label>
          <div className="flex gap-2">
            <Input value={settings?.webhook_secret || ''} readOnly />
            <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(settings?.webhook_secret || '')} disabled={!settings?.webhook_secret}>Copiar</Button>
            <Button type="button" variant="secondary" onClick={rotateSecret} disabled={loading}>Rotacionar</Button>
          </div>
        </div>

        <div className="bg-blue-50 p-4 rounded-md border border-blue-200 text-sm space-y-2">
            <h4 className="font-semibold text-blue-800">Como configurar o Mercado Pago:</h4>
            <ol className="list-decimal pl-4 space-y-1 text-blue-700">
                <li>Acesse o <a href="https://www.mercadopago.com.br/developers/panel" target="_blank" rel="noopener noreferrer" className="underline">Painel de Desenvolvedores do Mercado Pago</a>.</li>
                <li>Crie uma nova aplicação ou selecione uma existente.</li>
                <li>Em "Credenciais de produção", copie o "Access Token" e cole no campo <strong>API Key</strong> acima.</li>
                <li>No menu lateral, vá em "Notificações Webhooks" e configure a URL: <code className="bg-blue-100 px-1 rounded">{endpoint}</code></li>
                <li>Selecione os eventos: <code>payment.created</code> e <code>payment.updated</code>.</li>
                <li>Salve as alterações no Mercado Pago e clique em "Salvar" aqui.</li>
            </ol>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={loading}>Salvar</Button>
          <Button variant="outline" onClick={load} disabled={loading}>Recarregar</Button>
        </div>

        <p className="text-sm text-muted-foreground">Envie o header <code>x-pix-secret</code> com o segredo acima no webhook do seu provedor.</p>
      </CardContent>
    </Card>
  )
}

export default PixIntegrationSettings
