
import React, { useState, useEffect, useRef } from 'react';
import forge from 'node-forge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, Receipt, Settings, FileText, Upload, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { IntegerInput } from '@/components/ui/integer-input';

interface FiscalConfig {
  id?: string;
  cnpj: string;
  inscricao_estadual: string;
  razao_social: string;
  nome_fantasia: string;
  endereco_logradouro: string;
  endereco_numero: string;
  endereco_complemento: string;
  endereco_bairro: string;
  endereco_municipio: string;
  endereco_uf: string;
  endereco_cep: string;
  codigo_municipio: string;
  nfce_serie: string;
  nfce_numero_atual: number;
  certificado_a1_base64: string;
  certificado_senha: string;
  ambiente: string;
  regime_tributario: number;
  csc_id: string;
  csc_token: string;
  ibpt_enabled: boolean;
  ibpt_token: string;
  ativo: boolean;
}

type ParsedCertificateInfo = {
  cnpj?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  serialNumber?: string;
  validFrom?: Date;
  validTo?: Date;
  issuer?: string;
  subject?: string;
};

type CnpjRegistrationData = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  codigo_municipio?: string;
  inscricao_estadual?: string;
  regime_tributario?: number;
  situacao_cadastral?: string;
  source?: 'cnpj_ws' | 'brasil_api';
};

type CertificateRegistrationStatus = 'idle' | 'loading' | 'complete' | 'unavailable';

type FiscalReadiness = {
  ready: boolean;
  pilot?: string;
  scope?: string;
  ambiente?: string;
  uf?: string;
  checklist?: {
    errors?: string[];
    warnings?: string[];
  };
  certificate?: {
    valid?: boolean;
    errors?: string[];
    cnpj?: string;
    valid_from?: string;
    valid_to?: string;
  } | null;
};

const onlyDigits = (value?: string) => String(value || '').replace(/\D/g, '');

const normalizeTextKey = (value?: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

const resolveKnownMunicipalityCode = (settings: Pick<FiscalConfig, 'endereco_uf' | 'endereco_municipio' | 'codigo_municipio'>) => {
  const raw = onlyDigits(settings.codigo_municipio);
  if (raw.length === 7) return raw;
  const uf = String(settings.endereco_uf || '').toUpperCase();
  const city = normalizeTextKey(settings.endereco_municipio);
  if (uf === 'CE' && city === 'FORTALEZA') return '2304400';
  return raw;
};

const validateLocalFiscalSettings = (settings: FiscalConfig): string[] => {
  const errors: string[] = [];
  const uf = String(settings.endereco_uf || '').toUpperCase();
  const codigoMunicipio = resolveKnownMunicipalityCode(settings);

  if (!settings.cnpj || !settings.razao_social || !settings.endereco_logradouro) {
    errors.push('Preencha CNPJ, razao social e logradouro.');
  }

  if (uf === 'CE') {
    if (codigoMunicipio.length !== 7 || !codigoMunicipio.startsWith('23')) {
      errors.push('Codigo do municipio do Ceara deve ser o codigo IBGE com 7 digitos. Fortaleza, por exemplo, e 2304400.');
    }
    if (!onlyDigits(settings.inscricao_estadual)) {
      errors.push('Inscricao Estadual e obrigatoria para NFC-e no Ceara.');
    }
  }

  return errors;
};

const formatCnpj = (value?: string) => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length !== 14) return digits;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
};

const formatCertificateDate = (value?: Date) => {
  if (!value) return '';
  return value.toLocaleDateString('pt-BR');
};

const attributesToText = (attributes: any[] = []) =>
  attributes.map((attr: any) => `${attr.shortName || attr.name}=${attr.value}`).join(', ');

const getAttributeValue = (certificate: forge.pki.Certificate, names: string[]) => {
  for (const attr of certificate.subject.attributes as any[]) {
    const key = String(attr.shortName || attr.name || '').toLowerCase();
    if (names.some((name) => key === name.toLowerCase())) {
      return String(attr.value || '').trim();
    }
  }
  return '';
};

const extractCnpjFromText = (value?: string): string => {
  const match = String(value || '').match(/(?:CNPJ[:=\s]*)?(\d{14})\b/);
  return match?.[1] || '';
};

const extractCnpjFromSubject = (certificate: forge.pki.Certificate): string => {
  const commonName = getAttributeValue(certificate, ['CN', 'commonName']);
  const commonNameCnpj = extractCnpjFromText(commonName);
  if (commonNameCnpj) return commonNameCnpj;

  const subjectValues = (certificate.subject.attributes as any[]).map((attr) => String(attr.value || ''));
  const subjectText = subjectValues.join(' ');
  return extractCnpjFromText(subjectText);
};

const isCertificateAuthority = (certificate: forge.pki.Certificate): boolean => {
  return (certificate.extensions || []).some((extension: any) =>
    String(extension.name || '').toLowerCase() === 'basicconstraints' && extension.cA === true
  );
};

const looksLikeIssuerName = (value?: string) => {
  return /\b(autoridade|certificadora|certificacao digital|certificação digital|ac\s|icp-brasil|serasa|certisign|valid|soluti|safeweb|caixa|receita federal)\b/i.test(String(value || ''));
};

