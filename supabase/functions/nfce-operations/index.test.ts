import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  allocateFiscalAdjustments,
  buildFiscalItems,
  generateNFCeXML,
  normalizeCfopForDestination,
  normalizeRtcConfigForEmission,
  normalizeStoredFiscalRecipient,
  requiresApprovedFiscalRules,
  requiresIcmsUfDest,
  resolveInternalIcmsModalRate,
  resolveInterstateIcmsRate,
  resolveOperationDestination,
  validateFiscalItemsForEmission,
  validateGeneratedFiscalXml,
  validateRecipientForModel,
} from "./index.ts";

const settings = {
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
  regime_tributario: 1,
  rtc_enabled: true,
  rtc_aliquota_ibs_uf: 0.1,
  rtc_aliquota_ibs_mun: 0,
  rtc_aliquota_cbs: 0.9,
};

Deno.test("producao sempre exige regra fiscal aprovada", () => {
  assertEquals(
    requiresApprovedFiscalRules({
      ambiente: "producao",
      require_approved_fiscal_rules: false,
    }),
    true,
  );
  assertEquals(
    requiresApprovedFiscalRules({
      ambiente: "homologacao",
      require_approved_fiscal_rules: true,
    }),
    true,
  );
  assertEquals(
    requiresApprovedFiscalRules({
      ambiente: "homologacao",
      require_approved_fiscal_rules: false,
    }),
    false,
  );
});

function generateFor(productFiscal: Record<string, unknown>) {
  const items = buildFiscalItems(
    [
      {
        product_id: "product-1",
        product_name: "Produto",
        quantity: 1,
        price: 100,
        subtotal: 100,
      },
    ],
    settings,
    new Map([["product-1", {
      fiscal_ncm: "21069090",
      fiscal_cfop: "5102",
      fiscal_csosn: "102",
      fiscal_cst_pis: "07",
      fiscal_cst_cofins: "07",
      fiscal_ibs_cbs_cst: "000",
      fiscal_cclass_trib: "000001",
      ...productFiscal,
    }]]),
  );
  const xml = generateNFCeXML({
    fiscalSettings: settings,
    cupom: {
      chave_acesso: "23260844625108000145650010000000011000000010",
      serie: "1",
      numero: 1,
      data_hora_emissao: "2026-08-03T12:00:00.000Z",
    },
    order: {},
    items,
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 100,
    valorDesconto: 0,
    valorTotal: 100,
    valorTributos: 7.65,
  });
  return { items, xml };
}

Deno.test("gera IBS/CBS integral por item e totaliza o documento", () => {
  const { items, xml } = generateFor({
    fiscal_ibs_cbs_cst: "000",
    fiscal_cclass_trib: "000001",
  });
  assertEquals(items[0].valor_ibs_uf, 0.1);
  assertEquals(items[0].valor_cbs, 0.9);
  assertStringIncludes(
    xml,
    "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>",
  );
  assertStringIncludes(xml, "<vIBSUF>0.10</vIBSUF>");
  assertStringIncludes(xml, "<vCBS>0.90</vCBS>");
  assertStringIncludes(xml, "<IBSCBSTot><vBCIBSCBS>100.00</vBCIBSCBS>");
});

Deno.test("não omite IBS/CBS quando JSON legado não possui enabled", () => {
  const { xml } = generateFor({
    fiscal_ibs_cbs_config: {
      mode: "standard",
      ibsUf: { rate: 0.1 },
      ibsMun: { rate: 0 },
      cbs: { rate: 0.9 },
    },
  });
  assertStringIncludes(
    xml,
    "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>",
  );
  assertStringIncludes(xml, "<vIBSUF>0.10</vIBSUF>");
  assertStringIncludes(xml, "<vCBS>0.90</vCBS>");
});

