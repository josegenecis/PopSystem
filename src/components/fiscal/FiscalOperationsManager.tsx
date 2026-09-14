import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type JsonObject = Record<string, unknown>;

type FiscalRule = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  model_codes: string[];
  issuer_crt: number[];
  operation_destination: number;
  origin_uf: string | null;
  destination_uf: string | null;
  recipient_ie_indicator: number | null;
  final_consumer: boolean | null;
  presence_indicator: number | null;
  product_origin: number | null;
  cfop: string;
  icms_code: string;
  icms_config: JsonObject;
  pis_cst: string | null;
  pis_config: JsonObject;
  cofins_cst: string | null;
  cofins_config: JsonObject;
  ipi_cst: string | null;
  ipi_config: JsonObject;
  ibs_cbs_cst: string | null;
  cclass_trib: string | null;
  ibs_cbs_config: JsonObject;
  is_cst: string | null;
  is_cclass_trib: string | null;
  is_config: JsonObject;
  benefit_code: string | null;
  legal_basis: string | null;
  accountant_approved_at: string | null;
  accountant_approved_by: string | null;
};

type RuleForm = {
  id: string;
  name: string;
  priority: string;
  models: "55" | "65" | "55,65";
  crt: "1" | "2" | "3";
  destination: "1" | "2" | "3";
  destinationUf: string;
  recipientIe: "1" | "2" | "9";
  finalConsumer: "true" | "false";
  presence: string;
  productOrigin: string;
  cfop: string;
  icmsCode: string;
  destinationIcmsRate: string;
  pisCst: string;
  cofinsCst: string;
  ipiCst: string;
  ibsCbsCst: string;
  cclassTrib: string;
  rtcMode: "none" | "standard" | "monophase" | "transfer_credit";
  ibsUf: RtcJurisdictionForm;
  ibsMun: RtcJurisdictionForm;
  cbs: RtcJurisdictionForm;
  monophase: Record<string, string>;
  transferIbs: string;
  transferCbs: string;
  isCst: string;
  isCclassTrib: string;
  benefitCode: string;
  legalBasis: string;
  icmsConfig: JsonObject;
  pisConfig: JsonObject;
  cofinsConfig: JsonObject;
  ipiConfig: JsonObject;
  ibsCbsConfig: JsonObject;
  isConfig: JsonObject;
};

type RtcJurisdictionForm = {
  rate: string;
  reduction: string;
  deferralPercent: string;
  returnedPercent: string;
};

type RtcClassification = {
  tax_kind: "IBS_CBS" | "IS";
  cst: string;
  cclass_trib: string;
  description: string;
};

type CfopOption = { code: string; description: string; operation_destination: number };

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const PRESENCE = [
  ["0", "0 — Não se aplica"], ["1", "1 — Operação presencial"],
  ["2", "2 — Não presencial, Internet"], ["3", "3 — Não presencial, teleatendimento"],
  ["4", "4 — NFC-e com entrega em domicílio"], ["5", "5 — Presencial fora do estabelecimento"],
  ["9", "9 — Não presencial, outros"],
];
const ORIGINS = [
  ["0", "0 — Nacional, exceto códigos 3, 4, 5 e 8"], ["1", "1 — Estrangeira, importação direta"],
  ["2", "2 — Estrangeira, adquirida no mercado interno"], ["3", "3 — Nacional, conteúdo de importação superior a 40% e até 70%"],
  ["4", "4 — Nacional, processo produtivo básico"], ["5", "5 — Nacional, conteúdo de importação até 40%"],
  ["6", "6 — Estrangeira, importação direta sem similar nacional"], ["7", "7 — Estrangeira, mercado interno sem similar nacional"],
  ["8", "8 — Nacional, conteúdo de importação superior a 70%"],
];
const CSOSN = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"];
const ICMS_CST = ["00", "10", "20", "30", "40", "41", "50", "51", "60", "70", "90"];
const CONTRIBUTION_CST = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "70", "71", "72", "73", "74", "75", "98", "99"];
const IPI_CST = ["00", "01", "02", "03", "04", "05", "49", "50", "51", "52", "53", "54", "55", "99"];
const MONOPHASE_FIELDS = [
  ["qBCMono", "Quantidade tributada"],
  ["adRemIBS", "Alíquota ad rem do IBS"],
  ["adRemCBS", "Alíquota ad rem da CBS"],
  ["qBCMonoReten", "Quantidade sujeita à retenção"],
  ["adRemIBSReten", "Alíquota ad rem do IBS retido"],
  ["adRemCBSReten", "Alíquota ad rem da CBS retida"],
  ["qBCMonoRet", "Quantidade retida anteriormente"],
  ["adRemIBSRet", "Alíquota ad rem do IBS retido anteriormente"],
  ["adRemCBSRet", "Alíquota ad rem da CBS retida anteriormente"],
  ["pDifIBS", "Diferimento do IBS (%)"],
  ["pDifCBS", "Diferimento da CBS (%)"],
] as const;

