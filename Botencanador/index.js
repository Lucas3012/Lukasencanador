const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@itsliaaa/baileys')
const { GoogleGenAI } = require('@google/genai')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Configuração da API do Gemini (Substitui pela tua chave obtida no Google AI Studio)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'SUA_CHAVE_API_GEMINI_AQUI'
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

let jaPareou = false

// Arquivo local para persistência de dados
const ARQUIVO_CHAMADOS = path.join(__dirname, 'chamados.json')

function carregarChamados() {
    try {
        if (fs.existsSync(ARQUIVO_CHAMADOS)) {
            const data = fs.readFileSync(ARQUIVO_CHAMADOS, 'utf8')
            return JSON.parse(data)
        }
    } catch (e) {
        console.error('Erro ao ler arquivo de chamados:', e.message)
    }
    return {}
}

function salvarChamado(protocolo, dados) {
    try {
        const chamados = carregarChamados()
        chamados[protocolo] = {
            ...dados,
            dataCriacao: new Date().toISOString()
        }
        fs.writeFileSync(ARQUIVO_CHAMADOS, JSON.stringify(chamados, null, 2), 'utf8')
        console.log(`💾 Chamado #${protocolo} salvo em arquivo!`)
    } catch (e) {
        console.error('Erro ao salvar chamado em arquivo:', e.message)
    }
}

const LINK_GRUPO = 'EwUIug1DbI3IWZGkpbrJ8n' 
const LINK_GRUPO_ATENDENTE = 'F0UYp2zG5pTAgtSE0dwctX'

const userState = {} 
const userData = {}

const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ""
}

const SERVICOS = {
    desentupimento: [
        "Desentupimento de pia/lavatório",
        "Desentupimento de ralo/tanque",
        "Desentupimento de vaso sanitário",
        "Desentupimento coluna/rede principal",
        "Limpeza/desentupimento caixa de gordura",
        "Limpeza/desentupimento caixa de inspeção"
    ],
    reparos: [
        "Troca de torneira simples/filtro",
        "Instalação torneira monocomando/misturador",
        "Troca de engate flexível / niple",
        "Troca ou substituição de sifão",
        "Troca de válvula de escoamento (ralo)",
        "Reparo em válvula Hydra / Docol",
        "Troca mecanismo interno caixa acoplada",
        "Troca de bóia de caixa d'água",
        "Troca de registro geral/gaveta/pressão",
        "Limpeza de caixa d'água (até 1.000 L)",
        "Limpeza de caixa d'água (1.500L a 3.000L)",
        "Substituição tubulação do banheiro",
        "Substituição tubulação da cozinha",
        "Substituição tubulação por PVC/PPR"
    ]
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

const question = (texto) => new Promise((resolve) => {
    if (!process.stdin.isTTY) {
        console.log('⚠️ Ambiente sem terminal interativo. Aguardando conexão por sessão salva.');
        return resolve('');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(texto, (resposta) => {
        rl.close()
        resolve(resposta)
    })
})

// Função para consultar o Gemini quando o utilizador faz perguntas gerais
async function responderComGemini(pergunta) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: pergunta,
            config: {
                systemInstruction: `Você é o assistente virtual inteligente de uma empresa de encanadores profissionais que atende Itabuna, Ilhéus e Itapé. 
Sua função é tirar dúvidas simples sobre hidráulica, vazamentos e desentupimentos com cordialidade, objetividade e clareza.
Sempre lembre o cliente de que soluções definitivas devem ser feitas por um especialista.
No final da resposta, convide o cliente a digitar "1" para agendar uma visita ou "0" para ver o menu principal.`
            }
        });
        return response.text;
    } catch (err) {
        console.error('Erro na chamada do Gemini:', err);
        return null;
    }
}

const MENU_TEXTO = `Olá! 👋 Bem-vindo ao atendimento do Encanador.\n\nEscolha uma opção digitando o número correspondente ou o nome da opção:\n\n1️⃣ *Solicitar Serviço / Agendar*\n2️⃣ *Orçamento Automático*\n3️⃣ *Tabela de Serviços por Categoria*\n4️⃣ *Regiões de Atendimento & Taxa de Visita*\n5️⃣ *Formas de Pagamento Aceitas*\n6️⃣ *Horário de Funcionamento*\n7️⃣ *Falar com Atendente*\n8️⃣ *Status do Atendimento / Reclamação*`

