
import { z } from 'zod';

export const ownerPhoneDigits = (value: string) => String(value || '').replace(/\D/g, '');

export const normalizeOwnerPhone = (value: string) => {
  const digits = ownerPhoneDigits(value);
  const hasCountryCode = digits.startsWith('55') && (digits.length === 12 || digits.length === 13);
  return hasCountryCode ? digits : `55${digits}`;
};

export const formatOwnerPhoneInput = (value: string) => {
  const digits = ownerPhoneDigits(value);
  const localDigits = (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits).slice(0, 11);
  if (localDigits.length <= 2) return localDigits ? `(${localDigits}` : '';
  if (localDigits.length <= 6) return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2)}`;
  if (localDigits.length <= 10) return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 6)}-${localDigits.slice(6)}`;
  return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 7)}-${localDigits.slice(7)}`;
};

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email é obrigatório')
    .email('Email deve ter um formato válido')
    .max(255, 'Email deve ter no máximo 255 caracteres'),
  password: z
    .string()
    .min(1, 'Senha é obrigatória')
    .min(6, 'Senha deve ter pelo menos 6 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres')
});

export const signupSchema = z.object({
  email: z
    .string()
    .min(1, 'Email é obrigatório')
    .email('Email deve ter um formato válido')
    .max(255, 'Email deve ter no máximo 255 caracteres'),
  password: z
    .string()
    .min(6, 'Senha deve ter pelo menos 6 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Senha deve conter pelo menos uma letra minúscula, uma maiúscula e um número'),
  confirmPassword: z
    .string()
    .min(1, 'Confirmação de senha é obrigatória'),
  restaurantName: z
    .string()
    .min(1, 'Nome do restaurante é obrigatório')
    .max(100, 'Nome do restaurante deve ter no máximo 100 caracteres')

    .regex(/^[a-zA-ZÀ-ÿ0-9\s\-.]+$/, 'Nome do restaurante contém caracteres inválidos'),

  ownerPhone: z
    .string()
    .min(1, 'Telefone do proprietário é obrigatório')
    .refine((value) => {
      const digits = ownerPhoneDigits(value);
      const localDigits = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
        ? digits.slice(2)
        : digits;
      return localDigits.length === 10 || localDigits.length === 11;
    }, 'Informe um telefone com DDD válido'),

  name: z
    .string()
    .min(1, 'Seu nome é obrigatório')
    .max(100, 'Nome deve ter no máximo 100 caracteres')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Nome deve conter apenas letras e espaços')
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

export type LoginData = z.infer<typeof loginSchema>;
export type SignupData = z.infer<typeof signupSchema>;
