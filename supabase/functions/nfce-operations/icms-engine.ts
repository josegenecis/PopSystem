// Motor de serializacao do ICMS para NF-e/NFC-e 4.00.
//
// A escolha tributaria pertence a uma regra fiscal aprovada para a operacao.
// Este modulo nao tenta "adivinhar" CST/CSOSN. Ele valida a combinacao recebida
// e falha antes da transmissao quando faltar um campo obrigatorio.

export type TaxRegime = 1 | 2 | 3;

export const SIMPLES_CSOSN = [
  "101",
  "102",
  "103",
  "201",
  "202",
  "203",
  "300",
  "400",
  "500",
  "900",
] as const;

export const NORMAL_CST = [
  "00",
  "10",
  "20",
  "30",
  "40",
  "41",
  "50",
  "51",
  "60",
  "70",
  "90",
] as const;

export interface IcmsConfig {
  // Por padrão, a base própria é recalculada a partir do valor líquido do item.
  // Use "explicit" somente quando a legislação exigir uma base monetária fixa
  // informada pela regra (e nunca como exemplo cadastral reutilizável).
  baseMode?: "operation" | "explicit";
  // "state_modal" acompanha a alíquota interna vigente da UF do emitente.
  // "explicit" preserva uma alíquota especial aprovada para o produto.
  rateMode?: "state_modal" | "explicit";
  modBC?: number;
  pRedBC?: number;
  vBC?: number;
  pICMS?: number;
  vICMS?: number;
  vICMSOp?: number;
  pDif?: number;
  vICMSDif?: number;
  vICMSDeson?: number;
  motDesICMS?: number;
  indDeduzDeson?: 0 | 1;
  modBCST?: number;
  pMVAST?: number;
  pRedBCST?: number;
  vBCST?: number;
  pICMSST?: number;
  vICMSST?: number;
  vBCFCP?: number;
  pFCP?: number;
  vFCP?: number;
  vBCFCPST?: number;
  pFCPST?: number;
  vFCPST?: number;
  vBCSTRet?: number;
  pST?: number;
  vICMSSubstituto?: number;
  vICMSSTRet?: number;
  vBCFCPSTRet?: number;
  pFCPSTRet?: number;
  vFCPSTRet?: number;
  pRedBCEfet?: number;
  vBCEfet?: number;
  pICMSEfet?: number;
  vICMSEfet?: number;
  pCredSN?: number;
  vCredICMSSN?: number;
}

export interface IcmsItem {
  regime_tributario?: number;
  origem: string;
  cst_icms: string;
  valor_total: number;
  valor_desconto?: number;
  icms_config?: IcmsConfig | string | null;
  // Compatibilidade com o snapshot de ST ja existente.
  icms_st_base_retida?: number;
  icms_st_aliquota?: number;
  icms_substituto?: number;
  icms_st_retido?: number;
  icms_efetivo_reducao?: number;
  icms_efetivo_aliquota?: number;
}

export interface IcmsTotals {
  vBC: number;
  vICMS: number;
  vICMSDeson: number;
  vFCP: number;
  vBCST: number;
  vST: number;
  vFCPST: number;
  vFCPSTRet: number;
}

const SIMPLE_SET = new Set<string>(SIMPLES_CSOSN);
const NORMAL_SET = new Set<string>(NORMAL_CST);

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown): number {
  return Number(number(value).toFixed(2));
}

function rate(value: unknown): number {
  const parsed = number(value);
  return Math.min(100, Math.max(0, parsed));
}

function fixed2(value: unknown): string {
  return money(value).toFixed(2);
}

function fixed4(value: unknown): string {
  return number(value).toFixed(4);
}

function parseConfig(value: IcmsItem["icms_config"]): IcmsConfig {
  if (value && typeof value === "object") return { ...value };
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      throw new Error("Configuração ICMS inválida: JSON malformado");
    }
  }
  return {};
}

function has(config: IcmsConfig, field: keyof IcmsConfig): boolean {
  return config[field] !== undefined && config[field] !== null &&
    Number.isFinite(Number(config[field]));
}

function required(
  config: IcmsConfig,
  fields: (keyof IcmsConfig)[],
  code: string,
) {
  const missing = fields.filter((field) => !has(config, field));
  if (missing.length) {
    throw new Error(
      `${code}: campos obrigatórios ausentes: ${missing.join(", ")}`,
    );
  }
}