Deno.test("não omite IBS/CBS quando operação classificada possui mode none legado", () => {
  const rtcConfig = normalizeRtcConfigForEmission(
    {
      mode: "none",
      aliquota_ibs_uf: 0.1,
      aliquota_ibs_mun: 0,
      aliquota_cbs: 0.9,
    },
    "000",
    "000001",
  );
  assertEquals(rtcConfig.enabled, true);
  assertEquals(rtcConfig.mode, "standard");

  const { xml } = generateFor({
    fiscal_ibs_cbs_config: {
      mode: "none",
      aliquota_ibs_uf: 0.1,
      aliquota_ibs_mun: 0,
      aliquota_cbs: 0.9,
    },
  });
  assertStringIncludes(
    xml,
    "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>",
  );
  assertStringIncludes(xml, "<IBSCBSTot>");
});

Deno.test("resolve alíquota interestadual pela origem, destino e origem fiscal", () => {
  assertEquals(resolveInterstateIcmsRate("CE", "SP", 0), 12);
  assertEquals(resolveInterstateIcmsRate("CE", "PR", 0), 12);
  assertEquals(resolveInterstateIcmsRate("SP", "CE", 0), 7);
  assertEquals(resolveInterstateIcmsRate("SP", "CE", 1), 4);
});

Deno.test("aplica a alíquota modal interna vigente do Ceará", () => {
  assertEquals(resolveInternalIcmsModalRate("CE", "2023-12-31"), 18);
  assertEquals(resolveInternalIcmsModalRate("CE", "2024-01-01"), 20);

  const items = buildFiscalItems(
    [{
      product_id: "product-ce",
      product_name: "Produto com reducao",
      quantity: 1,
      price: 100,
    }],
    settings,
    new Map([["product-ce", {
      fiscal_ncm: "21069090",
      fiscal_cfop: "5102",
      fiscal_csosn: "900",
      fiscal_icms_config: { modBC: 3, pRedBC: 63, pICMS: 18 },
      fiscal_cst_pis: "07",
      fiscal_cst_cofins: "07",
      fiscal_ibs_cbs_cst: "000",
      fiscal_cclass_trib: "000001",
    }]]),
    1,
  );
  assertEquals(items[0].icms_config.pICMS, 20);
  const { vBC, vICMS } = items[0].icms_config;
  // A base e o imposto sao calculados pelo motor no momento da serializacao;
  // aqui garantimos que a regra legada nao carregue a modal antiga.
  assertEquals(vBC, undefined);
  assertEquals(vICMS, undefined);
  const xml = generateNFCeXML({
    fiscalSettings: settings,
    cupom: {
      chave_acesso: "23260844625108000145650010000000011000000010",
      serie: "1",
      numero: 1,
      data_hora_emissao: "2026-08-20T12:00:00.000Z",
    },
    order: {},
    items,
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 100,
    valorDesconto: 0,
    valorTotal: 100,
  });
  assertStringIncludes(
    xml,
    "<vBC>37.00</vBC><pRedBC>63.0000</pRedBC><pICMS>20.0000</pICMS><vICMS>7.40</vICMS>",
  );
  // CSOSN 900 não é incompatível por definição com destinatário não
  // contribuinte. A aplicabilidade vem da regra operacional aprovada e seus
  // parâmetros são validados pelo motor de ICMS antes da transmissão.
  validateFiscalItemsForEmission(items, settings, 1, {
    modelCode: "55",
    consumerData: {
      state_registration_indicator: 9,
      final_consumer: true,
    },
  });
  validateFiscalItemsForEmission(items, settings, 1, {
    modelCode: "55",
    consumerData: {
      state_registration_indicator: 1,
      final_consumer: false,
    },
  });
});

