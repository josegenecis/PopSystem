import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { NORMAL_CST, SIMPLES_CSOSN } from "./icms-engine.ts";
import {
  buildFiscalItems,
  generateNFCeXML,
  validateFiscalItemsForEmission,
} from "./index.ts";

const schema = new URL(
  "./schemas/PL_010e_v1.02/NFe/nfe_v4.00.xsd",
  import.meta.url,
).pathname;

const signature =
  '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#NFe23260844625108000145650010000000011000000010"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AA==</DigestValue></Reference></SignedInfo><SignatureValue>AA==</SignatureValue><KeyInfo><X509Data><X509Certificate>AA==</X509Certificate></X509Data></KeyInfo></Signature>';

const baseSettings = {
  ambiente: "homologacao",
  endereco_uf: "CE",
  codigo_municipio: "2304400",
  cnpj: "44625108000145",
  razao_social: "EMITENTE TESTE",
  nome_fantasia: "EMITENTE TESTE",
  endereco_logradouro: "Rua Teste",
  endereco_numero: "1",
  endereco_bairro: "Centro",
  endereco_municipio: "Fortaleza",
  endereco_cep: "60000000",
  inscricao_estadual: "123456789",
  rtc_enabled: false,
};

const own = { modBC: 0, pICMS: 20 };
const reduced = { ...own, pRedBC: 20 };
const st = { modBCST: 4, vBCST: 120, pICMSST: 18, vICMSST: 21.6 };
const retained = {
  vBCSTRet: 100,
  pST: 18,
  vICMSSubstituto: 8,
  vICMSSTRet: 10,
};

const simpleConfigs: Record<string, Record<string, number>> = {
  "101": { pCredSN: 3 },
  "102": {},
  "103": {},
  "201": { ...st, pCredSN: 3 },
  "202": st,
  "203": st,
  "300": {},
  "400": {},
  "500": retained,
  "900": { ...own, pRedBC: 63 },
};

const normalConfigs: Record<string, Record<string, number>> = {
  "00": own,
  "10": { ...own, ...st },
  "20": reduced,
  "30": { ...st, vICMSDeson: 5, motDesICMS: 9 },
  "40": { vICMSDeson: 5, motDesICMS: 9 },
  "41": {},
  "50": {},
  "51": { ...own, pDif: 50 },
  "60": retained,
  "70": { ...reduced, ...st },
  "90": own,
};

function addSchemaOnlySignature(xml: string): string {
  return xml.replace("</NFe>", `${signature}</NFe>`);
}

