
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Check, MonitorCog, Palette, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAppearanceSettings } from '@/hooks/useAppearanceSettings';
import {
  getSystemColorPalette,
  SYSTEM_COLOR_PALETTES,
  SystemColorScheme,
} from '@/lib/systemAppearance';

// Cores prontas sugeridas para o cardápio
const PRESET_COLORS = [
  { id: 'pomar', name: 'Pomar', primary: '#85C441', secondary: '#063D2E', accent: '#EF6C20', price: '#EF6C20', tag: '#85C441', background: '#F7EEDF' },
  { id: 'ifood', name: 'Clássico Red', primary: '#EA1D2C', secondary: '#333333', accent: '#EA1D2C', price: '#EA1D2C', tag: '#EA1D2C', background: '#F7F7F7' },
  { id: 'ocean', name: 'Ocean', primary: '#0ea5e9', secondary: '#0f172a', accent: '#38bdf8', price: '#0284c7', tag: '#0ea5e9', background: '#f8fafc' },
];

const asThemeRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
};

const themeColor = (theme: Record<string, unknown>, key: string, fallback: string) => {
  return typeof theme[key] === 'string' ? theme[key] as string : fallback;
};

const AppearanceSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    settings: systemAppearance,
    loading: isSystemAppearanceLoading,
    updateSettings: updateSystemAppearance,
  } = useAppearanceSettings();
  
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingSystemColor, setIsSavingSystemColor] = useState(false);
  const [systemColor, setSystemColor] = useState<SystemColorScheme>(systemAppearance.primary_color);
  const [menuColors, setMenuColors] = useState({
    primary: '#85C441', // Cor principal (botões)
    secondary: '#063D2E', // Cor secundária (textos, cabeçalho)
    accent: '#EF6C20', // Cor de destaque (ícones)
    price: '#EF6C20', // Cor dos preços
    tag: '#85C441', // Cor das tags/badges
    background: '#F7EEDF' // Cor de fundo do cardápio
  });

  useEffect(() => {
    setSystemColor(systemAppearance.primary_color);
  }, [systemAppearance.primary_color]);

  // Carregar as cores do banco quando o componente montar
  useEffect(() => {
    const loadMenuColors = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('theme_config')
          .eq('id', user.id)
          .single();
          
        if (data?.theme_config) {
          const theme = asThemeRecord(data.theme_config);
          const accent = themeColor(theme, 'accent', '#EF6C20');
          setMenuColors({
            primary: themeColor(theme, 'primary', '#85C441'),
            secondary: themeColor(theme, 'secondary', '#063D2E'),
            accent,
            price: themeColor(theme, 'price', accent),
            tag: themeColor(theme, 'tag', themeColor(theme, 'primary', '#85C441')),
            background: themeColor(theme, 'background', '#F7EEDF'),
          });
        }
      } catch (err) {
        console.error('Erro ao carregar cores do cardápio:', err);
      }
    };
    
    loadMenuColors();
  }, [user]);

  const handleColorChange = (field: keyof typeof menuColors, value: string) => {
    setMenuColors(prev => ({ ...prev, [field]: value }));
  };

  const applyPreset = (preset: typeof PRESET_COLORS[0]) => {
    setMenuColors({
      primary: preset.primary,
      secondary: preset.secondary,
      accent: preset.accent,
      price: preset.price,
      tag: preset.tag,
      background: preset.background
    });
  };

  const saveColors = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('theme_config')
        .eq('id', user.id)
        .maybeSingle();
      const currentTheme = asThemeRecord(currentProfile?.theme_config);

      const { error } = await supabase
        .from('profiles')
        .update({ theme_config: { ...currentTheme, ...menuColors } })
        .eq('id', user.id);
        
      if (error) throw error;
      
      toast({
        title: "Cores salvas com sucesso!",
        description: "As novas cores já estão ativas no seu cardápio digital.",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar as cores do cardápio.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveSystemColor = async () => {
    setIsSavingSystemColor(true);
    try {
      await updateSystemAppearance({ primary_color: systemColor });
    } finally {
      setIsSavingSystemColor(false);
    }
  };

  const selectedSystemPalette = getSystemColorPalette(systemColor);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-[color:var(--app-primary-border)] shadow-md">
        <CardHeader className="border-b bg-[var(--app-primary-soft)] pb-5">
          <CardTitle className="flex items-center gap-2 text-[var(--app-primary-deep)]">
            <MonitorCog size={24} className="text-[var(--app-primary)]" />
            Cores do sistema
          </CardTitle>
          <CardDescription>
            Escolha a identidade visual do painel. Menus, botões, destaques e navegação serão atualizados para toda a equipe desta loja.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            role="radiogroup"
            aria-label="Cor principal do sistema"
          >
            {SYSTEM_COLOR_PALETTES.map((palette) => {
              const selected = systemColor === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSystemColor(palette.id)}
                  className={`relative overflow-hidden rounded-2xl border-2 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    selected ? 'border-[var(--app-primary)] shadow-md' : 'border-slate-200'
                  }`}
                >
                  <div className="flex h-16 overflow-hidden rounded-xl border border-black/5">
                    <span className="w-2/5" style={{ backgroundColor: palette.primaryDeep }} />
                    <span className="w-2/5" style={{ backgroundColor: palette.primary }} />
                    <span className="w-1/5 bg-white" />
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-slate-900">{palette.name}</p>
                      <p className="mt-1 text-xs leading-4 text-slate-500">{palette.description}</p>
                    </div>
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? 'text-white' : 'border-slate-200 text-transparent'}`}
                      style={selected ? { backgroundColor: palette.primary, borderColor: palette.primary } : undefined}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className="overflow-hidden rounded-2xl border p-4 sm:p-5"
            style={{ backgroundColor: selectedSystemPalette.surface, borderColor: selectedSystemPalette.border }}
          >
            <div className="flex min-h-28 overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="w-16 p-3" style={{ backgroundColor: selectedSystemPalette.primaryDeep }}>
                <div className="mx-auto h-8 w-8 rounded-lg" style={{ backgroundColor: selectedSystemPalette.primary }} />
                <div className="mx-auto mt-3 h-2 w-8 rounded-full bg-white/70" />
                <div className="mx-auto mt-2 h-2 w-8 rounded-full bg-white/40" />
              </div>
              <div className="flex flex-1 flex-col justify-between p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Pré-visualização</p>
                  <p className="mt-1 text-lg font-black" style={{ color: selectedSystemPalette.primaryDeep }}>Seu PopSystem</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: selectedSystemPalette.primaryDark }}>Botão principal</span>
                  <span className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" style={{ borderColor: selectedSystemPalette.border, color: selectedSystemPalette.primaryDeep }}>Ação secundária</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={saveSystemColor}
              disabled={isSavingSystemColor || isSystemAppearanceLoading}
              className="w-full gap-2 sm:w-auto"
            >
              <Save size={18} />
              {isSavingSystemColor ? 'Aplicando...' : `Aplicar tema ${selectedSystemPalette.name}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-boracume-orange/30 shadow-md">
        <CardHeader className="bg-boracume-light/50 border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-boracume-dark-green">
            <Palette size={24} className="text-boracume-orange" />
            Cores do cardápio digital
          </CardTitle>
          <CardDescription>
            Escolha as cores exatas da sua marca para deixar o cardápio com a cara do seu restaurante.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-8">
          
          {/* Sugestões de Cores */}
          <div>
            <Label className="text-base font-semibold mb-3 block text-boracume-dark-green">
              Temas Prontos Sugeridos
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PRESET_COLORS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 hover:border-boracume-green hover:shadow-md transition-all bg-white"
                >
                  <div className="flex w-full h-8 rounded-md overflow-hidden">
                    <div className="flex-1" style={{ backgroundColor: preset.primary }}></div>
                    <div className="flex-1" style={{ backgroundColor: preset.secondary }}></div>
                    <div className="flex-1" style={{ backgroundColor: preset.background }}></div>
                  </div>
                  <span className="text-xs font-medium text-gray-700">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 my-4"></div>

          {/* Cores Customizadas */}
          <div>
            <Label className="text-base font-semibold mb-4 block text-boracume-dark-green">
              Personalização Livre (Cores Exatas)
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div className="space-y-3">
                <Label htmlFor="primary-color" className="text-sm">Cor Principal (Botões)</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="primary-color" 
                    value={menuColors.primary} 
                    onChange={(e) => handleColorChange('primary', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.primary} 
                    onChange={(e) => handleColorChange('primary', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="secondary-color" className="text-sm">Cor Secundária (Cabeçalho e Textos)</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="secondary-color" 
                    value={menuColors.secondary} 
                    onChange={(e) => handleColorChange('secondary', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.secondary} 
                    onChange={(e) => handleColorChange('secondary', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="accent-color" className="text-sm">Cor de Destaque (Ícones)</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="accent-color" 
                    value={menuColors.accent} 
                    onChange={(e) => handleColorChange('accent', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.accent} 
                    onChange={(e) => handleColorChange('accent', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="price-color" className="text-sm">Cor dos Preços</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="price-color" 
                    value={menuColors.price} 
                    onChange={(e) => handleColorChange('price', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.price} 
                    onChange={(e) => handleColorChange('price', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="tag-color" className="text-sm">Cor das Tags e Selos</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="tag-color" 
                    value={menuColors.tag} 
                    onChange={(e) => handleColorChange('tag', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.tag} 
                    onChange={(e) => handleColorChange('tag', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="bg-color" className="text-sm">Cor de Fundo da Página</Label>
                <div className="flex gap-3">
                  <Input 
                    type="color" 
                    id="bg-color" 
                    value={menuColors.background} 
                    onChange={(e) => handleColorChange('background', e.target.value)}
                    className="w-14 h-12 p-1 cursor-pointer"
                  />
                  <Input 
                    type="text" 
                    value={menuColors.background} 
                    onChange={(e) => handleColorChange('background', e.target.value)}
                    className="flex-1 font-mono uppercase"
                  />
                </div>
              </div>

            </div>
          </div>

          {/* Preview Rápido */}
          <div className="mt-8 p-6 rounded-xl border border-dashed" style={{ backgroundColor: menuColors.background }}>
            <h4 className="text-sm font-semibold mb-4 text-center opacity-50" style={{ color: menuColors.secondary }}>Pré-visualização</h4>
            <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-sm border p-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg leading-tight" style={{ color: menuColors.secondary }}>
                    Hambúrguer Artesanal
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Pão brioche, blend 160g, queijo prato e maionese da casa.</p>
                  <div className="mt-3">
                    <span className="font-bold text-lg" style={{ color: menuColors.price }}>R$ 32,90</span>
                    <span className="ml-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ color: menuColors.tag, borderColor: menuColors.tag, backgroundColor: `${menuColors.tag}1A` }}>
                      -10%
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold shadow-md" style={{ backgroundColor: menuColors.primary }}>
                    +
                  </div>
                </div>
              </div>
              <Button className="w-full mt-4 text-white font-bold" style={{ backgroundColor: menuColors.primary }}>
                Finalizar Pedido
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button 
          onClick={saveColors} 
          className="w-full md:w-auto bg-boracume-orange hover:bg-boracume-orange/90 text-white gap-2" 
          disabled={isSaving}
        >
          <Save size={18} />
          {isSaving ? 'Salvando...' : 'Salvar Personalização'}
        </Button>
      </div>
    </div>
  );
};

export default AppearanceSettings;
