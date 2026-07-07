// generate-version.js
const fs = require('fs');

// Gera um timestamp único baseado na hora exata do build
const appVersion = Date.now().toString();

const versionData = JSON.stringify({ version: appVersion });

// Salva o arquivo na pasta public (ele será hospedado junto com o site)
fs.writeFileSync('./public/version.json', versionData);

console.log(`✅ Arquivo version.json gerado com a versão: ${appVersion}`);