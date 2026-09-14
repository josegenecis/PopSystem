import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildIcmsXml,
  calculateIcmsTotals,
  NORMAL_CST,
  normalizeIcmsCode,
  SIMPLES_CSOSN,
} from "./icms-engine.ts";

const own = { modBC: 0, pICMS: 18 };
const reduced = { ...own, pRedBC: 20 };
const st = { modBCST: 4, vBCST: 120, pICMSST: 18, vICMSST: 21.6 };
const retained = { vBCSTRet: 100, pST: 18, vICMSSubstituto: 8, vICMSSTRet: 10 };
const credit = { pCredSN: 3 };

function item(code: string, icms_config: Record<string, number> = {}) {
  return {
    regime_tributario: code.length === 3 ? 1 : 3,
    origem: "0",
    cst_icms: code,
    valor_total: 100,
    icms_config,
  };
}

Deno.test("serializa todos os CSOSNs suportados no grupo correto", () => {
  const configs: Record<string, Record<string, number>> = {
    "101": credit,
    "102": {},
    "103": {},
    "201": { ...st, ...credit },
    "202": st,
    "203": st,
    "300": {},
    "400": {},
    "500": retained,
    "900": own,
  };
  const groups: Record<string, string> = {
    "101": "ICMSSN101",
    "102": "ICMSSN102",
    "103": "ICMSSN102",
    "201": "ICMSSN201",
    "202": "ICMSSN202",
    "203": "ICMSSN202",
    "300": "ICMSSN102",
    "400": "ICMSSN102",
    "500": "ICMSSN500",
    "900": "ICMSSN900",
  };
  for (const code of SIMPLES_CSOSN) {
    const xml = buildIcmsXml(item(code, configs[code]), 1);
    assertStringIncludes(xml, `<${groups[code]}>`);
    assertStringIncludes(xml, `<CSOSN>${code}</CSOSN>`);
  }
});

Deno.test("serializa reducao do CSOSN 900 na ordem exigida pelo schema", () => {
  const xml = buildIcmsXml(item("900", { ...own, pRedBC: 63 }), 1);
  assertStringIncludes(
    xml,
    "<ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>0</modBC><vBC>37.00</vBC><pRedBC>63.0000</pRedBC><pICMS>18.0000</pICMS><vICMS>6.66</vICMS>",
  );
  assertEquals(
    calculateIcmsTotals([
      item("900", { ...own, pRedBC: 63 }),
    ]),
    {
      vBC: 37,
      vICMS: 6.66,
      vICMSDeson: 0,
      vFCP: 0,
      vBCST: 0,
      vST: 0,
      vFCPST: 0,
      vFCPSTRet: 0,
    },
  );
});

Deno.test("serializa todos os CSTs do regime normal no grupo correto", () => {
  const configs: Record<string, Record<string, number>> = {
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
  for (const code of NORMAL_CST) {
    const xml = buildIcmsXml(item(code, configs[code]), 3);
    assertStringIncludes(
      xml,
      `<ICMS${code === "40" || code === "41" || code === "50" ? "40" : code}>`,
    );
    assertStringIncludes(xml, `<CST>${code}</CST>`);
  }
});

Deno.test("calcula credito do Simples e diferimento sem aceitar valor inventado", () => {
  assertStringIncludes(
    buildIcmsXml(item("101", credit), 1),
    "<vCredICMSSN>3.00</vCredICMSSN>",
  );
  const deferred = buildIcmsXml(item("51", { ...own, pDif: 50 }), 3);
  assertStringIncludes(deferred, "<vICMSOp>18.00</vICMSOp>");
  assertStringIncludes(deferred, "<vICMSDif>9.00</vICMSDif>");
  assertStringIncludes(deferred, "<vICMS>9.00</vICMS>");
});

Deno.test("bloqueia codigo incompatível com o CRT e configuração incompleta", () => {
  assertThrows(() => buildIcmsXml(item("00", own), 1), Error, "CSOSN");
  assertThrows(() => buildIcmsXml(item("101"), 1), Error, "pCredSN");
  assertThrows(() => buildIcmsXml(item("10", own), 3), Error, "modBCST");
  assertThrows(
    () => buildIcmsXml({ ...item("00", own), origem: "9" }, 3),
    Error,
    "Origem",
  );
});

Deno.test("normaliza CST por regime e soma totais ICMS", () => {
  assertEquals(normalizeIcmsCode(1, "101"), "101");
  assertEquals(normalizeIcmsCode(3, "0"), "00");
  assertEquals(calculateIcmsTotals([item("00", own)]), {
    vBC: 100,
    vICMS: 18,
    vICMSDeson: 0,
    vFCP: 0,
    vBCST: 0,
    vST: 0,
    vFCPST: 0,
    vFCPSTRet: 0,
  });
});

Deno.test("totaliza ICMS proprio sem misturar imposto retido do CSOSN 500", () => {
  assertEquals(
    calculateIcmsTotals([
      item("900", { modBC: 0, pICMS: 20, pRedBC: 63 }),
      item("500", {
        pICMS: 20,
        vBCSTRet: 100,
        pST: 18,
        vICMSSubstituto: 12,
        vICMSSTRet: 6,
        pRedBCEfet: 0,
        vBCEfet: 100,
        pICMSEfet: 18,
        vICMSEfet: 18,
      }),
      item("900", { modBC: 0, pICMS: 20 }),
    ]),
    {
      vBC: 137,
      vICMS: 27.4,
      vICMSDeson: 0,
      vFCP: 0,
      vBCST: 0,
      vST: 0,
      vFCPST: 0,
      vFCPSTRet: 0,
    },
  );
});
