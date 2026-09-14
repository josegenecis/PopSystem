import { supabase } from '@/integrations/supabase/client';

export const WHATSAPP_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav',
  'video/mp4', 'application/pdf', 'text/plain'
]);

export function whatsappMediaType(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export function validateWhatsAppMedia(file: File) {
  if (file.size > WHATSAPP_MEDIA_MAX_BYTES) throw new Error('O arquivo deve ter no máximo 10 MB.');
  if (!allowedMimeTypes.has(file.type)) throw new Error('Formato não permitido. Envie imagem, PDF, texto, vídeo MP4 ou áudio.');
}

export async function uploadWhatsAppMedia(userId: string, conversationId: string, file: File) {
  validateWhatsAppMedia(file);
  const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'arquivo';
  const path = `${userId}/${conversationId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('whatsapp-media').upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false
  });
  if (error) throw error;
  const { data, error: signedError } = await supabase.storage.from('whatsapp-media').createSignedUrl(path, 60 * 60);
  if (signedError || !data?.signedUrl) {
    await supabase.storage.from('whatsapp-media').remove([path]);
    throw signedError || new Error('Não foi possível preparar o anexo.');
  }
  return { path, signedUrl: data.signedUrl, mediaType: whatsappMediaType(file.type) };
}

export async function signWhatsAppMedia(path?: string | null) {
  if (!path) return '';
  const { data } = await supabase.storage.from('whatsapp-media').createSignedUrl(path, 60 * 60);
  return data?.signedUrl || '';
}
