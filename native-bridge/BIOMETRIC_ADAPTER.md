# Adaptador biométrico do PopConnect

O PopConnect não envia imagem nem template biométrico bruto para o PopSystem. O
adaptador do fabricante mantém o template no leitor ou no computador do
estabelecimento e devolve somente uma referência opaca e seu hash SHA-256.

## Configuração

No PopConnect, escolha `SDK do fabricante`, informe o caminho absoluto do
executável adaptador e o identificador do leitor. O executável é chamado assim:

```text
adaptador.exe <acao> '<json>'
```

Ele deve escrever uma única resposta JSON em `stdout`, retornar código zero no
sucesso e não registrar dados biométricos nos logs.

## Contrato

### `list_devices`

Entrada:

```json
{}
```

Saída:

```json
{
  "devices": [
    { "deviceId": "RECEPCAO-01", "model": "Modelo do leitor", "serialNumber": "..." }
  ]
}
```

### `enroll`

Entrada:

```json
{ "deviceId": "RECEPCAO-01", "employeeRef": "uuid", "fingerPosition": "right_index", "samples": 3 }
```

Saída:

```json
{ "providerReference": "referencia-opaca", "templateHash": "sha256-em-hexadecimal", "quality": 0.92 }
```

### `identify`

Entrada:

```json
{ "deviceId": "RECEPCAO-01" }
```

Saída:

```json
{ "providerReference": "referencia-opaca", "quality": 0.91, "livenessPassed": true }
```

### `remove`

Entrada:

```json
{ "deviceId": "RECEPCAO-01", "providerReference": "referencia-opaca" }
```

Saída:

```json
{ "removed": true }
```

## Requisitos de segurança

- Executar o SDK com usuário sem privilégios administrativos.
- Validar a assinatura do driver e do SDK do fabricante.
- Proteger o armazenamento local com as APIs criptográficas do sistema operacional.
- Nunca retornar template, imagem ou minúcia no JSON.
- Remover o template local quando a revogação for confirmada.
- Manter o relógio do computador sincronizado e bloquear alteração manual do NSR.
- O simulador existe somente para homologação e não pode ser habilitado na distribuição de produção.

O modo REP-P oficial depende ainda de registro do programa no INPI, assinatura
ICP-Brasil dos arquivos exigidos, comprovante PDF assinado em PAdES, geração e
validação de AFD/AEJ e emissão do Atestado Técnico e Termo de Responsabilidade.
