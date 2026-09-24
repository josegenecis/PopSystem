
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Save, Copy, Clock3, Smartphone, CalendarClock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { formatBRL, parseBRL } from '@/lib/currency';
import AdjustableImageDialog from '@/components/media/AdjustableImageDialog';
import { DEFAULT_ORDER_SCHEDULING_CONFIG, getOrderSchedulingConfig, type OrderSchedulingConfig } from '@/lib/orderScheduling';

const weekDays = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
] as const;

type WeekDayKey = typeof weekDays[number]['key'];

type DailySchedule = {
  open: string;
  close: string;
  closed: boolean;
};

const createDefaultSchedule = (): Record<WeekDayKey, DailySchedule> => ({
  monday: { open: '10:00', close: '22:00', closed: false },
  tuesday: { open: '10:00', close: '22:00', closed: false },
  wednesday: { open: '10:00', close: '22:00', closed: false },
  thursday: { open: '10:00', close: '22:00', closed: false },
  friday: { open: '10:00', close: '22:00', closed: false },
  saturday: { open: '10:00', close: '22:00', closed: false },
  sunday: { open: '10:00', close: '22:00', closed: false },
});

const normalizeSchedule = (value: any, fallback?: DailySchedule): DailySchedule => ({
  open: typeof value?.open === 'string' && value.open ? value.open : fallback?.open || '10:00',
  close: typeof value?.close === 'string' && value.close ? value.close : fallback?.close || '22:00',
  closed: Boolean(value?.closed),
});

const parseWeeklySchedule = (openingHours?: string | null): Record<WeekDayKey, DailySchedule> => {
  const defaults = createDefaultSchedule();
  if (!openingHours) return defaults;

  try {
    const parsed = JSON.parse(openingHours);
    if (parsed && typeof parsed === 'object') {
      return weekDays.reduce((acc, day) => {
        acc[day.key] = normalizeSchedule(parsed[day.key], defaults[day.key]);
        return acc;
      }, {} as Record<WeekDayKey, DailySchedule>);
    }
  } catch {}

  const match = String(openingHours).match(/(\d{2}:\d{2})\s*[-àa]+\s*(\d{2}:\d{2})/i);
  if (match) {
    const [, open, close] = match;
    return weekDays.reduce((acc, day) => {
      acc[day.key] = { open, close, closed: false };
      return acc;
    }, {} as Record<WeekDayKey, DailySchedule>);
  }

  return defaults;
};