Deno.test("NA01-20 dispensa ICMSUFDest para CRT 1 e mantém exigência no regime normal", () => {
  const recipient = {
    state_registration_indicator: 9,
    final_consumer: true,
  };
  assertEquals(requiresIcmsUfDest(1, "55", 2, recipient), false);
  assertEquals(requiresIcmsUfDest(4, "55", 2, recipient), false);
  assertEquals(requiresIcmsUfDest(2, "55", 2, recipient), true);
  assertEquals(requiresIcmsUfDest(3, "55", 2, recipient), true);
  assertEquals(requiresIcmsUfDest(3, "65", 2, recipient), false);
  assertEquals(
    requiresIcmsUfDest(3, "55", 2, {
      ...recipient,
      state_registration_indicator: 1,
    }),
    false,
  );

  const [simpleItem] = buildFiscalItems(
    [{
      product_name: "Venda interestadual Simples",
      quantity: 1,
      price: 100,
      ncm: "21069090",
      cfop: "6102",
      csosn: "102",
    }],
    { ...settings, rtc_enabled: false },
    new Map(),
    2,
  );
  validateFiscalItemsForEmission(
    [simpleItem],
    {
      ...settings,
      rtc_enabled: false,
    },
    2,
    {
      modelCode: "55",
      consumerData: recipient,
    },
  );

  const [normalItem] = buildFiscalItems(
    [{
      product_name: "Venda interestadual Regime Normal",
      quantity: 1,
      price: 100,
      ncm: "21069090",
      cfop: "6102",
      cst_icms: "00",
      fiscal_icms_config: { modBC: 3, pICMS: 12 },
    }],
    {
      ...settings,
      regime_tributario: 3,
      rtc_enabled: false,
    },
    new Map(),
    2,
  );
  assertThrows(
    () =>
      validateFiscalItemsForEmission(
        [normalItem],
        {
          ...settings,
          regime_tributario: 3,
          rtc_enabled: false,
        },
        2,
        {
          modelCode: "55",
          consumerData: recipient,
        },
      ),
    Error,
    "DIFAL/ICMSUFDest deve estar configurado",
  );
});

Deno.test("bloqueia emissão RTC sem CST e cClassTrib em vez de omitir IBS/CBS", () => {
  assertThrows(
    () =>
      buildFiscalItems(
        [{
          product_id: "sem-rtc",
          product_name: "Sem RTC",
          quantity: 1,
          price: 10,
        }],
        settings,
        new Map([["sem-rtc", {
          fiscal_ncm: "21069090",
          fiscal_cfop: "5102",
          fiscal_csosn: "102",
        }]]),
        1,
      ),
    Error,
    "faltam CST IBS/CBS",
  );
});

Deno.test("gera grupos de reducao para bares e restaurantes", () => {
  const { items, xml } = generateFor({
    fiscal_ibs_cbs_cst: "200",
    fiscal_cclass_trib: "200047",
    fiscal_reducao_ibs: 40,
    fiscal_reducao_cbs: 40,
  });
  assertEquals(items[0].valor_ibs_uf, 0.06);
  assertEquals(items[0].valor_cbs, 0.54);
  assertStringIncludes(xml, "<CST>200</CST><cClassTrib>200047</cClassTrib>");
  assertStringIncludes(
    xml,
    "<gRed><pRedAliq>40.0000</pRedAliq><pAliqEfet>0.0600</pAliqEfet></gRed>",
  );
  assertStringIncludes(
    xml,
    "<gRed><pRedAliq>40.0000</pRedAliq><pAliqEfet>0.5400</pAliqEfet></gRed>",
  );
});