async function ligarbot() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessao')
    const { version } = await fetchLatestBaileysVersion()
    
    const client = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    })

    client.ev.on('creds.update', saveCreds)

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            if (info.key && info.key.remoteJid === 'status@broadcast') return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            await client.readMessages([{ remoteJid: from, id: info.key.id, participant: info.key.participant }])

            const altpdf = Object.keys(info.message)
            const type = altpdf[0] === 'senderKeyDistributionMessage' ? altpdf[1] === 'messageContextInfo' ? altpdf[2] : altpdf[1] : altpdf[0]

            const texto_exato = (type === 'conversation') ? info.message.conversation : (type === 'extendedTextMessage') ? info.message.extendedTextMessage.text : (type === 'imageMessage') ? info.message.imageMessage.caption : ''
            const text = texto_exato.trim()
            const textNorm = normalizar(text)

            if (!text) return

            console.log(`📩 Mensagem recebida de [${from}]: "${text}"`)

            async function escrever(mensagem) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: mensagem }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estadoAtual = userState[from]
            const rodapeNavegacao = `\n\n─────────────────\n↩️ *9* - Voltar à Pergunta Anterior\n🏠 *0* - Voltar ao Menu Principal`

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'inicio') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await escrever(MENU_TEXTO)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('solicitar') || textNorm.includes('agendar') || textNorm.includes('chamado') || textNorm.includes('servico')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2' || textNorm.includes('orcamento') || textNorm.includes('valor') || textNorm.includes('preco')) {
                    userState[from] = 'orcamento_categoria'
                    const introOrcamento = `📊 *Orçamento Automático*\n\nSelecione a categoria do serviço para ver as opções disponíveis:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(introOrcamento)
                } else if (text === '3' || textNorm.includes('tabela') || textNorm.includes('lista') || textNorm.includes('categoria')) {
                    userState[from] = 'tabela_categoria'
                    const menuPrecos = `🛠️ *Lista de Serviços por Categoria*\n\nEscolha qual categoria de serviço você deseja consultar:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(menuPrecos)
                } else if (text === '4' || textNorm.includes('regiao') || textNorm.includes('regioes') || textNorm.includes('visita') || textNorm.includes('cidade') || textNorm.includes('taxa')) {
                    const regioes = `📍 *Regiões de Atendimento & Visita:*\n\n🏠 Atendemos exclusivamente nas seguintes cidades:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita/Avaliação:* R$ 50,00 (Esse valor é abatido no total caso o serviço seja aprovado!).\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(regioes)
                    userState[from] = 'regioes_pos_opcao'
                } else if (text === '5' || textNorm.includes('pagamento') || textNorm.includes('pix') || textNorm.includes('cartao') || textNorm.includes('dinheiro')) {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito (até 12x)\n✅ Cartão de Débito\n✅ Dinheiro em espécie\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(pagamentos)
                    userState[from] = 'pagamento_pos_opcao'
                } else if (text === '6' || textNorm.includes('horario') || textNorm.includes('hora') || textNorm.includes('funcionamento') || textNorm.includes('aberto')) {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nAtendemos de Segunda a Sexta-feira, das 08h às 18h.\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(horarios)
                    userState[from] = 'horario_pos_opcao'
                } else if (text === '7' || textNorm.includes('atendente') || textNorm.includes('humano') || textNorm.includes('falar') || textNorm.includes('pessoa')) {
                    await escrever('⏳ Aguarde um momento...')
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPara encaminharmos você a um de nossos especialistas, por favor digite seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '8' || textNorm.includes('status') || textNorm.includes('reclamacao') || textNorm.includes('protocolo') || textNorm.includes('consultar')) {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Reclamação*\n\nPor favor, informe o seu *Nome completo*:' + rodapeNavegacao)
                } else {
                    // Resposta do Gemini para dúvidas gerais
                    await client.sendPresenceUpdate('composing', from)
                    const respostaAI = await responderComGemini(text)
                    if (respostaAI) {
                        await escrever(respostaAI)
                    } else {
                        await escrever(MENU_TEXTO)
                    }
                }
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '9' || textNorm === 'voltar') { userState[from] = 'inicio'; await escrever(MENU_TEXTO); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! 👋\n\nAgora, digite o seu *Telefone para Contato/WhatsApp* (com DDD):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_telefone') {
                if (text === '9' || textNorm === 'voltar') { userState[from] = 'chamado_nome'; await escrever('📋 *Abertura de Chamado*\n\nPor favor, digite o seu *Nome completo*:' + rodapeNavegacao); return; }
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Perfeito! Agora, digite o seu *Endereço completo* (Rua, Número, Bairro):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_endereco') {
                if (text === '9' || textNorm === 'voltar') { userState[from] = 'chamado_telefone'; await escrever('Digite o seu *Telefone para Contato/WhatsApp* (com DDD):' + rodapeNavegacao); return; }
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Descreva brevemente o problema ou o serviço que você precisa:' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_detalhes') {
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, {
                    tipo: 'servico',
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    detalhes: userData[from].detalhes
                })
                const resumoChamado = `🚨 *NOVO CHAMADO REGISTRADO*\n\n🔢 *Protocolo:* #${protocolo}\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n🏠 *Endereço:* ${userData[from].endereco}\n📝 *Detalhes:* ${userData[from].detalhes}`
                await escrever(resumoChamado)
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!* Um de nossos técnicos entrará em contato em instantes.`)
                delete userState[from]
                delete userData[from]
            }

        } catch (erro) {
            console.log('Erro ao processar mensagem:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr && !client.authState.creds.registered && !jaPareou) {
            jaPareou = true
            const Pergunta = await question('Por Favor Me diga Seu número (ex: 5573981070937):\n')
            const Numero = Pergunta.replace(/[^0-9]/g, '')
            let codigo = await client.requestPairingCode(Numero)
            codigo = codigo?.match(/.{1,4}/g)?.join("-") || codigo
            console.log(`🔑 Codigo de Pareamento: ${codigo}`)
        }
        
        if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso com suporte ao Gemini AI!')
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 1000)
            }
        }
    })
}

ligarbot()
