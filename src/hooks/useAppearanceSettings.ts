
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface AppearanceSettings {
  theme: string;
  primary_color: string;
  font_size: string;
  compact_mode: boolean;
  show_animations: boolean;
  high_contrast: boolean;
  reduced_motion: boolean;
}

export const useAppearanceSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppearanceSettings>({
    theme: 'light',
    primary_color: 'orange',
    font_size: 'medium',
    compact_mode: false,
    show_animations: true,
    high_contrast: false,
    reduced_motion: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchSettings();
    } else {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  // Carregar fallback do localStorage quando não houver dados no Supabase
  useEffect(() => {
    if (!user) {
      try {
        const raw = localStorage.getItem('appearance_settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          setSettings((prev) => ({ ...prev, ...parsed }));
        }
      } catch {}
    }
  }, [user]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('appearance_settings')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Erro ao carregar configurações:', error);
        return;
      }

      if (data) {
        const newSettings = {
          theme: data.theme || 'light',
          primary_color: data.primary_color || 'orange',
          font_size: data.font_size || 'medium',
          compact_mode: data.compact_mode || false,
          show_animations: data.show_animations || true,
          high_contrast: data.high_contrast || false,
          reduced_motion: data.reduced_motion || false,
        };
        setSettings(newSettings);
        try { localStorage.setItem('appearance_settings', JSON.stringify(newSettings)); } catch {}
      } else {
        // Fallback localStorage
        try {
          const raw = localStorage.getItem('appearance_settings');
          if (raw) {
            const parsed = JSON.parse(raw);
            setSettings((prev) => ({ ...prev, ...parsed }));
          }
        } catch {}
      }
    } catch (error) {
      console.error('Erro ao carregar configurações de aparência:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<AppearanceSettings>) => {
    try {
      const updatedSettings = { ...settings, ...newSettings };
      // Atualizar UI imediatamente (optimistic update)
      setSettings(updatedSettings);
      try { localStorage.setItem('appearance_settings', JSON.stringify(updatedSettings)); } catch {}

    const { error } = await supabase
      .from('appearance_settings')
      .upsert({
        user_id: user?.id,
        theme: updatedSettings.theme,
        primary_color: updatedSettings.primary_color,
        font_size: updatedSettings.font_size,
        compact_mode: updatedSettings.compact_mode,
        show_animations: updatedSettings.show_animations,
        high_contrast: updatedSettings.high_contrast,
        reduced_motion: updatedSettings.reduced_motion,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

      if (error) throw error;

      toast({
        title: "Configurações salvas",
        description: "As configurações de aparência foram atualizadas com sucesso.",
      });
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      toast({
        title: "Erro",
        description: "Erro ao salvar configurações de aparência.",
        variant: "destructive"
      });
    }
  };

  const applySettings = (settings: AppearanceSettings) => {
    const root = document.documentElement;
    
    // Apply theme
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else if (settings.theme === 'auto') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', !!prefersDark);
    } else {
      root.classList.remove('dark');
    }

    // Apply primary color with correct HSL values
    const colorMap = {
      orange: { primary: '25 95% 53%', accent: '25 95% 53%' },
      blue: { primary: '221 83% 53%', accent: '217 91% 60%' },
      green: { primary: '142 76% 36%', accent: '138 76% 49%' },
      purple: { primary: '258 90% 66%', accent: '266 85% 58%' },
      red: { primary: '0 72% 51%', accent: '0 84% 60%' }
    };

    const colors = colorMap[settings.primary_color as keyof typeof colorMap];
    if (colors) {
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--accent', colors.accent);
      // Garantir contraste adequado para textos sobre primary/accent
      root.style.setProperty('--primary-foreground', '0 0% 100%');
      root.style.setProperty('--accent-foreground', '0 0% 100%');
      // Atualizar ring para acompanhar a cor principal
      root.style.setProperty('--ring', colors.primary);
    }

    // Apply font size
    const fontSizes = {
      small: '14px',
      medium: '16px',
      large: '18px',
      'extra-large': '20px'
    };
    root.style.fontSize = fontSizes[settings.font_size as keyof typeof fontSizes];

    // Apply other settings
    if (settings.compact_mode) {
      root.classList.add('compact-mode');
    } else {
      root.classList.remove('compact-mode');
    }

    if (settings.high_contrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }

    if (settings.reduced_motion) {
      root.classList.add('reduced-motion');
    } else {
      root.classList.remove('reduced-motion');
    }

    if (!settings.show_animations) {
      root.classList.add('no-animations');
    } else {
      root.classList.remove('no-animations');
    }
  };

  return {
    settings,
    loading,
    updateSettings,
    applySettings
  };
};
