import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadCertificateFromBase64,
  validateCertificate,
} from "./certificate-utils.ts";
import { SefazClient } from "./sefaz-client.ts";
import { getSefazEndpoint } from "./sefaz-endpoints.ts";
import { getQRCodeBaseUrl } from "./qrcode-generator.ts";
import { resolveStoreUserId } from "../_shared/multi-store.ts";
import {
  buildIcmsXml as buildIcmsGroupXml,
  calculateIcmsTotals,
  NORMAL_CST,
  normalizeIcmsCode,
  SIMPLES_CSOSN,
  validateIcmsItem,
} from "./icms-engine.ts";
import {
  buildRtcItemXml,
  buildRtcTotalsXml,
  validateRtcItem,
} from "./rtc-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-diagnostic-key",
};

type Ambiente = "producao" | "homologacao";

// Este emissor atende documentos de venda. As demais finalidades possuem
// regras próprias de ide, referenciamento, totais e devolução de tributos e
// não podem reutilizar silenciosamente o XML de uma venda normal.
const SUPPORTED_OPERATION_TYPES = new Set(["sale"]);
const VALID_PRESENCE_INDICATORS = new Set([0, 1, 2, 3, 4, 5, 9]);
const ICMS_ST_CODES_REQUIRING_CEST = new Set([
  "201",
  "202",
  "203",
  "500",
  "10",
  "30",
  "60",
  "70",
]);

const NFE_TIMEZONES: Partial<Record<string, string>> = {
  AC: "America/Rio_Branco",
  AM: "America/Manaus",
  RR: "America/Boa_Vista",
  RO: "America/Porto_Velho",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
};
const MUNICIPALITY_CODE_OVERRIDES: Record<string, string> = {
  "CE|FORTALEZA": "2304400",
};

interface NFCeData {
  operation:
    | "emitir"
    | "retomar_pendente"
    | "reenviar_rejeitado"
    | "consultar"
    | "cancelar"
    | "download_xml"
    | "testar_conexao"
    | "validar_config"
    | "validar_pre_emissao"
    | "politica_emissao"
    | "diagnosticar_cadastro_email";
  order_id?: string;
  cupom_id?: string;
  model_code?: "55" | "65";
  consumer_data?: {
    nome?: string;
    cpf_cnpj?: string;
    email?: string;
    state_registration?: string;
    state_registration_indicator?: number;
    address?: string;
    address_number?: string;
    address_complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    city_code?: string;
    country_code?: string;
    country_name?: string;
    foreign_id?: string;
    final_consumer?: boolean;
    presence_indicator?: number;
  };
  observacoes?: string;
  motivo?: string;
  items?: any[];
  delivery_fee?: number;
  discount?: number;
  _storeId?: string;
}

export async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const requestData: NFCeData = await req.json();

    if (requestData.operation === "diagnosticar_cadastro_email") {
      return await diagnosticarCadastroPorEmail(req, supabase, requestData);
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Authorization header is required");

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Invalid authorization token");
    const storeUserId = await resolveStoreUserId(
      supabase,
      user.id,
      requestData._storeId,
    );

    switch (requestData.operation) {
      case "emitir":
        return await emitirNFCe(supabase, storeUserId, requestData);
      case "retomar_pendente":
        return await retomarDocumentoPendente(
          supabase,
          storeUserId,
          required(requestData.cupom_id, "cupom_id"),
        );
      case "reenviar_rejeitado":
        return await reenviarDocumentoRejeitado(
          supabase,
          storeUserId,
          required(requestData.cupom_id, "cupom_id"),
        );
      case "consultar":
        return await consultarNFCe(
          supabase,
          storeUserId,
          required(requestData.cupom_id, "cupom_id"),
        );
      case "cancelar":
        return await cancelarNFCe(
          supabase,
          storeUserId,
          required(requestData.cupom_id, "cupom_id"),
          requestData.motivo || "Cancelamento solicitado pelo usuario",
        );
      case "download_xml":
        return await downloadXML(
          supabase,
          storeUserId,
          required(requestData.cupom_id, "cupom_id"),
        );
      case "testar_conexao":
        return await testarConexaoSefaz(supabase, storeUserId);
      case "validar_config":
        return await validarConfiguracaoFiscal(supabase, storeUserId);
      case "validar_pre_emissao":
        return await validarPreEmissao(supabase, storeUserId, requestData);
      case "politica_emissao":
        return await obterPoliticaEmissao(
          supabase,
          storeUserId,
          requestData.model_code,
        );
      default:
        throw new Error("Operacao nao suportada");
    }
  } catch (error) {
    console.error("Error in nfce-operations:", error);
    return json(
      { error: getErrorMessage(error) || "Erro interno do servidor" },
      400,
    );
  }
}

async function validarPreEmissao(
  supabase: any,
  userId: string,
  data: NFCeData,
) {
  const modelCode: "55" | "65" = data.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(
    supabase,
    userId,
    modelCode === "65",
  );
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (!modelSettings?.enabled) {
    throw new Error(
      `${
        modelCode === "55" ? "NF-e modelo 55" : "NFC-e modelo 65"
      } não está habilitada nas Configurações fiscais`,
    );
  }

  fiscalSettings.ambiente = modelSettings.environment;
  fiscalSettings.nfce_serie = modelSettings.series;
  fiscalSettings.nfce_numero_atual = modelSettings.next_number;
  fiscalSettings.operation_nature =
    modelSettings.operation_nature || "Venda de mercadoria";
  validateFiscalSettingsForEmission(fiscalSettings, modelCode);
  validateRecipientForModel(data.consumer_data, fiscalSettings, modelCode);

  const orderItems = normalizeOrderItems(data.items);
  if (orderItems.length === 0) {
    throw new Error("Venda sem itens para validação fiscal");
  }

  const productIds = Array.from(
    new Set(
      orderItems
        .map((item) => String(item.product_id || "").trim())
        .filter(Boolean),
    ),
  );
  const productFiscalById = new Map<string, any>();
  if (productIds.length > 0) {
    const { data: productFiscalRows, error: productFiscalError } =
      await supabase
        .from("products")
        .select(
          "id,internal_code,fiscal_default_operation_id,fiscal_ncm,fiscal_cfop,fiscal_csosn,fiscal_icms_cst,fiscal_icms_config,fiscal_cst_pis,fiscal_cst_cofins,fiscal_origem,fiscal_cest,fiscal_beneficio,fiscal_observacao,fiscal_ibs_cbs_cst,fiscal_cclass_trib,fiscal_ibs_cbs_config,fiscal_is_cst,fiscal_is_cclass_trib,fiscal_is_config,fiscal_reducao_ibs,fiscal_reducao_cbs,fiscal_icms_st_base_ret_unit,fiscal_icms_st_aliquota,fiscal_icms_substituto_unit,fiscal_icms_st_ret_unit,fiscal_icms_efetivo_reducao,fiscal_icms_efetivo_aliquota",
        )
        .in("id", productIds)
        .eq("user_id", userId);
    if (productFiscalError) {
      throw new Error(
        `Erro ao carregar tributação dos produtos: ${productFiscalError.message}`,
      );
    }
    for (const row of productFiscalRows || []) {
      productFiscalById.set(String(row.id), row);
    }
  }

  const operationDestination = resolveOperationDestination(
    fiscalSettings,
    data.consumer_data,
    modelCode,
  );
  if (operationDestination === 3) {
    throw new Error(
      "Operação com destino ao exterior bloqueada: complete a homologação fiscal de exportação antes de transmitir.",
    );
  }

  const resolvedOrderItems = await applyApprovedFiscalRules(
    supabase,
    userId,
    modelCode,
    fiscalSettings,
    data.consumer_data,
    operationDestination,
    orderItems,
    productFiscalById,
  );
  const builtFiscalItems = buildFiscalItems(
    resolvedOrderItems,
    fiscalSettings,
    productFiscalById,
    operationDestination,
  );
  const fiscalItems = allocateFiscalAdjustments(
    builtFiscalItems,
    money(data.delivery_fee || 0),
    money(data.discount || 0),
  );
  validateFiscalItemsForEmission(
    fiscalItems,
    fiscalSettings,
    operationDestination,
    { modelCode, consumerData: data.consumer_data },
  );

  return json({
    success: true,
    model_code: modelCode,
    operation_destination: operationDestination,
    item_count: fiscalItems.length,
    message: "Venda fiscal validada antes do registro",
  });
}

async function obterPoliticaEmissao(
  supabase: any,
  userId: string,
  requestedModel?: "55" | "65",
) {
  const modelCode = requestedModel === "55" ? "55" : "65";
  const { data: model, error: modelError } = await supabase
    .from("fiscal_document_models")
    .select("enabled,automatic_emission,model_code,environment")
    .eq("user_id", userId)
    .eq("model_code", modelCode)
    .maybeSingle();

  if (modelError) {
    throw new Error(
      `Erro ao consultar a política fiscal: ${modelError.message}`,
    );
  }

  if (model) {
    return json({
      success: true,
      enabled:
        model.enabled === true &&
        (modelCode === "55" || model.automatic_emission === true),
      model_code: modelCode,
      environment: model.environment || null,
      source: "fiscal_document_models",
    });
  }

  if (modelCode === "55") {
    return json({
      success: true,
      enabled: false,
      model_code: "55",
      environment: null,
      source: "not_configured",
    });
  }
  // Compatibilidade com contas que ainda não possuem a linha do modelo 65.
  const { data: legacy, error: legacyError } = await supabase
    .from("fiscal_settings")
    .select("ativo,ambiente")
    .eq("user_id", userId)
    .maybeSingle();

  if (legacyError) {
    throw new Error(
      `Erro ao consultar a configuração fiscal: ${legacyError.message}`,
    );
  }

  return json({
    success: true,
    enabled: legacy?.ativo === true,
    model_code: "65",
    environment: legacy?.ambiente || null,
    source: legacy ? "fiscal_settings" : "not_configured",
  });
}

if (import.meta.main) serve(handleRequest);

async function emitirNFCe(supabase: any, userId: string, data: NFCeData) {
  const modelCode: "55" | "65" = data.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(
    supabase,
    userId,
    modelCode === "65",
  );
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (!modelSettings?.enabled) {
    throw new Error(
      `${
        modelCode === "55" ? "NF-e modelo 55" : "NFC-e modelo 65"
      } não está habilitada nas Configurações fiscais`,
    );
  }
  fiscalSettings.ambiente = modelSettings.environment;
  fiscalSettings.nfce_serie = modelSettings.series;
  fiscalSettings.nfce_numero_atual = modelSettings.next_number;
  fiscalSettings.operation_nature =
    modelSettings.operation_nature || "Venda de mercadoria";
  validateFiscalSettingsForEmission(fiscalSettings, modelCode);
  validateRecipientForModel(data.consumer_data, fiscalSettings, modelCode);
  const { certInfo, sefazClient } = loadSefazClient(fiscalSettings);

  try {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", required(data.order_id, "order_id"))
      .eq("user_id", userId)
      .single();
    if (orderError || !order) throw new Error("Pedido nao encontrado");

    // Emissao fiscal precisa ser idempotente por venda e modelo. Se a chamada
    // anterior caiu depois de reservar a numeracao, retomamos o mesmo documento
    // em vez de criar outra NF-e/NFC-e para o mesmo pedido.
    const { data: existingDocuments, error: existingDocumentError } =
      await supabase
        .from("nfce_cupons")
        .select("*")
        .eq("user_id", userId)
        .eq("order_id", order.id)
        .eq("model_code", modelCode)
        .in("status", ["pendente", "autorizado", "rejeitado"])
        .order("created_at", { ascending: false })
        .limit(1);
    if (existingDocumentError) {
      throw new Error(
        `Erro ao verificar documento fiscal da venda: ${existingDocumentError.message}`,
      );
    }

    const existingDocument = existingDocuments?.[0];
    if (existingDocument?.status === "autorizado") {
      return json({
        success: true,
        cupom_id: existingDocument.id,
        numero: existingDocument.numero,
        serie: existingDocument.serie,
        chave_acesso: existingDocument.chave_acesso,
        qr_code_url: existingDocument.qr_code_url || "",
        model_code: modelCode,
        ambiente: fiscalSettings.ambiente,
        status: "autorizado",
        protocolo: existingDocument.protocolo_autorizacao,
        recovered: true,
      });
    }
    if (existingDocument?.status === "pendente") {
      return await retomarDocumentoPendente(
        supabase,
        userId,
        existingDocument.id,
      );
    }
    if (existingDocument?.status === "rejeitado") {
      return json(
        {
          success: false,
          cupom_id: existingDocument.id,
          numero: existingDocument.numero,
          serie: existingDocument.serie,
          chave_acesso: existingDocument.chave_acesso,
          model_code: modelCode,
          ambiente: fiscalSettings.ambiente,
          status: "rejeitado",
          motivo:
            existingDocument.motivo_rejeicao ||
            "Documento rejeitado pela SEFAZ",
          error:
            "Esta venda ja possui um documento rejeitado. Corrija os dados e use Reenviar nota.",
        },
        409,
      );
    }

    const orderItems = normalizeOrderItems(order.items);
    if (orderItems.length === 0) {
      throw new Error("Pedido sem itens para emissao fiscal");
    }

    const productIds = Array.from(
      new Set(
        orderItems
          .map((item) => String(item.product_id || "").trim())
          .filter(Boolean),
      ),
    );
    const productFiscalById = new Map<string, any>();
    if (productIds.length > 0) {
      const { data: productFiscalRows, error: productFiscalError } =
        await supabase
          .from("products")
          .select(
            "id,internal_code,fiscal_default_operation_id,fiscal_ncm,fiscal_cfop,fiscal_csosn,fiscal_icms_cst,fiscal_icms_config,fiscal_cst_pis,fiscal_cst_cofins,fiscal_origem,fiscal_cest,fiscal_beneficio,fiscal_observacao,fiscal_ibs_cbs_cst,fiscal_cclass_trib,fiscal_ibs_cbs_config,fiscal_is_cst,fiscal_is_cclass_trib,fiscal_is_config,fiscal_reducao_ibs,fiscal_reducao_cbs,fiscal_icms_st_base_ret_unit,fiscal_icms_st_aliquota,fiscal_icms_substituto_unit,fiscal_icms_st_ret_unit,fiscal_icms_efetivo_reducao,fiscal_icms_efetivo_aliquota",
          )
          .in("id", productIds)
          .eq("user_id", userId);
      if (productFiscalError) {
        throw new Error(
          `Erro ao carregar tributacao dos produtos: ${productFiscalError.message}`,
        );
      }
      for (const row of productFiscalRows || []) {
        productFiscalById.set(String(row.id), row);
      }
    }

    const numeroNFCe = await getNextFiscalDocumentNumber(
      supabase,
      userId,
      modelCode,
    );
    const dataEmissao = new Date();
    const chaveAcesso = await generateAccessKey(
      supabase,
      fiscalSettings,
      numeroNFCe,
      dataEmissao,
      modelCode,
    );
    const operationDestination = resolveOperationDestination(
      fiscalSettings,
      data.consumer_data,
      modelCode,
    );
    if (operationDestination === 3) {
      throw new Error(
        "Operação com destino ao exterior bloqueada: complete a homologação fiscal de exportação (país, idEstrangeiro, endereço e tributação) antes de transmitir. O sistema não emitirá uma NF-e internacional com dados incompletos.",
      );
    }
    const resolvedOrderItems = await applyApprovedFiscalRules(
      supabase,
      userId,
      modelCode,
      fiscalSettings,
      data.consumer_data,
      operationDestination,
      orderItems,
      productFiscalById,
    );
    const builtFiscalItems = buildFiscalItems(
      resolvedOrderItems,
      fiscalSettings,
      productFiscalById,
      operationDestination,
    );
    const deliveryFee = money(order.delivery_fee || 0);
    const valorDesconto = money(order.discount || 0);
    const fiscalItems = allocateFiscalAdjustments(
      builtFiscalItems,
      deliveryFee,
      valorDesconto,
    );
    validateFiscalItemsForEmission(
      fiscalItems,
      fiscalSettings,
      operationDestination,
      { modelCode, consumerData: data.consumer_data },
    );
    const totalProdutos = money(
      fiscalItems.reduce((sum, item) => sum + item.valor_total, 0),
    );
    const valorTotal = money(
      order.total || totalProdutos + deliveryFee - valorDesconto,
    );
    const valorTributos = await applyIbptApproximateTaxes(
      fiscalItems,
      fiscalSettings,
    );

    const { data: cupom, error: cupomError } = await supabase
      .from("nfce_cupons")
      .insert([
        {
          user_id: userId,
          order_id: order.id,
          numero: numeroNFCe,
          serie: fiscalSettings.nfce_serie,
          chave_acesso: chaveAcesso,
          valor_total: valorTotal,
          valor_desconto: valorDesconto,
          valor_tributos: valorTributos,
          consumidor_nome: data.consumer_data?.nome || null,
          consumidor_cpf_cnpj: onlyDigits(data.consumer_data?.cpf_cnpj) || null,
          model_code: modelCode,
          status: "pendente",
          contingencia: false,
          data_hora_emissao: dataEmissao.toISOString(),
        },
      ])
      .select()
      .single();
    if (cupomError) {
      throw new Error(`Erro ao criar cupom: ${cupomError.message}`);
    }

    const items = fiscalItems.map((item) => ({ ...item, cupom_id: cupom.id }));
    const { error: itemsError } = await supabase
      .from("nfce_items")
      .insert(items);
    if (itemsError) {
      // Nenhum XML foi gerado ou transmitido neste ponto. Removemos apenas o
      // rascunho incompleto para que uma nova tentativa não fique presa para
      // sempre em "pendente". A numeração reservada continua consumida, como
      // exige a rastreabilidade fiscal, evitando qualquer reutilização.
      await supabase.from("nfce_items").delete().eq("cupom_id", cupom.id);
      await supabase
        .from("nfce_cupons")
        .delete()
        .eq("id", cupom.id)
        .eq("user_id", userId);
      throw new Error(`Erro ao criar itens do cupom: ${itemsError.message}`);
    }

    const xmlContent = generateNFCeXML({
      fiscalSettings,
      cupom,
      order,
      items,
      consumerData: data.consumer_data,
      observacoes: data.observacoes,
      paymentMethod: order.payment_method,
      deliveryFee,
      totalProdutos,
      valorDesconto,
      valorTotal,
      valorTributos,
      modelCode,
    });
    validateGeneratedFiscalXml(xmlContent, {
      accessKey: chaveAcesso,
      modelCode,
      items,
      totalProdutos,
      deliveryFee,
      valorDesconto,
      valorTotal,
    });

    const transmissionResult = await sefazClient.enviarNFCe(
      xmlContent,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      modelCode === "65"
        ? {
            chaveAcesso,
            dataEmissao: cupom.data_hora_emissao,
            valorTotal,
            cpfCnpjConsumidor: data.consumer_data?.cpf_cnpj,
            cscId: fiscalSettings.csc_id,
            cscToken: fiscalSettings.csc_token,
          }
        : undefined,
      modelCode,
    );

    const authorized =
      transmissionResult.success &&
      ["100", "150"].includes(transmissionResult.cStat);
    const communicationUncertain = transmissionResult.cStat === "999";
    const qrCodeUrl = transmissionResult.qrCodeUrl || "";

    const updateData: any = {
      xml_content: transmissionResult.xmlEnviado || xmlContent,
      // Falha/timeout de rede nao e rejeicao fiscal. Mantemos pendente para
      // consultar a mesma chave antes de qualquer retransmissao.
      status: authorized
        ? "autorizado"
        : communicationUncertain
          ? "pendente"
          : "rejeitado",
      motivo_rejeicao: authorized
        ? null
        : `${transmissionResult.cStat} - ${transmissionResult.xMotivo}`,
      updated_at: new Date().toISOString(),
    };
    if (authorized) {
      updateData.protocolo_autorizacao = transmissionResult.protocolo;
      updateData.data_hora_autorizacao = new Date().toISOString();
      updateData.xml_autorizado = transmissionResult.xmlRetorno;
      try {
        updateData.xml_processado = buildProcessedNFeXml(
          transmissionResult.xmlEnviado || xmlContent,
          transmissionResult.xmlRetorno,
        );
      } catch (processedXmlError) {
        // Nunca perde uma autorizacao valida por falha de composicao local.
        // O download tentara reconstruir novamente usando os XMLs preservados.
        console.error(
          "Falha ao montar nfeProc apos autorizacao:",
          processedXmlError,
        );
      }
      updateData.qr_code_url = qrCodeUrl;
    }

    await supabase.from("nfce_cupons").update(updateData).eq("id", cupom.id);
    await supabase.from("nfce_transmissions").insert([
      {
        cupom_id: cupom.id,
        tipo_operacao: "emissao",
        xml_enviado: transmissionResult.xmlEnviado || xmlContent,
        xml_retorno: transmissionResult.xmlRetorno,
        codigo_status: transmissionResult.cStat,
        motivo: transmissionResult.xMotivo,
        protocolo: transmissionResult.protocolo,
        sucesso: authorized,
      },
    ]);

    return json({
      success: authorized,
      cupom_id: cupom.id,
      numero: numeroNFCe,
      serie: fiscalSettings.nfce_serie,
      chave_acesso: chaveAcesso,
      qr_code_url: qrCodeUrl,
      model_code: modelCode,
      xml_content: transmissionResult.xmlEnviado || xmlContent,
      ambiente: fiscalSettings.ambiente,
      status: updateData.status,
      protocolo: transmissionResult.protocolo,
      motivo: transmissionResult.xMotivo,
      certificado_cnpj: certInfo.cnpj,
    });
  } finally {
    sefazClient.close();
  }
}

