import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  applySystemColorScheme,
  DEFAULT_SYSTEM_COLOR_SCHEME,
  normalizeSystemColorScheme,
  SystemColorScheme,
} from '@/lib/systemAppearance';

export interface AppearanceSettings {
  theme: string;
  primary_color: SystemColorScheme;
  font_size: string;
  compact_mode: boolean;
  show_animations: boolean;
  high_contrast: boolean;
  reduced_motion: boolean;
}

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'light',
  primary_color: DEFAULT_SYSTEM_COLOR_SCHEME,
  font_size: 'medium',
  compact_mode: false,
  show_animations: true,
  high_contrast: false,
  reduced_motion: false,
};

const storageKeyFor = (userId?: string | null) => `popsystem_system_appearance_${userId || 'local'}`;

const readStoredSettings = (key: string): Partial<AppearanceSettings> | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Partial<AppearanceSettings> : null;
  } catch (error) {
    console.warn('[APPEARANCE] Preferência local inválida.', error);
    return null;
  }
};

const storeSettings = (key: string, settings: AppearanceSettings) => {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch (error) {
    console.warn('[APPEARANCE] Não foi possível salvar o cache local.', error);
  }
};

const mergeSettings = (
  base: AppearanceSettings,
  incoming?: Partial<AppearanceSettings> | null,
): AppearanceSettings => ({
  ...base,
  ...incoming,
  primary_color: normalizeSystemColorScheme(incoming?.primary_color || base.primary_color),
});

export const applyAppearanceSettings = (settings: AppearanceSettings) => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (settings.theme === 'dark') {
    root.classList.add('dark');
  } else if (settings.theme === 'auto') {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', Boolean(prefersDark));
  } else {
    root.classList.remove('dark');
  }

  applySystemColorScheme(settings.primary_color);

  const fontSizes = {
    small: '14px',
    medium: '16px',
    large: '18px',
    'extra-large': '20px',
  } as const;
  root.style.fontSize = fontSizes[settings.font_size as keyof typeof fontSizes] || fontSizes.medium;

  root.classList.toggle('compact-mode', settings.compact_mode);
  root.classList.toggle('high-contrast', settings.high_contrast);
  root.classList.toggle('reduced-motion', settings.reduced_motion);
  root.classList.toggle('no-animations', !settings.show_animations);
};

export const useAppearanceSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const userId = user?.id || null;
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const storageKey = storageKeyFor(userId);
    const cached = readStoredSettings(storageKey);
    if (cached) setSettings((current) => mergeSettings(current, cached));

    if (!userId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('appearance_settings')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        if (!active || !data) return;

        const loadedSettings: AppearanceSettings = {
          theme: data.theme || 'light',
          primary_color: normalizeSystemColorScheme(data.primary_color),
          font_size: data.font_size || 'medium',
          compact_mode: data.compact_mode ?? false,
          show_animations: data.show_animations ?? true,
          high_contrast: data.high_contrast ?? false,
          reduced_motion: data.reduced_motion ?? false,
        };
        setSettings(loadedSettings);
        storeSettings(storageKey, loadedSettings);
      } catch (error) {
        console.error('Erro ao carregar configurações de aparência:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchSettings();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    applyAppearanceSettings(settings);
  }, [settings]);

  const updateSettings = useCallback(async (newSettings: Partial<AppearanceSettings>) => {
    const updatedSettings = mergeSettings(settings, newSettings);
    setSettings(updatedSettings);
    applyAppearanceSettings(updatedSettings);
    storeSettings(storageKeyFor(userId), updatedSettings);

    if (!userId) return;

    try {
      const payload = {
        user_id: userId,
        theme: updatedSettings.theme,
        primary_color: updatedSettings.primary_color,
        font_size: updatedSettings.font_size,
        compact_mode: updatedSettings.compact_mode,
        show_animations: updatedSettings.show_animations,
        high_contrast: updatedSettings.high_contrast,
        reduced_motion: updatedSettings.reduced_motion,
        updated_at: new Date().toISOString(),
      };
      const { data: current, error: currentError } = await supabase
        .from('appearance_settings')
        .select('id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentError && currentError.code !== 'PGRST116') throw currentError;
      const { error } = current?.id
        ? await supabase.from('appearance_settings').update(payload).eq('id', current.id)
        : await supabase.from('appearance_settings').insert(payload);

      if (error) throw error;
      toast({
        title: 'Configurações salvas',
        description: 'As cores do sistema foram atualizadas para esta loja.',
      });
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar as cores do sistema.',
        variant: 'destructive',
      });
    }
  }, [settings, toast, userId]);

  return {
    settings,
    loading,
    updateSettings,
    applySettings: applyAppearanceSettings,
  };
};