Deno.test("classifica CE para PE e usa o CFOP interestadual definido pela regra", () => {
  const consumerData = {
    cpf_cnpj: "19100000000",
    nome: "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO – SEM VALOR FISCAL",
    address: "Rua Teste",
    address_number: "1",
    neighborhood: "Centro",
    city_code: "2611606",
    city: "Recife",
    state: "PE",
    postal_code: "50000000",
    country_code: "1058",
    state_registration_indicator: 9,
    final_consumer: true,
  };
  const destination = resolveOperationDestination(settings, consumerData, "55");
  const items = buildFiscalItems(
    [
      {
        product_id: "product-1",
        product_name: "Produto",
        quantity: 1,
        price: 100,
      },
    ],
    settings,
    new Map([["product-1", {
      fiscal_ncm: "21069090",
      fiscal_cfop: "6102",
      fiscal_csosn: "102",
      fiscal_cst_pis: "07",
      fiscal_cst_cofins: "07",
      fiscal_ibs_cbs_cst: "000",
      fiscal_cclass_trib: "000001",
    }]]),
    destination,
  );
  assertEquals(destination, 2);
  assertEquals(items[0].cfop, "6102");
  const xml = generateNFCeXML({
    fiscalSettings: settings,
    cupom: {
      chave_acesso: "23260844625108000145550010000000011000000010",
      serie: "1",
      numero: 1,
      data_hora_emissao: "2026-08-03T12:00:00.000Z",
    },
    order: {},
    items,
    consumerData,
    modelCode: "55",
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 100,
    valorDesconto: 0,
    valorTotal: 100,
    valorTributos: 7.65,
  });
  assertStringIncludes(xml, "<idDest>2</idDest>");
  assertStringIncludes(xml, "<CFOP>6102</CFOP>");
  assertStringIncludes(
    xml,
    "<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>",
  );
});

Deno.test("mantem operacao na mesma UF como interna", () => {
  assertEquals(
    resolveOperationDestination(
      settings,
      { state: "CE", country_code: "1058" },
      "55",
    ),
    1,
  );
  assertEquals(normalizeCfopForDestination("6102", 1), "5102");
});

Deno.test("gera CSOSN 500 com ICMS-ST retido e ICMS efetivo proporcionais a quantidade", () => {
  const { items, xml } = generateFor({
    fiscal_ncm: "22021000",
    fiscal_cfop: "5405",
    fiscal_csosn: "500",
    fiscal_cest: "0301100",
    fiscal_icms_st_base_ret_unit: 10,
    fiscal_icms_st_aliquota: 20,
    fiscal_icms_substituto_unit: 1.2,
    fiscal_icms_st_ret_unit: 0.8,
    fiscal_icms_efetivo_reducao: 0,
    fiscal_icms_efetivo_aliquota: 20,
  });
  assertEquals(items[0].icms_st_base_retida, 10);
  assertEquals(items[0].icms_st_retido, 0.8);
  assertStringIncludes(xml, "<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN>");
  assertStringIncludes(xml, "<vBCSTRet>10.00</vBCSTRet><pST>20.0000</pST>");
  assertStringIncludes(
    xml,
    "<vICMSSubstituto>1.20</vICMSSubstituto><vICMSSTRet>0.80</vICMSSTRet>",
  );
  assertStringIncludes(
    xml,
    "<vBCEfet>100.00</vBCEfet><pICMSEfet>20.0000</pICMSEfet><vICMSEfet>20.00</vICMSEfet>",
  );
});

Deno.test("usa CFOP proprio de revenda ST nas operacoes interna e interestadual", () => {
  assertEquals(normalizeCfopForDestination("5405", 1), "5405");
  assertEquals(normalizeCfopForDestination("5405", 2), "6404");
  assertEquals(normalizeCfopForDestination("6404", 1), "5405");
  assertEquals(normalizeCfopForDestination("6404", 2), "6404");
});

Deno.test("nao inventa correspondencia de CFOP desconhecida", () => {
  assertThrows(
    () => normalizeCfopForDestination("5949", 2),
    Error,
    "não possui correspondência fiscal aprovada",
  );
});

Deno.test("classifica destinatario fora do Brasil como exterior", () => {
  assertEquals(
    resolveOperationDestination(
      settings,
      { state: "EX", country_code: "2496" },
      "55",
    ),
    3,
  );
  assertEquals(normalizeCfopForDestination("5102", 3), "7102");
});