function tag(name: string, value: unknown, decimals: 2 | 4 = 2): string {
  return `<${name}>${decimals === 4 ? fixed4(value) : fixed2(value)}</${name}>`;
}

function optionalTag(
  config: IcmsConfig,
  name: keyof IcmsConfig,
  decimals: 2 | 4 = 2,
): string {
  return has(config, name) ? tag(name, config[name], decimals) : "";
}

function baseAndTax(config: IcmsConfig, item: IcmsItem): IcmsConfig {
  const result = { ...config };
  const operationBase = money(
    Math.max(0, number(item.valor_total) - number(item.valor_desconto)),
  );
  const calculateOwnTax = has(result, "pICMS") &&
    result.baseMode !== "explicit";
  if (calculateOwnTax) {
    result.vBC = money(
      operationBase * (1 - rate(result.pRedBC) / 100),
    );
    result.vICMSOp = money(number(result.vBC) * rate(result.pICMS) / 100);
    if (has(result, "pDif")) {
      result.vICMSDif = money(
        number(result.vICMSOp) * rate(result.pDif) / 100,
      );
      result.vICMS = money(
        number(result.vICMSOp) - number(result.vICMSDif),
      );
    } else {
      result.vICMS = result.vICMSOp;
    }
  } else if (!has(result, "vBC") && has(result, "pICMS")) {
    result.vBC = operationBase;
  }
  if (
    !has(result, "vICMS") && !has(result, "pDif") && has(result, "vBC") &&
    has(result, "pICMS")
  ) {
    result.vICMS = money(number(result.vBC) * rate(result.pICMS) / 100);
  }
  if (!has(result, "vCredICMSSN") && has(result, "pCredSN")) {
    const creditBase = has(result, "vBC") ? number(result.vBC) : operationBase;
    result.vCredICMSSN = money(creditBase * rate(result.pCredSN) / 100);
  }
  if (!has(result, "vICMSOp") && has(result, "vBC") && has(result, "pICMS")) {
    result.vICMSOp = money(number(result.vBC) * rate(result.pICMS) / 100);
  }
  if (
    !has(result, "vICMSDif") && has(result, "vICMSOp") && has(result, "pDif")
  ) {
    result.vICMSDif = money(number(result.vICMSOp) * rate(result.pDif) / 100);
  }
  if (
    !has(result, "vICMS") && has(result, "vICMSOp") && has(result, "vICMSDif")
  ) {
    result.vICMS = money(number(result.vICMSOp) - number(result.vICMSDif));
  }
  if (!has(result, "vFCP") && has(result, "vBCFCP") && has(result, "pFCP")) {
    result.vFCP = money(number(result.vBCFCP) * rate(result.pFCP) / 100);
  }
  if (
    !has(result, "vFCPST") && has(result, "vBCFCPST") && has(result, "pFCPST")
  ) {
    result.vFCPST = money(number(result.vBCFCPST) * rate(result.pFCPST) / 100);
  }
  if (
    !has(result, "vFCPSTRet") && has(result, "vBCFCPSTRet") &&
    has(result, "pFCPSTRet")
  ) {
    result.vFCPSTRet = money(
      number(result.vBCFCPSTRet) * rate(result.pFCPSTRet) / 100,
    );
  }
  return result;
}

function normalTax(config: IcmsConfig): string {
  return `<modBC>${number(config.modBC)}</modBC>${
    optionalTag(config, "pRedBC", 4)
  }${tag("vBC", config.vBC)}${tag("pICMS", config.pICMS, 4)}${
    tag("vICMS", config.vICMS)
  }${optionalTag(config, "vBCFCP")}${optionalTag(config, "pFCP", 4)}${
    optionalTag(config, "vFCP")
  }`;
}

// O grupo ICMSSN900 tem uma ordem diferente dos grupos do regime normal:
// modBC, vBC e somente então pRedBC. Como o XSD usa xs:sequence, reutilizar
// normalTax aqui faz a SEFAZ rejeitar o XML com cStat 225 quando há redução.
function simplesOtherTax(config: IcmsConfig): string {
  return `<modBC>${number(config.modBC)}</modBC>${tag("vBC", config.vBC)}${
    optionalTag(config, "pRedBC", 4)
  }${tag("pICMS", config.pICMS, 4)}${tag("vICMS", config.vICMS)}${
    optionalTag(config, "vBCFCP")
  }${optionalTag(config, "pFCP", 4)}${optionalTag(config, "vFCP")}`;
}