const emptyJurisdiction = (): RtcJurisdictionForm => ({
  rate: "",
  reduction: "0",
  deferralPercent: "0",
  returnedPercent: "0",
});

const emptyForm = (): RuleForm => ({
  id: "", name: "", priority: "100", models: "55,65", crt: "1", destination: "1",
  destinationUf: "", recipientIe: "9", finalConsumer: "true", presence: "1", productOrigin: "0",
  cfop: "", icmsCode: "102", destinationIcmsRate: "", pisCst: "07", cofinsCst: "07", ipiCst: "none",
  ibsCbsCst: "none", cclassTrib: "none", isCst: "none", isCclassTrib: "none", benefitCode: "",
  rtcMode: "none", ibsUf: emptyJurisdiction(), ibsMun: emptyJurisdiction(), cbs: emptyJurisdiction(),
  monophase: {}, transferIbs: "", transferCbs: "",
  legalBasis: "", icmsConfig: {}, pisConfig: {}, cofinsConfig: {}, ipiConfig: {},
  ibsCbsConfig: { mode: "none" }, isConfig: { enabled: false },
});

const asObject = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro inesperado";
const formNumber = (value: unknown, fallback = "") => value == null || value === "" ? fallback : String(value);
const decimalValue = (value: string) => Number(value.replace(",", "."));
const optionalDecimal = (value: string) => value.trim() === "" ? undefined : decimalValue(value);
const jurisdictionForm = (value: unknown, legacy: Partial<RtcJurisdictionForm> = {}): RtcJurisdictionForm => {
  const item = asObject(value);
  return {
    rate: formNumber(item.rate, legacy.rate || ""),
    reduction: formNumber(item.reduction, legacy.reduction || "0"),
    deferralPercent: formNumber(item.deferralPercent, legacy.deferralPercent || "0"),
    returnedPercent: formNumber(item.returnedPercent, legacy.returnedPercent || "0"),
  };
};
const compactJurisdiction = (value: RtcJurisdictionForm) => Object.fromEntries(
  Object.entries(value).flatMap(([key, raw]) => {
    const parsed = optionalDecimal(raw);
    return parsed == null ? [] : [[key, parsed]];
  }),
);

// O schema fiscal existe apenas na homologação enquanto esta entrega é validada;
// o tipo gerado do Supabase será atualizado quando a migração for promovida.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fiscalSupabase = supabase as any;