const ProfileSettings = () => {
  const [formData, setFormData] = useState({
    restaurantName: '',
    description: '',
    phone: '',
    address: '',
    email: '',
    website: '',
    openingHours: '10:00 - 22:00',
    deliveryFee: formatBRL(5),
    minimumOrder: formatBRL(25)
  });
  
  const [profileImage, setProfileImage] = useState('');
  const [bannerImage, setBannerImage] = useState('');
  const [bannerFit, setBannerFit] = useState<'cover' | 'contain'>('cover');
  const [profileThemeConfig, setProfileThemeConfig] = useState<Record<string, any>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [pendingBannerFile, setPendingBannerFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [weeklySchedule, setWeeklySchedule] = useState<Record<WeekDayKey, DailySchedule>>(createDefaultSchedule());
  const [orderScheduling, setOrderScheduling] = useState<OrderSchedulingConfig>({ ...DEFAULT_ORDER_SCHEDULING_CONFIG });
  const { toast } = useToast();
  const { user } = useAuth();

  const previewTheme = {
    primary: profileThemeConfig.primary || '#85C441',
    secondary: profileThemeConfig.secondary || '#063D2E',
    accent: profileThemeConfig.accent || '#EF6C20',
    price: profileThemeConfig.price || profileThemeConfig.accent || '#EF6C20',
    tag: profileThemeConfig.tag || profileThemeConfig.primary || '#85C441',
    background: profileThemeConfig.background || '#F7EEDF',
  };

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user]);

  const loadProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user?.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Erro ao carregar perfil:', error);
        return;
      }

      if (data) {
        setFormData({
          restaurantName: data.restaurant_name || '',
          description: data.description || '',
          phone: data.phone || '',
          address: data.address || '',
          email: data.email || '',
          website: data.website || '',
          openingHours: data.opening_hours || '10:00 - 22:00',
          deliveryFee: formatBRL(data.delivery_fee ?? 5),
          minimumOrder: formatBRL(data.minimum_order ?? 25)
        });
        setWeeklySchedule(parseWeeklySchedule(data.opening_hours));
        setProfileImage(data.logo_url || '');
        setBannerImage(data.banner_url || '');
        const themeConfig = (data as any).theme_config && typeof (data as any).theme_config === 'object' ? (data as any).theme_config : {};
        setProfileThemeConfig(themeConfig);
        setOrderScheduling(getOrderSchedulingConfig(themeConfig));
        setBannerFit(themeConfig.bannerFit === 'contain' ? 'contain' : 'cover');
      }
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const updateWeeklySchedule = (day: WeekDayKey, updates: Partial<DailySchedule>) => {
    setWeeklySchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        ...updates
      }
    }));
  };

  const copyDayToAll = (sourceDay: WeekDayKey) => {
    setWeeklySchedule(prev => {
      const source = prev[sourceDay];
      return weekDays.reduce((acc, day) => {
        acc[day.key] = { ...source };
        return acc;
      }, {} as Record<WeekDayKey, DailySchedule>);
    });

    toast({
      title: 'Horários copiados',
      description: 'O horário selecionado foi aplicado para todos os dias.',
    });
  };

  const uploadProfileImage = async (file: File, kind: 'logo' | 'banner') => {
    if (!user) return;

    const setKindUploading = kind === 'logo' ? setUploading : setUploadingBanner;
    setKindUploading(true);
    try {
      const fileExt = file.name.split('.').pop() || 'png';
      const fileName = `${user.id}_${kind}_${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);

      if (kind === 'logo') {
        setProfileImage(publicUrl);
      } else {
        setBannerImage(publicUrl);
        setBannerFit('cover');
      }

      toast({
        title: kind === 'logo' ? 'Logo ajustada' : 'Banner ajustado',
        description: kind === 'logo'
          ? 'A logo foi carregada com o enquadramento escolhido. Clique em salvar para confirmar.'
          : 'O banner foi carregado com o enquadramento escolhido. Clique em salvar para confirmar.',
      });
    } catch (error) {
      console.error('Erro no upload:', error);
      toast({
        title: 'Erro no upload',
        description: 'Não foi possível fazer upload da imagem. Tente novamente.',
        variant: 'destructive'
      });
    } finally {
      setKindUploading(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione apenas arquivos de imagem.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Erro',
        description: 'A imagem deve ter no máximo 5MB.',
        variant: 'destructive',
      });
      return;
    }

    setPendingLogoFile(file);
  };

  const handleBannerUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione apenas arquivos de imagem.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'Erro',
        description: 'A imagem deve ter no máximo 10MB.',
        variant: 'destructive',
      });
      return;
    }

    setPendingBannerFile(file);
  };

  const handleSave = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const profileData = {
        id: user.id,
        restaurant_name: formData.restaurantName,
        description: formData.description,
        phone: formData.phone,
        address: formData.address,
        email: formData.email,
        website: formData.website,
        opening_hours: JSON.stringify(weeklySchedule),
        delivery_fee: parseBRL(formData.deliveryFee),
        minimum_order: parseBRL(formData.minimumOrder),
        logo_url: profileImage,
        banner_url: bannerImage,
        theme_config: {
          ...profileThemeConfig,
          bannerFit,
          orderScheduling,
        },
        updated_at: new Date().toISOString()
      };

      const trySave = async (data: any) => {
        const { id, ...updateData } = data;
        const upd = await supabase.from('profiles').update(updateData).eq('id', id).select('id');
        const updateError = (upd as any).error;
        if (updateError) return updateError;
        const updatedRows = (upd as any).data;
        if (Array.isArray(updatedRows) && updatedRows.length > 0) return null;
        const ins = await supabase.from('profiles').insert(data);
        return (ins as any).error;
      };

      let error = await trySave(profileData);

      if (error && String((error as any)?.message || '').toLowerCase().includes('jwt')) {
        try {
          await supabase.auth.refreshSession();
          error = await trySave(profileData);
        } catch {}
      }

      let msg = String((error as any)?.message || '');
      if (error && (msg.includes('banner_url') || String((error as any)?.details || '').includes('banner_url'))) {
        const { banner_url, ...withoutBanner } = profileData as any;
        error = await trySave(withoutBanner);
        msg = String((error as any)?.message || '');
        if (!error && bannerImage) {
          toast({
            title: "Perfil salvo",
            description: "Salvei o perfil. Para salvar o banner, aplique a atualização do banco (banner_url).",
          });
          return;
        }
      }

      if (error && (msg.includes('theme_config') || String((error as any)?.details || '').includes('theme_config'))) {
        const { theme_config, ...withoutThemeConfig } = profileData as any;
        error = await trySave(withoutThemeConfig);
        if (!error) {
          toast({
            title: "Perfil salvo",
            description: "Salvei o perfil. Para salvar o ajuste da capa, aplique a atualização do banco (theme_config).",
          });
          return;
        }
      }

      if (error) throw error;
      
      toast({
        title: "Perfil salvo!",
        description: "As informações do restaurante foram atualizadas com sucesso.",
      });
    } catch (error) {
      console.error('Erro ao salvar:', error);
      toast({
        title: "Erro ao salvar",
        description: String((error as any)?.message || "Não foi possível salvar o perfil. Tente novamente."),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdjustableImageDialog
        open={Boolean(pendingLogoFile)}
        file={pendingLogoFile}
        title="Ajustar logo"
        aspectRatio={1}
        outputWidth={512}
        outputHeight={512}
        onCancel={() => setPendingLogoFile(null)}
        onConfirm={(file) => {
          setPendingLogoFile(null);
          void uploadProfileImage(file, 'logo');
        }}
      />
      <AdjustableImageDialog
        open={Boolean(pendingBannerFile)}
        file={pendingBannerFile}
        title="Ajustar banner do restaurante"
        aspectRatio={3}
        outputWidth={1200}
        outputHeight={400}
        onCancel={() => setPendingBannerFile(null)}
        onConfirm={(file) => {
          setPendingBannerFile(null);
          void uploadProfileImage(file, 'banner');
        }}
      />
      <Card className="border border-[#FF6400]/12 bg-gradient-to-br from-[#FFF8F2] via-white to-[#F5EBE1]/60 shadow-[0_20px_50px_-36px_rgba(0,50,35,0.18)]">
        <CardHeader className="border-b border-[#FF6400]/10 bg-white/70">
          <CardTitle>Informações Básicas</CardTitle>
          <CardDescription>
            Configure as informações principais do seu restaurante
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center space-x-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profileImage} />
              <AvatarFallback>RS</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Label htmlFor="logo-upload" className="cursor-pointer">
                <Button variant="outline" className="cursor-pointer border-[#FF6400]/15 bg-white/85 text-[#003223] hover:bg-[#F5EBE1]" disabled={uploading} asChild>
                  <span>
                    <Upload size={16} className="mr-2" />
                    {uploading ? 'Enviando...' : 'Alterar Logo'}
                  </span>
                </Button>
              </Label>
              <input
                id="logo-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Formatos aceitos: JPG, PNG, WebP, GIF (máx. 5MB)
                </p>
                <p className="text-xs text-blue-600 font-medium">
                  Tamanho recomendado: 200x200px (formato quadrado)
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="space-y-2">
              <Label>Banner do Restaurante</Label>
              <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-xl border border-[#FF6400]/10 bg-[#FFF8F2] md:h-32">
                {bannerImage ? (
                  <img src={bannerImage} alt="Banner" className={`w-full h-full ${bannerFit === 'contain' ? 'object-contain' : 'object-cover'}`} />
                ) : (
                  <div className="text-xs text-muted-foreground">Nenhum banner cadastrado</div>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Label htmlFor="banner-upload" className="cursor-pointer">
                  <Button variant="outline" className="cursor-pointer border-[#FF6400]/15 bg-white/85 text-[#003223] hover:bg-[#F5EBE1]" disabled={uploadingBanner} asChild>
                    <span>
                      <Upload size={16} className="mr-2" />
                      {uploadingBanner ? 'Enviando...' : 'Alterar Banner'}
                    </span>
                  </Button>
                </Label>
                <input
                  id="banner-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleBannerUpload}
                />
                <div className="w-full space-y-1 sm:w-[220px]">
                  <Label className="text-xs font-semibold text-[#003223]/70">Ajuste da imagem</Label>
                  <Select value={bannerFit} onValueChange={(value) => setBannerFit(value === 'contain' ? 'contain' : 'cover')}>
                    <SelectTrigger className="h-10 rounded-xl border-[#FF6400]/15 bg-white/85">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">Preencher capa</SelectItem>
                      <SelectItem value="contain">Mostrar inteira</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Formatos aceitos: JPG, PNG, WebP, GIF (máx. 10MB)
                </p>
                <p className="text-xs text-blue-600 font-medium">
                  Tamanho recomendado: 1200x400px (formato horizontal)
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-[#003223]/10 bg-white/85 p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#003223]/60">
                <Smartphone className="h-4 w-4 text-[#FF6400]" />
                Preview mobile
              </div>
              <div className="mx-auto w-full max-w-[310px] overflow-hidden rounded-[28px] border-[8px] border-[#101820] bg-[#101820] shadow-xl">
                <div className="h-[560px] overflow-hidden rounded-[20px]" style={{ backgroundColor: previewTheme.background }}>
                  <div className="relative h-36 overflow-hidden" style={{ backgroundColor: previewTheme.secondary }}>
                    {bannerImage ? (
                      <img
                        src={bannerImage}
                        alt="Prévia da capa no cardápio mobile"
                        className={`absolute inset-0 h-full w-full ${bannerFit === 'contain' ? 'object-contain' : 'object-cover'}`}
                      />
                    ) : profileImage ? (
                      <img
                        src={profileImage}
                        alt="Prévia da logo no fundo do cardápio"
                        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-xl"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-black/15" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-transparent" />
                  </div>

                  <div className="-mt-11 px-3">
                    <div className="rounded-xl border border-black/5 bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-2">
                        <div className="-mt-7 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-sm">
                          {profileImage ? (
                            <img src={profileImage} alt="Logo na prévia mobile" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-black" style={{ color: previewTheme.secondary }}>
                              {(formData.restaurantName || 'PS').slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-black leading-tight" style={{ color: previewTheme.secondary }}>
                            {formData.restaurantName || 'Nome do restaurante'}
                          </h3>
                          <div className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${previewTheme.tag}22`, color: previewTheme.tag }}>
                            Aberto agora
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px]" style={{ color: previewTheme.secondary, opacity: 0.72 }}>
                            {formData.description || 'Descrição curta do restaurante aparecendo no cardápio digital.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl bg-white p-2 shadow-sm">
                      <div className="h-9 rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-400">Buscar no cardápio</div>
                    </div>

                    <div className="mt-3 flex gap-2 overflow-hidden">
                      {['Destaques', 'Combos', 'Bebidas'].map((item, index) => (
                        <div
                          key={item}
                          className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold"
                          style={{
                            backgroundColor: index === 0 ? previewTheme.primary : '#fff',
                            color: index === 0 ? '#fff' : previewTheme.secondary,
                            border: index === 0 ? 'none' : '1px solid rgba(0,0,0,0.08)'
                          }}
                        >
                          {item}
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 space-y-2">
                      {[
                        ['Produto destaque', 'R$ 32,90'],
                        ['Combo especial', 'R$ 48,00']
                      ].map(([name, price]) => (
                        <div key={name} className="flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm">
                          <div className="h-14 w-14 rounded-xl" style={{ backgroundColor: `${previewTheme.primary}22` }} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-black" style={{ color: previewTheme.secondary }}>{name}</div>
                            <div className="mt-1 text-[11px] text-slate-500">Descrição do item no app mobile.</div>
                            <div className="mt-1 text-sm font-black" style={{ color: previewTheme.price }}>{price}</div>
                          </div>
                          <div className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-black text-white" style={{ backgroundColor: previewTheme.primary }}>+</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="restaurant-name">Nome do Restaurante</Label>
              <Input
                id="restaurant-name"
                value={formData.restaurantName}
                onChange={(e) => handleInputChange('restaurantName', e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Endereço Completo</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição do Restaurante</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={3}
            />
          </div>

          <div className="rounded-2xl border border-[#8CC850]/25 bg-gradient-to-br from-[#F4FAEC] via-white to-[#FFF8F2] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <div className="rounded-xl bg-[#8CC850]/15 p-2 text-[#003223]"><CalendarClock className="h-5 w-5" /></div>
                <div>
                  <Label htmlFor="order-scheduling" className="text-base font-bold text-[#003223]">Permitir pedidos agendados</Label>
                  <p className="mt-1 text-sm text-[#003223]/65">O cliente poderá escolher uma data e um horário futuro no fechamento do pedido.</p>
                </div>
              </div>
              <Switch
                id="order-scheduling"
                checked={orderScheduling.enabled}
                onCheckedChange={(enabled) => setOrderScheduling((current) => ({ ...current, enabled }))}
              />
            </div>

            {orderScheduling.enabled && (
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="schedule-lead">Antecedência mínima</Label>
                  <Select
                    value={String(orderScheduling.minimumLeadMinutes)}
                    onValueChange={(value) => setOrderScheduling((current) => ({ ...current, minimumLeadMinutes: Number(value) }))}
                  >
                    <SelectTrigger id="schedule-lead"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="60">1 hora</SelectItem>
                      <SelectItem value="120">2 horas</SelectItem>
                      <SelectItem value="240">4 horas</SelectItem>
                      <SelectItem value="1440">1 dia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-preparation">Avisar para preparar</Label>
                  <Select
                    value={String(orderScheduling.preparationLeadMinutes)}
                    onValueChange={(value) => setOrderScheduling((current) => ({ ...current, preparationLeadMinutes: Number(value) }))}
                  >
                    <SelectTrigger id="schedule-preparation"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No horário</SelectItem>
                      <SelectItem value="15">15 min antes</SelectItem>
                      <SelectItem value="30">30 min antes</SelectItem>
                      <SelectItem value="45">45 min antes</SelectItem>
                      <SelectItem value="60">1 hora antes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-interval">Intervalo dos horários</Label>
                  <Select
                    value={String(orderScheduling.slotIntervalMinutes)}
                    onValueChange={(value) => setOrderScheduling((current) => ({ ...current, slotIntervalMinutes: Number(value) }))}
                  >
                    <SelectTrigger id="schedule-interval"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutos</SelectItem>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="60">1 hora</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-days">Agendar até</Label>
                  <Select
                    value={String(orderScheduling.maximumAdvanceDays)}
                    onValueChange={(value) => setOrderScheduling((current) => ({ ...current, maximumAdvanceDays: Number(value) }))}
                  >
                    <SelectTrigger id="schedule-days"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 dias</SelectItem>
                      <SelectItem value="7">7 dias</SelectItem>
                      <SelectItem value="14">14 dias</SelectItem>
                      <SelectItem value="30">30 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border border-[#8CC850]/20 bg-gradient-to-br from-[#F5EBE1]/85 via-white to-[#8CC850]/10 shadow-[0_20px_50px_-36px_rgba(0,50,35,0.2)]">
        <CardHeader className="border-b border-[#8CC850]/15 bg-white/70">
          <CardTitle>Configurações de Delivery</CardTitle>
          <CardDescription>
            Configure horários e valores para delivery
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[#FF6400]" />
              <Label>Horário de Funcionamento por Dia</Label>
            </div>
            <div className="space-y-3 rounded-2xl border border-[#8CC850]/18 bg-gradient-to-br from-[#FFF8F2] via-white to-[#8CC850]/10 p-3">
              {weekDays.map((day) => {
                const current = weeklySchedule[day.key];
                return (
                  <div key={day.key} className="grid gap-3 rounded-xl border border-[#FF6400]/10 bg-white/90 p-3 md:grid-cols-[90px_1fr_1fr_auto_auto] md:items-center">
                    <div className="text-sm font-semibold text-[#003223]">{day.label}</div>
                    <div className="flex items-center gap-2 rounded-xl border border-[#FF6400]/10 bg-[#FFF8F2]/85 px-3 py-2">
                      <Label htmlFor={`${day.key}-open`} className="shrink-0 text-xs font-semibold text-[#003223]/65">Abre</Label>
                      <Input
                        id={`${day.key}-open`}
                        type="time"
                        value={current.open}
                        disabled={current.closed}
                        onChange={(e) => updateWeeklySchedule(day.key, { open: e.target.value })}
                        className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-[#FF6400]/10 bg-[#FFF8F2]/85 px-3 py-2">
                      <Label htmlFor={`${day.key}-close`} className="shrink-0 text-xs font-semibold text-[#003223]/65">Fecha</Label>
                      <Input
                        id={`${day.key}-close`}
                        type="time"
                        value={current.close}
                        disabled={current.closed}
                        onChange={(e) => updateWeeklySchedule(day.key, { close: e.target.value })}
                        className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#8CC850]/20 bg-[#8CC850]/10 px-3 py-2">
                      <Label htmlFor={`${day.key}-closed`} className="text-sm font-medium text-[#003223]">Fechado</Label>
                      <Switch
                        id={`${day.key}-closed`}
                        checked={current.closed}
                        onCheckedChange={(checked) => updateWeeklySchedule(day.key, { closed: checked })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl border-[#FF6400]/15 bg-white text-[#003223] hover:bg-[#F5EBE1]"
                      onClick={() => copyDayToAll(day.key)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar para todos
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="delivery-fee">Taxa de Entrega (R$)</Label>
              <CurrencyTextInput
                id="delivery-fee"
                value={formData.deliveryFee}
                onValueChange={(value) => handleInputChange('deliveryFee', value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="minimum-order">Pedido Mínimo (R$)</Label>
              <CurrencyTextInput
                id="minimum-order"
                value={formData.minimumOrder}
                onValueChange={(value) => handleInputChange('minimumOrder', value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="w-full md:w-auto rounded-xl bg-[#8CC850] text-[#003223] hover:bg-[#79b541]" disabled={loading}>
          <Save size={16} className="mr-2" />
          {loading ? 'Salvando...' : 'Salvar Alterações'}
        </Button>
      </div>
    </div>
  );
};

export default ProfileSettings;