async function assertSchemaValid(xml: string, scenario: string) {
  const command = new Deno.Command("xmllint", {
    args: ["--noout", "--schema", schema, "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(new TextEncoder().encode(addSchemaOnlySignature(xml)));
  await writer.close();
  const result = await command.output();
  assertEquals(
    result.code,
    0,
    `${scenario}: ${new TextDecoder().decode(result.stderr)}`,
  );
}

function generateDocument(
  crt: 1 | 2 | 3,
  code: string,
  config: Record<string, number>,
  modelCode: "55" | "65",
  contributions?: {
    cst: string;
    pis: Record<string, unknown>;
    cofins: Record<string, unknown>;
  },
  rtc?: Record<string, unknown>,
  extra: Record<string, any> = {},
) {
  const operationDestination = extra.operationDestination || 1;
  const settings = {
    ...baseSettings,
    regime_tributario: crt,
    rtc_enabled: Boolean(rtc?.rtc_config),
  };
  const productFiscal = {
    fiscal_ncm: "21069090",
    fiscal_cfop: operationDestination === 2 ? "6102" : "5102",
    fiscal_origem: "0",
    fiscal_cest:
      ["201", "202", "203", "500", "10", "30", "60", "70"].includes(code)
        ? "0301100"
        : null,
    fiscal_icms_config: config,
    fiscal_cst_pis: "07",
    fiscal_cst_cofins: "07",
    fiscal_ipi_cst: extra.ipi_cst,
    fiscal_ipi_config: extra.ipi_config,
    ...(crt === 1 ? { fiscal_csosn: code } : { fiscal_icms_cst: code }),
  };
  const items = buildFiscalItems(
    [{
      product_id: "product-1",
      product_name: "Produto teste",
      quantity: 1,
      price: 100,
      subtotal: 100,
      fiscal_pis_config: contributions?.pis,
      fiscal_cofins_config: contributions?.cofins,
      fiscal_cst_pis: contributions?.cst,
      fiscal_cst_cofins: contributions?.cst,
      rtc_config: rtc?.rtc_config,
      fiscal_ibs_cbs_cst: rtc?.cst_ibs_cbs,
      fiscal_cclass_trib: rtc?.cclass_trib,
      is_config: rtc?.is_config,
      fiscal_is_cst: rtc?.is_cst,
      fiscal_is_cclass_trib: rtc?.is_cclass_trib,
      fiscal_icms_config: extra.icms_config,
      fiscal_ipi_cst: extra.ipi_cst,
      fiscal_ipi_config: extra.ipi_config,
    }],
    settings,
    new Map([["product-1", productFiscal]]),
    operationDestination,
  );
  const consumerData = modelCode === "55"
    ? {
      cpf_cnpj: "19100000000",
      nome: "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO SEM VALOR FISCAL",
      address: "Rua Teste",
      address_number: "1",
      neighborhood: "Centro",
      city_code: operationDestination === 2 ? "3550308" : "2304400",
      city: operationDestination === 2 ? "Sao Paulo" : "Fortaleza",
      state: operationDestination === 2 ? "SP" : "CE",
      postal_code: operationDestination === 2 ? "01001000" : "60000000",
      state_registration_indicator: 9,
      final_consumer: true,
      ...(extra.consumerData || {}),
    }
    : undefined;
  validateFiscalItemsForEmission(items, settings, operationDestination, {
    modelCode,
    consumerData,
  });
  return generateNFCeXML({
    fiscalSettings: settings,
    cupom: {
      chave_acesso: "23260844625108000145650010000000011000000010",
      serie: "1",
      numero: 1,
      data_hora_emissao: "2026-08-18T12:00:00.000Z",
    },
    order: {},
    items,
    consumerData,
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 100,
    valorDesconto: 0,
    valorTotal: 100,
    valorTributos: 7.65,
    modelCode,
  });
}

Deno.test("matriz XSD oficial: IPI tributado e não tributado", async () => {
  const taxed = generateDocument(3, "00", own, "55", undefined, undefined, {
    ipi_cst: "50",
    ipi_config: { cEnq: "999", rate: 5 },
  });
  assertStringIncludes(
    taxed,
    "<IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>5.0000</pIPI><vIPI>5.00</vIPI>",
  );
  await assertSchemaValid(taxed, "IPI tributado");

  const untaxed = generateDocument(1, "102", {}, "65", undefined, undefined, {
    ipi_cst: "53",
    ipi_config: { cEnq: "999" },
  });
  assertStringIncludes(
    untaxed,
    "<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>",
  );
  await assertSchemaValid(untaxed, "IPI não tributado");
});

Deno.test("matriz XSD oficial: DIFAL para consumidor final não contribuinte", async () => {
  // A NA01-20 dispensa expressamente o grupo para CRT 1 (Simples) e CRT 4
  // (MEI). A matriz deve exercitar somente os regimes em que há exigência.
  for (const crt of [2, 3] as const) {
    const code = "00";
    const baseConfig = normalConfigs[code];
    const xml = generateDocument(
      crt,
      code,
      baseConfig,
      "55",
      undefined,
      undefined,
      {
        operationDestination: 2,
        icms_config: {
          ...baseConfig,
          difal: {
            enabled: true,
            internalRate: 18,
            interstateRate: 7,
            destinationShare: 100,
            fcpRate: 2,
          },
        },
      },
    );
    assertStringIncludes(xml, "<ICMSUFDest><vBCUFDest>100.00</vBCUFDest>");
    assertStringIncludes(
      xml,
      "<vICMSUFDest>11.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>",
    );
    await assertSchemaValid(xml, `DIFAL CRT ${crt}`);
  }
});

Deno.test("matriz XSD oficial: todos os CSOSN nos modelos 55 e 65", async () => {
  for (const model of ["55", "65"] as const) {
    for (const code of SIMPLES_CSOSN) {
      await assertSchemaValid(
        generateDocument(
          1,
          code,
          simpleConfigs[code],
          model,
          undefined,
          undefined,
          model === "55"
            ? {
              consumerData: {
                cpf_cnpj: "99999999000191",
                state_registration: "060000015",
                state_registration_indicator: 1,
                final_consumer: false,
              },
            }
            : {},
        ),
        `CRT 1 / modelo ${model} / CSOSN ${code}`,
      );
    }
  }
});

Deno.test("matriz XSD oficial: IBS, CBS e IS no XML completo 55/65", async () => {
  const scenarios: Array<{ name: string; rtc: Record<string, unknown> }> = [
    {
      name: "IBS/CBS integral",
      rtc: {
        cst_ibs_cbs: "000",
        cclass_trib: "000001",
        rtc_config: {
          enabled: true,
          mode: "standard",
          ibsUf: { rate: 0.1 },
          ibsMun: { rate: 0 },
          cbs: { rate: 0.9 },
        },
      },
    },
    {
      name: "IBS/CBS com redução",
      rtc: {
        cst_ibs_cbs: "200",
        cclass_trib: "200047",
        rtc_config: {
          enabled: true,
          mode: "standard",
          ibsUf: { rate: 0.1, reduction: 40 },
          ibsMun: { rate: 0, reduction: 40 },
          cbs: { rate: 0.9, reduction: 40 },
        },
      },
    },
    {
      name: "Imposto Seletivo percentual",
      rtc: {
        is_cst: "000",
        is_cclass_trib: "000001",
        is_config: {
          enabled: true,
          cst: "000",
          cClassTrib: "000001",
          rate: 10,
        },
      },
    },
  ];
  for (const model of ["55", "65"] as const) {
    for (const scenario of scenarios) {
      await assertSchemaValid(
        generateDocument(
          1,
          "102",
          simpleConfigs["102"],
          model,
          undefined,
          scenario.rtc,
        ),
        `modelo ${model} / ${scenario.name}`,
      );
    }
  }
});

const contributionCsts = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "49",
  "50",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "70",
  "71",
  "72",
  "73",
  "74",
  "75",
  "98",
  "99",
];

Deno.test("matriz XSD oficial: todos os CST de PIS/COFINS nos modelos 55 e 65", async () => {
  for (const model of ["55", "65"] as const) {
    for (const cst of contributionCsts) {
      const quantityMode = cst === "03";
      const config = quantityMode
        ? { mode: "quantity", quantity: 1, unitRate: 1.25 }
        : {
          mode: "percentage",
          base: 100,
          rate: ["01", "02"].includes(cst) ? 1.65 : 0,
        };
      await assertSchemaValid(
        generateDocument(1, "102", simpleConfigs["102"], model, {
          cst,
          pis: config,
          cofins: quantityMode
            ? { mode: "quantity", quantity: 1, unitRate: 5.75 }
            : { ...config, rate: ["01", "02"].includes(cst) ? 7.6 : 0 },
        }),
        `modelo ${model} / PIS-COFINS CST ${cst}`,
      );
    }
  }
});

Deno.test("matriz XSD oficial: todos os CST nos CRT 2 e 3 e modelos 55 e 65", async () => {
  for (const crt of [2, 3] as const) {
    for (const model of ["55", "65"] as const) {
      for (const code of NORMAL_CST) {
        await assertSchemaValid(
          generateDocument(crt, code, normalConfigs[code], model),
          `CRT ${crt} / modelo ${model} / CST ${code}`,
        );
      }
    }
  }
});