export default function FiscalOperationsManager() {
  const { activeStoreId, user } = useAuth();
  const { toast } = useToast();
  const storeId = activeStoreId || user?.id;
  const [rules, setRules] = useState<FiscalRule[]>([]);
  const [issuerUf, setIssuerUf] = useState("");
  const [cfops, setCfops] = useState<CfopOption[]>([]);
  const [rtc, setRtc] = useState<RtcClassification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [approvalRule, setApprovalRule] = useState<FiscalRule | null>(null);
  const [responsible, setResponsible] = useState("");
  const [form, setForm] = useState<RuleForm>(emptyForm);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [rulesResult, settingsResult, cfopResult, rtcResult] = await Promise.all([
        fiscalSupabase.from("fiscal_tax_rules").select("*").eq("user_id", storeId).order("priority").order("created_at", { ascending: false }),
        fiscalSupabase.from("fiscal_settings").select("endereco_uf").eq("user_id", storeId).maybeSingle(),
        fiscalSupabase.from("fiscal_cfop_catalog").select("code,description,operation_destination").eq("active", true).order("code"),
        fiscalSupabase.from("fiscal_rtc_classifications").select("tax_kind,cst,cclass_trib,description").eq("active", true).order("cst").order("cclass_trib"),
      ]);
      for (const result of [rulesResult, settingsResult, cfopResult, rtcResult]) if (result.error) throw result.error;
      setRules((rulesResult.data || []) as FiscalRule[]);
      setIssuerUf(String(settingsResult.data?.endereco_uf || "").toUpperCase());
      setCfops((cfopResult.data || []) as CfopOption[]);
      setRtc((rtcResult.data || []) as RtcClassification[]);
    } catch (error: unknown) {
      toast({ title: "Erro ao carregar operações fiscais", description: errorMessage(error), variant: "destructive" });
    } finally { setLoading(false); }
  }, [storeId, toast]);

  useEffect(() => { void load(); }, [load]);

  const availableCfops = useMemo(() => cfops.filter((item) => item.operation_destination === Number(form.destination)), [cfops, form.destination]);
  const icmsCodes = form.crt === "1" ? CSOSN : ICMS_CST;
  const ibsCsts = useMemo(() => [...new Set(rtc.filter((x) => x.tax_kind === "IBS_CBS").map((x) => x.cst))], [rtc]);
  const isCsts = useMemo(() => [...new Set(rtc.filter((x) => x.tax_kind === "IS").map((x) => x.cst))], [rtc]);
  const ibsClasses = useMemo(() => rtc.filter((x) => x.tax_kind === "IBS_CBS" && x.cst === form.ibsCbsCst), [rtc, form.ibsCbsCst]);
  const isClasses = useMemo(() => rtc.filter((x) => x.tax_kind === "IS" && x.cst === form.isCst), [rtc, form.isCst]);

  const setField = <K extends keyof RuleForm>(field: K, value: RuleForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const setJurisdictionField = (field: "ibsUf" | "ibsMun" | "cbs", key: keyof RtcJurisdictionForm, value: string) => {
    setForm((current) => ({ ...current, [field]: { ...current[field], [key]: value } }));
  };

  const openNew = () => { setForm(emptyForm()); setEditorOpen(true); };
  const openEdit = (rule: FiscalRule) => {
    const difal = asObject(asObject(rule.icms_config).difal);
    const ibsCbsConfig = asObject(rule.ibs_cbs_config);
    const monophase = asObject(ibsCbsConfig.monophase);
    const transferCredit = asObject(ibsCbsConfig.transferCredit);
    const configuredMode = String(ibsCbsConfig.mode || (rule.ibs_cbs_cst ? "standard" : "none"));
    const hasRtcClassification = /^\d{3}$/.test(rule.ibs_cbs_cst || "") && /^\d{6}$/.test(rule.cclass_trib || "");
    // Algumas regras antigas conservaram CST/cClassTrib, mas gravaram o JSON
    // padrão como `mode: none`. Nesse estado o formulário escondia os campos e
    // o XML também descartava o grupo. A classificação preenchida é a fonte
    // inequívoca de que a RTC deve continuar editável.
    const rtcMode = configuredMode === "none" && hasRtcClassification
      ? "standard"
      : ["standard", "monophase", "transfer_credit"].includes(configuredMode)
      ? configuredMode as RuleForm["rtcMode"]
      : rule.ibs_cbs_cst ? "standard" : "none";
    setForm({
      id: rule.id, name: rule.name, priority: String(rule.priority), models: rule.model_codes.join(",") as RuleForm["models"],
      crt: String(rule.issuer_crt[0] || 1) as RuleForm["crt"], destination: String(rule.operation_destination || 1) as RuleForm["destination"],
      destinationUf: rule.destination_uf || "", recipientIe: String(rule.recipient_ie_indicator || 9) as RuleForm["recipientIe"],
      finalConsumer: String(rule.final_consumer !== false) as RuleForm["finalConsumer"], presence: String(rule.presence_indicator ?? 1),
      productOrigin: String(rule.product_origin ?? 0), cfop: rule.cfop, icmsCode: rule.icms_code,
      destinationIcmsRate: difal.internalRate == null ? "" : String(difal.internalRate), pisCst: rule.pis_cst || "07",
      cofinsCst: rule.cofins_cst || "07", ipiCst: rule.ipi_cst || "none", ibsCbsCst: rule.ibs_cbs_cst || "none",
      cclassTrib: rule.cclass_trib || "none", isCst: rule.is_cst || "none", isCclassTrib: rule.is_cclass_trib || "none",
      rtcMode,
      ibsUf: jurisdictionForm(ibsCbsConfig.ibsUf, {
        rate: formNumber(ibsCbsConfig.aliquota_ibs_uf),
        reduction: formNumber(ibsCbsConfig.reducao_ibs, "0"),
      }),
      ibsMun: jurisdictionForm(ibsCbsConfig.ibsMun, {
        rate: formNumber(ibsCbsConfig.aliquota_ibs_mun),
        reduction: formNumber(ibsCbsConfig.reducao_ibs, "0"),
      }),
      cbs: jurisdictionForm(ibsCbsConfig.cbs, {
        rate: formNumber(ibsCbsConfig.aliquota_cbs),
        reduction: formNumber(ibsCbsConfig.reducao_cbs, "0"),
      }),
      monophase: Object.fromEntries(Object.entries(monophase).map(([key, value]) => [key, formNumber(value)])),
      transferIbs: formNumber(transferCredit.vIBS), transferCbs: formNumber(transferCredit.vCBS),
      benefitCode: rule.benefit_code || "", legalBasis: rule.legal_basis || "", icmsConfig: asObject(rule.icms_config),
      pisConfig: asObject(rule.pis_config), cofinsConfig: asObject(rule.cofins_config), ipiConfig: asObject(rule.ipi_config),
      ibsCbsConfig: asObject(rule.ibs_cbs_config), isConfig: asObject(rule.is_config),
    });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!storeId || !issuerUf) return toast({ title: "Cadastre a UF do emitente antes de criar a operação", variant: "destructive" });
    if (!form.name.trim() || !form.cfop) return toast({ title: "Preencha nome e CFOP", variant: "destructive" });
    if (form.destination === "2" && (!UFS.includes(form.destinationUf) || form.destinationUf === issuerUf)) return toast({ title: "Escolha uma UF de destino diferente da UF do emitente", variant: "destructive" });
    const destinationIcmsRate = Number(form.destinationIcmsRate.replace(",", "."));
    if (form.destination === "2" && (!Number.isFinite(destinationIcmsRate) || destinationIcmsRate <= 0 || destinationIcmsRate > 100)) {
      return toast({ title: "Informe uma alíquota interna do ICMS válida para a UF de destino", description: "Use um percentual maior que zero e de até 100%.", variant: "destructive" });
    }
    const selectedCfop = cfops.find((item) => item.code === form.cfop && item.operation_destination === Number(form.destination));
    if (!selectedCfop) return toast({ title: "CFOP incompatível com o destino da operação", variant: "destructive" });
    if (form.rtcMode !== "none" && (form.ibsCbsCst === "none" || form.cclassTrib === "none")) {
      return toast({ title: "Selecione o CST e a classificação tributária do IBS/CBS", variant: "destructive" });
    }
    if (form.rtcMode === "standard") {
      const jurisdictions = [["IBS estadual", form.ibsUf], ["IBS municipal", form.ibsMun], ["CBS", form.cbs]] as const;
      for (const [label, values] of jurisdictions) {
        if (!Number.isFinite(decimalValue(values.rate)) || decimalValue(values.rate) < 0 || decimalValue(values.rate) > 100) {
          return toast({ title: `Informe uma alíquota válida para ${label}`, description: "Use um percentual entre 0 e 100.", variant: "destructive" });
        }
        for (const value of [values.reduction, values.deferralPercent, values.returnedPercent]) {
          if (!Number.isFinite(decimalValue(value)) || decimalValue(value) < 0 || decimalValue(value) > 100) {
            return toast({ title: `Percentuais inválidos em ${label}`, description: "Redução, diferimento e devolução devem ficar entre 0 e 100.", variant: "destructive" });
          }
        }
      }
    }
    const monophaseConfig = Object.fromEntries(Object.entries(form.monophase).flatMap(([key, raw]) => {
      const value = optionalDecimal(raw);
      return value == null ? [] : [[key, value]];
    }));
    if (form.rtcMode === "monophase" && Object.keys(monophaseConfig).length === 0) {
      return toast({ title: "Informe os parâmetros da tributação monofásica", variant: "destructive" });
    }
    const transferIbs = optionalDecimal(form.transferIbs);
    const transferCbs = optionalDecimal(form.transferCbs);
    if (form.rtcMode === "transfer_credit" && (transferIbs == null || transferCbs == null || transferIbs < 0 || transferCbs < 0)) {
      return toast({ title: "Informe os valores de transferência de crédito do IBS e da CBS", variant: "destructive" });
    }
    const icmsConfig = { ...form.icmsConfig };
    if (form.destination === "2") {
      icmsConfig.difal = { ...asObject(icmsConfig.difal), internalRate: destinationIcmsRate };
    } else delete icmsConfig.difal;
    const ibsCbsConfig: JsonObject = form.rtcMode === "none"
      ? { mode: "none", enabled: false }
      : form.rtcMode === "standard"
        ? { mode: "standard", enabled: true, ibsUf: compactJurisdiction(form.ibsUf), ibsMun: compactJurisdiction(form.ibsMun), cbs: compactJurisdiction(form.cbs) }
        : form.rtcMode === "monophase"
          ? { mode: "monophase", enabled: true, monophase: monophaseConfig }
          : { mode: "transfer_credit", enabled: true, transferCredit: { vIBS: transferIbs, vCBS: transferCbs } };
    const payload = {
      user_id: storeId, name: form.name.trim(), active: false, priority: Number(form.priority) || 100,
      model_codes: form.models.split(","), issuer_crt: [Number(form.crt)], operation_type: "sale",
      operation_destination: Number(form.destination), origin_uf: issuerUf,
      destination_uf: form.destination === "1" ? issuerUf : form.destination === "3" ? "EX" : form.destinationUf,
      recipient_ie_indicator: Number(form.recipientIe), final_consumer: form.finalConsumer === "true",
      presence_indicator: Number(form.presence), product_id: null, ncm_prefix: null, cest: null,
      product_origin: Number(form.productOrigin), cfop: form.cfop, icms_code: form.icmsCode, icms_config: icmsConfig,
      pis_cst: form.pisCst, pis_config: form.pisConfig, cofins_cst: form.cofinsCst, cofins_config: form.cofinsConfig,
      ipi_cst: form.ipiCst === "none" ? null : form.ipiCst, ipi_config: form.ipiConfig,
      ibs_cbs_cst: form.ibsCbsCst === "none" ? null : form.ibsCbsCst,
      cclass_trib: form.cclassTrib === "none" ? null : form.cclassTrib,
      ibs_cbs_config: ibsCbsConfig,
      is_cst: form.isCst === "none" ? null : form.isCst, is_cclass_trib: form.isCclassTrib === "none" ? null : form.isCclassTrib,
      is_config: form.isCst === "none" ? { enabled: false } : { ...form.isConfig, enabled: true },
      benefit_code: form.benefitCode.trim() || null, legal_basis: form.legalBasis.trim() || null,
      rtc_source_version: null, rtc_table_version: null,
    };
    setSaving(true);
    try {
      const query = form.id
        ? fiscalSupabase.from("fiscal_tax_rules").update(payload).eq("id", form.id).eq("user_id", storeId)
        : fiscalSupabase.from("fiscal_tax_rules").insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast({ title: form.id ? "Operação fiscal atualizada" : "Operação fiscal criada", description: form.id ? "A operação voltou para rascunho e precisa ser aprovada novamente." : "Revise e aprove a regra antes de usá-la na emissão." });
      setEditorOpen(false); await load();
    } catch (error: unknown) { toast({ title: "Não foi possível salvar", description: errorMessage(error), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const approve = async () => {
    if (!approvalRule) return;
    setSaving(true);
    try {
      const { error } = await fiscalSupabase.rpc("approve_fiscal_tax_rule_homologation", { p_rule_id: approvalRule.id, p_responsible: responsible });
      if (error) throw error;
      toast({ title: "Operação fiscal aprovada", description: "A regra já pode ser resolvida pelo motor fiscal." });
      setApprovalRule(null); setResponsible(""); await load();
    } catch (error: unknown) { toast({ title: "Aprovação não concluída", description: errorMessage(error), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const remove = async (rule: FiscalRule) => {
    if (rule.accountant_approved_at || !window.confirm(`Excluir a operação “${rule.name}”?`)) return;
    const { error } = await fiscalSupabase.from("fiscal_tax_rules").delete().eq("id", rule.id).eq("user_id", storeId);
    if (error) toast({ title: "Não foi possível excluir", description: error.message, variant: "destructive" }); else await load();
  };

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle>Operações fiscais</CardTitle><CardDescription>Tributação definida pela operação. NCM e CEST permanecem exclusivamente no produto.</CardDescription></div>
          <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nova operação</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!issuerUf && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Informe a UF no cadastro do emitente. A origem da operação será preenchida automaticamente.</div>}
          {rules.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Nenhuma operação fiscal cadastrada.</div>}
          {rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{rule.name}</strong>{rule.accountant_approved_at ? <Badge className="bg-emerald-600">Aprovada</Badge> : <Badge variant="secondary">Rascunho</Badge>}</div>
              <p className="mt-1 text-sm text-muted-foreground">{rule.origin_uf} → {rule.destination_uf} · CFOP {rule.cfop} · {rule.issuer_crt[0] === 1 ? "CSOSN" : "CST"} {rule.icms_code} · modelos {rule.model_codes.join("/")}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Fundamentação legal:</span> {rule.legal_basis || "Não informada"}</p>
            </div>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openEdit(rule)}><Pencil className="mr-2 h-4 w-4" />Editar</Button>{!rule.accountant_approved_at && <><Button variant="outline" size="sm" aria-label={`Excluir operação ${rule.name}`} title={`Excluir operação ${rule.name}`} onClick={() => void remove(rule)}><Trash2 className="h-4 w-4" /></Button><Button size="sm" onClick={() => setApprovalRule(rule)}><ShieldCheck className="mr-2 h-4 w-4" />Aprovar</Button></>}</div>
          </div>)}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{form.id ? "Editar operação fiscal" : "Nova operação fiscal"}</DialogTitle><DialogDescription>{form.id ? "Ao salvar, a operação volta para rascunho e deve ser aprovada novamente antes da emissão." : "Os campos técnicos e as versões oficiais são montados internamente na aprovação."}</DialogDescription></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome da operação"><Input value={form.name} onChange={(e) => setField("name", e.target.value)} /></Field>
          <Field label="Prioridade"><Input type="number" min="0" value={form.priority} onChange={(e) => setField("priority", e.target.value)} /></Field>
          <EnumField label="Modelos" value={form.models} onChange={(v) => setField("models", v as RuleForm["models"])} options={[["55,65", "NF-e 55 e NFC-e 65"], ["55", "Somente NF-e 55"], ["65", "Somente NFC-e 65"]]} />
          <EnumField label="Regime do emitente" value={form.crt} onChange={(v) => { setField("crt", v as RuleForm["crt"]); setField("icmsCode", v === "1" ? "102" : "00"); }} options={[["1", "1 — Simples Nacional"], ["2", "2 — Simples: excesso de sublimite"], ["3", "3 — Regime normal"]]} />
          <Field label="UF de origem (emitente)"><Input value={issuerUf || "Não cadastrada"} disabled /></Field>
          <EnumField label="Destino da operação" value={form.destination} onChange={(v) => { setField("destination", v as RuleForm["destination"]); setField("destinationUf", ""); setField("cfop", ""); }} options={[["1", "1 — Operação interna"], ["2", "2 — Operação interestadual"], ["3", "3 — Operação com exterior"]]} />
          {form.destination === "2" && <EnumField label="UF de destino" value={form.destinationUf} onChange={(v) => setField("destinationUf", v)} placeholder="Selecione a UF" options={UFS.filter((uf) => uf !== issuerUf).map((uf) => [uf, uf])} />}
          {form.destination !== "2" && <Field label="UF de destino"><Input value={form.destination === "1" ? issuerUf : "EX"} disabled /></Field>}
          <EnumField label="Indicador de IE do destinatário" value={form.recipientIe} onChange={(v) => setField("recipientIe", v as RuleForm["recipientIe"])} options={[["1", "1 — Contribuinte ICMS"], ["2", "2 — Contribuinte isento"], ["9", "9 — Não contribuinte"]]} />
          <EnumField label="Consumidor final" value={form.finalConsumer} onChange={(v) => setField("finalConsumer", v as RuleForm["finalConsumer"])} options={[["true", "Sim"], ["false", "Não"]]} />
          <EnumField label="Indicador de presença" value={form.presence} onChange={(v) => setField("presence", v)} options={PRESENCE} />
          <EnumField label="Origem do produto" value={form.productOrigin} onChange={(v) => setField("productOrigin", v)} options={ORIGINS} />
          <EnumField label="CFOP" value={form.cfop} onChange={(v) => setField("cfop", v)} placeholder="Selecione o CFOP" options={availableCfops.map((item) => [item.code, `${item.code} — ${item.description}`])} />
          <EnumField label={form.crt === "1" ? "CSOSN" : "CST ICMS"} value={form.icmsCode} onChange={(v) => setField("icmsCode", v)} options={icmsCodes.map((code) => [code, code])} />
          {form.destination === "2" && <Field label="Alíquota interna do ICMS no destino (%)"><Input inputMode="decimal" value={form.destinationIcmsRate} onChange={(e) => setField("destinationIcmsRate", e.target.value)} placeholder="Ex.: 20,00" /></Field>}
          <EnumField label="CST PIS" value={form.pisCst} onChange={(v) => setField("pisCst", v)} options={CONTRIBUTION_CST.map((x) => [x, x])} />
          <EnumField label="CST COFINS" value={form.cofinsCst} onChange={(v) => setField("cofinsCst", v)} options={CONTRIBUTION_CST.map((x) => [x, x])} />
          <EnumField label="CST IPI" value={form.ipiCst} onChange={(v) => setField("ipiCst", v)} options={[["none", "Sem IPI"], ...IPI_CST.map((x) => [x, x])]} />
          <div className="md:col-span-2 lg:col-span-3 rounded-xl border bg-slate-50 p-4">
            <div className="mb-4"><h3 className="font-semibold">IBS e CBS</h3><p className="text-sm text-muted-foreground">Preencha os dados que serão usados pelo motor fiscal. Nenhuma configuração em JSON é necessária.</p></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <EnumField label="Modalidade do IBS/CBS" value={form.rtcMode} onChange={(v) => {
                const mode = v as RuleForm["rtcMode"];
                setField("rtcMode", mode);
                if (mode === "none") { setField("ibsCbsCst", "none"); setField("cclassTrib", "none"); }
              }} options={[["none", "Sem incidência"], ["standard", "Tributação padrão"], ["monophase", "Tributação monofásica"], ["transfer_credit", "Transferência de crédito"]]} />
              {form.rtcMode !== "none" && <>
                <EnumField label="CST IBS/CBS" value={form.ibsCbsCst} onChange={(v) => { setField("ibsCbsCst", v); setField("cclassTrib", "none"); }} options={[["none", "Selecione"], ...ibsCsts.map((x) => [x, x])]} />
                <EnumField label="Classificação tributária IBS/CBS" value={form.cclassTrib} onChange={(v) => setField("cclassTrib", v)} options={[["none", "Selecione"], ...ibsClasses.map((x) => [x.cclass_trib, `${x.cclass_trib} — ${x.description}`])]} />
              </>}
            </div>
            {form.rtcMode === "standard" && <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <RtcJurisdictionFields title="IBS estadual" value={form.ibsUf} onChange={(key, value) => setJurisdictionField("ibsUf", key, value)} />
              <RtcJurisdictionFields title="IBS municipal" value={form.ibsMun} onChange={(key, value) => setJurisdictionField("ibsMun", key, value)} />
              <RtcJurisdictionFields title="CBS" value={form.cbs} onChange={(key, value) => setJurisdictionField("cbs", key, value)} />
            </div>}
            {form.rtcMode === "monophase" && <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {MONOPHASE_FIELDS.map(([key, label]) => <Field key={key} label={label}><Input inputMode="decimal" value={form.monophase[key] || ""} onChange={(event) => setForm((current) => ({ ...current, monophase: { ...current.monophase, [key]: event.target.value } }))} /></Field>)}
            </div>}
            {form.rtcMode === "transfer_credit" && <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Valor transferido de IBS (R$)"><Input inputMode="decimal" value={form.transferIbs} onChange={(event) => setField("transferIbs", event.target.value)} /></Field>
              <Field label="Valor transferido de CBS (R$)"><Input inputMode="decimal" value={form.transferCbs} onChange={(event) => setField("transferCbs", event.target.value)} /></Field>
            </div>}
          </div>
          <EnumField label="CST Imposto Seletivo" value={form.isCst} onChange={(v) => { setField("isCst", v); setField("isCclassTrib", "none"); }} options={[["none", "Sem incidência"], ...isCsts.map((x) => [x, x])]} />
          <EnumField label="Classificação tributária IS" value={form.isCclassTrib} onChange={(v) => setField("isCclassTrib", v)} options={[["none", "Não aplicável"], ...isClasses.map((x) => [x.cclass_trib, `${x.cclass_trib} — ${x.description}`])]} />
          <Field label="Código de benefício fiscal"><Input value={form.benefitCode} onChange={(e) => setField("benefitCode", e.target.value)} /></Field>
          <div className="md:col-span-2 lg:col-span-3"><Field label="Fundamentação legal da operação (opcional)"><Textarea rows={3} value={form.legalBasis} onChange={(e) => setField("legalBasis", e.target.value)} placeholder="Ex.: dispositivo legal, convênio, ajuste ou observação validada pelo contador" /><p className="text-xs text-muted-foreground">Quando informada, fica vinculada à operação e é preservada para conferência e auditoria fiscal.</p></Field></div>
        </div><DialogFooter><Button variant="outline" onClick={() => setEditorOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar rascunho</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={Boolean(approvalRule)} onOpenChange={(open) => !open && setApprovalRule(null)}><DialogContent><DialogHeader><DialogTitle>Aprovar operação fiscal</DialogTitle><DialogDescription>Após a aprovação, a regra fica imutável e as versões oficiais das tabelas são registradas automaticamente.</DialogDescription></DialogHeader><Field label="Responsável pela validação"><Input value={responsible} onChange={(e) => setResponsible(e.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={() => setApprovalRule(null)}>Cancelar</Button><Button onClick={() => void approve()} disabled={saving || responsible.trim().length < 3}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function EnumField({ label, value, onChange, options, placeholder = "Selecione" }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; placeholder?: string }) {
  return <Field label={label}><Select value={value || undefined} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></Field>;
}

function RtcJurisdictionFields({ title, value, onChange }: { title: string; value: RtcJurisdictionForm; onChange: (field: keyof RtcJurisdictionForm, value: string) => void }) {
  return <div className="space-y-3 rounded-lg border bg-white p-3"><div className="font-semibold">{title}</div><Field label="Alíquota (%)"><Input inputMode="decimal" value={value.rate} onChange={(event) => onChange("rate", event.target.value)} /></Field><Field label="Redução da alíquota (%)"><Input inputMode="decimal" value={value.reduction} onChange={(event) => onChange("reduction", event.target.value)} /></Field><Field label="Diferimento (%)"><Input inputMode="decimal" value={value.deferralPercent} onChange={(event) => onChange("deferralPercent", event.target.value)} /></Field><Field label="Devolução do tributo (%)"><Input inputMode="decimal" value={value.returnedPercent} onChange={(event) => onChange("returnedPercent", event.target.value)} /></Field></div>;
}
