# Arquitetura do motor de regras fiscais

## Princípio

O cadastro do produto informa fatos permanentes, como NCM, CEST e origem. A tributação da venda não é um atributo permanente do produto: ela é resolvida por uma regra vigente para o contexto completo da operação.

```text
produto + emitente + destinatário + finalidade + destino + data
                              │
                              ▼
                 regra fiscal vigente e aprovada
                              │
                              ▼
              CFOP + ICMS + PIS/COFINS/IPI + IBS/CBS/IS
                              │
                              ▼
                    snapshot imutável no item fiscal
```

## Critérios de resolução

A tabela `fiscal_tax_rules` permite restringir uma regra por:

- modelo 55/65 e CRT 1/2/3;
- finalidade da operação;
- operação interna, interestadual ou exterior;
- UF de origem e destino;
- indicador de IE, consumidor final e indicador de presença;
- produto, prefixo de NCM, CEST e origem da mercadoria;
- vigência e prioridade.

Regras específicas vencem regras genéricas. Empate de especificidade e prioridade é tratado como ambiguidade e bloqueia a emissão. Regra inativa, vencida ou sem aprovação contábil não participa da resolução.

## ICMS implementado

O serializador `icms-engine.ts` contém os grupos do leiaute 4.00 para:

- Simples Nacional: CSOSN 101, 102, 103, 201, 202, 203, 300, 400, 500 e 900;
- regime normal: CST 00, 10, 20, 30, 40, 41, 50, 51, 60, 70 e 90;
- origem 0 a 8, crédito do Simples, ICMS próprio, redução, diferimento, desoneração, ST, FCP e ST retido conforme os campos configurados.

O motor valida campos obrigatórios e calcula valores derivados apenas quando base e alíquota foram fornecidas. Ele não inventa NCM, CFOP, CST/CSOSN ou alíquota.

## Reforma Tributária

O serializador `rtc-engine.ts` cobre IBS-UF, IBS-Mun, CBS, Imposto Seletivo,
redução, diferimento, devolução, crédito presumido, tributação regular,
monofasia e transferência de crédito. A configuração, as versões oficiais e
o roteiro de validação estão em `rtc-validation-handoff.md`.

## Operação e auditoria

Cada item emitido preserva `fiscal_rule_id`, CRT, finalidade e a configuração ICMS usada. Isso permite demonstrar qual regra gerou o XML mesmo depois de uma alteração futura na matriz.

O modo `require_approved_fiscal_rules` é opt-in para permitir migração gradual das empresas existentes. Após a matriz de uma empresa ser homologada, esse modo deve ficar ativo para impedir fallback ao cadastro legado.

## Bloqueios antes da produção nacional

- atualizar os XSDs e tabelas para o pacote oficial vigente;
- completar PIS, COFINS, IPI, II, ISS e IBS/CBS/IS para os cenários aplicáveis;
- importar regras escritas e aprovadas pelo contador, incluindo benefícios e regras estaduais;
- testar autorização, rejeição, cancelamento, contingência e inutilização por UF/modelo;
- registrar evidências de homologação por empresa e cenário.

Não existe uma única tabela estática capaz de tornar o sistema automaticamente válido para “qualquer operação” brasileira. Alterações legais, regimes especiais, protocolos estaduais e características do destinatário exigem matriz versionada e manutenção fiscal contínua.
