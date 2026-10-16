import { MongoClient } from 'mongodb';
import fs from 'fs';

// Cole a sua URL real do banco de dados aqui:
const uri = "mongodb://root2:1rGay2HQa0DCH1TTQwXc3CqKF0-wXHUqRVb6jgfGQq2_e5bS@be2f531d-55bf-427a-ba07-502009ee1f10.southamerica-east1.firestore.goog:443/creditnow?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false";
const dbName = "creditnow";
const collectionName = "invoices";

async function gerarLoteDoMongo() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log('🔗 Conectado ao MongoDB com sucesso!');

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Busca as notas em processamento, ignorando registros de teste
        const notas = await collection.find({ 
            status: { $regex: /processando/i },
            client: { $not: /teste/i } 
        }).toArray();
        
        console.log(`\n🔍 Total de notas encontradas com status "processando": ${notas.length}`);

        if (notas.length === 0) {
            console.log('⚠️ Nenhuma nota encontrada com status "processando".');
            return;
        }

        const TAMANHO_LOTE = 10; // Quantidade de notas por lote
        let rpsInicial = 424;
        let totalInseridas = 0;

        console.log('\n----------------------------------------');
        console.log('📋 GERANDO LOTES DIVIDIDOS (PADRÃO GISSONLINE):');
        console.log('----------------------------------------');

        for (let i = 0; i < notas.length; i += TAMANHO_LOTE) {
            const numeroLote = Math.floor(i / TAMANHO_LOTE) + 1;
            const loteNotas = notas.slice(i, i + TAMANHO_LOTE);
            const idLote = `Lote_${numeroLote}_${Date.now()}`;

            // Correção estrutural: Alterado para EnviarLoteRpsEnvio com o container LoteRps e o atributo Id obrigatório
            let xmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
xmlContent += `<EnviarLoteRpsEnvio xmlns="http://www.ginfles.com.br/ginfles_v03.xsd" xmlns:tipos="http://www.ginfles.com.br/tipos_v03.xsd" xmlns:dsig="http://www.w3.org/2000/09/xmldsig#">\n`;
            xmlContent += `    <LoteRps Id="${idLote}" versao="2.04">\n`;
            xmlContent += `        <tipos:NumeroLote>${numeroLote}</tipos:NumeroLote>\n`;
            xmlContent += `        <tipos:Prestador>\n`;
            xmlContent += `            <tipos:Cnpj>63822689000150</tipos:Cnpj>\n`;
            xmlContent += `            <tipos:InscricaoMunicipal>148915</tipos:InscricaoMunicipal>\n`;
            xmlContent += `        </tipos:Prestador>\n`;
            xmlContent += `        <tipos:QuantidadeRps>${loteNotas.length}</tipos:QuantidadeRps>\n`;
            xmlContent += `        <tipos:ListaRps>\n`;

            loteNotas.forEach((nota, indexNoLote) => {
                const rpsAtual = rpsInicial + i + indexNoLote;

                const valor = nota.serviceValue ? Number(nota.serviceValue).toFixed(2) : "0.00";
                const documentoBruto = nota.cpf || nota.cnpj || "";
                const documentoLimpo = documentoBruto.replace(/\D/g, '');
                
                const nomeTomador = nota.client || "TOMADOR DESCONHECIDO";
                const discriminacao = nota.discriminacao || `Serviço de cobrança referente ao contrato ${nota._id || (i + indexNoLote)}`;

                let dataEmissao = "2026-10-07";
                if (nota.issueDate) {
                    const dataObj = new Date(nota.issueDate);
                    if (!isNaN(dataObj.getTime())) {
                        dataEmissao = dataObj.toISOString().split('T')[0];
                    }
                }

                const aliquota = "5.00"; // Ajustado para formato decimal percentual ou conforme regra do município (ex: 5.00 ou 0.05)
                const valorIss = (parseFloat(valor) * (parseFloat(aliquota) / 100)).toFixed(2);

                console.log(`[Lote ${numeroLote} | RPS ${rpsAtual}] Tomador: ${nomeTomador} | Valor: R$ ${valor} | Documento: ${documentoLimpo}`);

                xmlContent += `            <tipos:Rps>\n`;
                xmlContent += `                <tipos:InfDeclaracaoPrestacaoServico Id="Rps_${rpsAtual}">\n`;
                xmlContent += `                    <tipos:Competencia>${dataEmissao}</tipos:Competencia>\n`;
                xmlContent += `                    <tipos:IdentificacaoRps>\n`;
                xmlContent += `                        <tipos:Numero>${rpsAtual}</tipos:Numero>\n`;
                xmlContent += `                        <tipos:Serie>1</tipos:Serie>\n`;
                xmlContent += `                        <tipos:Tipo>1</tipos:Tipo>\n`;
                xmlContent += `                    </tipos:IdentificacaoRps>\n`;
                xmlContent += `                    <tipos:DataEmissao>${dataEmissao}</tipos:DataEmissao>\n`;
                xmlContent += `                    <tipos:Status>1</tipos:Status>\n`;
                xmlContent += `                    <tipos:NaturezaOperacao>1</NaturezaOperacao>\n`;
                xmlContent += `                    <tipos:OptanteSimplesNacional>2</tipos:OptanteSimplesNacional>\n`;
                xmlContent += `                    <tipos:IncentivoFiscal>2</IncentivoFiscal>\n`;
                xmlContent += `                    <tipos:Servico>\n`;
                xmlContent += `                        <tipos:Valores>\n`;
                xmlContent += `                            <tipos:ValorServicos>${valor}</tipos:ValorServicos>\n`;
                xmlContent += `                            <tipos:IssRetido>2</tipos:IssRetido>\n`;
                xmlContent += `                            <tipos:ValorIss>${valorIss}</tipos:ValorIss>\n`;
                xmlContent += `                            <tipos:BaseCalculo>${valor}</tipos:BaseCalculo>\n`;
                xmlContent += `                            <tipos:Aliquota>${aliquota}</tipos:Aliquota>\n`;
                xmlContent += `                        </tipos:Valores>\n`;
                xmlContent += `                        <tipos:ItemListaServico>15.01</tipos:ItemListaServico>\n`;
                xmlContent += `                        <tipos:CodigoTributacaoMunicipio>649999900</tipos:CodigoTributacaoMunicipio>\n`;
                xmlContent += `                        <tipos:Discriminacao>${discriminacao}</tipos:Discriminacao>\n`;
                xmlContent += `                        <tipos:CodigoMunicipio>3529401</tipos:CodigoMunicipio>\n`;
                xmlContent += `                    </tipos:Servico>\n`;
                xmlContent += `                    <tipos:Prestador>\n`;
                xmlContent += `                        <tipos:Cnpj>63822689000150</tipos:Cnpj>\n`;
                xmlContent += `                        <tipos:InscricaoMunicipal>148915</tipos:InscricaoMunicipal>\n`;
                xmlContent += `                    </tipos:Prestador>\n`;
                xmlContent += `                    <tipos:Tomador>\n`;
                xmlContent += `                        <tipos:IdentificacaoTomador>\n`;
                if (documentoLimpo) {
                    xmlContent += `                            <tipos:CpfCnpj>\n`;
                    if (documentoLimpo.length === 14) {
                        xmlContent += `                                <tipos:Cnpj>${documentoLimpo}</tipos:Cnpj>\n`;
                    } else {
                        xmlContent += `                                <tipos:Cpf>${documentoLimpo}</tipos:Cpf>\n`;
                    }
                    xmlContent += `                            </tipos:CpfCnpj>\n`;
                }
                xmlContent += `                        </tipos:IdentificacaoTomador>\n`;
                xmlContent += `                        <tipos:RazaoSocial>${nomeTomador}</tipos:RazaoSocial>\n`;
                xmlContent += `                    </tipos:Tomador>\n`;
                xmlContent += `                </tipos:InfDeclaracaoPrestacaoServico>\n`;
                xmlContent += `            </tipos:Rps>\n`;
            });

            xmlContent += `        </tipos:ListaRps>\n`;
xmlContent += `    </LoteRps>\n`;
            // Espaço reservado para a tag <dsig:Signature> caso utilize um módulo de assinatura digital posterior
            xmlContent += `</EnviarLoteRpsEnvio>`;

            const nomeArquivo = `lote_giss_parte_${numeroLote}.xml`;
            fs.writeFileSync(nomeArquivo, xmlContent);
            console.log(`📁 Ficheiro gerado: ${nomeArquivo} com ${loteNotas.length} notas.\n`);
            totalInseridas += loteNotas.length;
        }

        console.log('----------------------------------------');
        console.log(`✅ SUCESSO! Total de ${totalInseridas} notas divididas em lotes gerados com sucesso.`);
        console.log('----------------------------------------');

    } catch (error) {
        console.error('❌ Erro crítico ao processar o MongoDB:', error);
    } finally {
        await client.close();
    }
}

gerarLoteDoMongo();