Deno.test("valida destinatario completo e nao contribuinte para NF-e", () => {
  validateRecipientForModel(
    {
      cpf_cnpj: "19100000000",
      nome: "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO SEM VALOR FISCAL",
      address: "Rua Teste",
      address_number: "1",
      neighborhood: "Centro",
      city_code: "2304400",
      city: "Fortaleza",
      state: "CE",
      postal_code: "60000000",
      state_registration_indicator: 9,
      final_consumer: true,
    },
    settings,
    "55",
  );
});

Deno.test("normaliza destinatario persistido pelo checkout para reenvio fiscal", () => {
  const recipient = normalizeStoredFiscalRecipient({
    name: "Cliente salvo no pedido",
    cpf_cnpj: "19100000000",
    state: "CE",
  });
  assertEquals(recipient?.nome, "Cliente salvo no pedido");
  assertEquals(recipient?.presence_indicator, 1);
});

Deno.test("bloqueia CPF/CNPJ invalido antes de transmitir NF-e", () => {
  assertThrows(
    () =>
      validateRecipientForModel(
        {
          cpf_cnpj: "11111111111",
          nome: "DESTINATARIO TESTE",
          address: "Rua Teste",
          address_number: "1",
          neighborhood: "Centro",
          city_code: "2304400",
          city: "Fortaleza",
          state: "CE",
          postal_code: "60000000",
          state_registration_indicator: 9,
        },
        settings,
        "55",
      ),
    Error,
    "CPF/CNPJ válido",
  );
});

Deno.test("exige IE quando destinatario da NF-e e contribuinte", () => {
  assertThrows(
    () =>
      validateRecipientForModel(
        {
          cpf_cnpj: "44625108000145",
          nome: "DESTINATARIO TESTE",
          address: "Rua Teste",
          address_number: "1",
          neighborhood: "Centro",
          city_code: "2304400",
          city: "Fortaleza",
          state: "CE",
          postal_code: "60000000",
          state_registration_indicator: 1,
        },
        settings,
        "55",
      ),
    Error,
    "inscrição estadual do contribuinte",
  );
});

Deno.test("bloqueia IE preenchida para nao contribuinte", () => {
  assertThrows(
    () =>
      validateRecipientForModel(
        {
          cpf_cnpj: "44625108000145",
          nome: "DESTINATARIO TESTE",
          address: "Rua Teste",
          address_number: "1",
          neighborhood: "Centro",
          city_code: "2304400",
          city: "Fortaleza",
          state: "CE",
          postal_code: "60000000",
          state_registration_indicator: 9,
          state_registration: "123456789",
        },
        settings,
        "55",
      ),
    Error,
    "IE deve ficar vazia",
  );
});

Deno.test("bloqueia operacao interestadual e nao-final em NFC-e", () => {
  assertThrows(
    () => validateRecipientForModel({ state: "SP" }, settings, "65"),
    Error,
    "não pode documentar operação interestadual",
  );
  assertThrows(
    () => validateRecipientForModel({ final_consumer: false }, settings, "65"),
    Error,
    "exclusiva para operação com consumidor final",
  );
});

Deno.test("serializa e valida o indicador de presenca informado", () => {
  const [item] = buildFiscalItems([{
    product_name: "Produto teste",
    quantity: 1,
    price: 10,
    subtotal: 10,
    ncm: "21069090",
    cfop: "5102",
    csosn: "102",
  }], { ...settings, rtc_enabled: false });
  const xml = generateNFCeXML({
    fiscalSettings: { ...settings, rtc_enabled: false },
    cupom: {
      chave_acesso: "23260844625108000145650010000000011000000010",
      serie: 1,
      numero: 1,
      data_hora_emissao: "2026-08-18T12:00:00.000Z",
    },
    order: {},
    items: [item],
    consumerData: { presence_indicator: 4 },
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 10,
    valorDesconto: 0,
    valorTotal: 10,
  });
  assertStringIncludes(xml, "<indPres>4</indPres>");
  assertThrows(
    () => validateRecipientForModel({ presence_indicator: 8 }, settings, "65"),
    Error,
    "Indicador de presença inválido",
  );
});

