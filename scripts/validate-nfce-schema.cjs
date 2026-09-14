#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const xmlFile = process.argv[2];
const schemaArg = process.argv[3];

if (!xmlFile) {
  console.error('Uso: npm run nfce:validate -- caminho/do/xml.xml [schema.xsd]');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const schemaDir = path.join(
  root,
  'supabase/functions/nfce-operations/schemas/PL_010e_v1.02/NFe',
);
const schemaFile = schemaArg
  ? path.resolve(schemaArg)
  : path.join(schemaDir, 'nfe_v4.00.xsd');
const resolvedXml = path.resolve(xmlFile);

if (!fs.existsSync(resolvedXml)) {
  console.error(`XML nao encontrado: ${resolvedXml}`);
  process.exit(2);
}

if (!fs.existsSync(schemaFile)) {
  console.error(`Schema nao encontrado: ${schemaFile}`);
  process.exit(2);
}

const xmllint = spawnSync('xmllint', ['--noout', '--schema', schemaFile, resolvedXml], {
  cwd: schemaDir,
  encoding: 'utf8',
});

if (xmllint.status === 0) {
  console.log('XML NF-e/NFC-e valido contra o schema oficial 010e v1.02.');
  process.exit(0);
}

if (xmllint.error?.code === 'ENOENT') {
  console.error('xmllint nao encontrado. Instale libxml2/xmllint para validar XSD localmente.');
  process.exit(2);
}

console.error((xmllint.stderr || xmllint.stdout || 'XML invalido contra o schema.').trim());
process.exit(xmllint.status || 1);
