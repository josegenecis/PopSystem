
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Palette, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Cores prontas sugeridas para o cardápio
const PRESET_COLORS = [
  { id: 'pomar', name: 'Pomar', primary: '#85C441', secondary: '#063D2E', accent: '#EF6C20', price: '#EF6C20', tag: '#85C441', background: '#F7EEDF' },
  { id: 'ifood', name: 'Clássico Red', primary: '#EA1D2C', secondary: '#333333', accent: '#EA1D2C', price: '#EA1D2C', tag: '#EA1D2C', background: '#F7F7F7' },
  { id: 'ocean', name: 'Ocean', primary: '#0ea5e9', secondary: '#0f172a', accent: '#38bdf8', price: '#0284c7', tag: '#0ea5e9', background: '#f8fafc' },
];

const AppearanceSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [isSaving, setIsSaving] = useState(false);
  const [menuColors, setMenuColors] = useState({
    primary: '#85C441', // Cor principal (botões)
    secondary: '#063D2E', // Cor secundária (textos, cabeçalho)
    accent: '#EF6C20', // Cor de destaque (ícones)
    price: '#EF6C20', // Cor dos preços
    tag: '#85C441', // Cor das tags/badges
    background: '#F7EEDF' // Cor de fundo do cardápio
  });

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
          const theme = data.theme_config as any;
          setMenuColors({
            primary: theme.primary || '#85C441',
            secondary: theme.secondary || '#063D2E',
            accent: theme.accent || '#EF6C20',
            price: theme.price || theme.accent || '#EF6C20',
            tag: theme.tag || theme.primary || '#85C441',
            background: theme.background || '#F7EEDF',
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
      const currentTheme = (currentProfile?.theme_config && typeof currentProfile.theme_config === 'object')
        ? currentProfile.theme_config as Record<string, any>
        : {};

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

  return (
    <div className="space-y-6">
      <Card className="border-boracume-orange/30 shadow-md">
        <CardHeader className="bg-boracume-light/50 border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-boracume-dark-green">
            <Palette size={24} className="text-boracume-orange" />
            Personalização do Cardápio Digital
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