function stTax(config: IcmsConfig): string {
  return `<modBCST>${number(config.modBCST)}</modBCST>${
    optionalTag(config, "pMVAST", 4)
  }${optionalTag(config, "pRedBCST", 4)}${tag("vBCST", config.vBCST)}${
    tag("pICMSST", config.pICMSST, 4)
  }${tag("vICMSST", config.vICMSST)}${optionalTag(config, "vBCFCPST")}${
    optionalTag(config, "pFCPST", 4)
  }${optionalTag(config, "vFCPST")}`;
}

function retainedTax(config: IcmsConfig): string {
  return `${tag("vBCSTRet", config.vBCSTRet)}${tag("pST", config.pST, 4)}${
    optionalTag(config, "vICMSSubstituto")
  }${tag("vICMSSTRet", config.vICMSSTRet)}${
    optionalTag(config, "vBCFCPSTRet")
  }${optionalTag(config, "pFCPSTRet", 4)}${optionalTag(config, "vFCPSTRet")}${
    optionalTag(config, "pRedBCEfet", 4)
  }${optionalTag(config, "vBCEfet")}${optionalTag(config, "pICMSEfet", 4)}${
    optionalTag(config, "vICMSEfet")
  }`;
}

function desoneracao(config: IcmsConfig): string {
  if (!has(config, "vICMSDeson") && !has(config, "motDesICMS")) return "";
  required(config, ["vICMSDeson", "motDesICMS"], "ICMS desonerado");
  return `${tag("vICMSDeson", config.vICMSDeson)}<motDesICMS>${
    number(config.motDesICMS)
  }</motDesICMS>${
    has(config, "indDeduzDeson")
      ? `<indDeduzDeson>${number(config.indDeduzDeson)}</indDeduzDeson>`
      : ""
  }`;
}

function origin(item: IcmsItem): string {
  const value = String(item.origem ?? "").replace(/\D/g, "");
  if (!/^[0-8]$/.test(value)) {
    throw new Error(`Origem da mercadoria inválida: ${value || "vazia"}`);
  }
  return value;
}

export function normalizeIcmsCode(regime: number, rawCode: unknown): string {
  const digits = String(rawCode ?? "").replace(/\D/g, "");
  return regime === 1
    ? digits.padStart(3, "0").slice(-3)
    : digits.padStart(2, "0").slice(-2);
}

