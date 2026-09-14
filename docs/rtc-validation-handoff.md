# Validação fiscal — IBS, CBS e Imposto Seletivo

## Escopo implementado

- grupos de item `IS` e `IBSCBS` da NT 2025.002;
- IBS estadual, IBS municipal e CBS;
- redução de alíquota, diferimento, devolução de tributo e crédito presumido;
- tributação regular (`gTribRegular`);
- monofasia (`gIBSCBSMono`) e seus totais (`gMono`);
- transferência de crédito (`gTransfCred`);
- Imposto Seletivo por alíquota percentual e/ou específica;
- totais separados de IBS-UF, IBS-Mun, CBS e IS;
- snapshot da versão da NT, tabela oficial e parâmetros usados em cada item;
- matriz operacional versionada, com aprovação fiscal imutável;
- aba **Fiscal → IBS, CBS e IS** para conferência.

## Controles de segurança

`rtc_enabled` nasce desligado. A geração deve ser ativada apenas após:

1. importar a tabela oficial CST/cClassTrib em `fiscal_rtc_classifications`, com URL, versão e hash;
2. cadastrar regras por operação, destino, produto/NCM e vigência;
3. registrar a versão da NT e da tabela na regra;
4. obter aprovação do responsável fiscal pelo fluxo administrativo;
5. deixar todos os itens verdes na aba de validação;
6. homologar exemplos de XML dos modelos 55 e 65 na SEFAZ.

O cadastro do produto é apenas uma classificação auxiliar. Ele não autoriza
sozinho a emissão: CFOP, CST/cClassTrib e parâmetros dependem também da
operação, destino, vigência e indicadores oficiais.

## Configuração JSON de uma regra padrão

```json
{
  "enabled": true,
  "mode": "standard",
  "ibsUf": { "rate": 0.1, "reduction": 0 },
  "ibsMun": { "rate": 0, "reduction": 0 },
  "cbs": { "rate": 0.9, "reduction": 0 }
}
```

Os campos de diferimento, devolução, crédito presumido e tributação regular
são opcionais no formato, mas obrigatórios quando os indicadores do CST e da
cClassTrib oficial assim determinarem.

## Fontes normativas

- Portal Nacional da NF-e — NT 2025.002 e informes técnicos RTC.
- Lei Complementar 214/2025, em sua versão compilada.

Esta entrega prepara o software e expõe a matriz para validação. Ela não
substitui a homologação da SEFAZ nem a aprovação do contador/tributarista para
as operações reais de cada estabelecimento.
