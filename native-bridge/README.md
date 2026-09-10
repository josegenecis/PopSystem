# Pop Connect

O Pop Connect é o aplicativo auxiliar do PopSystem para integrar o navegador e o PDV com os dispositivos instalados no computador.

## Dispositivos suportados

- Impressoras térmicas instaladas no Windows, macOS ou Linux, além de modelos ESC/POS em rede TCP 9100.
- Balanças USB/seriais compatíveis com Toledo, Filizola, Urano, Magna, Elgin e protocolo genérico.
- Leitores USB de código de barras configurados no modo teclado, com Enter após a leitura.

## Uso pelo restaurante

1. Instale o Pop Connect no computador do caixa.
2. Abra o aplicativo, gere o código e informe-o em **Configurações → Dispositivos** no PopSystem.
3. Escolha a impressora e faça uma impressão de teste.
4. Se houver balança, selecione a porta e a marca e teste a leitura do peso.

O aplicativo inicia junto com o computador e continua ativo ao fechar a janela.

## Compatibilidade técnica

Para não interromper instalações existentes, o serviço local continua disponível em `ws://127.0.0.1:8766` e mantém as ações antigas de impressão. A comunicação em nuvem continua usando o pareamento e a fila de impressão já existentes.