export function buildIcmsXml(item: IcmsItem, regimeValue: number): string {
  const regime = Number(regimeValue) as TaxRegime;
  if (![1, 2, 3].includes(regime)) {
    throw new Error(`CRT ${regimeValue} não suportado`);
  }
  const code = normalizeIcmsCode(regime, item.cst_icms);
  const orig = origin(item);
  let config = parseConfig(item.icms_config);

  // Migração transparente do snapshot legado de CSOSN 500/CST 60.
  if (["500", "60"].includes(code) && !has(config, "vBCSTRet")) {
    config = {
      ...config,
      vBCSTRet: number(item.icms_st_base_retida),
      pST: number(item.icms_st_aliquota),
      vICMSSubstituto: number(item.icms_substituto),
      vICMSSTRet: number(item.icms_st_retido),
      pRedBCEfet: number(item.icms_efetivo_reducao),
      pICMSEfet: number(item.icms_efetivo_aliquota),
    };
    if (number(item.icms_efetivo_aliquota) > 0) {
      const base = money(
        number(item.valor_total) *
          (1 - number(item.icms_efetivo_reducao) / 100),
      );
      config.vBCEfet = base;
      config.vICMSEfet = money(base * number(item.icms_efetivo_aliquota) / 100);
    }
  }
  config = baseAndTax(config, item);

  if (regime === 1) {
    if (!SIMPLE_SET.has(code)) throw new Error(`CSOSN ${code} não suportado`);
    if (["102", "103", "300", "400"].includes(code)) {
      return `<ICMS><ICMSSN102><orig>${orig}</orig><CSOSN>${code}</CSOSN></ICMSSN102></ICMS>`;
    }
    if (code === "101") {
      required(config, ["pCredSN", "vCredICMSSN"], code);
      return `<ICMS><ICMSSN101><orig>${orig}</orig><CSOSN>101</CSOSN>${
        tag("pCredSN", config.pCredSN, 4)
      }${tag("vCredICMSSN", config.vCredICMSSN)}</ICMSSN101></ICMS>`;
    }
    if (["201", "202", "203"].includes(code)) {
      required(config, ["modBCST", "vBCST", "pICMSST", "vICMSST"], code);
      const credit = code === "201"
        ? (required(config, ["pCredSN", "vCredICMSSN"], code),
          `${tag("pCredSN", config.pCredSN, 4)}${
            tag("vCredICMSSN", config.vCredICMSSN)
          }`)
        : "";
      const group = code === "201" ? "ICMSSN201" : "ICMSSN202";
      return `<ICMS><${group}><orig>${orig}</orig><CSOSN>${code}</CSOSN>${
        stTax(config)
      }${credit}</${group}></ICMS>`;
    }
    if (code === "500") {
      required(config, ["vBCSTRet", "pST", "vICMSSTRet"], code);
      return `<ICMS><ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN>${
        retainedTax(config)
      }</ICMSSN500></ICMS>`;
    }
    // 900 permite os grupos próprios e de ST, todos opcionais no schema. A
    // configuração deve declarar ao menos um tratamento para evitar XML vazio.
    if (!Object.keys(config).length) {
      throw new Error("CSOSN 900 exige configuração ICMS explícita");
    }
    const own = has(config, "modBC")
      ? (required(config, ["vBC", "pICMS", "vICMS"], code),
        simplesOtherTax(config))
      : "";
    const st = has(config, "modBCST")
      ? (required(config, ["vBCST", "pICMSST", "vICMSST"], code), stTax(config))
      : "";
    const credit = has(config, "pCredSN") || has(config, "vCredICMSSN")
      ? (required(config, ["pCredSN", "vCredICMSSN"], code),
        `${tag("pCredSN", config.pCredSN, 4)}${
          tag("vCredICMSSN", config.vCredICMSSN)
        }`)
      : "";
    return `<ICMS><ICMSSN900><orig>${orig}</orig><CSOSN>900</CSOSN>${own}${st}${credit}</ICMSSN900></ICMS>`;
  }

  if (!NORMAL_SET.has(code)) throw new Error(`CST ICMS ${code} não suportado`);
  if (code === "00") {
    required(config, ["modBC", "vBC", "pICMS", "vICMS"], code);
    return `<ICMS><ICMS00><orig>${orig}</orig><CST>00</CST>${
      normalTax(config)
    }</ICMS00></ICMS>`;
  }
  if (code === "10") {
    required(config, [
      "modBC",
      "vBC",
      "pICMS",
      "vICMS",
      "modBCST",
      "vBCST",
      "pICMSST",
      "vICMSST",
    ], code);
    return `<ICMS><ICMS10><orig>${orig}</orig><CST>10</CST>${
      normalTax(config)
    }${stTax(config)}</ICMS10></ICMS>`;
  }
  if (code === "20") {
    required(config, ["modBC", "pRedBC", "vBC", "pICMS", "vICMS"], code);
    return `<ICMS><ICMS20><orig>${orig}</orig><CST>20</CST>${
      normalTax(config)
    }${desoneracao(config)}</ICMS20></ICMS>`;
  }
  if (code === "30") {
    required(config, ["modBCST", "vBCST", "pICMSST", "vICMSST"], code);
    return `<ICMS><ICMS30><orig>${orig}</orig><CST>30</CST>${stTax(config)}${
      desoneracao(config)
    }</ICMS30></ICMS>`;
  }
  if (["40", "41", "50"].includes(code)) {
    return `<ICMS><ICMS40><orig>${orig}</orig><CST>${code}</CST>${
      desoneracao(config)
    }</ICMS40></ICMS>`;
  }
  if (code === "51") {
    required(config, [
      "modBC",
      "vBC",
      "pICMS",
      "vICMSOp",
      "pDif",
      "vICMSDif",
      "vICMS",
    ], code);
    return `<ICMS><ICMS51><orig>${orig}</orig><CST>51</CST><modBC>${
      number(config.modBC)
    }</modBC>${optionalTag(config, "pRedBC", 4)}${tag("vBC", config.vBC)}${
      tag("pICMS", config.pICMS, 4)
    }${tag("vICMSOp", config.vICMSOp)}${tag("pDif", config.pDif, 4)}${
      tag("vICMSDif", config.vICMSDif)
    }${tag("vICMS", config.vICMS)}${optionalTag(config, "vBCFCP")}${
      optionalTag(config, "pFCP", 4)
    }${optionalTag(config, "vFCP")}</ICMS51></ICMS>`;
  }
  if (code === "60") {
    required(config, ["vBCSTRet", "pST", "vICMSSTRet"], code);
    return `<ICMS><ICMS60><orig>${orig}</orig><CST>60</CST>${
      retainedTax(config)
    }</ICMS60></ICMS>`;
  }
  if (code === "70") {
    required(config, [
      "modBC",
      "pRedBC",
      "vBC",
      "pICMS",
      "vICMS",
      "modBCST",
      "vBCST",
      "pICMSST",
      "vICMSST",
    ], code);
    return `<ICMS><ICMS70><orig>${orig}</orig><CST>70</CST>${
      normalTax(config)
    }${stTax(config)}${desoneracao(config)}</ICMS70></ICMS>`;
  }
  if (!Object.keys(config).length) {
    throw new Error("CST 90 exige configuração ICMS explícita");
  }
  const own = has(config, "modBC")
    ? (required(config, ["vBC", "pICMS", "vICMS"], code), normalTax(config))
    : "";
  const st = has(config, "modBCST")
    ? (required(config, ["vBCST", "pICMSST", "vICMSST"], code), stTax(config))
    : "";
  return `<ICMS><ICMS90><orig>${orig}</orig><CST>90</CST>${own}${st}${
    desoneracao(config)
  }</ICMS90></ICMS>`;
}

