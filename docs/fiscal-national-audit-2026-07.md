# Auditoria fiscal nacional — julho de 2026

## Resultado

O módulo atual possui emissão, consulta, cancelamento, XML, certificado A1, CSC e endpoints para as 27 UFs, mas ainda não deve ser anunciado como homologado para qualquer restaurante do Brasil.

## Bloqueios críticos para cobertura nacional

1. Atualizar os schemas do pacote PL_009 para os pacotes oficiais vigentes 010e/010d.
2. Implementar NT 2025.002 (IBS/CBS/IS) e tabelas oficiais atualizadas da Reforma Tributária de 2026.
3. ~~Gerar os grupos de ICMS conforme CRT, CST/CSOSN e tributação do produto.~~ Base estrutural entregue para todos os CSOSN/CST previstos no escopo; ainda exige homologação dos cenários e regras contábeis.
4. ~~Remover o NCM genérico como fallback silencioso.~~ Entregue; produto sem NCM/CFOP/tributação válida bloqueia a emissão.
5. Integrar tabela IBPT ou fonte equivalente licenciada para `vTotTrib`; não usar percentual fixo para todo produto.
6. Validar CEST, cBenef, CFOP e regras estaduais por UF e operação.
7. Atualizar QR Code da NFC-e para a versão exigida pelas notas técnicas vigentes e revisar URLs oficiais por UF.
8. Implementar contingência offline NFC-e completa, conciliação, inutilização de numeração e monitoramento de indisponibilidade.
9. Criar matriz automatizada de homologação por UF, ambiente, regime tributário e cenário fiscal.
10. Validar o produto final com contador/consultoria fiscal e processos de credenciamento de cada SEFAZ.

## Correções entregues nesta auditoria

- Produto referenciado por pedido ou NFC-e passa a ser arquivado/desativado, preservando o histórico fiscal.
- Menu ganhou acesso direto a **Cupons fiscais**.
- Gestão de cupons ganhou **Reimprimir DANFE**.
- Cancelamento deixa explícito que vale para a NFC-e inteira, não para apenas um item.
- Emissão passou a carregar NCM, CFOP, CSOSN, PIS, COFINS, origem, CEST, cBenef e observação do cadastro real do produto.
- Data/hora fiscal deixou de usar sempre o fuso do Ceará e passou a considerar a UF emitente.
- Foi criado um motor determinístico de ICMS para CRT 1, 2 e 3, sem escolher tributação por aproximação.
- Foi criada uma matriz fiscal versionada que correlaciona CFOP e tributação ao contexto da operação.
- A emissão passa a preservar a regra e os parâmetros utilizados em cada item para auditoria posterior.
- A conversão genérica de CFOP foi eliminada do fluxo de emissão; o CFOP precisa vir da regra exata aplicável.

## Limite desta entrega

Esta estrutura não equivale a homologação fiscal nacional. PIS, COFINS, IPI, II, ISS, benefícios, FCP, ST, DIFAL, monofásicos e IBS/CBS precisam ser parametrizados conforme produto, operação, UF, destinatário e vigência. Os schemas e notas técnicas também devem ser atualizados continuamente. A produção deve permanecer bloqueada para qualquer cenário ainda não testado e aprovado.

## Regra operacional importante

Não se cancela um único item de uma NFC-e já autorizada. Quando a legislação e o prazo permitirem, cancela-se a NFC-e inteira e emite-se uma nova NFC-e correta. No Ceará, o cancelamento ordinário exige que não tenha ocorrido circulação e deve ser solicitado em até 30 minutos da autorização.