const getBagLocalKeyId = (bag: any): string => {
  const raw = Array.isArray(bag?.attributes?.localKeyId)
    ? bag.attributes.localKeyId[0]
    : bag?.attributes?.localKeyId;
  if (!raw) return '';
  return forge.util.bytesToHex(String(raw));
};

const publicKeyMatchesPrivateKey = (certificate: forge.pki.Certificate, privateKey: forge.pki.PrivateKey) => {
  const certPublicKey = certificate.publicKey as any;
  const key = privateKey as any;
  return Boolean(certPublicKey?.n && certPublicKey?.e && key?.n && key?.e && certPublicKey.n.equals(key.n) && certPublicKey.e.equals(key.e));
};

const extractCnpjFromCertificate = (certificate: forge.pki.Certificate): string => {
  const subjectCnpj = extractCnpjFromSubject(certificate);
  if (subjectCnpj) return subjectCnpj;

  for (const extension of certificate.extensions || []) {
    const value = String((extension as any).value || '');
    const match = value.match(/(\d{14})/);
    if (match) return match[1];
  }

  return '';
};

const cleanCompanyNameFromCertificate = (value?: string, cnpj?: string) => {
  const cnpjDigits = onlyDigits(cnpj);
  let cleanValue = String(value || '');
  if (cnpjDigits) {
    cleanValue = cleanValue.replace(new RegExp(`[:\\s-]*${cnpjDigits}\\b`), '');
  }
  return cleanValue
    .replace(/[:\s-]*\d{14}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseCertificateBase64 = (base64Data: string, password: string): ParsedCertificateInfo => {
  const p12Data = forge.util.decode64(base64Data);
  const p12Asn1 = forge.asn1.fromDer(p12Data);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const privateKeyBag = keyBags.find((bag: any) => bag?.key);
  const privateKey = privateKeyBag?.key as forge.pki.PrivateKey | undefined;
  const privateKeyLocalId = getBagLocalKeyId(privateKeyBag);
  const certificateEntries = (certBags[forge.pki.oids.certBag] || [])
    .map((bag: any) => ({ certificate: bag?.cert as forge.pki.Certificate | undefined, localKeyId: getBagLocalKeyId(bag) }))
    .filter((entry) => entry.certificate);
  const certificates = certificateEntries
    .map((entry) => entry.certificate)
    .filter(Boolean) as forge.pki.Certificate[];
  const linkedCertificate = certificateEntries.find((entry) =>
    privateKey && (
      (privateKeyLocalId && entry.localKeyId === privateKeyLocalId) ||
      publicKeyMatchesPrivateKey(entry.certificate!, privateKey)
    )
  )?.certificate;
  const rankedCertificates = certificates
    .map((certificate) => {
      const commonName = getAttributeValue(certificate, ['CN', 'commonName']);
      const subjectCnpj = extractCnpjFromSubject(certificate);
      const anyCnpj = extractCnpjFromCertificate(certificate);
      let score = 0;
      if (subjectCnpj) score += 100;
      if (anyCnpj) score += 30;
      if (!isCertificateAuthority(certificate)) score += 40;
      if (!looksLikeIssuerName(commonName)) score += 10;
      return { certificate, cnpj: subjectCnpj || anyCnpj, score };
    })
    .sort((a, b) => b.score - a.score);
  const linkedCnpj = linkedCertificate ? extractCnpjFromSubject(linkedCertificate) || extractCnpjFromCertificate(linkedCertificate) : '';
  const selected = linkedCertificate && linkedCnpj
    ? { certificate: linkedCertificate, cnpj: linkedCnpj, score: Number.MAX_SAFE_INTEGER }
    : rankedCertificates.find((item) => item.cnpj && !isCertificateAuthority(item.certificate)) ||
    rankedCertificates.find((item) => item.cnpj) ||
    rankedCertificates[0];
  const certificate = selected?.certificate;

  if (!certificate) {
    throw new Error('Certificado nao encontrado no arquivo A1.');
  }

  const cnpj = selected?.cnpj || extractCnpjFromCertificate(certificate);
  if (!cnpj) {
    throw new Error('Nao encontrei CNPJ de titular no certificado. Confira se o arquivo A1 pertence a empresa cliente.');
  }

  const commonName = getAttributeValue(certificate, ['CN', 'commonName']);
  const organization = getAttributeValue(certificate, ['O', 'organizationName']);
  const organizationalUnit = getAttributeValue(certificate, ['OU', 'organizationalUnitName']);
  const commonNameCnpj = extractCnpjFromText(commonName);
  const titularName = cleanCompanyNameFromCertificate(commonName, commonNameCnpj || cnpj);
  const razaoSocial = cleanCompanyNameFromCertificate(
    titularName && !looksLikeIssuerName(titularName) ? titularName : organization,
    cnpj
  );

  return {
    cnpj,
    razaoSocial,
    nomeFantasia: cleanCompanyNameFromCertificate(
      !looksLikeIssuerName(organization) ? organization : organizationalUnit,
      cnpj
    ),
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
    subject: attributesToText(certificate.subject.attributes as any[]),
    issuer: attributesToText(certificate.issuer.attributes as any[]),
  };
};

type NfceCupomSummary = {
  id: string;
  numero: number;
  serie: string;
  status: string;
  valor_total: number;
  data_hora_emissao: string;
  protocolo_autorizacao: string | null;
  motivo_rejeicao: string | null;
};

const fetchCnpjRegistrationData = async (cnpj: string): Promise<CnpjRegistrationData | null> => {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sessão expirada. Entre novamente para consultar o CNPJ.');

  const response = await fetch(`/api/fiscal/cnpj-lookup?cnpj=${digits}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.registration) {
    throw new Error(payload?.error || 'Não foi possível consultar os dados públicos do CNPJ.');
  }

  return payload.registration as CnpjRegistrationData;
};

const isRegistrationCompatibleWithCertificate = (
  registration: CnpjRegistrationData | null | undefined,
  info: ParsedCertificateInfo
) => {
  if (!registration) return false;
  if (registration.cnpj && onlyDigits(registration.cnpj) !== onlyDigits(info.cnpj)) return false;

  const registrationName = String(registration.razao_social || registration.nome_fantasia || '').trim();
  if (!registrationName) return true;
  if (looksLikeIssuerName(registrationName) && info.razaoSocial && !looksLikeIssuerName(info.razaoSocial)) {
    return false;
  }

  return true;
};

const mergeCertificateData = (
  current: FiscalConfig,
  info: ParsedCertificateInfo,
  registration?: CnpjRegistrationData | null
): FiscalConfig => {
  const safeRegistration = isRegistrationCompatibleWithCertificate(registration, info) ? registration : null;
  return {
    ...current,
    cnpj: info.cnpj ? formatCnpj(info.cnpj) : current.cnpj,
    inscricao_estadual: safeRegistration?.inscricao_estadual || current.inscricao_estadual,
    razao_social: safeRegistration?.razao_social || info.razaoSocial || current.razao_social,
    nome_fantasia: safeRegistration?.nome_fantasia || info.nomeFantasia || current.nome_fantasia || '',
    endereco_logradouro: safeRegistration?.logradouro || current.endereco_logradouro,
    endereco_numero: safeRegistration?.numero || current.endereco_numero,
    endereco_complemento: safeRegistration?.complemento || current.endereco_complemento,
    endereco_bairro: safeRegistration?.bairro || current.endereco_bairro,
    endereco_municipio: safeRegistration?.municipio || current.endereco_municipio,
    endereco_uf: safeRegistration?.uf || current.endereco_uf,
    endereco_cep: safeRegistration?.cep || current.endereco_cep,
    codigo_municipio: safeRegistration?.codigo_municipio
      ? onlyDigits(String(safeRegistration.codigo_municipio))
      : current.codigo_municipio,
    regime_tributario: safeRegistration?.regime_tributario || current.regime_tributario,
  };
};

const FiscalSettings: React.FC<{ modelSettingsVisible?: boolean; recentDocumentsVisible?: boolean }> = ({
  modelSettingsVisible = true,
  recentDocumentsVisible = true,
}) => {
  const [settings, setSettings] = useState<FiscalConfig>({
    cnpj: '',
    inscricao_estadual: '',
    razao_social: '',
    nome_fantasia: '',
    endereco_logradouro: '',
    endereco_numero: '',
    endereco_complemento: '',
    endereco_bairro: '',
    endereco_municipio: '',
    endereco_uf: '',
    endereco_cep: '',
    codigo_municipio: '',
    nfce_serie: '1',
    nfce_numero_atual: 1,
    certificado_a1_base64: '',
    certificado_senha: '',
    ambiente: 'homologacao',
    regime_tributario: 1,
    csc_id: '',
    csc_token: '',
    ibpt_enabled: false,
    ibpt_token: '',
    ativo: false
  });
  const [loading, setLoading] = useState(false);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateInfo, setCertificateInfo] = useState<ParsedCertificateInfo | null>(null);
  const [certificateAutofillLoading, setCertificateAutofillLoading] = useState(false);
  const [certificateError, setCertificateError] = useState('');
  const [certificateRegistrationStatus, setCertificateRegistrationStatus] = useState<CertificateRegistrationStatus>('idle');
  const [certificateRegistrationSource, setCertificateRegistrationSource] = useState<CnpjRegistrationData['source']>();
  const certificateAutofillRequestRef = useRef(0);
  const [nfceNumeroRaw, setNfceNumeroRaw] = useState('1');
  const [readiness, setReadiness] = useState<FiscalReadiness | null>(null);
  const [nfceCupons, setNfceCupons] = useState<NfceCupomSummary[]>([]);
  const [loadingCupons, setLoadingCupons] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadFiscalSettings();
      loadNfceCupons();
    }
  }, [user]);

  const loadFiscalSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('fiscal_settings')
        .select('*')
        .eq('user_id', user?.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      if (data) {
        setSettings({
          id: data.id,
          cnpj: data.cnpj || '',
          inscricao_estadual: data.inscricao_estadual || '',
          razao_social: data.razao_social || '',
          nome_fantasia: data.nome_fantasia || '',
          endereco_logradouro: data.endereco_logradouro || '',
          endereco_numero: data.endereco_numero || '',
          endereco_complemento: data.endereco_complemento || '',
          endereco_bairro: data.endereco_bairro || '',
          endereco_municipio: data.endereco_municipio || '',
          endereco_uf: data.endereco_uf || '',
          endereco_cep: data.endereco_cep || '',
          codigo_municipio: resolveKnownMunicipalityCode({
            endereco_uf: data.endereco_uf || '',
            endereco_municipio: data.endereco_municipio || '',
            codigo_municipio: data.codigo_municipio || '',
          } as FiscalConfig),
          nfce_serie: data.nfce_serie || '1',
          nfce_numero_atual: data.nfce_numero_atual || 1,
          certificado_a1_base64: data.certificado_a1_base64 || '',
          certificado_senha: data.certificado_senha || '',
          ambiente: data.ambiente || 'homologacao',
          regime_tributario: data.regime_tributario || 1,
          csc_id: data.csc_id || '',
          csc_token: data.csc_token || '',
          ibpt_enabled: Boolean((data as any).ibpt_enabled),
          ibpt_token: (data as any).ibpt_token || '',
          ativo: data.ativo || false
        });
        setNfceNumeroRaw(String(data.nfce_numero_atual || 1));
      }
    } catch (error: any) {
      console.error('Erro ao carregar configurações:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar configurações fiscais.",
        variant: "destructive"
      });
    }
  };

  const loadNfceCupons = async () => {
    if (!user?.id) return;

    try {
      setLoadingCupons(true);
      const { data, error } = await supabase
        .from('nfce_cupons')
        .select('id, numero, serie, status, valor_total, data_hora_emissao, protocolo_autorizacao, motivo_rejeicao')
        .eq('user_id', user.id)
        .order('data_hora_emissao', { ascending: false })
        .limit(10);

      if (error) throw error;
      setNfceCupons((data || []) as NfceCupomSummary[]);
    } catch (error) {
      console.error('Erro ao carregar últimas NFC-e:', error);
      setNfceCupons([]);
    } finally {
      setLoadingCupons(false);
    }
  };

  const handleCertificateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerFileName = file.name.toLowerCase();
    if (!lowerFileName.endsWith('.pfx') && !lowerFileName.endsWith('.p12')) {
      toast({
        title: "Erro",
        description: "Apenas arquivos .pfx ou .p12 são aceitos para certificados A1.",
        variant: "destructive"
      });
      return;
    }

    setCertificateFile(file);
    setCertificateError('');
    
    // Convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64String = e.target?.result as string;
      const base64Content = base64String?.split(',')[1]; // Remove data:application/... prefix
      if (!base64Content) {
        setCertificateError('Não foi possível carregar o conteúdo do certificado. Selecione o arquivo novamente.');
        return;
      }
      setCertificateInfo(null);
      setCertificateRegistrationStatus('idle');
      setCertificateRegistrationSource(undefined);
      setSettings(prev => ({ ...prev, certificado_a1_base64: base64Content }));
      if (settings.certificado_senha) {
        void tryApplyCertificateAutofill(base64Content, settings.certificado_senha);
      } else {
        toast({
          title: "Certificado carregado",
          description: "Informe a senha do certificado para preencher os dados automaticamente.",
        });
      }
    };
    reader.onerror = () => {
      setCertificateInfo(null);
      setCertificateError('Não foi possível ler o arquivo selecionado. Selecione o certificado novamente.');
    };
    reader.readAsDataURL(file);
  };

  const applyCertificateInfo = (info: ParsedCertificateInfo, registration?: CnpjRegistrationData | null) => {
    setCertificateInfo(info);
    setSettings(prev => mergeCertificateData(prev, info, registration));
  };

  const tryApplyCertificateAutofill = async (
    base64Content: string,
    password: string,
    options: { silent?: boolean } = {}
  ) => {
    if (!base64Content || !password) return false;

    const requestId = ++certificateAutofillRequestRef.current;
    try {
      setCertificateAutofillLoading(true);
      setCertificateError('');
      setCertificateRegistrationStatus('loading');
      const info = parseCertificateBase64(base64Content, password);
      let registration: CnpjRegistrationData | null = null;
      try {
        registration = info.cnpj ? await fetchCnpjRegistrationData(info.cnpj) : null;
      } catch (registrationError) {
        console.warn('Nao foi possivel consultar dados publicos do CNPJ', registrationError);
      }
      if (requestId !== certificateAutofillRequestRef.current) return null;
      applyCertificateInfo(info, registration);
      setCertificateRegistrationStatus(registration ? 'complete' : 'unavailable');
      setCertificateRegistrationSource(registration?.source);
      if (!options.silent) {
        toast({
          title: "Dados preenchidos pelo certificado",
          description: registration
            ? `${registration.razao_social || 'Empresa identificada'} - cadastro empresarial preenchido para revisão.`
            : `${formatCnpj(info.cnpj)} identificado. Revise os campos que não puderam ser consultados.`,
        });
      }
      return { info, registration };
    } catch (error: any) {
      if (requestId !== certificateAutofillRequestRef.current) return null;
      setCertificateInfo(null);
      setCertificateRegistrationStatus('idle');
      setCertificateRegistrationSource(undefined);
      const rawMessage = String(error?.message || '');
      const friendlyMessage = /password|senha|mac could not be verified|invalid/i.test(rawMessage)
        ? 'Senha incorreta ou certificado incompatível. Confira a senha e tente novamente.'
        : (rawMessage || 'Confira o arquivo e a senha do certificado A1.');
      setCertificateError(friendlyMessage);
      if (!options.silent) {
        toast({
          title: "Não foi possível ler o certificado",
          description: friendlyMessage,
          variant: "destructive"
        });
      }
      return null;
    } finally {
      if (requestId === certificateAutofillRequestRef.current) setCertificateAutofillLoading(false);
    }
  };

  const saveSettings = async (): Promise<boolean> => {
    try {
      setLoading(true);
      let settingsToSave = settings;

      if (settings.certificado_a1_base64 && !settings.certificado_senha) {
        toast({
          title: "Informe a senha do certificado",
          description: "A senha é necessária para validar e salvar o certificado A1.",
          variant: "destructive"
        });
        return false;
      }

      if (settings.certificado_a1_base64 && settings.certificado_senha && !certificateInfo) {
        const certificateResult = await tryApplyCertificateAutofill(
          settings.certificado_a1_base64,
          settings.certificado_senha
        );
        if (!certificateResult) return false;
        settingsToSave = mergeCertificateData(settings, certificateResult.info, certificateResult.registration);
      }

      if (settingsToSave.ibpt_enabled && !settingsToSave.ibpt_token.trim()) {
        toast({
          title: "Informe o token do IBPT",
          description: "O token individual do CNPJ e necessario para consultar e exibir os tributos aproximados.",
          variant: "destructive"
        });
        return false;
      }

      const validationErrors = validateLocalFiscalSettings(settingsToSave);
      if (validationErrors.length) {
        toast({
          title: "Revise o cadastro fiscal",
          description: validationErrors[0],
          variant: "destructive"
        });
        return false;
      }

      const settingsData = {
        ...settingsToSave,
        codigo_municipio: resolveKnownMunicipalityCode(settingsToSave),
        cnpj: formatCnpj(settingsToSave.cnpj),
        inscricao_estadual: onlyDigits(settingsToSave.inscricao_estadual),
        endereco_cep: onlyDigits(settingsToSave.endereco_cep),
        user_id: user?.id,
        updated_at: new Date().toISOString()
      };

      let result;
      if (settings.id) {
        // Update existing
        const { id, ...updateData } = settingsData;
        result = await supabase
          .from('fiscal_settings')
          .update(updateData)
          .eq('id', settings.id);
      } else {
        // Insert new
        result = await supabase
          .from('fiscal_settings')
          .insert([settingsData]);
      }

      if (result.error) throw result.error;

      toast({
        title: "Sucesso",
        description: "Configurações fiscais salvas com sucesso!",
      });

      // Reload settings to get the ID if it was a new insert
      if (!settings.id) {
        await loadFiscalSettings();
      }
      return true;
    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      toast({
        title: "Erro",
        description: error?.message || "Erro ao salvar configurações fiscais.",
        variant: "destructive"
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const validateFiscalReadiness = async () => {
    try {
      setLoading(true);

      const validationErrors = validateLocalFiscalSettings(settings);
      if (validationErrors.length) {
        toast({
          title: "Revise o cadastro fiscal",
          description: validationErrors[0],
          variant: "destructive"
        });
        return;
      }

      if (!settings.id) {
        const saved = await saveSettings();
        if (!saved) return;
      }

      const { data, error } = await supabase.functions.invoke('nfce-operations', {
        body: { operation: 'validar_config', _storeId: user?.id }
      });

      if (error) throw error;
      setReadiness(data as FiscalReadiness);

      toast({
        title: data?.ready ? `Fiscal ${settings.endereco_uf} pronto para teste` : 'Ainda falta ajustar o fiscal',
        description: data?.ready
          ? 'A configuração passou na validação técnica inicial para homologação.'
          : (data?.checklist?.errors?.[0] || 'Veja os pontos pendentes no checklist.'),
        variant: data?.ready ? 'default' : 'destructive'
      });
    } catch (error: any) {
      setReadiness(null);
      toast({
        title: "Erro na validação fiscal",
        description: error.message || "Não foi possível validar as configurações fiscais.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      setLoading(true);

      const validationErrors = validateLocalFiscalSettings(settings);
      if (validationErrors.length) {
        toast({
          title: "Revise o cadastro fiscal",
          description: validationErrors[0],
          variant: "destructive"
        });
        return;
      }
      
      if (!settings.id) {
        const saved = await saveSettings();
        if (!saved) return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error('Login nao confirmado. Saia e entre novamente antes de testar a Sefaz.');
      }

      const response = await fetch('/api/nfce/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.motivo || data?.message || 'Nao foi possivel testar a conexao com a Sefaz.');
      }
      if (!data?.success) {
        throw new Error(data?.motivo || 'A Sefaz retornou falha no status do servico.');
      }
      
      toast({
        title: "Conexão testada",
        description: `Sefaz ${data.uf}/${data.ambiente}: ${data.cStat} - ${data.motivo}`,
      });
    } catch (error: any) {
      toast({
        title: "Erro na conexão",
        description: error.message || "Erro ao testar conexão com a Sefaz.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const renderCertificateImportSection = () => (
    <div className="space-y-4 rounded-2xl border border-[#FF6400]/15 bg-[#FFF8F2] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Importar certificado digital A1</h3>
          <p className="mt-1 text-sm text-slate-600">
            Envie o .pfx/.p12 e informe a senha. O sistema usa o certificado do titular para preencher os dados da empresa cliente.
          </p>
        </div>
        <Upload className="mt-1 h-5 w-5 shrink-0 text-[#FF6400]" />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr,280px]">
        <div className="space-y-2">
          <Label>Arquivo do Certificado (.pfx/.p12)</Label>
          <Input
            type="file"
            accept=".pfx,.p12"
            onChange={handleCertificateUpload}
            className="bg-white"
          />
          {certificateFile && (
            <p className="text-sm text-green-700">Certificado carregado: {certificateFile.name}</p>
          )}
          {certificateAutofillLoading && (
            <p className="text-sm text-blue-700">Lendo certificado e preenchendo dados fiscais...</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Senha do Certificado</Label>
          <Input
            type="password"
            value={settings.certificado_senha}
            onChange={(e) => {
              const password = e.target.value;
              certificateAutofillRequestRef.current += 1;
              setCertificateInfo(null);
              setCertificateRegistrationStatus('idle');
              setCertificateRegistrationSource(undefined);
              setCertificateError('');
              setSettings(prev => ({ ...prev, certificado_senha: password }));
            }}
            onBlur={() => {
              if (settings.certificado_a1_base64 && settings.certificado_senha && !certificateInfo) {
                void tryApplyCertificateAutofill(settings.certificado_a1_base64, settings.certificado_senha);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && settings.certificado_a1_base64 && settings.certificado_senha) {
                e.preventDefault();
                void tryApplyCertificateAutofill(settings.certificado_a1_base64, settings.certificado_senha);
              }
            }}
            placeholder="senha123"
            className="bg-white"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          disabled={!settings.certificado_a1_base64 || !settings.certificado_senha || certificateAutofillLoading}
          onClick={() => void tryApplyCertificateAutofill(settings.certificado_a1_base64, settings.certificado_senha)}
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          {certificateAutofillLoading ? 'Validando certificado...' : 'Validar e preencher dados'}
        </Button>
        {!settings.certificado_a1_base64 && (
          <p className="text-sm text-slate-600">Selecione primeiro o arquivo do certificado A1.</p>
        )}
      </div>

      {certificateError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <div className="font-semibold">Certificado não validado</div>
          <div className="mt-1">{certificateError}</div>
        </div>
      )}

      {certificateInfo && (
        <div className={`rounded-2xl border p-4 text-sm ${certificateRegistrationStatus === 'complete'
          ? 'border-green-200 bg-green-50 text-green-900'
          : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}>
          <div className="flex items-start gap-3">
            <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${certificateRegistrationStatus === 'complete' ? 'text-green-700' : 'text-amber-700'}`} />
            <div className="space-y-1">
              <div className="font-semibold">
                {certificateRegistrationStatus === 'complete'
                  ? 'Certificado lido e cadastro empresarial preenchido'
                  : 'Certificado lido; revise os dados cadastrais'}
              </div>
              <div>CNPJ: {formatCnpj(certificateInfo.cnpj) || 'não identificado'}</div>
              {certificateInfo.razaoSocial && <div>Razão social do titular: {certificateInfo.razaoSocial}</div>}
              <div>Validade: {formatCertificateDate(certificateInfo.validFrom)} até {formatCertificateDate(certificateInfo.validTo)}</div>
              {certificateRegistrationStatus === 'complete' && (
                <div>Dados consultados automaticamente pelo CNPJ{certificateRegistrationSource ? ` (${certificateRegistrationSource === 'cnpj_ws' ? 'CNPJ.ws' : 'BrasilAPI'})` : ''}.</div>
              )}
              {certificateRegistrationStatus === 'unavailable' && (
                <div>A consulta cadastral não respondeu. O CNPJ e os dados presentes no certificado foram aplicados; complete os demais campos manualmente.</div>
              )}
              {certificateInfo.issuer && <div className="opacity-80">Autoridade emissora: {certificateInfo.issuer}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderCeReadinessSection = () => {
    const errors = readiness?.checklist?.errors || [];
    const warnings = readiness?.checklist?.warnings || [];

    return (
      <div className={`rounded-2xl border p-4 ${readiness?.ready ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-3">
            {readiness?.ready ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            )}
            <div>
              <h3 className="text-lg font-medium">Diagnóstico do modelo NFC-e (65)</h3>
              <p className="mt-1 text-sm text-slate-700">
                Valida cadastro, certificado A1, endpoints e requisitos técnicos da UF selecionada antes do teste na SEFAZ.
              </p>
            </div>
          </div>
          <Button onClick={validateFiscalReadiness} disabled={loading} variant="outline">
            Validar fiscal {settings.endereco_uf || 'UF'}
          </Button>
        </div>

        {readiness && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-xl bg-white/80 p-3">
              <div className="font-semibold text-slate-900">
                Status: {readiness.ready ? 'Pronto para teste em homologação' : 'Ajustes pendentes'}
              </div>
              <div className="text-slate-600">
                UF: {readiness.uf || '--'} | Ambiente: {readiness.ambiente || '--'} | Escopo: {readiness.scope || 'NFC-e 65'}
              </div>
            </div>

            {errors.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
                <div className="font-semibold">Corrigir antes de emitir</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errors.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div className="font-semibold">Atenção</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {warnings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </div>
            )}

            {readiness.certificate && (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-3 text-slate-700">
                Certificado: {readiness.certificate.valid ? 'válido' : 'com erro'}
                {readiness.certificate.cnpj ? ` | CNPJ ${formatCnpj(readiness.certificate.cnpj)}` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Configuração do Emissor Fiscal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {modelSettingsVisible && <div className="flex items-center space-x-2">
            <Switch
              id="fiscal-enabled"
              checked={settings.ativo}
              onCheckedChange={(checked) => setSettings(prev => ({ ...prev, ativo: checked }))}
            />
            <Label htmlFor="fiscal-enabled">Ativar emissão automática de NFC-e (modelo 65)</Label>
          </div>}

          {(modelSettingsVisible ? settings.ativo : true) && (
            <>
              {renderCertificateImportSection()}
              {modelSettingsVisible && renderCeReadinessSection()}

              {/* Dados da Empresa */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Dados da Empresa</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>CNPJ *</Label>
                    <Input
                      value={settings.cnpj}
                      onChange={(e) => setSettings(prev => ({ ...prev, cnpj: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Inscrição Estadual</Label>
                    <Input
                      value={settings.inscricao_estadual}
                      onChange={(e) => setSettings(prev => ({ ...prev, inscricao_estadual: e.target.value }))}
                      placeholder="000.000.000.000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Razão Social *</Label>
                    <Input
                      value={settings.razao_social}
                      onChange={(e) => setSettings(prev => ({ ...prev, razao_social: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Nome Fantasia</Label>
                    <Input
                      value={settings.nome_fantasia}
                      onChange={(e) => setSettings(prev => ({ ...prev, nome_fantasia: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Endereço</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Logradouro *</Label>
                    <Input
                      value={settings.endereco_logradouro}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_logradouro: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Número *</Label>
                    <Input
                      value={settings.endereco_numero}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_numero: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Complemento</Label>
                    <Input
                      value={settings.endereco_complemento}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_complemento: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Bairro *</Label>
                    <Input
                      value={settings.endereco_bairro}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_bairro: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>CEP *</Label>
                    <Input
                      value={settings.endereco_cep}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_cep: e.target.value }))}
                      placeholder="00000-000"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Município *</Label>
                    <Input
                      value={settings.endereco_municipio}
                      onChange={(e) => setSettings(prev => ({ ...prev, endereco_municipio: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>UF *</Label>
                    <Select 
                      value={settings.endereco_uf} 
                      onValueChange={(value) => setSettings(prev => ({ ...prev, endereco_uf: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AC">AC</SelectItem>
                        <SelectItem value="AL">AL</SelectItem>
                        <SelectItem value="AP">AP</SelectItem>
                        <SelectItem value="AM">AM</SelectItem>
                        <SelectItem value="BA">BA</SelectItem>
                        <SelectItem value="CE">CE</SelectItem>
                        <SelectItem value="DF">DF</SelectItem>
                        <SelectItem value="ES">ES</SelectItem>
                        <SelectItem value="GO">GO</SelectItem>
                        <SelectItem value="MA">MA</SelectItem>
                        <SelectItem value="MT">MT</SelectItem>
                        <SelectItem value="MS">MS</SelectItem>
                        <SelectItem value="MG">MG</SelectItem>
                        <SelectItem value="PA">PA</SelectItem>
                        <SelectItem value="PB">PB</SelectItem>
                        <SelectItem value="PR">PR</SelectItem>
                        <SelectItem value="PE">PE</SelectItem>
                        <SelectItem value="PI">PI</SelectItem>
                        <SelectItem value="RJ">RJ</SelectItem>
                        <SelectItem value="RN">RN</SelectItem>
                        <SelectItem value="RS">RS</SelectItem>
                        <SelectItem value="RO">RO</SelectItem>
                        <SelectItem value="RR">RR</SelectItem>
                        <SelectItem value="SC">SC</SelectItem>
                        <SelectItem value="SP">SP</SelectItem>
                        <SelectItem value="SE">SE</SelectItem>
                        <SelectItem value="TO">TO</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Código do Município *</Label>
                    <Input
                      value={settings.codigo_municipio}
                      onChange={(e) => setSettings(prev => ({ ...prev, codigo_municipio: onlyDigits(e.target.value).slice(0, 7) }))}
                      placeholder="2304400"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Regime tributário</Label>
                <Select value={settings.regime_tributario.toString()} onValueChange={(value) => setSettings(prev => ({ ...prev, regime_tributario: parseInt(value) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Simples Nacional</SelectItem>
                    <SelectItem value="3" disabled>Regime Normal (aguardando homologação)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Configurações NFC-e */}
              {modelSettingsVisible && <div className="space-y-4">
                <h3 className="text-lg font-medium">Configurações NFC-e</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Série NFC-e *</Label>
                    <Input
                      value={settings.nfce_serie}
                      onChange={(e) => setSettings(prev => ({ ...prev, nfce_serie: e.target.value }))}
                      placeholder="1"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Próximo Número</Label>
                    <IntegerInput
                      min={1}
                      value={nfceNumeroRaw}
                      fallback={settings.nfce_numero_atual || 1}
                      onValueChange={(value) => {
                        setNfceNumeroRaw(value);
                        if (value !== '') {
                          setSettings(prev => ({ ...prev, nfce_numero_atual: parseInt(value, 10) || 1 }));
                        }
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Regime Tributário</Label>
                    <Select 
                      value={settings.regime_tributario.toString()} 
                      onValueChange={(value) => setSettings(prev => ({ ...prev, regime_tributario: parseInt(value) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Simples Nacional</SelectItem>
                        <SelectItem value="3" disabled>Regime Normal (aguardando homologação)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Ambiente</Label>
                  <Select 
                    value={settings.ambiente} 
                    onValueChange={(value) => setSettings(prev => ({ ...prev, ambiente: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="homologacao">Homologação</SelectItem>
                      <SelectItem value="producao">Produção</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>}

              {/* CSC legado - opcional no QR Code v3 online */}
              {modelSettingsVisible && <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium">CSC legado (opcional)</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    O QR Code v3 online dispensa CSC. Preencha apenas para compatibilidade solicitada pela SEFAZ ou pelo especialista fiscal.
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>CSC ID</Label>
                    <Input
                      value={settings.csc_id}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(e) => setSettings(prev => ({ ...prev, csc_id: onlyDigits(e.target.value).slice(0, 6) }))}
                      placeholder="Ex.: 1"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use apenas o identificador numerico do CSC.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>CSC Token</Label>
                    <Input
                      type="password"
                      value={settings.csc_token}
                      onChange={(e) => setSettings(prev => ({ ...prev, csc_token: e.target.value }))}
                      placeholder="Token fornecido pela Sefaz"
                    />
                  </div>
                </div>
              </div>}

              <div className="space-y-4 rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-base">Tributos aproximados — IBPT</Label>
                    <p className="text-sm text-muted-foreground">
                      Consulta a API oficial De Olho no Imposto e inclui vTotTrib, fonte e versão no documento.
                    </p>
                  </div>
                  <Switch
                    checked={settings.ibpt_enabled}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, ibpt_enabled: checked }))}
                  />
                </div>
                {settings.ibpt_enabled && (
                  <div className="space-y-2">
                    <Label>Token IBPT da empresa</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={settings.ibpt_token}
                      onChange={(event) => setSettings(prev => ({ ...prev, ibpt_token: event.target.value.trim() }))}
                      placeholder="Token obtido no portal De Olho no Imposto"
                    />
                    <p className="text-xs text-muted-foreground">
                      O token é individual por CNPJ e precisa estar vigente para a consulta da tabela IBPT.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {modelSettingsVisible && <Button onClick={testConnection} disabled={loading} variant="outline">
                  <Settings className="w-4 h-4 mr-2" />
                  Testar Conexão
                </Button>}
                <Button onClick={saveSettings} disabled={loading}>
                  {loading ? 'Salvando...' : 'Salvar Configurações'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {recentDocumentsVisible && settings.ativo && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Últimas NFC-e Emitidas
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={loadNfceCupons} disabled={loadingCupons}>
                {loadingCupons ? 'Atualizando...' : 'Atualizar'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingCupons ? (
              <div className="text-center py-8 text-gray-500">
                Carregando NFC-e...
              </div>
            ) : nfceCupons.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                Nenhuma NFC-e emitida ainda. Finalize uma venda no PDV e confirme a emissão fiscal.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {nfceCupons.map((cupom) => {
                  const statusClass =
                    cupom.status === 'autorizado'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : cupom.status === 'rejeitado'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : cupom.status === 'cancelado'
                          ? 'bg-slate-50 text-slate-700 border-slate-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200';

                  return (
                    <div key={cupom.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <div>
                        <div className="font-semibold text-primary">
                          NFC-e {cupom.numero} / Série {cupom.serie}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(cupom.data_hora_emissao).toLocaleString('pt-BR')}
                        </div>
                        {cupom.protocolo_autorizacao && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Protocolo: {cupom.protocolo_autorizacao}
                          </div>
                        )}
                        {cupom.motivo_rejeicao && (
                          <div className="mt-1 text-xs text-red-600">
                            {cupom.motivo_rejeicao}
                          </div>
                        )}
                      </div>
                      <div className={`w-fit rounded-full border px-3 py-1 text-sm font-semibold capitalize ${statusClass}`}>
                        {cupom.status}
                      </div>
                      <div className="text-lg font-bold text-primary">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cupom.valor_total || 0))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FiscalSettings;