async function consultarNFCe(supabase: any, userId: string, cupomId: string) {
  const { data: cupom, error: cupomError } = await supabase
    .from("nfce_cupons")
    .select("*")
    .eq("id", cupomId)
    .eq("user_id", userId)
    .single();
  if (cupomError || !cupom) throw new Error("Cupom nao encontrado");

  // Todo documento pendente e retomado de forma segura. A retomada consulta a
  // chave na SEFAZ primeiro e so retransmite quando ela ainda nao foi autorizada,
  // sempre preservando chave, numero e serie.
  if (cupom.status === "pendente") {
    return await retomarDocumentoPendente(supabase, userId, cupomId);
  }

  const modelCode: "55" | "65" = cupom.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(supabase, userId, false);
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (modelSettings?.environment) {
    fiscalSettings.ambiente = modelSettings.environment;
  }
  const { sefazClient } = loadSefazClient(fiscalSettings);
  try {
    const result = await sefazClient.consultarNFCe(
      cupom.chave_acesso,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      modelCode,
    );

    const status = ["100", "150"].includes(result.cStat)
      ? "autorizado"
      : cupom.status;
    await supabase
      .from("nfce_cupons")
      .update({
        status,
        protocolo_autorizacao: result.protocolo || cupom.protocolo_autorizacao,
        motivo_rejeicao: result.success
          ? null
          : `${result.cStat} - ${result.xMotivo}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cupomId);

    await supabase.from("nfce_transmissions").insert([
      {
        cupom_id: cupomId,
        tipo_operacao: "consulta",
        xml_retorno: result.xmlRetorno,
        codigo_status: result.cStat,
        motivo: result.xMotivo,
        protocolo: result.protocolo,
        sucesso: result.success,
      },
    ]);

    return json({
      success: result.success,
      status,
      protocolo: result.protocolo,
      motivo: result.xMotivo,
    });
  } finally {
    sefazClient.close();
  }
}

async function retomarDocumentoPendente(
  supabase: any,
  userId: string,
  cupomId: string,
) {
  const { data: cupom, error: cupomError } = await supabase
    .from("nfce_cupons")
    .select("*")
    .eq("id", cupomId)
    .eq("user_id", userId)
    .single();
  if (cupomError || !cupom) throw new Error("Documento fiscal não encontrado");
  if (cupom.status !== "pendente") {
    throw new Error(
      "Somente documentos pendentes podem ter a emissão retomada",
    );
  }
  if (!cupom.order_id || !cupom.chave_acesso) {
    throw new Error(
      "Documento pendente sem pedido ou chave de acesso preservada",
    );
  }

  const modelCode: "55" | "65" = cupom.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(supabase, userId, false);
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (!modelSettings?.enabled) {
    throw new Error(
      `${
        modelCode === "55" ? "NF-e modelo 55" : "NFC-e modelo 65"
      } não está habilitada nas Configurações fiscais`,
    );
  }
  fiscalSettings.ambiente = modelSettings.environment;
  fiscalSettings.nfce_serie = cupom.serie;
  fiscalSettings.nfce_numero_atual = cupom.numero;
  fiscalSettings.operation_nature =
    modelSettings.operation_nature || "Venda de mercadoria";
  validateFiscalSettingsForEmission(fiscalSettings, modelCode);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", cupom.order_id)
    .eq("user_id", userId)
    .single();
  if (orderError || !order) {
    throw new Error(
      "Pedido relacionado ao documento pendente não foi encontrado",
    );
  }

  const variations = normalizeRecord(order.variations);
  const consumerData = normalizeStoredFiscalRecipient(
    variations.fiscal_recipient,
  );
  validateRecipientForModel(consumerData, fiscalSettings, modelCode);

  const orderItems = normalizeOrderItems(order.items);
  if (orderItems.length === 0) {
    throw new Error("Pedido sem itens para retomar a emissão fiscal");
  }

  const productIds = Array.from(
    new Set(
      orderItems
        .map((item) => String(item.product_id || "").trim())
        .filter(Boolean),
    ),
  );
  const productFiscalById = new Map<string, any>();
  if (productIds.length > 0) {
    const { data: productFiscalRows, error: productFiscalError } =
      await supabase
        .from("products")
        .select(
          "id,internal_code,fiscal_default_operation_id,fiscal_ncm,fiscal_cfop,fiscal_csosn,fiscal_icms_cst,fiscal_icms_config,fiscal_cst_pis,fiscal_cst_cofins,fiscal_origem,fiscal_cest,fiscal_beneficio,fiscal_observacao,fiscal_ibs_cbs_cst,fiscal_cclass_trib,fiscal_ibs_cbs_config,fiscal_is_cst,fiscal_is_cclass_trib,fiscal_is_config,fiscal_reducao_ibs,fiscal_reducao_cbs,fiscal_icms_st_base_ret_unit,fiscal_icms_st_aliquota,fiscal_icms_substituto_unit,fiscal_icms_st_ret_unit,fiscal_icms_efetivo_reducao,fiscal_icms_efetivo_aliquota",
        )
        .in("id", productIds)
        .eq("user_id", userId);
    if (productFiscalError) {
      throw new Error(
        `Erro ao carregar tributação dos produtos: ${productFiscalError.message}`,
      );
    }
    for (const row of productFiscalRows || []) {
      productFiscalById.set(String(row.id), row);
    }
  }

  const operationDestination = resolveOperationDestination(
    fiscalSettings,
    consumerData,
    modelCode,
  );
  if (operationDestination === 3) {
    throw new Error(
      "Operação com destino ao exterior bloqueada: complete a homologação fiscal de exportação antes de transmitir.",
    );
  }
  const resolvedOrderItems = await applyApprovedFiscalRules(
    supabase,
    userId,
    modelCode,
    fiscalSettings,
    consumerData,
    operationDestination,
    orderItems,
    productFiscalById,
  );
  const builtFiscalItems = buildFiscalItems(
    resolvedOrderItems,
    fiscalSettings,
    productFiscalById,
    operationDestination,
  );
  const deliveryFee = money(order.delivery_fee || 0);
  const valorDesconto = money(order.discount || 0);
  const fiscalItems = allocateFiscalAdjustments(
    builtFiscalItems,
    deliveryFee,
    valorDesconto,
  );
  validateFiscalItemsForEmission(
    fiscalItems,
    fiscalSettings,
    operationDestination,
    { modelCode, consumerData },
  );
  const totalProdutos = money(
    fiscalItems.reduce((sum, item) => sum + item.valor_total, 0),
  );
  const valorTotal = money(
    order.total || totalProdutos + deliveryFee - valorDesconto,
  );
  const valorTributos = await applyIbptApproximateTaxes(
    fiscalItems,
    fiscalSettings,
  );
  const items = fiscalItems.map((item) => ({ ...item, cupom_id: cupom.id }));

  // Um registro pendente pode ter sido criado antes de qualquer envio (por
  // exemplo, quando a gravação dos itens falhou) ou pode ter sido transmitido
  // e perdido a resposta. Só consultamos a SEFAZ no segundo caso. Isso evita
  // uma consulta demorada e, principalmente, uma retransmissão cega.
  const { data: transmissionRows, error: transmissionLookupError } =
    await supabase
      .from("nfce_transmissions")
      .select("xml_enviado,codigo_status,sucesso,created_at")
      .eq("cupom_id", cupom.id)
      .in("tipo_operacao", ["emissao", "reenvio"])
      .order("created_at", { ascending: false })
      .limit(1);
  if (transmissionLookupError) {
    throw new Error(
      `Erro ao verificar a transmissão anterior: ${transmissionLookupError.message}`,
    );
  }
  const previousTransmission = transmissionRows?.[0] || null;
  const previousXml = String(
    cupom.xml_content || previousTransmission?.xml_enviado || "",
  ).trim();
  // A presenca do XML assinado e a evidencia necessaria para considerar que
  // houve transmissao. Um registro incompleto de auditoria sem XML nao pode
  // forcar consulta/reenvio de conteudo vazio.
  const wasPreviouslyTransmitted = Boolean(previousXml);

  const { certInfo, sefazClient } = loadSefazClient(fiscalSettings);
  try {
    if (wasPreviouslyTransmitted) {
      // Se a resposta original se perdeu depois da autorização, a consulta
      // encontra o documento sem criar uma segunda nota para a mesma venda.
      const consultation = await sefazClient.consultarNFCe(
        cupom.chave_acesso,
        fiscalSettings.endereco_uf,
        fiscalSettings.ambiente as Ambiente,
        modelCode,
      );
      await supabase.from("nfce_transmissions").insert([
        {
          cupom_id: cupom.id,
          tipo_operacao: "consulta",
          xml_retorno: consultation.xmlRetorno,
          codigo_status: consultation.cStat,
          motivo: consultation.xMotivo,
          protocolo: consultation.protocolo,
          sucesso: ["100", "150"].includes(consultation.cStat),
        },
      ]);

      if (["100", "150"].includes(consultation.cStat)) {
        await supabase
          .from("nfce_cupons")
          .update({
            status: "autorizado",
            protocolo_autorizacao:
              consultation.protocolo || cupom.protocolo_autorizacao,
            motivo_rejeicao: null,
            data_hora_autorizacao:
              cupom.data_hora_autorizacao || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", cupomId)
          .eq("user_id", userId);
        return json({
          success: true,
          recovered: true,
          status: "autorizado",
          model_code: modelCode,
          motivo: "Documento já constava como autorizado na SEFAZ.",
        });
      }

      // Falha de rede deixa o estado desconhecido. Nunca retransmitimos nessa
      // situação; uma nova consulta poderá confirmar a autorização depois.
      if (consultation.cStat === "999") {
        await supabase
          .from("nfce_cupons")
          .update({
            status: "pendente",
            motivo_rejeicao: `999 - ${consultation.xMotivo}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cupomId)
          .eq("user_id", userId);
        return json({
          success: false,
          recovered: false,
          status: "pendente",
          model_code: modelCode,
          motivo:
            "A SEFAZ não respondeu à consulta. O documento continua pendente e não foi retransmitido para evitar duplicidade.",
        });
      }

      // 217 confirma que a chave não está na base da SEFAZ. Só então é seguro
      // reenviar exatamente o XML assinado que já havia sido transmitido.
      if (consultation.cStat !== "217") {
        await supabase
          .from("nfce_cupons")
          .update({
            status: "pendente",
            motivo_rejeicao: `${consultation.cStat} - ${consultation.xMotivo}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cupomId)
          .eq("user_id", userId);
        return json({
          success: false,
          recovered: false,
          status: "pendente",
          model_code: modelCode,
          motivo: `A SEFAZ retornou ${consultation.cStat} - ${consultation.xMotivo}. O documento foi mantido pendente sem retransmissão automática.`,
        });
      }

      const retransmissionResult = await sefazClient.reenviarNFeAssinada(
        previousXml,
        fiscalSettings.endereco_uf,
        fiscalSettings.ambiente as Ambiente,
        modelCode,
      );
      const retransmissionAuthorized =
        retransmissionResult.success &&
        ["100", "150"].includes(retransmissionResult.cStat);
      const retransmissionUncertain = retransmissionResult.cStat === "999";
      const retransmissionUpdate: Record<string, unknown> = {
        status: retransmissionAuthorized
          ? "autorizado"
          : retransmissionUncertain
            ? "pendente"
            : "rejeitado",
        motivo_rejeicao: retransmissionAuthorized
          ? null
          : `${retransmissionResult.cStat} - ${retransmissionResult.xMotivo}`,
        updated_at: new Date().toISOString(),
      };
      if (retransmissionAuthorized) {
        retransmissionUpdate.protocolo_autorizacao =
          retransmissionResult.protocolo;
        retransmissionUpdate.data_hora_autorizacao = new Date().toISOString();
        retransmissionUpdate.xml_autorizado = retransmissionResult.xmlRetorno;
        try {
          retransmissionUpdate.xml_processado = buildProcessedNFeXml(
            previousXml,
            retransmissionResult.xmlRetorno,
          );
        } catch (processedXmlError) {
          console.error(
            "Falha ao montar nfeProc ao retransmitir pendência:",
            processedXmlError,
          );
        }
      }
      await supabase
        .from("nfce_cupons")
        .update(retransmissionUpdate)
        .eq("id", cupom.id)
        .eq("user_id", userId);
      await supabase.from("nfce_transmissions").insert([
        {
          cupom_id: cupom.id,
          tipo_operacao: "reenvio",
          xml_enviado: previousXml,
          xml_retorno: retransmissionResult.xmlRetorno,
          codigo_status: retransmissionResult.cStat,
          motivo: retransmissionResult.xMotivo,
          protocolo: retransmissionResult.protocolo,
          sucesso: retransmissionAuthorized,
        },
      ]);
      return json({
        success: retransmissionAuthorized,
        recovered: retransmissionAuthorized,
        cupom_id: cupom.id,
        numero: cupom.numero,
        serie: cupom.serie,
        chave_acesso: cupom.chave_acesso,
        model_code: modelCode,
        status: retransmissionAuthorized
          ? "autorizado"
          : retransmissionUncertain
            ? "pendente"
            : "rejeitado",
        protocolo: retransmissionResult.protocolo,
        motivo: retransmissionResult.xMotivo,
        certificado_cnpj: certInfo.cnpj,
      });
    }

    // Sem XML nem tentativa anterior, o documento nunca chegou à SEFAZ. A
    // emissão pode continuar imediatamente com a numeração e chave reservadas.
    const { error: deleteItemsError } = await supabase
      .from("nfce_items")
      .delete()
      .eq("cupom_id", cupom.id);
    if (deleteItemsError) {
      throw new Error(
        `Erro ao preparar os itens da nota pendente: ${deleteItemsError.message}`,
      );
    }
    const { error: itemsError } = await supabase
      .from("nfce_items")
      .insert(items);
    if (itemsError) {
      throw new Error(
        `Erro ao reconstruir os itens da nota pendente: ${itemsError.message}`,
      );
    }

    const xmlContent = generateNFCeXML({
      fiscalSettings,
      cupom,
      order,
      items,
      consumerData,
      observacoes: "",
      paymentMethod: order.payment_method,
      deliveryFee,
      totalProdutos,
      valorDesconto,
      valorTotal,
      valorTributos,
      modelCode,
    });
    validateGeneratedFiscalXml(xmlContent, {
      accessKey: cupom.chave_acesso,
      modelCode,
      items,
      totalProdutos,
      deliveryFee,
      valorDesconto,
      valorTotal,
    });
    const transmissionResult = await sefazClient.enviarNFCe(
      xmlContent,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      modelCode === "65"
        ? {
            chaveAcesso: cupom.chave_acesso,
            dataEmissao: cupom.data_hora_emissao,
            valorTotal,
            cpfCnpjConsumidor: consumerData?.cpf_cnpj,
            cscId: fiscalSettings.csc_id,
            cscToken: fiscalSettings.csc_token,
          }
        : undefined,
      modelCode,
    );

    const authorized =
      transmissionResult.success &&
      ["100", "150"].includes(transmissionResult.cStat);
    const communicationUncertain = transmissionResult.cStat === "999";
    const updateData: Record<string, unknown> = {
      xml_content: transmissionResult.xmlEnviado || xmlContent,
      status: authorized
        ? "autorizado"
        : communicationUncertain
          ? "pendente"
          : "rejeitado",
      motivo_rejeicao: authorized
        ? null
        : `${transmissionResult.cStat} - ${transmissionResult.xMotivo}`,
      updated_at: new Date().toISOString(),
    };
    if (authorized) {
      updateData.protocolo_autorizacao = transmissionResult.protocolo;
      updateData.data_hora_autorizacao = new Date().toISOString();
      updateData.xml_autorizado = transmissionResult.xmlRetorno;
      updateData.qr_code_url = transmissionResult.qrCodeUrl || "";
      try {
        updateData.xml_processado = buildProcessedNFeXml(
          transmissionResult.xmlEnviado || xmlContent,
          transmissionResult.xmlRetorno,
        );
      } catch (processedXmlError) {
        console.error(
          "Falha ao montar nfeProc ao retomar pendência:",
          processedXmlError,
        );
      }
    }
    await supabase
      .from("nfce_cupons")
      .update(updateData)
      .eq("id", cupom.id)
      .eq("user_id", userId);
    await supabase.from("nfce_transmissions").insert([
      {
        cupom_id: cupom.id,
        tipo_operacao: "emissao",
        xml_enviado: transmissionResult.xmlEnviado || xmlContent,
        xml_retorno: transmissionResult.xmlRetorno,
        codigo_status: transmissionResult.cStat,
        motivo: transmissionResult.xMotivo,
        protocolo: transmissionResult.protocolo,
        sucesso: authorized,
      },
    ]);

    return json({
      success: authorized,
      recovered: false,
      cupom_id: cupom.id,
      numero: cupom.numero,
      serie: cupom.serie,
      chave_acesso: cupom.chave_acesso,
      model_code: modelCode,
      status: authorized
        ? "autorizado"
        : communicationUncertain
          ? "pendente"
          : "rejeitado",
      protocolo: transmissionResult.protocolo,
      motivo: transmissionResult.xMotivo,
      certificado_cnpj: certInfo.cnpj,
    });
  } finally {
    sefazClient.close();
  }
}

async function reenviarDocumentoRejeitado(
  supabase: any,
  userId: string,
  cupomId: string,
) {
  const { data: cupom, error: cupomError } = await supabase
    .from("nfce_cupons")
    .select("*")
    .eq("id", cupomId)
    .eq("user_id", userId)
    .single();
  if (cupomError || !cupom) throw new Error("Documento fiscal não encontrado");
  if (cupom.status !== "rejeitado") {
    throw new Error("Somente documentos rejeitados podem ser reenviados");
  }
  if (!cupom.chave_acesso || !cupom.order_id) {
    throw new Error(
      "O documento rejeitado não possui pedido e chave preservados para reenvio",
    );
  }

  const modelCode: "55" | "65" = cupom.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(supabase, userId, false);
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (!modelSettings?.enabled) {
    throw new Error(
      `${
        modelCode === "55" ? "NF-e modelo 55" : "NFC-e modelo 65"
      } não está habilitada nas Configurações fiscais`,
    );
  }
  fiscalSettings.ambiente = modelSettings.environment;
  fiscalSettings.nfce_serie = cupom.serie;
  fiscalSettings.nfce_numero_atual = cupom.numero;
  fiscalSettings.operation_nature =
    modelSettings.operation_nature || "Venda de mercadoria";
  validateFiscalSettingsForEmission(fiscalSettings, modelCode);
  const { sefazClient } = loadSefazClient(fiscalSettings);

  try {
    // Evita duplicidade quando a autorizacao ocorreu, mas a resposta original se perdeu.
    const consultation = await sefazClient.consultarNFCe(
      cupom.chave_acesso,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      modelCode,
    );
    if (["100", "150"].includes(consultation.cStat)) {
      await supabase
        .from("nfce_cupons")
        .update({
          status: "autorizado",
          protocolo_autorizacao:
            consultation.protocolo || cupom.protocolo_autorizacao,
          motivo_rejeicao: null,
          data_hora_autorizacao:
            cupom.data_hora_autorizacao || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", cupomId)
        .eq("user_id", userId);
      return json({
        success: true,
        recovered: true,
        status: "autorizado",
        motivo: "Documento já constava como autorizado na SEFAZ.",
      });
    }

    // Não retransmite enquanto o estado da chave estiver incerto. A rejeição
    // 225 confirma que o XML anterior é inválido; a consulta 217 confirma que
    // a chave não existe na SEFAZ e torna segura a reconstrução abaixo.
    if (consultation.cStat === "999") {
      return json({
        success: false,
        status: "rejeitado",
        motivo:
          "A SEFAZ não respondeu à consulta. O documento não foi retransmitido para evitar duplicidade.",
        codigo_status: consultation.cStat,
      });
    }
    if (consultation.cStat !== "217") {
      return json({
        success: false,
        status: "rejeitado",
        motivo: `A SEFAZ retornou ${consultation.cStat} - ${consultation.xMotivo}. O documento não foi retransmitido automaticamente.`,
        codigo_status: consultation.cStat,
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", cupom.order_id)
      .eq("user_id", userId)
      .single();
    if (orderError || !order) {
      throw new Error(
        "Pedido relacionado ao documento rejeitado não foi encontrado",
      );
    }

    const variations = normalizeRecord(order.variations);
    const consumerData = normalizeStoredFiscalRecipient(
      variations.fiscal_recipient,
    );
    validateRecipientForModel(consumerData, fiscalSettings, modelCode);

    const orderItems = normalizeOrderItems(order.items);
    if (orderItems.length === 0) {
      throw new Error("Pedido sem itens para reconstruir o documento fiscal");
    }

    const productIds = Array.from(
      new Set(
        orderItems
          .map((item) => String(item.product_id || "").trim())
          .filter(Boolean),
      ),
    );
    const productFiscalById = new Map<string, any>();
    if (productIds.length > 0) {
      const { data: productFiscalRows, error: productFiscalError } =
        await supabase
          .from("products")
          .select(
            "id,internal_code,fiscal_default_operation_id,fiscal_ncm,fiscal_cfop,fiscal_csosn,fiscal_icms_cst,fiscal_icms_config,fiscal_cst_pis,fiscal_cst_cofins,fiscal_origem,fiscal_cest,fiscal_beneficio,fiscal_observacao,fiscal_ibs_cbs_cst,fiscal_cclass_trib,fiscal_ibs_cbs_config,fiscal_is_cst,fiscal_is_cclass_trib,fiscal_is_config,fiscal_reducao_ibs,fiscal_reducao_cbs,fiscal_icms_st_base_ret_unit,fiscal_icms_st_aliquota,fiscal_icms_substituto_unit,fiscal_icms_st_ret_unit,fiscal_icms_efetivo_reducao,fiscal_icms_efetivo_aliquota",
          )
          .in("id", productIds)
          .eq("user_id", userId);
      if (productFiscalError) {
        throw new Error(
          `Erro ao carregar tributação dos produtos: ${productFiscalError.message}`,
        );
      }
      for (const row of productFiscalRows || []) {
        productFiscalById.set(String(row.id), row);
      }
    }

    const operationDestination = resolveOperationDestination(
      fiscalSettings,
      consumerData,
      modelCode,
    );
    if (operationDestination === 3) {
      throw new Error(
        "Operação com destino ao exterior bloqueada: complete a homologação fiscal de exportação antes de transmitir.",
      );
    }
    const resolvedOrderItems = await applyApprovedFiscalRules(
      supabase,
      userId,
      modelCode,
      fiscalSettings,
      consumerData,
      operationDestination,
      orderItems,
      productFiscalById,
    );
    const builtFiscalItems = buildFiscalItems(
      resolvedOrderItems,
      fiscalSettings,
      productFiscalById,
      operationDestination,
    );
    const deliveryFee = money(order.delivery_fee || 0);
    const valorDesconto = money(order.discount || 0);
    const fiscalItems = allocateFiscalAdjustments(
      builtFiscalItems,
      deliveryFee,
      valorDesconto,
    );
    validateFiscalItemsForEmission(
      fiscalItems,
      fiscalSettings,
      operationDestination,
      { modelCode, consumerData },
    );
    const totalProdutos = money(
      fiscalItems.reduce((sum, item) => sum + item.valor_total, 0),
    );
    const valorTotal = money(
      order.total || totalProdutos + deliveryFee - valorDesconto,
    );
    const valorTributos = await applyIbptApproximateTaxes(
      fiscalItems,
      fiscalSettings,
    );
    const items = fiscalItems.map((item) => ({ ...item, cupom_id: cupom.id }));

    const { error: deleteItemsError } = await supabase
      .from("nfce_items")
      .delete()
      .eq("cupom_id", cupom.id);
    if (deleteItemsError) {
      throw new Error(
        `Erro ao preparar os itens do documento rejeitado: ${deleteItemsError.message}`,
      );
    }
    const { error: itemsError } = await supabase
      .from("nfce_items")
      .insert(items);
    if (itemsError) {
      throw new Error(
        `Erro ao reconstruir os itens do documento rejeitado: ${itemsError.message}`,
      );
    }

    // Uma NFC-e rejeitada não pode conservar uma dhEmi antiga na nova
    // tentativa (rejeição 704). A chave só contém ano/mês, portanto permanece
    // válida dentro do mesmo mês; na virada do mês ela precisa ser recalculada.
    const retryEmissionDate = new Date();
    const retryDateParts = getNfeDateParts(
      retryEmissionDate,
      fiscalSettings.endereco_uf,
    );
    const retryAamm = `${retryDateParts.year.slice(-2)}${retryDateParts.month}`;
    const originalAamm = String(cupom.chave_acesso).slice(2, 6);
    const retryAccessKey =
      originalAamm === retryAamm
        ? cupom.chave_acesso
        : await generateAccessKey(
            supabase,
            fiscalSettings,
            Number(cupom.numero),
            retryEmissionDate,
            modelCode,
          );
    cupom.chave_acesso = retryAccessKey;
    cupom.data_hora_emissao = retryEmissionDate.toISOString();
    const { error: emissionDataError } = await supabase
      .from("nfce_cupons")
      .update({
        chave_acesso: retryAccessKey,
        data_hora_emissao: cupom.data_hora_emissao,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cupom.id)
      .eq("user_id", userId);
    if (emissionDataError) {
      throw new Error(
        `Erro ao atualizar a data de emissão do documento rejeitado: ${emissionDataError.message}`,
      );
    }

    const xmlContent = generateNFCeXML({
      fiscalSettings,
      cupom,
      order,
      items,
      consumerData,
      observacoes: "",
      paymentMethod: order.payment_method,
      deliveryFee,
      totalProdutos,
      valorDesconto,
      valorTotal,
      valorTributos,
      modelCode,
    });
    validateGeneratedFiscalXml(xmlContent, {
      accessKey: cupom.chave_acesso,
      modelCode,
      items,
      totalProdutos,
      deliveryFee,
      valorDesconto,
      valorTotal,
    });

    // Gera assinatura e QR Code novamente a partir do XML reconstruído. O
    // número e a série são preservados; a data é renovada para a transmissão.
    const result = await sefazClient.enviarNFCe(
      xmlContent,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      modelCode === "65"
        ? {
            chaveAcesso: cupom.chave_acesso,
            dataEmissao: cupom.data_hora_emissao,
            valorTotal,
            cpfCnpjConsumidor: consumerData?.cpf_cnpj,
            cscId: fiscalSettings.csc_id,
            cscToken: fiscalSettings.csc_token,
          }
        : undefined,
      modelCode,
    );
    const authorized = result.success && ["100", "150"].includes(result.cStat);
    const communicationUncertain = result.cStat === "999";
    const sentXml = result.xmlEnviado || xmlContent;
    const updateData: Record<string, unknown> = {
      xml_content: sentXml,
      valor_total: valorTotal,
      valor_desconto: valorDesconto,
      valor_tributos: valorTributos,
      status: authorized
        ? "autorizado"
        : communicationUncertain
          ? "pendente"
          : "rejeitado",
      motivo_rejeicao: authorized
        ? null
        : `${result.cStat} - ${result.xMotivo}`,
      updated_at: new Date().toISOString(),
    };
    if (authorized) {
      updateData.protocolo_autorizacao = result.protocolo;
      updateData.data_hora_autorizacao = new Date().toISOString();
      updateData.xml_autorizado = result.xmlRetorno;
      try {
        updateData.xml_processado = buildProcessedNFeXml(
          sentXml,
          result.xmlRetorno,
        );
      } catch (processedXmlError) {
        // A autorizacao e o protocolo prevalecem; o XML processado pode ser reconstruido no download.
        console.error(
          "Falha ao montar nfeProc apos reenvio:",
          processedXmlError,
        );
      }
      updateData.qr_code_url = result.qrCodeUrl || "";
    }
    await supabase
      .from("nfce_cupons")
      .update(updateData)
      .eq("id", cupomId)
      .eq("user_id", userId);
    await supabase.from("nfce_transmissions").insert([
      {
        cupom_id: cupomId,
        tipo_operacao: "reenvio",
        xml_enviado: sentXml,
        xml_retorno: result.xmlRetorno,
        codigo_status: result.cStat,
        motivo: result.xMotivo,
        protocolo: result.protocolo,
        sucesso: authorized,
      },
    ]);
    return json({
      success: authorized,
      status: authorized
        ? "autorizado"
        : communicationUncertain
          ? "pendente"
          : "rejeitado",
      motivo: result.xMotivo,
      codigo_status: result.cStat,
    });
  } finally {
    sefazClient.close();
  }
}

async function cancelarNFCe(
  supabase: any,
  userId: string,
  cupomId: string,
  motivo: string,
) {
  const { data: cupom, error: cupomError } = await supabase
    .from("nfce_cupons")
    .select("*")
    .eq("id", cupomId)
    .eq("user_id", userId)
    .single();
  if (cupomError || !cupom) throw new Error("Cupom nao encontrado");
  if (cupom.status !== "autorizado") {
    throw new Error("Apenas cupons autorizados podem ser cancelados");
  }
  if (!cupom.protocolo_autorizacao) {
    throw new Error("Cupom autorizado sem protocolo salvo");
  }

  const modelCode: "55" | "65" = cupom.model_code === "55" ? "55" : "65";
  const fiscalSettings = await loadFiscalSettings(supabase, userId, false);
  const modelSettings = await loadFiscalModel(supabase, userId, modelCode);
  if (modelSettings?.environment) {
    fiscalSettings.ambiente = modelSettings.environment;
  }
  const { sefazClient } = loadSefazClient(fiscalSettings);
  try {
    const result = await sefazClient.cancelarNFCe(
      cupom.chave_acesso,
      cupom.protocolo_autorizacao,
      motivo,
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
      fiscalSettings.cnpj,
      modelCode,
    );

    if (result.success) {
      await supabase
        .from("nfce_cupons")
        .update({
          status: "cancelado",
          updated_at: new Date().toISOString(),
        })
        .eq("id", cupomId);
    }
    await supabase.from("nfce_transmissions").insert([
      {
        cupom_id: cupomId,
        tipo_operacao: "cancelamento",
        xml_retorno: result.xmlRetorno,
        codigo_status: result.cStat,
        motivo: result.xMotivo || motivo,
        protocolo: result.protocolo,
        sucesso: result.success,
      },
    ]);

    return json({
      success: result.success,
      motivo: result.success ? "Cancelado com sucesso" : result.xMotivo,
    });
  } finally {
    sefazClient.close();
  }
}

async function testarConexaoSefaz(supabase: any, userId: string) {
  const fiscalSettings = await loadFiscalSettings(supabase, userId, true);
  validateFiscalSettingsForEmission(fiscalSettings);
  const { certInfo, sefazClient } = loadSefazClient(fiscalSettings);
  try {
    const result = await sefazClient.consultarStatusServico(
      fiscalSettings.endereco_uf,
      fiscalSettings.ambiente as Ambiente,
    );
    return json({
      success: result.success,
      cStat: result.cStat,
      motivo: result.xMotivo,
      ambiente: fiscalSettings.ambiente,
      uf: fiscalSettings.endereco_uf,
      certificado_cnpj: certInfo.cnpj,
    });
  } finally {
    sefazClient.close();
  }
}

async function validarConfiguracaoFiscal(supabase: any, userId: string) {
  const fiscalSettings = await loadFiscalSettings(supabase, userId, false);
  const checklist = buildFiscalReadiness(fiscalSettings);
  let certificate: any = null;

  if (
    fiscalSettings.certificado_a1_base64 &&
    fiscalSettings.certificado_senha
  ) {
    try {
      const certInfo = loadCertificateFromBase64(
        fiscalSettings.certificado_a1_base64,
        fiscalSettings.certificado_senha,
      );
      const validation = validateCertificate(certInfo, fiscalSettings.cnpj);
      certificate = {
        valid: validation.valid,
        errors: validation.errors,
        cnpj: certInfo.cnpj,
        valid_from: certInfo.validFrom.toISOString(),
        valid_to: certInfo.validTo.toISOString(),
        issuer: certInfo.issuer,
      };
      if (!validation.valid) {
        checklist.errors.push(
          ...validation.errors.map((message) => `Certificado: ${message}`),
        );
      }
    } catch (error) {
      const message = getErrorMessage(error);
      checklist.errors.push(`Certificado: ${message}`);
      certificate = { valid: false, errors: [message] };
    }
  }

  const ready = checklist.errors.length === 0;
  return json({
    success: ready,
    ready,
    scope: "NFC-e 65 / Simples Nacional",
    ambiente: fiscalSettings.ambiente,
    uf: fiscalSettings.endereco_uf,
    checklist,
    certificate,
  });
}

async function diagnosticarCadastroPorEmail(
  req: Request,
  supabase: any,
  data: any,
) {
  const expectedKey = Deno.env.get("NFCE_DIAGNOSTIC_KEY") || "";
  const receivedKey = req.headers.get("x-diagnostic-key") || "";
  if (!expectedKey || receivedKey !== expectedKey) {
    return json({ error: "Diagnostico nao autorizado" }, 401);
  }

  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("email e obrigatorio");

  const user = await findAuthUserByEmail(supabase, email);
  if (!user) {
    return json({ success: false, error: "Usuario nao encontrado", email });
  }

  const fiscalSettings = await loadFiscalSettings(supabase, user.id, false);
  const readiness = buildFiscalReadiness(fiscalSettings);
  let certificate: any = null;
  let connection: any = null;

  if (
    fiscalSettings.certificado_a1_base64 &&
    fiscalSettings.certificado_senha
  ) {
    try {
      const certInfo = loadCertificateFromBase64(
        fiscalSettings.certificado_a1_base64,
        fiscalSettings.certificado_senha,
      );
      const validation = validateCertificate(certInfo, fiscalSettings.cnpj);
      certificate = {
        valid: validation.valid,
        errors: validation.errors,
        cnpj: certInfo.cnpj,
        expected_cnpj: onlyDigits(fiscalSettings.cnpj),
        cnpj_matches: certInfo.cnpj === onlyDigits(fiscalSettings.cnpj),
        valid_from: certInfo.validFrom.toISOString(),
        valid_to: certInfo.validTo.toISOString(),
        subject: certInfo.subject,
        issuer: certInfo.issuer,
        chain_count: certInfo.certificateChainCount,
      };

      if (validation.valid && readiness.errors.length === 0) {
        const sefazClient = new SefazClient(certInfo);
        try {
          const result = await sefazClient.consultarStatusServico(
            fiscalSettings.endereco_uf,
            fiscalSettings.ambiente as Ambiente,
          );
          connection = {
            success: result.success,
            cStat: result.cStat,
            motivo: result.xMotivo,
            rawStatus: result.rawStatus,
          };
        } finally {
          sefazClient.close();
        }
      }
    } catch (error) {
      certificate = { valid: false, errors: [getErrorMessage(error)] };
    }
  }

  return json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    fiscal: {
      ativo: fiscalSettings.ativo,
      cnpj: onlyDigits(fiscalSettings.cnpj),
      razao_social: fiscalSettings.razao_social,
      nome_fantasia: fiscalSettings.nome_fantasia,
      inscricao_estadual: onlyDigits(fiscalSettings.inscricao_estadual),
      uf: fiscalSettings.endereco_uf,
      municipio: fiscalSettings.endereco_municipio,
      codigo_municipio: onlyDigits(fiscalSettings.codigo_municipio),
      ambiente: fiscalSettings.ambiente,
      serie: fiscalSettings.nfce_serie,
      proximo_numero: fiscalSettings.nfce_numero_atual,
      has_csc_id: Boolean(String(fiscalSettings.csc_id || "").trim()),
      has_csc_token: Boolean(String(fiscalSettings.csc_token || "").trim()),
      has_certificate: Boolean(fiscalSettings.certificado_a1_base64),
      certificate_bytes: Math.floor(
        (String(fiscalSettings.certificado_a1_base64 || "").length * 3) / 4,
      ),
    },
    readiness,
    certificate,
    connection,
  });
}

async function findAuthUserByEmail(supabase: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`Erro ao buscar usuarios: ${error.message}`);
    const users = data?.users || [];
    const found = users.find(
      (user: any) => String(user.email || "").toLowerCase() === email,
    );
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

async function downloadXML(supabase: any, userId: string, cupomId: string) {
  const { data: cupom, error } = await supabase
    .from("nfce_cupons")
    .select("xml_processado, xml_autorizado, xml_content, numero, status")
    .eq("id", cupomId)
    .eq("user_id", userId)
    .single();
  if (error || !cupom) throw new Error("Cupom nao encontrado");

  if (cupom.status !== "autorizado") {
    throw new Error(
      "O XML fiscal processado so existe para documentos autorizados",
    );
  }

  let xml = String(cupom.xml_processado || "").trim();
  if (!xml) {
    xml = buildProcessedNFeXml(cupom.xml_content, cupom.xml_autorizado);
    const { error: updateError } = await supabase
      .from("nfce_cupons")
      .update({ xml_processado: xml, updated_at: new Date().toISOString() })
      .eq("id", cupomId)
      .eq("user_id", userId);
    if (updateError) {
      throw new Error(
        `Nao foi possivel armazenar o XML processado: ${updateError.message}`,
      );
    }
  }
  return json({ xml, numero: cupom.numero, document_type: "nfeProc" });
}

function buildProcessedNFeXml(
  xmlNFe: unknown,
  xmlSefazResponse: unknown,
): string {
  const sent = String(xmlNFe || "").trim();
  const response = String(xmlSefazResponse || "").trim();
  if (!sent || !response) {
    throw new Error(
      "XML enviado ou protocolo de autorizacao nao foi encontrado",
    );
  }

  if (/<nfeProc\b/i.test(sent)) return ensureXmlDeclaration(sent);

  const nfeMatch = sent.match(/<(?:\w+:)?NFe\b[^>]*>[\s\S]*?<\/(?:\w+:)?NFe>/i);
  const protocolMatch = response.match(
    /<(?:\w+:)?protNFe\b[^>]*>[\s\S]*?<\/(?:\w+:)?protNFe>/i,
  );
  if (!nfeMatch) throw new Error("O XML assinado da nota nao foi encontrado");
  if (!protocolMatch) {
    throw new Error(
      "O protocolo de autorizacao protNFe nao foi encontrado na resposta da Sefaz",
    );
  }

  const nfe = removeNamespacePrefix(nfeMatch[0], "NFe");
  const protocol = normalizeProtocolFragment(protocolMatch[0]);
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${stripXmlDeclaration(
    nfe,
  )}${stripXmlDeclaration(protocol)}</nfeProc>`;
}

function removeNamespacePrefix(xml: string, elementName: string): string {
  return xml
    .replace(new RegExp(`<\\w+:${elementName}\\b`, "gi"), `<${elementName}`)
    .replace(new RegExp(`</\\w+:${elementName}>`, "gi"), `</${elementName}>`);
}

function normalizeProtocolFragment(xml: string): string {
  return xml
    .replace(/(<\/?)[A-Za-z_][\w.-]*:/g, "$1")
    .replace(/\s+xmlns:[A-Za-z_][\w.-]*=("[^"]*"|'[^']*')/g, "");
}

function stripXmlDeclaration(xml: string): string {
  return String(xml || "")
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, "")
    .trim();
}

function ensureXmlDeclaration(xml: string): string {
  return /^\s*<\?xml/i.test(xml)
    ? xml
    : `<?xml version="1.0" encoding="UTF-8"?>${xml}`;
}

async function loadFiscalSettings(
  supabase: any,
  userId: string,
  activeOnly: boolean,
) {
  let query = supabase
    .from("fiscal_settings")
    .select("*")
    .eq("user_id", userId);
  if (activeOnly) query = query.eq("ativo", true);
  const { data, error } = await query.single();
  if (error || !data) {
    throw new Error("Configuracoes fiscais nao encontradas ou inativas");
  }
  return data;
}

async function loadFiscalModel(
  supabase: any,
  userId: string,
  modelCode: "55" | "65",
) {
  const { data, error } = await supabase
    .from("fiscal_document_models")
    .select("*")
    .eq("user_id", userId)
    .eq("model_code", modelCode)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Erro ao carregar configuração do modelo ${modelCode}: ${error.message}`,
    );
  }
  return data;
}

function validCpfCnpj(value: unknown): boolean {
  const digits = onlyDigits(String(value || ""));
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) {
    return false;
  }
  const validateDigit = (baseLength: number, weights: number[]) => {
    const sum = weights.reduce(
      (total, weight, index) => total + Number(digits[index]) * weight,
      0,
    );
    const remainder = sum % 11;
    const digit = remainder < 2 ? 0 : 11 - remainder;
    return digit === Number(digits[baseLength]);
  };
  if (digits.length === 11) {
    return (
      validateDigit(9, [10, 9, 8, 7, 6, 5, 4, 3, 2]) &&
      validateDigit(10, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
    );
  }
  return (
    validateDigit(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    validateDigit(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  );
}

export function validateRecipientForModel(
  consumerData: NFCeData["consumer_data"] | undefined,
  fiscalSettings: any,
  modelCode: "55" | "65",
) {
  const presenceIndicator = Number(consumerData?.presence_indicator ?? 1);
  if (!VALID_PRESENCE_INDICATORS.has(presenceIndicator)) {
    throw new Error(
      `Indicador de presença inválido: ${presenceIndicator}. Use 0, 1, 2, 3, 4, 5 ou 9.`,
    );
  }
  if (modelCode === "65") {
    if (consumerData?.final_consumer === false) {
      throw new Error(
        "NFC-e modelo 65 é exclusiva para operação com consumidor final",
      );
    }
    const recipientUf = String(consumerData?.state || "")
      .trim()
      .toUpperCase();
    const issuerUf = String(fiscalSettings?.endereco_uf || "")
      .trim()
      .toUpperCase();
    if (recipientUf && issuerUf && recipientUf !== issuerUf) {
      throw new Error(
        "NFC-e modelo 65 não pode documentar operação interestadual; emita NF-e modelo 55",
      );
    }
    const optionalDoc = onlyDigits(consumerData?.cpf_cnpj);
    if (optionalDoc && !validCpfCnpj(optionalDoc)) {
      throw new Error("CPF/CNPJ do consumidor inválido para NFC-e");
    }
    return;
  }

  const doc = onlyDigits(consumerData?.cpf_cnpj);
  const missing: string[] = [];
  if (!String(consumerData?.nome || "").trim()) {
    missing.push("nome/razão social");
  }
  if (!validCpfCnpj(doc)) missing.push("CPF/CNPJ válido");
  if (!String(consumerData?.address || "").trim()) missing.push("logradouro");
  if (!String(consumerData?.address_number || "").trim()) {
    missing.push("número");
  }
  if (!String(consumerData?.neighborhood || "").trim()) missing.push("bairro");
  if (!String(consumerData?.city || "").trim()) missing.push("município");
  if (onlyDigits(consumerData?.city_code).length !== 7) {
    missing.push("código IBGE do município");
  }
  if (!/^[A-Z]{2}$/.test(String(consumerData?.state || "").toUpperCase())) {
    missing.push("UF");
  }
  if (onlyDigits(consumerData?.postal_code).length !== 8) missing.push("CEP");
  const ieIndicator = Number(consumerData?.state_registration_indicator ?? 9);
  const ie = String(consumerData?.state_registration || "").trim();
  if (![1, 2, 9].includes(ieIndicator)) {
    missing.push("indicador de IE válido (1, 2 ou 9)");
  } else if (ieIndicator === 1 && (ie.length < 2 || ie.length > 14)) {
    missing.push("inscrição estadual do contribuinte");
  } else if ([2, 9].includes(ieIndicator) && ie) {
    missing.push(
      "IE deve ficar vazia para destinatário isento/não contribuinte",
    );
  }
  if (missing.length) {
    throw new Error(
      `Destinatário incompleto para NF-e modelo 55: ${missing.join(", ")}`,
    );
  }
}

function loadSefazClient(fiscalSettings: any) {
  if (
    !fiscalSettings.certificado_a1_base64 ||
    !fiscalSettings.certificado_senha
  ) {
    throw new Error("Certificado digital A1 nao configurado");
  }
  const certInfo = loadCertificateFromBase64(
    fiscalSettings.certificado_a1_base64,
    fiscalSettings.certificado_senha,
  );
  const validation = validateCertificate(certInfo, fiscalSettings.cnpj);
  if (!validation.valid) {
    throw new Error(`Certificado invalido: ${validation.errors.join(", ")}`);
  }
  return { certInfo, sefazClient: new SefazClient(certInfo) };
}

function validateFiscalSettingsForEmission(
  settings: any,
  modelCode: "55" | "65" = "65",
) {
  const readiness = buildFiscalReadiness(settings, modelCode);
  if (readiness.errors.length) {
    throw new Error(
      `Configuracao fiscal incompleta: ${readiness.errors.join("; ")}`,
    );
  }
}

function buildFiscalReadiness(settings: any, modelCode: "55" | "65" = "65") {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requiredFields = [
    "cnpj",
    "razao_social",
    "endereco_logradouro",
    "endereco_numero",
    "endereco_bairro",
    "endereco_municipio",
    "endereco_uf",
    "endereco_cep",
    "codigo_municipio",
    "nfce_serie",
    "nfce_numero_atual",
  ];
  for (const field of requiredFields) {
    if (!String(settings[field] || "").trim()) {
      errors.push(`Campo obrigatorio ausente: ${field}`);
    }
  }

  const uf = String(settings.endereco_uf || "").toUpperCase();
  let codigoUf = "";
  if (uf) {
    try {
      codigoUf = getCodigoUF(uf);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }
  if (uf && codigoUf) {
    const codigoMunicipio = resolveMunicipalityCode(settings);
    if (codigoMunicipio.length !== 7 || !codigoMunicipio.startsWith(codigoUf)) {
      errors.push(
        `Codigo do municipio deve ter 7 digitos e comecar com o codigo IBGE da UF ${uf} (${codigoUf})`,
      );
    }
    if (codigoMunicipio !== onlyDigits(settings.codigo_municipio)) {
      warnings.push(
        `Codigo do municipio normalizado para ${
          settings.endereco_municipio || "municipio"
        }: ${codigoMunicipio}`,
      );
    }
    if (!onlyDigits(settings.inscricao_estadual)) {
      errors.push("Inscricao Estadual e obrigatoria para NFC-e");
    }
  }
  const ambiente = String(settings.ambiente || "") as Ambiente;
  if (uf && String(settings.ambiente || "").match(/^(homologacao|producao)$/)) {
    try {
      getSefazEndpoint(uf, ambiente, "status");
      getSefazEndpoint(uf, ambiente, "autorizacao");
      getSefazEndpoint(uf, ambiente, "retAutorizacao");
      getSefazEndpoint(uf, ambiente, "consulta");
      getSefazEndpoint(uf, ambiente, "evento");
      if (modelCode === "65") getQRCodeBaseUrl(uf, ambiente);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  const cnpj = onlyDigits(settings.cnpj);
  if (!validCpfCnpj(cnpj) || cnpj.length !== 14) {
    errors.push("CNPJ do emitente deve ser válido");
  }
  if (onlyDigits(settings.endereco_cep).length !== 8) {
    errors.push("CEP do emitente deve conter 8 dígitos");
  }
  const serie = Number(settings.nfce_serie);
  if (!Number.isInteger(serie) || serie < 1 || serie > 999) {
    errors.push("Serie NFC-e deve ser um numero entre 1 e 999");
  }
  const nextNumber = Number(settings.nfce_numero_atual);
  if (!Number.isInteger(nextNumber) || nextNumber < 1) {
    errors.push("Proximo numero da NFC-e deve ser maior que zero");
  }
  if (!String(settings.ambiente || "").match(/^(homologacao|producao)$/)) {
    errors.push("Ambiente fiscal invalido");
  }
  if (modelCode === "65" && (!settings.csc_id || !settings.csc_token)) {
    warnings.push(
      "CSC não informado: o emissor usará QR Code v3 online, que dispensa CSC conforme NT 2025.001.",
    );
  }
  if (!settings.certificado_a1_base64 || !settings.certificado_senha) {
    errors.push("Certificado A1 e senha sao obrigatorios");
  }
  if (settings.ambiente === "producao") {
    warnings.push(
      "Producao exige credenciamento NFC-e ativo na Sefaz da UF e CSC de producao. Teste primeiro em homologacao.",
    );
  }

  return { errors, warnings };
}

async function getNextFiscalDocumentNumber(
  supabase: any,
  userId: string,
  modelCode: "55" | "65",
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "get_next_fiscal_document_number",
    { p_user_id: userId, p_model_code: modelCode },
  );
  if (error) {
    throw new Error(
      `Erro ao gerar número do documento modelo ${modelCode}: ${error.message}`,
    );
  }
  return Number(data);
}

async function generateAccessKey(
  supabase: any,
  fiscalSettings: any,
  numero: number,
  dataEmissao: Date,
  modelCode: "55" | "65",
): Promise<string> {
  const parts = getNfeDateParts(dataEmissao, fiscalSettings.endereco_uf);
  const aamm = `${parts.year.slice(-2)}${parts.month}`;
  const codigoNumerico = crypto
    .getRandomValues(new Uint32Array(1))[0]
    .toString()
    .slice(0, 8)
    .padStart(8, "0");
  const { data, error } = await supabase.rpc("generate_nfce_access_key", {
    p_uf: getCodigoUF(fiscalSettings.endereco_uf),
    p_aamm: aamm,
    p_cnpj: onlyDigits(fiscalSettings.cnpj),
    p_modelo: modelCode,
    p_serie: String(fiscalSettings.nfce_serie),
    p_numero: String(numero),
    p_tipo_emissao: "1",
    p_codigo_numerico: codigoNumerico,
  });
  if (error) throw new Error(`Erro ao gerar chave de acesso: ${error.message}`);
  return String(data);
}

function normalizeOrderItems(rawItems: unknown): any[] {
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === "string") {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRecord(rawValue: unknown): Record<string, any> {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return rawValue as Record<string, any>;
  }
  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeRtcConfigForEmission(
  rawValue: unknown,
  cstIbsCbs: string,
  cclassTrib: string,
): Record<string, unknown> {
  const raw = normalizeRecord(rawValue);
  const classified = /^\d{3}$/.test(cstIbsCbs) && /^\d{6}$/.test(cclassTrib);
  const rawMode = String(raw.mode || "").trim();
  const supportedMode = ["standard", "monophase", "transfer_credit"].includes(rawMode)
    ? rawMode
    : "";
  // Uma operação que possui CST e cClassTrib não pode perder o grupo IBS/CBS
  // por causa de um JSON legado vazio ou salvo como `mode: none`. A opção
  // realmente sem incidência limpa a classificação no cadastro da operação.
  const mode = classified ? supportedMode || "standard" : rawMode || "standard";
  const legacyIbsReduction = raw.reducao_ibs;
  const legacyCbsReduction = raw.reducao_cbs;
  const ibsUf = normalizeRecord(raw.ibsUf);
  const ibsMun = normalizeRecord(raw.ibsMun);
  const cbs = normalizeRecord(raw.cbs);
  const withLegacyValues = (
    current: Record<string, unknown>,
    legacyRate: unknown,
    legacyReduction: unknown,
  ) => ({
    ...(current.rate ?? legacyRate) == null
      ? {}
      : { rate: current.rate ?? legacyRate },
    ...(current.reduction ?? legacyReduction) == null
      ? {}
      : { reduction: current.reduction ?? legacyReduction },
    ...current,
  });

  return {
    ...raw,
    enabled: classified && mode !== "none",
    mode,
    ibsUf: withLegacyValues(ibsUf, raw.aliquota_ibs_uf, legacyIbsReduction),
    ibsMun: withLegacyValues(ibsMun, raw.aliquota_ibs_mun, legacyIbsReduction),
    cbs: withLegacyValues(cbs, raw.aliquota_cbs, legacyCbsReduction),
  };
}

export function normalizeStoredFiscalRecipient(
  rawValue: unknown,
): NFCeData["consumer_data"] {
  const recipient = normalizeRecord(rawValue);
  return {
    ...recipient,
    // O checkout persiste o destinatário como `name`, enquanto a API fiscal
    // recebe `nome`. Aceitar os dois formatos preserva retomadas e reenvios.
    nome: String(recipient.nome || recipient.name || "").trim(),
    presence_indicator: Number(recipient.presence_indicator ?? 1),
  };
}

const UF_SUL_SUDESTE_SEM_ES = new Set(["MG", "PR", "RJ", "RS", "SC", "SP"]);
const UF_NORTE_NORDESTE_CENTRO_OESTE_E_ES = new Set([
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "RN",
  "RO",
  "RR",
  "SE",
  "TO",
]);
const ORIGENS_SUJEITAS_A_ALIQUOTA_IMPORTADA = new Set([1, 2, 3, 8]);

/**
 * Resolve a alíquota interestadual do ICMS sem depender de valor manual salvo
 * na regra. A alíquota de 4% aplica-se às origens alcançadas pela Resolução
 * 13/2012; nas demais, usa-se 7% no fluxo Sul/Sudeste (exceto ES) para
 * Norte/Nordeste/Centro-Oeste/ES e 12% nos outros fluxos interestaduais.
 */
export function resolveInterstateIcmsRate(
  originUf: unknown,
  destinationUf: unknown,
  productOrigin: unknown,
): 4 | 7 | 12 {
  const origin = String(originUf || "")
    .trim()
    .toUpperCase();
  const destination = String(destinationUf || "")
    .trim()
    .toUpperCase();
  if (
    !/^[A-Z]{2}$/.test(origin) ||
    !/^[A-Z]{2}$/.test(destination) ||
    origin === destination ||
    destination === "EX"
  ) {
    throw new Error(
      `UFs inválidas para cálculo interestadual: ${origin || "?"} -> ${
        destination || "?"
      }`,
    );
  }
  if (ORIGENS_SUJEITAS_A_ALIQUOTA_IMPORTADA.has(Number(productOrigin))) {
    return 4;
  }
  return UF_SUL_SUDESTE_SEM_ES.has(origin) &&
    UF_NORTE_NORDESTE_CENTRO_OESTE_E_ES.has(destination)
    ? 7
    : 12;
}

/** Alíquota modal interna vigente na data da operação. */
export function resolveInternalIcmsModalRate(
  uf: unknown,
  operationDate: string | Date = new Date(),
): number {
  const normalizedUf = String(uf || "")
    .trim()
    .toUpperCase();
  const date =
    operationDate instanceof Date
      ? operationDate.toISOString().slice(0, 10)
      : String(operationDate).slice(0, 10);

  // Lei CE 18.305/2023: a alíquota modal passou de 18% para 20% em 01/01/2024.
  if (normalizedUf === "CE") return date >= "2024-01-01" ? 20 : 18;
  throw new Error(
    `Alíquota modal interna não cadastrada para ${
      normalizedUf || "UF desconhecida"
    }`,
  );
}

function normalizeInternalIcmsConfig(
  rawConfig: unknown,
  settings: any,
  operationDestination: 1 | 2 | 3,
): Record<string, any> {
  const config = { ...normalizeRecord(rawConfig) };
  const issuerUf = String(settings?.endereco_uf || "").toUpperCase();
  const configuredRate = Number(config.pICMS ?? 0);
  if (
    operationDestination === 1 &&
    issuerUf === "CE" &&
    (config.rateMode === "state_modal" || configuredRate === 18)
  ) {
    config.pICMS = resolveInternalIcmsModalRate(issuerUf);
    config.rateMode = "state_modal";
  }
  return config;
}

/**
 * Regra NA01-20: o grupo ICMSUFDest é exigido na NF-e interestadual para
 * consumidor final não contribuinte. A própria regra possui exceção para
 * emitentes optantes pelo Simples Nacional (CRT 1) e MEI (CRT 4).
 */
export function requiresIcmsUfDest(
  crt: number,
  modelCode: "55" | "65" | undefined,
  operationDestination: 1 | 2 | 3,
  consumerData: any,
): boolean {
  if ([1, 4].includes(Number(crt))) return false;
  return (
    modelCode === "55" &&
    operationDestination === 2 &&
    consumerData?.final_consumer !== false &&
    Number(consumerData?.state_registration_indicator ?? 9) === 9
  );
}

async function applyApprovedFiscalRules(
  supabase: any,
  userId: string,
  modelCode: "55" | "65",
  settings: any,
  consumerData: NFCeData["consumer_data"] | undefined,
  operationDestination: 1 | 2 | 3,
  orderItems: any[],
  productFiscalById: Map<string, any>,
) {
  const operationDate = new Date().toISOString().slice(0, 10);
  const crt = Number(settings.regime_tributario || 1);
  const { data: rules, error } = await supabase
    .from("fiscal_tax_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .is("product_id", null)
    .not("accountant_approved_at", "is", null)
    .contains("model_codes", [modelCode])
    .contains("issuer_crt", [crt])
    .lte("valid_from", operationDate)
    .or(`valid_until.is.null,valid_until.gte.${operationDate}`)
    .order("priority", { ascending: true });

  // A migracao pode chegar antes do cache do PostgREST. Contas legadas seguem
  // funcionando enquanto o modo estrito estiver desligado em homologacao.
  // Em producao nunca e permitido transmitir com tributacao de fallback.
  if (error) {
    if (requiresApprovedFiscalRules(settings)) {
      throw new Error(
        `Erro ao resolver regras fiscais aprovadas: ${error.message}`,
      );
    }
    return orderItems;
  }

  const issuerUf = String(settings.endereco_uf || "").toUpperCase();
  const destinationUf =
    operationDestination === 3
      ? "EX"
      : String(consumerData?.state || issuerUf).toUpperCase();
  const recipientIe = Number(consumerData?.state_registration_indicator || 9);
  const finalConsumer = consumerData?.final_consumer !== false;
  const presenceIndicator = Number(consumerData?.presence_indicator || 1);

  return orderItems.map((item, itemIndex) => {
    const product = item.product_id
      ? productFiscalById.get(String(item.product_id)) || {}
      : {};
    const ncm = onlyDigits(item.fiscal_ncm || item.ncm || product.fiscal_ncm);
    const cest = onlyDigits(item.fiscal_cest || product.fiscal_cest);
    const productOrigin = Number(
      item.fiscal_origem ?? product.fiscal_origem ?? 0,
    );
    const defaultOperationId = String(
      item.fiscal_default_operation_id ||
        product.fiscal_default_operation_id ||
        "",
    );
    const operationType = String(item.operation_type || "sale");
    const matches = (rules || [])
      .filter(
        (rule: any) =>
          rule.operation_type === operationType &&
          (rule.operation_destination == null ||
            Number(rule.operation_destination) === operationDestination) &&
          (!rule.origin_uf || rule.origin_uf === issuerUf) &&
          (!rule.destination_uf || rule.destination_uf === destinationUf) &&
          (rule.recipient_ie_indicator == null ||
            Number(rule.recipient_ie_indicator) === recipientIe) &&
          (rule.final_consumer == null ||
            Boolean(rule.final_consumer) === finalConsumer) &&
          (rule.presence_indicator == null ||
            Number(rule.presence_indicator) === presenceIndicator) &&
          (!rule.ncm_prefix || ncm.startsWith(String(rule.ncm_prefix))) &&
          (!rule.cest || String(rule.cest) === cest) &&
          (rule.product_origin == null ||
            Number(rule.product_origin) === productOrigin),
      )
      .map((rule: any) => ({
        rule,
        isProductDefault: Boolean(defaultOperationId && String(rule.id) === defaultOperationId),
        specificity:
          String(rule.ncm_prefix || "").length * 10_000 +
          (rule.cest ? 1_000 : 0) +
          (rule.destination_uf ? 100 : 0) +
          (rule.operation_destination != null ? 10 : 0) +
          (rule.recipient_ie_indicator != null ? 2 : 0) +
          (rule.presence_indicator != null ? 1 : 0),
      }))
      .sort(
        (a: any, b: any) =>
          Number(b.isProductDefault) - Number(a.isProductDefault) ||
          b.specificity - a.specificity ||
          Number(a.rule.priority) - Number(b.rule.priority) ||
          String(a.rule.id).localeCompare(String(b.rule.id)),
      );

    if (!matches.length) {
      if (requiresApprovedFiscalRules(settings)) {
        throw new Error(
          `Item ${itemIndex + 1} (${
            item.product_name || item.name || "produto"
          }): nenhuma regra fiscal vigente e aprovada corresponde à operação`,
        );
      }
      return item;
    }
    if (
      matches.length > 1 &&
      matches[0].isProductDefault === matches[1].isProductDefault &&
      matches[0].specificity === matches[1].specificity &&
      Number(matches[0].rule.priority) === Number(matches[1].rule.priority)
    ) {
      throw new Error(
        `Item ${itemIndex + 1}: regras fiscais ambíguas (${
          matches[0].rule.name
        } e ${
          matches[1].rule.name
        }). Ajuste a prioridade ou os critérios antes de emitir.`,
      );
    }

    const rule = matches[0].rule;
    const icmsConfig = normalizeRecord(rule.icms_config);
    if (operationDestination === 1 && issuerUf === "CE") {
      const configuredRate = Number(icmsConfig.pICMS ?? 0);
      // Regras antigas do Ceará foram gravadas com a modal de 18%. Corrigimos
      // somente a modal/legada; uma alíquota especial marcada como explicit é
      // preservada e continua sob responsabilidade da regra aprovada.
      if (icmsConfig.rateMode === "state_modal" || configuredRate === 18) {
        icmsConfig.pICMS = resolveInternalIcmsModalRate(
          issuerUf,
          operationDate,
        );
        icmsConfig.rateMode = "state_modal";
      }
    } else if (operationDestination === 2) {
      const interstateRate = resolveInterstateIcmsRate(
        issuerUf,
        destinationUf,
        productOrigin,
      );
      // A alíquota própria e a usada pelo DIFAL não podem ficar congeladas em
      // uma regra antiga. Bases e alíquotas internas continuam pertencendo à
      // regra fiscal operacional aprovada para a UF.
      if (icmsConfig.pICMS !== undefined) icmsConfig.pICMS = interstateRate;
      if ([1, 4].includes(crt)) {
        // Não perpetua no XML uma configuração antiga de DIFAL em operação
        // do Simples/MEI, alcançada pela exceção expressa da NA01-20.
        delete icmsConfig.difal;
      } else {
        const difalConfig = normalizeRecord(icmsConfig.difal);
        if (difalConfig.enabled) {
          icmsConfig.difal = { ...difalConfig, interstateRate };
        }
      }
    }
    const ibsConfig = normalizeRecord(rule.ibs_cbs_config);
    return {
      ...item,
      operation_type: operationType,
      fiscal_rule_id: rule.id,
      fiscal_cfop: rule.cfop,
      fiscal_csosn: crt === 1 ? rule.icms_code : undefined,
      fiscal_icms_cst: crt === 1 ? undefined : rule.icms_code,
      fiscal_icms_config: icmsConfig,
      fiscal_cst_pis: rule.pis_cst || null,
      fiscal_pis_config: normalizeRecord(rule.pis_config),
      fiscal_cst_cofins: rule.cofins_cst || null,
      fiscal_cofins_config: normalizeRecord(rule.cofins_config),
      fiscal_ipi_cst: rule.ipi_cst || null,
      fiscal_ipi_config: normalizeRecord(rule.ipi_config),
      fiscal_beneficio: rule.benefit_code || null,
      fiscal_ibs_cbs_cst: rule.ibs_cbs_cst || null,
      fiscal_cclass_trib: rule.cclass_trib || null,
      fiscal_ibs_cbs_config: ibsConfig,
      fiscal_is_cst: rule.is_cst || null,
      fiscal_is_cclass_trib: rule.is_cclass_trib || null,
      fiscal_is_config: normalizeRecord(rule.is_config),
      fiscal_rtc_source_version: rule.rtc_source_version,
      fiscal_rtc_table_version: rule.rtc_table_version,
      fiscal_reducao_ibs: ibsConfig.reducao_ibs ?? 0,
      fiscal_reducao_cbs: ibsConfig.reducao_cbs ?? 0,
    };
  });
}

/**
 * Produção é sempre estrita: uma classificação gravada diretamente no produto
 * pode ajudar no cadastro/homologação, mas não substitui uma regra operacional
 * vigente e aprovada. O sinalizador permite aplicar a mesma trava antes de a
 * loja migrar para produção.
 */
export function requiresApprovedFiscalRules(settings: any): boolean {
  return (
    settings?.ambiente === "producao" ||
    settings?.require_approved_fiscal_rules === true
  );
}

export function buildFiscalItems(
  orderItems: any[],
  settings: any,
  productFiscalById: Map<string, any> = new Map(),
  operationDestination: 1 | 2 | 3 = 1,
) {
  const strictRuleMode = requiresApprovedFiscalRules(settings);
  return orderItems.map((item, index) => {
    const productFiscal = item.product_id
      ? productFiscalById.get(String(item.product_id)) || {}
      : {};
    if (strictRuleMode && !item.fiscal_rule_id) {
      throw new Error(
        `Item ${index + 1} (${item.product_name || item.name || "produto"}): ` +
          "nenhuma operação fiscal aprovada foi encontrada para esta venda",
      );
    }
    // Em modo estrito o produto fornece somente classificação fiscal. CFOP,
    // ICMS, contribuições e RTC vêm exclusivamente da operação aprovada.
    const legacyProduct = strictRuleMode ? {} : productFiscal;
    const quantity = Math.max(Number(item.quantity || 1), 0.0001);
    const unitPrice = money(item.price || item.valor_unitario || 0);
    const total = money(item.subtotal ?? unitPrice * quantity);
    const ncm = String(
      item.ncm ||
        item.fiscal_ncm ||
        productFiscal.fiscal_ncm ||
        settings.ncm_padrao ||
        "",
    )
      .replace(/\D/g, "")
      .padStart(8, "0")
      .slice(0, 8);
    const cstIbsCbs = onlyDigits(
      String(item.fiscal_ibs_cbs_cst || legacyProduct.fiscal_ibs_cbs_cst || ""),
    ).slice(0, 3);
    const cclassTrib = onlyDigits(
      String(item.fiscal_cclass_trib || legacyProduct.fiscal_cclass_trib || ""),
    ).slice(0, 6);
    const configuredRtc = normalizeRtcConfigForEmission(
      item.rtc_config ||
        item.fiscal_ibs_cbs_config ||
        legacyProduct.fiscal_ibs_cbs_config,
      cstIbsCbs,
      cclassTrib,
    );
    const configuredIbsUf = normalizeRecord(configuredRtc.ibsUf);
    const configuredIbsMun = normalizeRecord(configuredRtc.ibsMun);
    const configuredCbs = normalizeRecord(configuredRtc.cbs);
    const reducaoIbs = percentage(
      item.fiscal_reducao_ibs ??
        configuredIbsUf.reduction ??
        configuredIbsMun.reduction ??
        configuredRtc.reducao_ibs ??
        legacyProduct.fiscal_reducao_ibs ??
        0,
    );
    const reducaoCbs = percentage(
      item.fiscal_reducao_cbs ??
        configuredCbs.reduction ??
        configuredRtc.reducao_cbs ??
        legacyProduct.fiscal_reducao_cbs ??
        0,
    );
    const aliquotaIbsUf = percentage(
      configuredIbsUf.rate ??
        (strictRuleMode ? 0 : (settings.rtc_aliquota_ibs_uf ?? 0.1)),
    );
    const aliquotaIbsMun = percentage(
      configuredIbsMun.rate ??
        (strictRuleMode ? 0 : (settings.rtc_aliquota_ibs_mun ?? 0)),
    );
    const aliquotaCbs = percentage(
      configuredCbs.rate ??
        (strictRuleMode ? 0 : (settings.rtc_aliquota_cbs ?? 0.9)),
    );
    const baseIbsCbs = money(Math.max(0, total - money(item.discount || 0)));
    const aliquotaEfetivaIbsUf = effectiveRate(aliquotaIbsUf, reducaoIbs);
    const aliquotaEfetivaIbsMun = effectiveRate(aliquotaIbsMun, reducaoIbs);
    const aliquotaEfetivaCbs = effectiveRate(aliquotaCbs, reducaoCbs);
    const valorIbsUf = money((baseIbsCbs * aliquotaEfetivaIbsUf) / 100);
    const valorIbsMun = money((baseIbsCbs * aliquotaEfetivaIbsMun) / 100);
    const rtcClassified =
      /^\d{3}$/.test(cstIbsCbs) && /^\d{6}$/.test(cclassTrib);
    if (
      settings.rtc_enabled &&
      configuredRtc.mode !== "none" &&
      !rtcClassified
    ) {
      throw new Error(
        `Item ${index + 1} (${item.product_name || item.name || "produto"}): ` +
          "IBS/CBS está habilitado, mas faltam CST IBS/CBS (3 dígitos) e cClassTrib (6 dígitos) na regra fiscal aprovada",
      );
    }
    const rtcConfig = {
      ...configuredRtc,
      // Um item já classificado para a RTC não pode omitir o grupo por faltar
      // apenas `enabled` em um JSON legado. `mode: none` é a única desativação
      // explícita aceita para uma regra que não deve gerar IBS/CBS.
      enabled:
        configuredRtc.mode === "none"
          ? false
          : Boolean(
              configuredRtc.enabled || settings.rtc_enabled || rtcClassified,
            ),
      mode: configuredRtc.mode || "standard",
      ibsUf: {
        rate: configuredIbsUf.rate ?? aliquotaIbsUf,
        reduction:
          configuredIbsUf.reduction ?? configuredRtc.reducao_ibs ?? reducaoIbs,
        ...configuredIbsUf,
      },
      ibsMun: {
        rate: configuredIbsMun.rate ?? aliquotaIbsMun,
        reduction:
          configuredIbsMun.reduction ?? configuredRtc.reducao_ibs ?? reducaoIbs,
        ...configuredIbsMun,
      },
      cbs: {
        rate: configuredCbs.rate ?? aliquotaCbs,
        reduction:
          configuredCbs.reduction ?? configuredRtc.reducao_cbs ?? reducaoCbs,
        ...configuredCbs,
      },
    };
    const configuredIs = normalizeRecord(
      item.is_config || item.fiscal_is_config || legacyProduct.fiscal_is_config,
    );
    const selectiveConfig: Record<string, any> = {
      ...configuredIs,
      cst:
        configuredIs.cst || item.fiscal_is_cst || legacyProduct.fiscal_is_cst,
      cClassTrib:
        configuredIs.cClassTrib ||
        item.fiscal_is_cclass_trib ||
        legacyProduct.fiscal_is_cclass_trib,
    };
    const selectiveBase = money(selectiveConfig.vBC ?? baseIbsCbs);
    const selectiveValue = selectiveConfig.enabled
      ? money(
          selectiveConfig.value ??
            (selectiveBase * Number(selectiveConfig.rate || 0)) / 100 +
              (Number(selectiveConfig.quantity || 0) *
                Number(selectiveConfig.specificRate || 0)) /
                100,
        )
      : 0;
    const cstPis = String(
      item.fiscal_cst_pis ||
        legacyProduct.fiscal_cst_pis ||
        (strictRuleMode ? "" : settings.cst_pis_padrao || "07"),
    );
    const pisConfig = normalizeRecord(
      item.fiscal_pis_config || (strictRuleMode ? {} : item.pis_config),
    );
    const pisRate = Number(
      (strictRuleMode ? undefined : item.aliquota_pis) ?? pisConfig.rate ?? 0,
    );
    const pisValues = contributionValues(
      {
        ...item,
        valor_total: total,
        valor_desconto: money(item.discount || 0),
        quantidade: quantity,
        aliquota_pis: pisRate,
        pis_config: pisConfig,
      },
      "pis",
    );
    const cstCofins = String(
      item.fiscal_cst_cofins ||
        legacyProduct.fiscal_cst_cofins ||
        (strictRuleMode ? "" : settings.cst_cofins_padrao || "07"),
    );
    const cofinsConfig = normalizeRecord(
      item.fiscal_cofins_config || (strictRuleMode ? {} : item.cofins_config),
    );
    const cofinsRate = Number(
      (strictRuleMode ? undefined : item.aliquota_cofins) ??
        cofinsConfig.rate ??
        0,
    );
    const cofinsValues = contributionValues(
      {
        ...item,
        valor_total: total,
        valor_desconto: money(item.discount || 0),
        quantidade: quantity,
        aliquota_cofins: cofinsRate,
        cofins_config: cofinsConfig,
      },
      "cofins",
    );
    const rawIpiCst = String(
      item.fiscal_ipi_cst || legacyProduct.fiscal_ipi_cst || "",
    ).trim();
    const ipiCst = rawIpiCst ? normalizeTaxCst(rawIpiCst, "") : "";
    const ipiConfig = normalizeRecord(
      item.fiscal_ipi_config || legacyProduct.fiscal_ipi_config,
    );
    const ipiValues = calculateIpiValues({
      ...item,
      valor_total: total,
      valor_desconto: money(item.discount || 0),
      quantidade: quantity,
      ipi_config: ipiConfig,
    });
    const resolvedIcmsConfig = normalizeInternalIcmsConfig(
      item.fiscal_icms_config ||
        legacyProduct.fiscal_icms_config ||
        (strictRuleMode ? {} : item.icms_config || {}),
      settings,
      operationDestination,
    );
    return {
      product_id: item.product_id || null,
      regime_tributario: Number(settings.regime_tributario || 1),
      operation_type: String(item.operation_type || "sale"),
      fiscal_rule_id: item.fiscal_rule_id || null,
      codigo_produto: sanitizeCode(
        item.internal_code ||
          productFiscal.internal_code ||
          item.sku ||
          item.codigo_produto ||
          item.product_id ||
          String(index + 1).padStart(6, "0"),
      ),
      descricao: String(
        item.product_name || item.name || item.descricao || `Item ${index + 1}`,
      ),
      ncm,
      // O CFOP deve vir da regra da operacao/destino. Trocar somente o
      // primeiro digito e inseguro: diversas familias nao possuem par direto
      // (por exemplo, 5.405 e 6.404). A validacao abaixo bloqueia divergencias.
      cfop: onlyDigits(
        item.fiscal_cfop ||
          legacyProduct.fiscal_cfop ||
          (strictRuleMode ? "" : item.cfop || settings.cfop_padrao || ""),
      ).slice(0, 4),
      unidade: String(item.unidade || "UN"),
      quantidade: quantity,
      valor_unitario: unitPrice,
      valor_total: total,
      valor_desconto: money(item.discount || 0),
      origem:
        String(item.fiscal_origem || productFiscal.fiscal_origem || "0")
          .replace(/\D/g, "")
          .slice(0, 1) || "0",
      cest:
        String(item.fiscal_cest || productFiscal.fiscal_cest || "")
          .replace(/\D/g, "")
          .slice(0, 7) || null,
      cbenef:
        String(
          item.fiscal_beneficio || legacyProduct.fiscal_beneficio || "",
        ).trim() || null,
      informacoes_adicionais:
        String(
          item.fiscal_observacao || productFiscal.fiscal_observacao || "",
        ).trim() || null,
      cst_icms: normalizeIcmsCode(
        Number(settings.regime_tributario || 1),
        item.fiscal_icms_cst ||
          (Number(settings.regime_tributario || 1) === 1
            ? item.fiscal_csosn ||
              legacyProduct.fiscal_csosn ||
              (strictRuleMode ? "" : item.csosn || settings.csosn_padrao)
            : legacyProduct.fiscal_icms_cst ||
              legacyProduct.fiscal_csosn ||
              (strictRuleMode ? "" : item.cst_icms)),
      ),
      icms_config: resolvedIcmsConfig,
      rtc_config: rtcConfig,
      is_config: selectiveConfig,
      is_cst: item.fiscal_is_cst || legacyProduct.fiscal_is_cst || null,
      is_cclass_trib:
        item.fiscal_is_cclass_trib ||
        legacyProduct.fiscal_is_cclass_trib ||
        null,
      valor_is: selectiveValue,
      rtc_nt_version:
        item.fiscal_rtc_source_version ||
        (strictRuleMode ? null : settings.rtc_nt_version) ||
        null,
      rtc_table_version:
        item.fiscal_rtc_table_version ||
        (strictRuleMode ? null : settings.rtc_cclass_table_version) ||
        null,
      aliquota_icms: strictRuleMode
        ? Number(resolvedIcmsConfig.pICMS ?? resolvedIcmsConfig.rate ?? 0)
        : Number(item.aliquota_icms || 0),
      valor_icms: strictRuleMode ? 0 : Number(item.valor_icms || 0),
      icms_st_base_retida: money(
        Number(
          item.fiscal_icms_st_base_ret_unit ??
            legacyProduct.fiscal_icms_st_base_ret_unit ??
            0,
        ) * quantity,
      ),
      icms_st_aliquota: percentage(
        item.fiscal_icms_st_aliquota ??
          legacyProduct.fiscal_icms_st_aliquota ??
          0,
      ),
      icms_substituto: money(
        Number(
          item.fiscal_icms_substituto_unit ??
            legacyProduct.fiscal_icms_substituto_unit ??
            0,
        ) * quantity,
      ),
      icms_st_retido: money(
        Number(
          item.fiscal_icms_st_ret_unit ??
            legacyProduct.fiscal_icms_st_ret_unit ??
            0,
        ) * quantity,
      ),
      icms_efetivo_reducao: percentage(
        item.fiscal_icms_efetivo_reducao ??
          legacyProduct.fiscal_icms_efetivo_reducao ??
          0,
      ),
      icms_efetivo_aliquota: percentage(
        item.fiscal_icms_efetivo_aliquota ??
          legacyProduct.fiscal_icms_efetivo_aliquota ??
          0,
      ),
      cst_pis: cstPis,
      pis_config: pisConfig,
      aliquota_pis: pisRate,
      valor_pis: pisValues.value,
      cst_cofins: cstCofins,
      cofins_config: cofinsConfig,
      aliquota_cofins: cofinsRate,
      valor_cofins: cofinsValues.value,
      ipi_cst: ipiCst || null,
      ipi_config: ipiConfig,
      valor_ipi: ipiCst ? ipiValues.value : 0,
      cst_ibs_cbs: cstIbsCbs,
      cclass_trib: cclassTrib,
      aliquota_ibs_uf: aliquotaIbsUf,
      aliquota_ibs_mun: aliquotaIbsMun,
      aliquota_cbs: aliquotaCbs,
      reducao_ibs: reducaoIbs,
      reducao_cbs: reducaoCbs,
      valor_base_ibs_cbs: baseIbsCbs,
      valor_ibs_uf: valorIbsUf,
      valor_ibs_mun: valorIbsMun,
      valor_ibs: money(valorIbsUf + valorIbsMun),
      valor_cbs: money((baseIbsCbs * aliquotaEfetivaCbs) / 100),
    };
  });
}

type IbptApiResult = {
  Nacional?: number;
  Importado?: number;
  Estadual?: number;
  Municipal?: number;
  Fonte?: string;
  Versao?: string;
  Chave?: string;
  VigenciaInicio?: string;
  VigenciaFim?: string;
};

/**
 * Consulta a fonte oficial contratada pela empresa no IBPT e grava no item o
 * snapshot utilizado na emissão. A API recebe o valor total do item e devolve
 * percentuais aproximados vigentes para o NCM/UF.
 */
async function applyIbptApproximateTaxes(
  items: any[],
  settings: any,
): Promise<number> {
  if (!settings.ibpt_enabled) return 0;
  const token = String(settings.ibpt_token || "").trim();
  if (!token) {
    throw new Error(
      "IBPT está habilitado, mas o token da empresa não foi informado nas configurações fiscais",
    );
  }
  const cnpj = onlyDigits(settings.cnpj);
  const uf = String(settings.endereco_uf || "").toUpperCase();
  let totalTaxes = 0;

  for (const item of items) {
    const value = money(
      Math.max(
        0,
        Number(item.valor_total || 0) - Number(item.valor_desconto || 0),
      ),
    );
    const params = new URLSearchParams({
      token,
      cnpj,
      codigo: onlyDigits(item.ncm),
      uf,
      ex: "0",
      codigoInterno: String(item.codigo_produto || ""),
      descricao: String(item.descricao || "Produto"),
      unidadeMedida: String(item.unidade || "UN"),
      valor: value.toFixed(2),
      gtin: "SEM GTIN",
    });
    const response = await fetch(
      `https://apidoni.ibpt.org.br/api/v1/produtos?${params.toString()}`,
      { headers: { Accept: "application/json" } },
    );
    const payload = (await response
      .json()
      .catch(() => ({}))) as IbptApiResult & {
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `Falha na consulta IBPT do NCM ${item.ncm}: ${
          payload.message || response.status
        }`,
      );
    }
    const importedOrigins = new Set([1, 2, 3, 8]);
    const federalRate =
      Number(
        importedOrigins.has(Number(item.origem))
          ? payload.Importado
          : payload.Nacional,
      ) || 0;
    const stateRate = Number(payload.Estadual || 0);
    const municipalRate = Number(payload.Municipal || 0);
    const federalValue = money((value * federalRate) / 100);
    const stateValue = money((value * stateRate) / 100);
    const municipalValue = money((value * municipalRate) / 100);
    const itemTotal = money(federalValue + stateValue + municipalValue);
    item.valor_tributos_aproximados = itemTotal;
    item.ibpt_data = {
      federalRate,
      stateRate,
      municipalRate,
      federalValue,
      stateValue,
      municipalValue,
      source: payload.Fonte || "IBPT",
      version: payload.Versao || null,
      key: payload.Chave || null,
      validFrom: payload.VigenciaInicio || null,
      validUntil: payload.VigenciaFim || null,
    };
    totalTaxes = money(totalTaxes + itemTotal);
  }
  return totalTaxes;
}

export function allocateFiscalAdjustments(
  items: any[],
  deliveryFee: number,
  totalDiscount: number,
) {
  if (!items.length) return [];
  const gross = money(
    items.reduce((sum, item) => sum + Number(item.valor_total || 0), 0),
  );
  if (gross <= 0) {
    throw new Error(
      "A soma dos produtos deve ser maior que zero para ratear frete e desconto",
    );
  }
  let allocatedFreight = 0;
  let allocatedDiscount = 0;
  return items.map((item, index) => {
    const isLast = index === items.length - 1;
    const ratio = Number(item.valor_total || 0) / gross;
    const freight = isLast
      ? money(deliveryFee - allocatedFreight)
      : money(deliveryFee * ratio);
    const discount = isLast
      ? money(totalDiscount - allocatedDiscount)
      : money(totalDiscount * ratio);
    allocatedFreight = money(allocatedFreight + freight);
    allocatedDiscount = money(allocatedDiscount + discount);
    const adjusted = {
      ...item,
      valor_frete: freight,
      valor_desconto: discount,
      valor_pis: 0,
      valor_cofins: 0,
    };
    adjusted.valor_pis = contributionValues(adjusted, "pis").value;
    adjusted.valor_cofins = contributionValues(adjusted, "cofins").value;
    adjusted.valor_ipi = adjusted.ipi_cst
      ? calculateIpiValues(adjusted).value
      : 0;
    return adjusted;
  });
}

function percentage(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

function effectiveRate(nominalRate: number, reduction: number): number {
  return Number((nominalRate * (1 - percentage(reduction) / 100)).toFixed(4));
}

function normalizeTaxCst(value: string, fallback = "07") {
  return (
    String(value || fallback)
      .replace(/\D/g, "")
      .padStart(2, "0")
      .slice(0, 2) || fallback
  );
}

const PIS_COFINS_ALIQ_CSTS = ["01", "02"] as const;
const PIS_COFINS_QUANTITY_CSTS = ["03"] as const;
const PIS_COFINS_NT_CSTS = ["04", "05", "06", "07", "08", "09"] as const;
const PIS_COFINS_OTHER_CSTS = [
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
] as const;
const PIS_COFINS_CSTS = [
  ...PIS_COFINS_ALIQ_CSTS,
  ...PIS_COFINS_QUANTITY_CSTS,
  ...PIS_COFINS_NT_CSTS,
  ...PIS_COFINS_OTHER_CSTS,
] as const;

const IPI_TAXED_CSTS = ["00", "49", "50", "99"] as const;
const IPI_UNTAXED_CSTS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "51",
  "52",
  "53",
  "54",
  "55",
] as const;
const IPI_CSTS = [...IPI_TAXED_CSTS, ...IPI_UNTAXED_CSTS] as const;

function calculateIpiValues(item: any) {
  const config = normalizeRecord(item.ipi_config);
  const base = money(
    config.base ??
      Math.max(
        0,
        Number(item.valor_total || 0) - Number(item.valor_desconto || 0),
      ),
  );
  const rate = Number(config.rate ?? 0);
  const quantity = Number(config.quantity ?? item.quantidade ?? 0);
  const unitRate = Number(config.unitRate ?? config.unit_rate ?? 0);
  const calculated =
    config.mode === "quantity" ? quantity * unitRate : (base * rate) / 100;
  return {
    config,
    base,
    rate,
    quantity,
    unitRate,
    value: money(config.value ?? calculated),
  };
}

function validateIpi(item: any, label: string): string[] {
  if (!item.ipi_cst) return [];
  const cst = normalizeTaxCst(item.ipi_cst, "");
  const errors: string[] = [];
  if (!(IPI_CSTS as readonly string[]).includes(cst)) {
    return [
      `${label}: CST IPI ${
        cst || "(vazio)"
      } não é aceito pelo leiaute NF-e 4.00`,
    ];
  }
  const values = calculateIpiValues(item);
  if (!/^\d{1,3}$/.test(String(values.config.cEnq || ""))) {
    errors.push(
      `${label}: código de enquadramento do IPI (cEnq) deve ter de 1 a 3 dígitos`,
    );
  }
  if ((IPI_TAXED_CSTS as readonly string[]).includes(cst)) {
    if (values.config.mode === "quantity") {
      if (values.quantity <= 0 || values.unitRate <= 0) {
        errors.push(
          `${label}: quantidade e valor por unidade do IPI devem ser informados para CST ${cst}`,
        );
      }
    } else if (values.base <= 0 || values.rate < 0) {
      errors.push(
        `${label}: base e alíquota do IPI são inválidas para CST ${cst}`,
      );
    }
  }
  return errors;
}

export function buildIpiXml(item: any): string {
  if (!item.ipi_cst) return "";
  const cst = normalizeTaxCst(item.ipi_cst, "");
  const values = calculateIpiValues(item);
  const config = values.config;
  const producer = config.producerCnpj
    ? `<CNPJProd>${onlyDigits(config.producerCnpj)}</CNPJProd>`
    : "";
  const seal = config.sealCode
    ? `<cSelo>${escapeXml(config.sealCode)}</cSelo><qSelo>${onlyDigits(
        config.sealQuantity,
      )}</qSelo>`
    : "";
  const prefix = `<IPI>${producer}${seal}<cEnq>${escapeXml(
    config.cEnq,
  )}</cEnq>`;
  if ((IPI_UNTAXED_CSTS as readonly string[]).includes(cst)) {
    return `${prefix}<IPINT><CST>${cst}</CST></IPINT></IPI>`;
  }
  const calculation =
    config.mode === "quantity"
      ? `<qUnid>${fixed4(values.quantity)}</qUnid><vUnid>${fixed4(
          values.unitRate,
        )}</vUnid>`
      : `<vBC>${fixed2(values.base)}</vBC><pIPI>${fixed4(values.rate)}</pIPI>`;
  return `${prefix}<IPITrib><CST>${cst}</CST>${calculation}<vIPI>${fixed2(
    values.value,
  )}</vIPI></IPITrib></IPI>`;
}

function calculateIcmsUfDest(item: any) {
  const config = normalizeRecord(item.icms_config).difal;
  if (!config?.enabled) return null;
  const net = money(
    Math.max(
      0,
      Number(item.valor_total || 0) - Number(item.valor_desconto || 0),
    ),
  );
  const base = money(config.base ?? net);
  const fcpBase = money(config.fcpBase ?? base);
  const fcpRate = Number(config.fcpRate ?? 0);
  const internalRate = Number(config.internalRate);
  const interstateRate = Number(config.interstateRate);
  const destinationShare = Number(config.destinationShare ?? 100);
  const difference = money(
    Math.max(0, (base * (internalRate - interstateRate)) / 100),
  );
  const destinationValue = money(
    config.destinationValue ?? (difference * destinationShare) / 100,
  );
  return {
    base,
    fcpBase,
    fcpRate,
    internalRate,
    interstateRate,
    destinationShare,
    fcpValue: money(config.fcpValue ?? (fcpBase * fcpRate) / 100),
    destinationValue,
    originValue: money(config.originValue ?? difference - destinationValue),
  };
}

export function buildIcmsUfDestXml(item: any): string {
  const values = calculateIcmsUfDest(item);
  if (!values) return "";
  return (
    `<ICMSUFDest><vBCUFDest>${fixed2(values.base)}</vBCUFDest>` +
    `${
      values.fcpRate > 0
        ? `<vBCFCPUFDest>${fixed2(values.fcpBase)}</vBCFCPUFDest><pFCPUFDest>${fixed4(
            values.fcpRate,
          )}</pFCPUFDest>`
        : ""
    }` +
    `<pICMSUFDest>${fixed4(values.internalRate)}</pICMSUFDest><pICMSInter>${fixed2(
      values.interstateRate,
    )}</pICMSInter>` +
    `<pICMSInterPart>${fixed4(values.destinationShare)}</pICMSInterPart>` +
    `${
      values.fcpRate > 0
        ? `<vFCPUFDest>${fixed2(values.fcpValue)}</vFCPUFDest>`
        : ""
    }` +
    `<vICMSUFDest>${fixed2(
      values.destinationValue,
    )}</vICMSUFDest><vICMSUFRemet>${fixed2(
      values.originValue,
    )}</vICMSUFRemet></ICMSUFDest>`
  );
}

function contributionValues(item: any, contribution: "pis" | "cofins") {
  const config = normalizeRecord(item[`${contribution}_config`]);
  const netValue = money(
    Math.max(
      0,
      Number(item.valor_total || 0) - Number(item.valor_desconto || 0),
    ),
  );
  const base = money(config.base ?? netValue);
  const rate = Number(config.rate ?? item[`aliquota_${contribution}`] ?? 0);
  const quantity = Number(config.quantity ?? item.quantidade ?? 0);
  const unitRate = Number(config.unitRate ?? config.unit_rate ?? 0);
  const calculatedValue =
    config.mode === "quantity" ? quantity * unitRate : (base * rate) / 100;
  const explicitValue = config.value ?? item[`valor_${contribution}`];
  const value = money(
    explicitValue != null && Number(explicitValue) !== 0
      ? Number(explicitValue)
      : calculatedValue,
  );
  return { config, base, rate, quantity, unitRate, value };
}

function validateContribution(
  item: any,
  contribution: "pis" | "cofins",
  label: string,
): string[] {
  const fieldLabel = contribution === "pis" ? "PIS" : "COFINS";
  const cst = normalizeTaxCst(item[`cst_${contribution}`]);
  const errors: string[] = [];
  if (!(PIS_COFINS_CSTS as readonly string[]).includes(cst)) {
    return [
      `${label}: CST ${fieldLabel} ${cst} não é aceito pelo leiaute NF-e 4.00`,
    ];
  }
  const values = contributionValues(item, contribution);
  const isAliq = (PIS_COFINS_ALIQ_CSTS as readonly string[]).includes(cst);
  const isQuantity =
    cst === "03" ||
    ((PIS_COFINS_OTHER_CSTS as readonly string[]).includes(cst) &&
      values.config.mode === "quantity");
  if (isAliq) {
    if (values.base <= 0) {
      errors.push(
        `${label}: base de ${fieldLabel} deve ser maior que zero para CST ${cst}`,
      );
    }
    if (!Number.isFinite(values.rate) || values.rate <= 0) {
      errors.push(
        `${label}: alíquota de ${fieldLabel} deve ser informada para CST ${cst}`,
      );
    }
  }
  if (isQuantity) {
    if (!Number.isFinite(values.quantity) || values.quantity <= 0) {
      errors.push(
        `${label}: quantidade tributável de ${fieldLabel} deve ser informada para CST ${cst}`,
      );
    }
    if (!Number.isFinite(values.unitRate) || values.unitRate <= 0) {
      errors.push(
        `${label}: alíquota por unidade de ${fieldLabel} deve ser informada para CST ${cst}`,
      );
    }
  }
  if (!Number.isFinite(values.value) || values.value < 0) {
    errors.push(`${label}: valor de ${fieldLabel} inválido`);
  }
  return errors;
}

export function buildPisXml(item: any) {
  const cst = normalizeTaxCst(item.cst_pis);
  const values = contributionValues(item, "pis");
  let xml: string;
  if ((PIS_COFINS_ALIQ_CSTS as readonly string[]).includes(cst)) {
    xml = `<PIS><PISAliq><CST>${cst}</CST><vBC>${fixed2(
      values.base,
    )}</vBC><pPIS>${fixed4(values.rate)}</pPIS><vPIS>${fixed2(
      values.value,
    )}</vPIS></PISAliq></PIS>`;
  } else if (cst === "03") {
    xml = `<PIS><PISQtde><CST>03</CST><qBCProd>${fixed4(
      values.quantity,
    )}</qBCProd><vAliqProd>${fixed4(values.unitRate)}</vAliqProd><vPIS>${fixed2(
      values.value,
    )}</vPIS></PISQtde></PIS>`;
  } else if ((PIS_COFINS_NT_CSTS as readonly string[]).includes(cst)) {
    xml = `<PIS><PISNT><CST>${cst}</CST></PISNT></PIS>`;
  } else {
    const calculationXml =
      values.config.mode === "quantity"
        ? `<qBCProd>${fixed4(values.quantity)}</qBCProd><vAliqProd>${fixed4(
            values.unitRate,
          )}</vAliqProd>`
        : `<vBC>${fixed2(values.base)}</vBC><pPIS>${fixed4(values.rate)}</pPIS>`;
    xml = `<PIS><PISOutr><CST>${cst}</CST>${calculationXml}<vPIS>${fixed2(
      values.value,
    )}</vPIS></PISOutr></PIS>`;
  }
  return xml;
}

export function buildCofinsXml(item: any) {
  const cst = normalizeTaxCst(item.cst_cofins);
  const values = contributionValues(item, "cofins");
  if ((PIS_COFINS_ALIQ_CSTS as readonly string[]).includes(cst)) {
    return `<COFINS><COFINSAliq><CST>${cst}</CST><vBC>${fixed2(
      values.base,
    )}</vBC><pCOFINS>${fixed4(values.rate)}</pCOFINS><vCOFINS>${fixed2(
      values.value,
    )}</vCOFINS></COFINSAliq></COFINS>`;
  }
  if (cst === "03") {
    return `<COFINS><COFINSQtde><CST>03</CST><qBCProd>${fixed4(
      values.quantity,
    )}</qBCProd><vAliqProd>${fixed4(values.unitRate)}</vAliqProd><vCOFINS>${fixed2(
      values.value,
    )}</vCOFINS></COFINSQtde></COFINS>`;
  }
  if ((PIS_COFINS_NT_CSTS as readonly string[]).includes(cst)) {
    return `<COFINS><COFINSNT><CST>${cst}</CST></COFINSNT></COFINS>`;
  }
  const calculationXml =
    values.config.mode === "quantity"
      ? `<qBCProd>${fixed4(values.quantity)}</qBCProd><vAliqProd>${fixed4(
          values.unitRate,
        )}</vAliqProd>`
      : `<vBC>${fixed2(values.base)}</vBC><pCOFINS>${fixed4(
          values.rate,
        )}</pCOFINS>`;
  return `<COFINS><COFINSOutr><CST>${cst}</CST>${calculationXml}<vCOFINS>${fixed2(
    values.value,
  )}</vCOFINS></COFINSOutr></COFINS>`;
}

export function validateFiscalItemsForEmission(
  items: any[],
  settings: any,
  operationDestination: 1 | 2 | 3 = 1,
  context: { modelCode?: "55" | "65"; consumerData?: any } = {},
) {
  const crt = Number(settings.regime_tributario || 0);
  if (![1, 2, 3].includes(crt)) {
    throw new Error(
      `CRT ${
        crt || "não informado"
      } inválido. Use 1 para Simples Nacional, 2 para Simples com excesso de sublimite ou 3 para regime normal.`,
    );
  }

  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    const label = `Item ${index + 1} (${
      item.descricao || item.codigo_produto
    })`;
    const operationType = String(item.operation_type || "sale");
    if (!SUPPORTED_OPERATION_TYPES.has(operationType)) {
      errors.push(
        `${label}: finalidade '${operationType}' ainda não possui leiaute homologado; este motor aceita somente venda normal`,
      );
    }
    if (
      !/^\d{8}$/.test(String(item.ncm || "")) ||
      /^0{8}$/.test(String(item.ncm || ""))
    ) {
      errors.push(`${label}: NCM deve ter 8 dígitos`);
    }
    if (!/^\d{4}$/.test(String(item.cfop || ""))) {
      errors.push(`${label}: CFOP deve ter 4 dígitos`);
    }
    const expectedCfopPrefix = String(
      operationDestination === 1 ? 5 : operationDestination === 2 ? 6 : 7,
    );
    if (
      /^\d{4}$/.test(String(item.cfop || "")) &&
      !String(item.cfop).startsWith(expectedCfopPrefix)
    ) {
      errors.push(
        `${label}: CFOP ${item.cfop} incompatível com operação ${
          operationDestination === 1
            ? "interna"
            : operationDestination === 2
              ? "interestadual"
              : "com o exterior"
        }`,
      );
    }
    const icmsCode = normalizeIcmsCode(crt, item.cst_icms);
    const acceptedCodes: readonly string[] =
      crt === 1 ? SIMPLES_CSOSN : NORMAL_CST;
    if (!acceptedCodes.includes(icmsCode)) {
      errors.push(
        `${label}: ${crt === 1 ? "CSOSN" : "CST ICMS"} ${
          icmsCode || "(vazio)"
        } inválido`,
      );
    } else {
      // O CSOSN/CST efetivo já foi selecionado pela regra fiscal vigente da
      // operação (modelo, CRT, destino, destinatário, finalidade e vigência).
      // Não existe no leiaute da NF-e uma proibição geral do CSOSN 900 para
      // destinatário não contribuinte. Rejeitá-lo aqui por uma lista fixa
      // transformava uma classificação operacional válida em trava de
      // produto e duplicava, incorretamente, a decisão do resolvedor.
      try {
        validateIcmsItem({ ...item, cst_icms: icmsCode }, crt);
      } catch (error) {
        errors.push(`${label}: ${getErrorMessage(error)}`);
      }
    }
    errors.push(...validateContribution(item, "pis", label));
    errors.push(...validateContribution(item, "cofins", label));
    errors.push(...validateIpi(item, label));
    const difal = calculateIcmsUfDest(item);
    const difalRequired = requiresIcmsUfDest(
      crt,
      context.modelCode,
      operationDestination,
      context.consumerData,
    );
    if (difalRequired && !difal) {
      errors.push(
        `${label}: DIFAL/ICMSUFDest deve estar configurado na regra aprovada para venda interestadual a consumidor final não contribuinte`,
      );
    }
    if (difal) {
      if (!difalRequired) {
        errors.push(
          `${label}: DIFAL/ICMSUFDest foi configurado para uma operação em que o grupo não se aplica`,
        );
      }
      if (difal.base <= 0 || difal.internalRate <= 0) {
        errors.push(
          `${label}: base e alíquota interna do DIFAL devem ser maiores que zero`,
        );
      }
      if (![4, 7, 12].includes(difal.interstateRate)) {
        errors.push(
          `${label}: alíquota interestadual do DIFAL deve ser 4%, 7% ou 12%`,
        );
      }
      if (difal.destinationShare !== 100) {
        errors.push(
          `${label}: percentual vigente de partilha do DIFAL deve ser 100%`,
        );
      }
    }
    if (item.cest && !/^\d{7}$/.test(String(item.cest))) {
      errors.push(`${label}: CEST deve ter 7 dígitos`);
    }
    if (ICMS_ST_CODES_REQUIRING_CEST.has(icmsCode)) {
      if (!item.cest) {
        errors.push(
          `${label}: CEST é obrigatório para mercadoria sujeita a ICMS-ST (${
            crt === 1 ? "CSOSN" : "CST"
          } ${icmsCode})`,
        );
      }
    }
    const quantity = Number(item.quantidade || 0);
    const unitValue = Number(item.valor_unitario || 0);
    const productValue = Number(item.valor_total || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${label}: quantidade comercial deve ser maior que zero`);
    }
    if (!Number.isFinite(unitValue) || unitValue < 0) {
      errors.push(`${label}: valor unitário não pode ser negativo`);
    }
    if (Math.abs(money(quantity * unitValue) - money(productValue)) > 0.01) {
      errors.push(
        `${label}: valor do produto não confere com quantidade × valor unitário`,
      );
    }
    try {
      validateRtcItem(item);
    } catch (error) {
      errors.push(`${label}: ${getErrorMessage(error)}`);
    }
    const rtcConfig = normalizeRecord(item.rtc_config);
    const selectiveConfig = normalizeRecord(item.is_config);
    if (
      settings.rtc_strict_validation &&
      (rtcConfig.enabled || selectiveConfig.enabled)
    ) {
      if (!item.rtc_nt_version) {
        errors.push(`${label}: versão da Nota Técnica RTC não registrada`);
      }
      if (!item.rtc_table_version) {
        errors.push(
          `${label}: versão da tabela oficial CST/cClassTrib não registrada`,
        );
      }
      if (!item.fiscal_rule_id) {
        errors.push(
          `${label}: RTC exige regra fiscal versionada e aprovada, não apenas cadastro do produto`,
        );
      }
    }
  }
  if (errors.length) {
    throw new Error(
      `Configuração fiscal da operação incompleta: ${errors
        .slice(0, 5)
        .join("; ")}`,
    );
  }
}

export function generateNFCeXML(input: {
  fiscalSettings: any;
  cupom: any;
  order: any;
  items: any[];
  consumerData?: any;
  observacoes?: string;
  paymentMethod: string;
  deliveryFee: number;
  totalProdutos: number;
  valorDesconto: number;
  valorTotal: number;
  valorTributos?: number;
  modelCode?: "55" | "65";
}): string {
  const {
    fiscalSettings,
    cupom,
    order,
    items,
    consumerData,
    observacoes,
    paymentMethod,
    deliveryFee,
    totalProdutos,
    valorDesconto,
    valorTotal,
    valorTributos = 0,
    modelCode = "65",
  } = input;
  const isHomologacao = fiscalSettings.ambiente !== "producao";
  const operationDestination = resolveOperationDestination(
    fiscalSettings,
    consumerData,
    modelCode,
  );
  const dhEmi = formatNfeDate(
    new Date(cupom.data_hora_emissao),
    fiscalSettings.endereco_uf,
  );
  const codigoMunicipio = resolveMunicipalityCode(fiscalSettings);
  const consumidorDoc = onlyDigits(consumerData?.cpf_cnpj);
  const totalPis = money(
    items.reduce((sum, item) => sum + contributionValues(item, "pis").value, 0),
  );
  const totalCofins = money(
    items.reduce(
      (sum, item) => sum + contributionValues(item, "cofins").value,
      0,
    ),
  );
  const totalIpi = money(
    items.reduce(
      (sum, item) => sum + (item.ipi_cst ? calculateIpiValues(item).value : 0),
      0,
    ),
  );
  const difalTotals = items.reduce(
    (totals, item) => {
      const values = calculateIcmsUfDest(item);
      if (!values) return totals;
      totals.fcp = money(totals.fcp + values.fcpValue);
      totals.destination = money(totals.destination + values.destinationValue);
      totals.origin = money(totals.origin + values.originValue);
      return totals;
    },
    { fcp: 0, destination: 0, origin: 0 },
  );
  const detXml = items
    .map((item, index) => {
      const productName =
        isHomologacao && index === 0
          ? "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
          : item.descricao;
      const cestXml = item.cest ? `<CEST>${escapeXml(item.cest)}</CEST>` : "";
      const benefitXml = item.cbenef
        ? `<cBenef>${escapeXml(item.cbenef)}</cBenef>`
        : "";
      const additionalXml = item.informacoes_adicionais
        ? `<infAdProd>${escapeXml(item.informacoes_adicionais)}</infAdProd>`
        : "";
      const approximateTax = Number(item.valor_tributos_aproximados || 0);
      const approximateTaxXml =
        approximateTax > 0
          ? `<vTotTrib>${fixed2(approximateTax)}</vTotTrib>`
          : "";
      return `<det nItem="${index + 1}"><prod><cProd>${escapeXml(
        item.codigo_produto,
      )}</cProd><cEAN>SEM GTIN</cEAN><xProd>${escapeXml(
        productName,
      )}</xProd><NCM>${item.ncm}</NCM>${cestXml}${benefitXml}<CFOP>${item.cfop}</CFOP><uCom>${escapeXml(
        item.unidade,
      )}</uCom><qCom>${fixed4(item.quantidade)}</qCom><vUnCom>${fixed4(
        item.valor_unitario,
      )}</vUnCom><vProd>${fixed2(
        item.valor_total,
      )}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>${escapeXml(
        item.unidade,
      )}</uTrib><qTrib>${fixed4(item.quantidade)}</qTrib><vUnTrib>${fixed4(
        item.valor_unitario,
      )}</vUnTrib>${
        Number(item.valor_frete || 0) > 0
          ? `<vFrete>${fixed2(item.valor_frete)}</vFrete>`
          : ""
      }${
        Number(item.valor_desconto || 0) > 0
          ? `<vDesc>${fixed2(item.valor_desconto)}</vDesc>`
          : ""
      }<indTot>1</indTot></prod><imposto>${approximateTaxXml}${buildIcmsGroupXml(
        item,
        Number(fiscalSettings.regime_tributario || 1),
      )}${buildIpiXml(item)}${buildPisXml(item)}${buildCofinsXml(item)}${buildIcmsUfDestXml(
        item,
      )}${buildRtcItemXml(item)}</imposto>${additionalXml}</det>`;
    })
    .join("");

  const recipientAddressXml =
    modelCode === "55"
      ? `<enderDest><xLgr>${escapeXml(consumerData?.address || "")}</xLgr><nro>${escapeXml(
          consumerData?.address_number || "",
        )}</nro>${
          consumerData?.address_complement
            ? `<xCpl>${escapeXml(consumerData.address_complement)}</xCpl>`
            : ""
        }<xBairro>${escapeXml(consumerData?.neighborhood || "")}</xBairro><cMun>${onlyDigits(
          consumerData?.city_code,
        )}</cMun><xMun>${escapeXml(consumerData?.city || "")}</xMun><UF>${escapeXml(
          String(consumerData?.state || "").toUpperCase(),
        )}</UF><CEP>${onlyDigits(
          consumerData?.postal_code,
        )}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>`
      : "";
  const recipientIe = String(consumerData?.state_registration || "").trim();
  // A SEFAZ exige a razão padronizada do destinatário em homologação. Além
  // disso, caracteres como o travessão Unicode ficam fora do padrão TString
  // do XSD 4.00. Normalizar aqui evita depender do texto digitado/cadastrado.
  const recipientName = isHomologacao
    ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
    : String(consumerData?.nome || "").trim();
  const destXml = consumidorDoc
    ? `<dest>${
        consumidorDoc.length === 11
          ? `<CPF>${consumidorDoc}</CPF>`
          : `<CNPJ>${consumidorDoc}</CNPJ>`
      }${
        recipientName ? `<xNome>${escapeXml(recipientName)}</xNome>` : ""
      }${recipientAddressXml}<indIEDest>${Number(
        consumerData?.state_registration_indicator || 9,
      )}</indIEDest>${recipientIe ? `<IE>${escapeXml(recipientIe)}</IE>` : ""}${
        consumerData?.email
          ? `<email>${escapeXml(consumerData.email)}</email>`
          : ""
      }</dest>`
    : "";
  const paymentXml = buildPaymentDetailsXml(order, paymentMethod, valorTotal);
  const icmsTotals = calculateIcmsTotals(items);
  const ibptTotals = items.reduce(
    (acc, item) => {
      const ibpt = normalizeRecord(item.ibpt_data);
      acc.federal = money(acc.federal + Number(ibpt.federalValue || 0));
      acc.state = money(acc.state + Number(ibpt.stateValue || 0));
      acc.municipal = money(acc.municipal + Number(ibpt.municipalValue || 0));
      if (!acc.source && ibpt.source) acc.source = String(ibpt.source);
      if (!acc.version && ibpt.version) acc.version = String(ibpt.version);
      if (!acc.key && ibpt.key) acc.key = String(ibpt.key);
      return acc;
    },
    { federal: 0, state: 0, municipal: 0, source: "", version: "", key: "" },
  );
  const ibptDisclosure =
    valorTributos > 0
      ? `Tributos aproximados: R$ ${fixed2(valorTributos)} (Federal R$ ${fixed2(
          ibptTotals.federal,
        )}, Estadual R$ ${fixed2(ibptTotals.state)}, Municipal R$ ${fixed2(
          ibptTotals.municipal,
        )}). Fonte: ${ibptTotals.source || "IBPT"}${
          ibptTotals.version ? ` versão ${ibptTotals.version}` : ""
        }${ibptTotals.key ? ` chave ${ibptTotals.key}` : ""}.`
      : "";
  const additionalInformation = [
    String(observacoes || "").trim(),
    ibptDisclosure,
  ]
    .filter(Boolean)
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${cupom.chave_acesso}" versao="4.00"><ide><cUF>${getCodigoUF(
    fiscalSettings.endereco_uf,
  )}</cUF><cNF>${cupom.chave_acesso.substring(35, 43)}</cNF><natOp>${escapeXml(
    fiscalSettings.operation_nature || "Venda de mercadoria",
  )}</natOp><mod>${modelCode}</mod><serie>${Number(
    cupom.serie,
  )}</serie><nNF>${cupom.numero}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>${operationDestination}</idDest><cMunFG>${codigoMunicipio}</cMunFG><tpImp>${
    modelCode === "55" ? "1" : "4"
  }</tpImp><tpEmis>1</tpEmis><cDV>${cupom.chave_acesso.slice(-1)}</cDV><tpAmb>${
    isHomologacao ? "2" : "1"
  }</tpAmb><finNFe>1</finNFe><indFinal>${
    consumerData?.final_consumer === false ? "0" : "1"
  }</indFinal><indPres>${Number(
    consumerData?.presence_indicator ?? 1,
  )}</indPres><procEmi>0</procEmi><verProc>PopSystem-1.0</verProc></ide><emit><CNPJ>${onlyDigits(
    fiscalSettings.cnpj,
  )}</CNPJ><xNome>${escapeXml(fiscalSettings.razao_social)}</xNome><xFant>${escapeXml(
    fiscalSettings.nome_fantasia || fiscalSettings.razao_social,
  )}</xFant><enderEmit><xLgr>${escapeXml(
    fiscalSettings.endereco_logradouro,
  )}</xLgr><nro>${escapeXml(fiscalSettings.endereco_numero)}</nro>${
    fiscalSettings.endereco_complemento
      ? `<xCpl>${escapeXml(fiscalSettings.endereco_complemento)}</xCpl>`
      : ""
  }<xBairro>${escapeXml(
    fiscalSettings.endereco_bairro,
  )}</xBairro><cMun>${codigoMunicipio}</cMun><xMun>${escapeXml(
    fiscalSettings.endereco_municipio,
  )}</xMun><UF>${escapeXml(fiscalSettings.endereco_uf)}</UF><CEP>${onlyDigits(
    fiscalSettings.endereco_cep,
  )}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${escapeXml(
    fiscalSettings.inscricao_estadual || "ISENTO",
  )}</IE><CRT>${Number(
    fiscalSettings.regime_tributario || 1,
  )}</CRT></emit>${destXml}${detXml}<total><ICMSTot><vBC>${fixed2(
    icmsTotals.vBC,
  )}</vBC><vICMS>${fixed2(icmsTotals.vICMS)}</vICMS><vICMSDeson>${fixed2(
    icmsTotals.vICMSDeson,
  )}</vICMSDeson>${
    difalTotals.fcp > 0
      ? `<vFCPUFDest>${fixed2(difalTotals.fcp)}</vFCPUFDest>`
      : ""
  }${
    difalTotals.destination > 0
      ? `<vICMSUFDest>${fixed2(difalTotals.destination)}</vICMSUFDest>`
      : ""
  }${
    difalTotals.origin > 0
      ? `<vICMSUFRemet>${fixed2(difalTotals.origin)}</vICMSUFRemet>`
      : ""
  }<vFCP>${fixed2(icmsTotals.vFCP)}</vFCP><vBCST>${fixed2(
    icmsTotals.vBCST,
  )}</vBCST><vST>${fixed2(icmsTotals.vST)}</vST><vFCPST>${fixed2(
    icmsTotals.vFCPST,
  )}</vFCPST><vFCPSTRet>${fixed2(icmsTotals.vFCPSTRet)}</vFCPSTRet><vProd>${fixed2(
    totalProdutos,
  )}</vProd><vFrete>${fixed2(deliveryFee)}</vFrete><vSeg>0.00</vSeg><vDesc>${fixed2(
    valorDesconto,
  )}</vDesc><vII>0.00</vII><vIPI>${fixed2(
    totalIpi,
  )}</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${fixed2(totalPis)}</vPIS><vCOFINS>${fixed2(
    totalCofins,
  )}</vCOFINS><vOutro>0.00</vOutro><vNF>${fixed2(valorTotal)}</vNF>${
    valorTributos > 0 ? `<vTotTrib>${fixed2(valorTributos)}</vTotTrib>` : ""
  }</ICMSTot>${buildRtcTotalsXml(
    items,
    valorTotal,
  )}</total><transp><modFrete>9</modFrete></transp><pag>${paymentXml}</pag>${
    additionalInformation
      ? `<infAdic><infCpl>${escapeXml(
          additionalInformation,
        )}</infCpl></infAdic>`
      : ""
  }</infNFe></NFe>`;
}

export function validateGeneratedFiscalXml(
  xml: string,
  expected: {
    accessKey: string;
    modelCode: "55" | "65";
    items: any[];
    totalProdutos: number;
    deliveryFee: number;
    valorDesconto: number;
    valorTotal: number;
  },
) {
  const errors: string[] = [];
  if (
    !xml ||
    !xml.includes('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">')
  ) {
    errors.push("raiz NFe/namespace ausente");
  }
  if (/\b(?:undefined|null|NaN|Infinity)\b/.test(xml)) {
    errors.push("XML contém valor indefinido ou não numérico");
  }
  if (!xml.includes(`<infNFe Id="NFe${expected.accessKey}" versao="4.00">`)) {
    errors.push("chave de acesso/versão divergente no infNFe");
  }
  if (!xml.includes(`<mod>${expected.modelCode}</mod>`)) {
    errors.push(`modelo ${expected.modelCode} divergente no XML`);
  }
  const itemNumbers = Array.from(xml.matchAll(/<det nItem="(\d+)">/g)).map(
    (match) => Number(match[1]),
  );
  if (
    itemNumbers.length !== expected.items.length ||
    itemNumbers.some((value, index) => value !== index + 1)
  ) {
    errors.push("itens ausentes, duplicados ou fora de sequência");
  }
  const expectedRtcItems = expected.items.filter((item) =>
    normalizeRecord(item.rtc_config).enabled
  ).length;
  const xmlRtcItems = Array.from(xml.matchAll(/<IBSCBS>/g)).length;
  if (xmlRtcItems !== expectedRtcItems) {
    errors.push(
      `grupo IBS/CBS ausente ou duplicado: esperado em ${expectedRtcItems} item(ns), encontrado em ${xmlRtcItems}`,
    );
  }
  if (expectedRtcItems > 0 && !xml.includes("<IBSCBSTot>")) {
    errors.push("totalização IBS/CBS ausente");
  }

  const totalBlock = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/)?.[1] || "";
  const totalTag = (name: string) => {
    const value = totalBlock.match(
      new RegExp(`<${name}>([-0-9.]+)<\\/${name}>`),
    )?.[1];
    return value == null ? Number.NaN : Number(value);
  };
  if (Math.abs(totalTag("vProd") - money(expected.totalProdutos)) > 0.01) {
    errors.push("vProd do total diverge da soma dos itens");
  }
  if (Math.abs(totalTag("vFrete") - money(expected.deliveryFee)) > 0.01) {
    errors.push("vFrete do total diverge da taxa de entrega");
  }
  if (Math.abs(totalTag("vDesc") - money(expected.valorDesconto)) > 0.01) {
    errors.push("vDesc do total diverge do desconto da venda");
  }
  if (Math.abs(totalTag("vNF") - money(expected.valorTotal)) > 0.01) {
    errors.push("vNF do XML diverge do valor da venda");
  }
  const fiscalEquation = money(
    totalTag("vProd") -
      totalTag("vDesc") -
      totalTag("vICMSDeson") +
      totalTag("vST") +
      totalTag("vFCPST") +
      totalTag("vFrete") +
      totalTag("vSeg") +
      totalTag("vOutro") +
      totalTag("vII") +
      totalTag("vIPI") +
      totalTag("vIPIDevol"),
  );
  if (Math.abs(fiscalEquation - totalTag("vNF")) > 0.01) {
    errors.push(
      `fórmula legal do total não fecha: componentes resultam em ${fixed2(
        fiscalEquation,
      )}, mas vNF é ${fixed2(totalTag("vNF"))}`,
    );
  }
  const sumItemTag = (name: "vFrete" | "vDesc") =>
    money(
      Array.from(
        xml.matchAll(
          new RegExp(
            `<prod>[\\s\\S]*?<${name}>([0-9.]+)<\\/${name}>[\\s\\S]*?<\\/prod>`,
            "g",
          ),
        ),
      ).reduce((sum, match) => sum + Number(match[1]), 0),
    );
  if (Math.abs(sumItemTag("vFrete") - totalTag("vFrete")) > 0.01) {
    errors.push("soma do frete dos itens diverge do vFrete total");
  }
  if (Math.abs(sumItemTag("vDesc") - totalTag("vDesc")) > 0.01) {
    errors.push("soma dos descontos dos itens diverge do vDesc total");
  }
  if (!/<pag><detPag>/.test(xml)) errors.push("grupo de pagamento ausente");
  if (errors.length) {
    throw new Error(
      `Pré-validação fiscal impediu a transmissão: ${errors.join("; ")}`,
    );
  }
}

export function resolveOperationDestination(
  fiscalSettings: any,
  consumerData: NFCeData["consumer_data"] | undefined,
  modelCode: "55" | "65" = "65",
): 1 | 2 | 3 {
  if (modelCode === "65") return 1;
  const issuerState = String(fiscalSettings?.endereco_uf || "")
    .trim()
    .toUpperCase();
  const recipientState = String(consumerData?.state || "")
    .trim()
    .toUpperCase();
  const countryCode = onlyDigits(consumerData?.country_code || "1058");
  if (recipientState === "EX" || (countryCode && countryCode !== "1058")) {
    return 3;
  }
  if (!/^[A-Z]{2}$/.test(issuerState) || !/^[A-Z]{2}$/.test(recipientState)) {
    throw new Error(
      "Não foi possível determinar o destino fiscal: confira a UF do emitente e do destinatário.",
    );
  }
  return issuerState === recipientState ? 1 : 2;
}

export function normalizeCfopForDestination(
  cfopValue: unknown,
  operationDestination: 1 | 2 | 3,
): string {
  const cfop = onlyDigits(String(cfopValue || ""));
  if (!/^\d{4}$/.test(cfop)) return cfop;
  if (!/^[567]/.test(cfop)) {
    throw new Error(`CFOP ${cfop} inválido para uma operação de saída.`);
  }
  const expectedPrefix =
    operationDestination === 1 ? "5" : operationDestination === 2 ? "6" : "7";
  if (cfop.startsWith(expectedPrefix)) return cfop;

  // Correspondências explícitas. A legislação não permite inferir um CFOP
  // trocando somente o primeiro dígito (por exemplo, 5.405 corresponde a
  // 6.404, e não a 6.405). Novas famílias devem entrar nesta matriz somente
  // depois da validação fiscal.
  const families: string[][] = [
    ["5101", "6101", "7101"],
    ["5102", "6102", "7102"],
    ["5405", "6404"],
  ];
  const family = families.find((codes) => codes.includes(cfop));
  const resolved = family?.find((code) => code.startsWith(expectedPrefix));
  if (resolved) return resolved;

  throw new Error(
    `CFOP ${cfop} não possui correspondência fiscal aprovada para idDest ${operationDestination}. Cadastre a regra exata da operação.`,
  );
}

function buildPaymentDetailsXml(
  order: any,
  paymentMethod: string,
  valorTotal: number,
): string {
  const lines = normalizeFiscalPaymentLines(order, paymentMethod, valorTotal);
  const paid = money(lines.reduce((sum, line) => sum + line.amount, 0));
  if (paid + 0.01 < money(valorTotal)) {
    throw new Error(
      `Pagamentos (${fixed2(paid)}) são menores que o total fiscal (${fixed2(
        valorTotal,
      )})`,
    );
  }
  const change = money(paid - valorTotal);
  if (change > 0 && !lines.some((line) => line.method === "dinheiro")) {
    throw new Error(
      "Pagamentos maiores que a nota só podem gerar troco quando houver pagamento em dinheiro",
    );
  }
  const details = lines
    .map((line: { method: string; amount: number }) => {
      const tPag = mapPaymentMethod(line.method);
      const cardXml = buildPaymentCardXml(tPag, order, line.method);
      return `<detPag><indPag>0</indPag><tPag>${tPag}</tPag><vPag>${fixed2(
        line.amount,
      )}</vPag>${cardXml}</detPag>`;
    })
    .join("");
  return `${details}${change > 0 ? `<vTroco>${fixed2(change)}</vTroco>` : ""}`;
}

function normalizeFiscalPaymentLines(
  order: any,
  paymentMethod: string,
  valorTotal: number,
): Array<{ method: string; amount: number }> {
  const splitLines = Array.isArray(order?.variations?.payment_split?.lines)
    ? order.variations.payment_split.lines
    : [];

  const validSplitLines = splitLines
    .map((line: any) => ({
      method: normalizeFiscalPaymentMethod(
        line?.method || line?.label || paymentMethod,
      ),
      amount: money(Number(line?.amount || 0)),
    }))
    .filter((line: any) => line.amount > 0);

  if (validSplitLines.length > 0) {
    const totals = new Map<string, number>();
    validSplitLines.forEach((line: { method: string; amount: number }) => {
      totals.set(
        line.method,
        money((totals.get(line.method) || 0) + line.amount),
      );
    });
    return Array.from(totals, ([method, amount]) => ({ method, amount }));
  }

  return [
    {
      method: normalizeFiscalPaymentMethod(paymentMethod),
      amount: money(valorTotal),
    },
  ];
}

function normalizeFiscalPaymentMethod(method: string): string {
  const normalized = normalizeTextKey(String(method || "")).replace(
    /[^A-Z0-9]/g,
    "_",
  );
  if (normalized.includes("PIX")) {
    return normalized.includes("ONLINE") ? "pix_online" : "pix";
  }
  if (normalized.includes("DEBITO") || normalized.includes("DEBIT")) {
    return "cartao_debito";
  }
  if (normalized.includes("CREDITO") || normalized.includes("CREDIT")) {
    return "cartao_credito";
  }
  if (normalized.includes("CARTAO") || normalized.includes("CARD")) {
    return "cartao_credito";
  }
  if (normalized.includes("DINHEIRO") || normalized.includes("CASH")) {
    return "dinheiro";
  }
  return String(method || "");
}

function buildPaymentCardXml(tPag: string, order: any, method: string): string {
  if (!["03", "04", "17"].includes(tPag)) return "";

  if (tPag === "17") {
    return "<card><tpIntegra>2</tpIntegra></card>";
  }

  const tef = order?.variations?.tef || {};
  const acquirerCnpj = onlyDigits(tef?.acquirer_cnpj || tef?.cnpj || "");
  const authorizationCode = String(
    tef?.auth || tef?.authorization_code || tef?.cAut || "",
  ).trim();
  const brandCode = mapCardBrand(tef?.brand);

  if (
    acquirerCnpj.length === 14 &&
    authorizationCode &&
    ["03", "04"].includes(tPag)
  ) {
    return `<card><tpIntegra>1</tpIntegra><CNPJ>${acquirerCnpj}</CNPJ>${
      brandCode ? `<tBand>${brandCode}</tBand>` : ""
    }<cAut>${escapeXml(authorizationCode).slice(0, 128)}</cAut></card>`;
  }

  return "<card><tpIntegra>2</tpIntegra></card>";
}

function mapCardBrand(value: unknown): string {
  const brand = normalizeTextKey(String(value || ""));
  if (!brand) return "";
  if (brand.includes("VISA")) return "01";
  if (brand.includes("MASTER")) return "02";
  if (brand.includes("AMERICAN") || brand.includes("AMEX")) return "03";
  if (brand.includes("SOROCRED")) return "04";
  if (brand.includes("DINERS")) return "05";
  if (brand.includes("ELO")) return "06";
  if (brand.includes("HIPER")) return "07";
  if (brand.includes("AURA")) return "08";
  if (brand.includes("CABAL")) return "09";
  return "99";
}

function mapPaymentMethod(method: string): string {
  const normalized = normalizeFiscalPaymentMethod(method);
  if (normalized.includes("pix")) return "17";
  if (normalized.includes("cartao_debito")) return "04";
  if (normalized.includes("cartao_credito")) return "03";
  if (normalized.includes("dinheiro")) return "01";
  return "99";
}

function getCodigoUF(uf: string): string {
  const codigos: Record<string, string> = {
    AC: "12",
    AL: "27",
    AP: "16",
    AM: "13",
    BA: "29",
    CE: "23",
    DF: "53",
    ES: "32",
    GO: "52",
    MA: "21",
    MT: "51",
    MS: "50",
    MG: "31",
    PA: "15",
    PB: "25",
    PR: "41",
    PE: "26",
    PI: "22",
    RJ: "33",
    RN: "24",
    RS: "43",
    RO: "11",
    RR: "14",
    SC: "42",
    SP: "35",
    SE: "28",
    TO: "17",
  };
  const normalizedUf = String(uf || "").toUpperCase();
  const codigo = codigos[normalizedUf];
  if (!codigo) {
    throw new Error(`UF fiscal invalida ou nao suportada: ${uf || "(vazia)"}`);
  }
  return codigo;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function required(value: string | undefined, field: string): string {
  if (!value) throw new Error(`${field} e obrigatorio`);
  return value;
}

function onlyDigits(value?: string): string {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeCode(value: string): string {
  return (
    String(value || "")
      .replace(/[^\w.-]/g, "")
      .slice(0, 60) || "000001"
  );
}

function escapeXml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function money(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function fixed2(value: number): string {
  return money(value).toFixed(2);
}

function fixed4(value: number): string {
  return Number(value || 0).toFixed(4);
}

function getNfeTimeZone(uf: string): string {
  return NFE_TIMEZONES[String(uf || "").toUpperCase()] || "America/Sao_Paulo";
}

function getNfeDateParts(date: Date, uf: string) {
  const timeZone = getNfeTimeZone(uf);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const offsetName =
    offsetFormatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || "GMT-03:00";
  const offset = offsetName.replace(/^GMT/i, "") || "-03:00";
  return {
    year: parts.year || String(date.getUTCFullYear()),
    month: parts.month || String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: parts.day || String(date.getUTCDate()).padStart(2, "0"),
    hour: parts.hour === "24" ? "00" : parts.hour || "00",
    minute: parts.minute || "00",
    second: parts.second || "00",
    offset: /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "-03:00",
  };
}

function formatNfeDate(date: Date, uf: string): string {
  const parts = getNfeDateParts(date, uf);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.offset}`;
}

function normalizeTextKey(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveMunicipalityCode(settings: any): string {
  const raw = onlyDigits(settings?.codigo_municipio);
  if (raw.length === 7) return raw;
  const uf = String(settings?.endereco_uf || "").toUpperCase();
  const city = normalizeTextKey(settings?.endereco_municipio);
  return MUNICIPALITY_CODE_OVERRIDES[`${uf}|${city}`] || raw;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || "Erro desconhecido");
}
