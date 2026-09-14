const fs = require('fs');
const path = require('path');
const Firebird = require('node-firebird');

const MAX_ROWS = 250000;
// O conteúdo é compactado antes do envio. Este limite protege a memória do
// aplicativo sem obrigar o restaurante a dividir bancos Firebird comuns.
const MAX_SERIALIZED_BYTES = 120 * 1024 * 1024;
const ALLOWED_CHARSETS = new Set(['UTF8', 'WIN1252', 'ISO8859_1', 'NONE']);

const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

const serializeValue = (value) => {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[conteúdo binário omitido: ${value.byteLength} bytes]`;
  if (typeof value === 'function') return '[conteúdo BLOB omitido]';
  return String(value);
};

const normalizeRow = (row) => Object.fromEntries(
  Object.entries(row || {}).map(([column, value]) => [String(column).trim(), serializeValue(value)]),
);

const translateFirebirdError = (error, host, port) => {
  const message = String(error?.message || error || 'Falha desconhecida no Firebird');
  const lower = message.toLowerCase();
  if (/econnrefused|connection.*refused|unable to complete network request|failed to connect|connect timeout/.test(lower)) {
    return `O servidor Firebird não respondeu em ${host}:${port}. Abra o sistema antigo (ou o serviço Firebird) neste computador e tente novamente.`;
  }
  if (/username and password|user name and password|authentication|login/.test(lower)) {
    return 'Usuário ou senha do Firebird inválidos. Confirme as credenciais usadas pelo sistema antigo.';
  }
  if (/unavailable database|no permission for read-select access|cannot attach|database file appears corrupt/.test(lower)) {
    return 'O Firebird não conseguiu abrir este banco. Confirme se o arquivo pertence ao servidor instalado e se o serviço possui acesso ao caminho selecionado.';
  }
  if (/unsupported on-disk structure|wrong ods|incompatible.*database/.test(lower)) {
    return 'A versão do Firebird instalada não é compatível com este banco. Abra o sistema antigo para usar a mesma versão do servidor e tente novamente.';
  }
  if (/character set|charset|transliteration/.test(lower)) {
    return 'O banco usa outra codificação de texto. Tente novamente escolhendo WIN1252 ou NONE no campo de codificação.';
  }
  return message;
};

class FirebirdMigrationService {
  static validateOptions(input = {}) {
    const host = String(input.host || '127.0.0.1').trim();
    const port = Number(input.port || 3050);
    const database = String(input.database || '').trim();
    const user = String(input.user || 'SYSDBA').trim();
    const password = String(input.password || '');
    const charset = String(input.charset || 'UTF8').toUpperCase();

    if (!host || host.length > 253) throw new Error('Informe o endereço do servidor Firebird.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A porta do Firebird é inválida.');
    if (!database) throw new Error('Selecione o arquivo .FDB ou .GDB.');
    if (!user) throw new Error('Informe o usuário do Firebird.');
    if (!password) throw new Error('Informe a senha do Firebird usada pelo sistema antigo.');
    if (!ALLOWED_CHARSETS.has(charset)) throw new Error('A codificação selecionada não é suportada.');

    const extension = path.extname(database).toLowerCase();
    if (extension === '.fbk') throw new Error('Este arquivo é um backup .FBK. Restaure-o como .FDB pelo sistema antigo antes de importar.');
    if (!['.fdb', '.gdb'].includes(extension) && !/^[a-z0-9_.-]+$/i.test(database)) {
      throw new Error('Selecione um banco Firebird .FDB ou .GDB válido.');
    }
    if (['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase()) && path.isAbsolute(database) && !fs.existsSync(database)) {
      throw new Error('O arquivo Firebird selecionado não foi encontrado neste computador.');
    }

    return { host, port, database, user, password, charset };
  }

  static async analyze(input) {
    const options = this.validateOptions(input);
    let database;
    let transaction;
    try {
      database = await Firebird.attachAsync({
        ...options,
        lowercase_keys: false,
        blobAsText: false,
        connectTimeout: 15000,
        retryConnectionInterval: 1000,
      });
      transaction = await database.transactionAsync({
        isolation: Firebird.ISOLATION_READ_COMMITTED,
        readOnly: true,
        wait: true,
        waitTimeout: 15,
      });

      const relationRows = await transaction.queryAsync(`
        SELECT TRIM(RDB$RELATION_NAME) AS TABLE_NAME
        FROM RDB$RELATIONS
        WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
          AND RDB$VIEW_BLR IS NULL
        ORDER BY RDB$RELATION_NAME
      `);
      const tableNames = relationRows
        .map((row) => String(row.TABLE_NAME ?? row.table_name ?? '').trim())
        .filter(Boolean);
      if (!tableNames.length) throw new Error('O banco Firebird não possui tabelas de dados.');

      const tables = {};
      let rowCount = 0;
      let serializedBytes = 0;
      for (const tableName of tableNames) {
        const rows = [];
        await transaction.sequentiallyAsync(`SELECT * FROM ${quoteIdentifier(tableName)}`, (rawRow) => {
          if (rowCount >= MAX_ROWS) throw new Error(`O banco possui mais de ${MAX_ROWS.toLocaleString('pt-BR')} registros. Divida a migração ou solicite uma importação assistida.`);
          const row = normalizeRow(rawRow);
          serializedBytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
          if (serializedBytes > MAX_SERIALIZED_BYTES) throw new Error('Os dados convertidos ultrapassam 120 MB. Para este volume, solicite uma importação assistida.');
          rows.push(row);
          rowCount += 1;
        });
        if (rows.length) tables[tableName] = rows;
      }
      if (!Object.keys(tables).length) throw new Error('As tabelas do banco Firebird estão vazias.');

      await transaction.rollbackAsync();
      transaction = null;
      return {
        success: true,
        payload: {
          origem: {
            engine: 'firebird',
            filename: path.basename(options.database),
            tables: Object.keys(tables).length,
            rows: rowCount,
          },
          tabelas: tables,
        },
        sourceName: path.basename(options.database),
        tableCount: Object.keys(tables).length,
        rowCount,
      };
    } catch (error) {
      try { await transaction?.rollbackAsync(); } catch {}
      return { success: false, error: translateFirebirdError(error, options.host, options.port) };
    } finally {
      try { await database?.detachAsync(true); } catch {}
    }
  }
}

module.exports = FirebirdMigrationService;
module.exports.serializeValue = serializeValue;
module.exports.normalizeRow = normalizeRow;
module.exports.translateFirebirdError = translateFirebirdError;
