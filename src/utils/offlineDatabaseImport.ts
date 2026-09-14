import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const SQLITE_EXTENSIONS = new Set(['sqlite', 'sqlite3', 'db', 'db3']);
const FIREBIRD_EXTENSIONS = new Set(['fdb', 'gdb', 'fbk']);

export type OfflineDatabaseEngine = 'sqlite' | 'firebird' | 'unknown';

export function detectOfflineDatabaseEngine(filename: string): OfflineDatabaseEngine {
  const extension = filename.toLowerCase().split('.').pop() || '';
  if (SQLITE_EXTENSIONS.has(extension)) return 'sqlite';
  if (FIREBIRD_EXTENSIONS.has(extension)) return 'firebird';
  return 'unknown';
}

const serializeValue = (value: SqlValue) => {
  if (value instanceof Uint8Array) return `[conteúdo binário omitido: ${value.byteLength} bytes]`;
  return value;
};

const quoteIdentifier = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function readTable(database: Database, tableName: string) {
  const statement = database.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`);
  const rows: Array<Record<string, unknown>> = [];
  try {
    while (statement.step()) {
      const row = statement.getAsObject();
      rows.push(Object.fromEntries(Object.entries(row).map(([column, value]) => [column, serializeValue(value)])));
    }
  } finally {
    statement.free();
  }
  return rows;
}

export async function convertSqliteToImportFile(file: File) {
  if (detectOfflineDatabaseEngine(file.name) !== 'sqlite') {
    throw new Error('O arquivo selecionado não foi identificado como SQLite.');
  }

  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const tableQuery = database.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const tableNames = (tableQuery[0]?.values || []).map((row) => String(row[0] || '')).filter(Boolean);
    if (!tableNames.length) throw new Error('O banco SQLite não possui tabelas de dados.');

    const tables: Record<string, Array<Record<string, unknown>>> = {};
    let totalRows = 0;
    for (const tableName of tableNames) {
      const rows = readTable(database, tableName);
      if (!rows.length) continue;
      tables[tableName] = rows;
      totalRows += rows.length;
    }
    if (!Object.keys(tables).length) throw new Error('As tabelas do banco SQLite estão vazias.');

    const payload = JSON.stringify({
      origem: { engine: 'sqlite', filename: file.name, tables: Object.keys(tables).length, rows: totalRows },
      tabelas: tables,
    });
    const outputName = `${file.name.replace(/\.[^.]+$/, '') || 'banco-sqlite'}-popsystem.json`;
    return {
      file: new File([payload], outputName, { type: 'application/json' }),
      tableCount: Object.keys(tables).length,
      rowCount: totalRows,
    };
  } catch (error) {
    if (error instanceof Error && /SQLite|tabela|banco/i.test(error.message)) throw error;
    throw new Error('Não consegui abrir este SQLite. Confirme se o arquivo não está criptografado ou corrompido.');
  } finally {
    database.close();
  }
}

export type FirebirdConnectionOptions = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  charset: 'UTF8' | 'WIN1252' | 'ISO8859_1' | 'NONE';
};

const gzipJsonFile = async (payload: string, outputName: string) => {
  const jsonBlob = new Blob([payload], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') {
    return new File([jsonBlob], outputName, { type: 'application/json' });
  }

  const compressedStream = jsonBlob.stream().pipeThrough(new CompressionStream('gzip'));
  const compressedBlob = await new Response(compressedStream).blob();
  if (compressedBlob.size >= jsonBlob.size) {
    return new File([jsonBlob], outputName, { type: 'application/json' });
  }

  // application/octet-stream já é permitido no bucket privado. A extensão
  // informa à função de migração que o conteúdo deve ser descompactado.
  return new File([compressedBlob], `${outputName}.gz`, { type: 'application/octet-stream' });
};

export async function convertFirebirdToImportFile(options: FirebirdConnectionOptions) {
  const api = window.electronAPI;
  if (!api?.isElectron || !api.analyzeFirebirdDatabase) {
    throw new Error('Para ler Firebird, abra esta tela no aplicativo PopSystem Desktop atualizado.');
  }
  const response = await api.analyzeFirebirdDatabase(options);
  if (!response.success || !response.payload) throw new Error(response.error || 'Não foi possível ler o banco Firebird.');
  const payload = JSON.stringify(response.payload);
  const outputName = `${(response.sourceName || 'banco-firebird').replace(/\.[^.]+$/, '')}-popsystem.json`;
  const outputFile = await gzipJsonFile(payload, outputName);
  return {
    file: outputFile,
    tableCount: response.tableCount || 0,
    rowCount: response.rowCount || 0,
    compressed: outputFile.name.endsWith('.gz'),
    originalSize: new Blob([payload]).size,
  };
}