Deno.test("bloqueia finalidade sem leiaute próprio e ST sem CEST", () => {
  const [item] = buildFiscalItems([{
    product_name: "Produto ST",
    quantity: 1,
    price: 100,
    subtotal: 100,
    ncm: "21069090",
    cfop: "5403",
    csosn: "201",
    operation_type: "return",
    fiscal_icms_config: {
      modBCST: 4,
      vBCST: 120,
      pICMSST: 18,
      vICMSST: 21.6,
      pCredSN: 3,
    },
  }], { ...settings, rtc_enabled: false });
  assertThrows(
    () =>
      validateFiscalItemsForEmission([item], settings, 1, { modelCode: "65" }),
    Error,
    "finalidade 'return'",
  );
  item.operation_type = "sale";
  assertThrows(
    () =>
      validateFiscalItemsForEmission([item], settings, 1, { modelCode: "65" }),
    Error,
    "CEST é obrigatório",
  );
});

Deno.test("rateia frete e desconto nos itens e fecha os totais", () => {
  const baseItems = buildFiscalItems([
    {
      product_name: "A",
      quantity: 1,
      price: 100,
      subtotal: 100,
      ncm: "21069090",
      cfop: "5102",
      csosn: "102",
    },
    {
      product_name: "B",
      quantity: 1,
      price: 50,
      subtotal: 50,
      ncm: "21069090",
      cfop: "5102",
      csosn: "102",
    },
  ], { ...settings, rtc_enabled: false });
  const items = allocateFiscalAdjustments(baseItems, 10, 5);
  assertEquals(items.reduce((sum, item) => sum + item.valor_frete, 0), 10);
  assertEquals(items.reduce((sum, item) => sum + item.valor_desconto, 0), 5);
  const accessKey = "23260844625108000145650010000000011000000010";
  const xml = generateNFCeXML({
    fiscalSettings: { ...settings, rtc_enabled: false },
    cupom: {
      chave_acesso: accessKey,
      serie: 1,
      numero: 1,
      data_hora_emissao: "2026-08-18T12:00:00.000Z",
    },
    order: {},
    items,
    paymentMethod: "pix",
    deliveryFee: 10,
    totalProdutos: 150,
    valorDesconto: 5,
    valorTotal: 155,
  });
  validateGeneratedFiscalXml(xml, {
    accessKey,
    modelCode: "65",
    items,
    totalProdutos: 150,
    deliveryFee: 10,
    valorDesconto: 5,
    valorTotal: 155,
  });
});

Deno.test("pre-validacao bloqueia vNF que ignora IPI", () => {
  const accessKey = "23260844625108000145650010000000011000000010";
  const [item] = buildFiscalItems([{
    product_name: "Produto IPI",
    quantity: 1,
    price: 100,
    subtotal: 100,
    ncm: "21069090",
    cfop: "5102",
    cst_icms: "00",
    fiscal_icms_config: { modBC: 0, pICMS: 18 },
    fiscal_ipi_cst: "50",
    fiscal_ipi_config: { cEnq: "999", rate: 5 },
  }], { ...settings, regime_tributario: 3, rtc_enabled: false });
  const xml = generateNFCeXML({
    fiscalSettings: { ...settings, regime_tributario: 3, rtc_enabled: false },
    cupom: {
      chave_acesso: accessKey,
      serie: 1,
      numero: 1,
      data_hora_emissao: "2026-08-18T12:00:00.000Z",
    },
    order: {},
    items: [item],
    paymentMethod: "pix",
    deliveryFee: 0,
    totalProdutos: 100,
    valorDesconto: 0,
    valorTotal: 100,
  });
  assertThrows(
    () =>
      validateGeneratedFiscalXml(xml, {
        accessKey,
        modelCode: "65",
        items: [item],
        totalProdutos: 100,
        deliveryFee: 0,
        valorDesconto: 0,
        valorTotal: 100,
      }),
    Error,
    "fórmula legal do total não fecha",
  );
});
