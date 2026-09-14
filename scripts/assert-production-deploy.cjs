const { execFileSync } = require('node:child_process');

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();

if (branch !== 'main') {
  console.error(`Deploy de producao bloqueado: branch atual e "${branch || 'desconhecida'}", nao "main".`);
  process.exit(1);
}

if (dirty) {
  console.error('Deploy de producao bloqueado: existem alteracoes locais sem commit.');
  process.exit(1);
}

if (process.env.HOMOLOGATION_APPROVED !== 'YES') {
  console.error('Deploy de producao bloqueado: defina HOMOLOGATION_APPROVED=YES depois da homologacao formal.');
  process.exit(1);
}

console.log('Guarda de producao aprovada.');