export function validateIcmsItem(item: IcmsItem, regime: number): void {
  buildIcmsXml(item, regime);
}

export function calculateIcmsTotals(items: IcmsItem[]): IcmsTotals {
  return items.reduce<IcmsTotals>((totals, item) => {
    const config = baseAndTax(parseConfig(item.icms_config), item);
    const regime = Number(
      item.regime_tributario ||
        (String(item.cst_icms || "").replace(/\D/g, "").length === 3 ? 1 : 3),
    );
    const code = normalizeIcmsCode(regime, item.cst_icms);

    // ICMSTot deve refletir somente os grupos efetivamente serializados no
    // item. Em especial, CSOSN 500/CST 60 informam imposto anteriormente
    // retido (e, opcionalmente, ICMS efetivo), mas esses valores nao compoem
    // vBC/vICMS nem vBCST/vST do documento atual.
    const hasOwnTax = regime === 1
      ? code === "900" && has(config, "modBC")
      : ["00", "10", "20", "51", "70"].includes(code) ||
        (code === "90" && has(config, "modBC"));
    const hasStTax = regime === 1
      ? ["201", "202", "203"].includes(code) ||
        (code === "900" && has(config, "modBCST"))
      : ["10", "30", "70"].includes(code) ||
        (code === "90" && has(config, "modBCST"));
    const hasDesoneracao = regime !== 1 &&
      ["20", "30", "40", "41", "50", "70", "90"].includes(code);
    const hasRetainedTax = regime === 1 ? code === "500" : code === "60";

    if (hasOwnTax) {
      totals.vBC += number(config.vBC);
      totals.vICMS += number(config.vICMS);
      totals.vFCP += number(config.vFCP);
    }
    if (hasStTax) {
      totals.vBCST += number(config.vBCST);
      totals.vST += number(config.vICMSST);
      totals.vFCPST += number(config.vFCPST);
    }
    if (hasDesoneracao) {
      totals.vICMSDeson += number(config.vICMSDeson);
    }
    if (hasRetainedTax) {
      totals.vFCPSTRet += number(config.vFCPSTRet);
    }
    return totals;
  }, {
    vBC: 0,
    vICMS: 0,
    vICMSDeson: 0,
    vFCP: 0,
    vBCST: 0,
    vST: 0,
    vFCPST: 0,
    vFCPSTRet: 0,
  });
}
