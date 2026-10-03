const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@itsliaaa/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = process.env.BOT_NUMBER || ''

let jaPareou = false
let authStateData = null

const ARQUIVO_CHAMADOS = path.join(__dirname, 'chamados.json')

function carregarChamados() {
    try {
        if (fs.existsSync(ARQUIVO_CHAMADOS)) {
            return JSON.parse(fs.readFileSync(ARQUIVO_CHAMADOS, 'utf8'))
        }
    } catch (e) {}
    return {}
}

function salvarChamado(protocolo, dados) {
    try {
        const chamados = carregarChamados()
        chamados[protocolo] = { ...dados, dataCriacao: new Date().toISOString() }
        fs.writeFileSync(ARQUIVO_CHAMADOS, JSON.stringify(chamados, null, 2), 'utf8')
    } catch (e) {}
}

const userState = {} 
const userData = {}
const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim() : ""
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

async function iniciarBanco() {
    if (MONGO_URI && mongoose.connection.readyState === 0) {
        try {
            console.log('🍃 Conectando ao MongoDB Atlas...');
            await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
            console.log('✅ Conectado ao MongoDB com sucesso!');

            if (process.env.RESET_SESSION === 'true') {
                console.log('🧹 Limpando coleção de sessão antiga...');
                try {
                    await mongoose.connection.db.collection('sessions').deleteMany({});
                    console.log('✨ Sessão limpa no MongoDB!');
                } catch (e) {}
            }

            authStateData = await useMongoDBAuthState();
        } catch (err) {
            console.error('❌ Falha ao conectar ao MongoDB:', err.message);
            const { useMultiFileAuthState } = require('@itsliaaa/baileys');
            authStateData = await useMultiFileAuthState('./sessao');
        }
    } else if (!authStateData) {
        const { useMultiFileAuthState } = require('@itsliaaa/baileys');
        authStateData = await useMultiFileAuthState('./sessao');
    }
}

async function ligarbot() {
    await iniciarBanco()

    const { state, saveCreds } = authStateData
    
    const client = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '110.0.5563.56'],
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    })

    client.ev.on('creds.update', saveCreds)

    async function enviarListaInterativa(from, titulo, texto, textoBotao, secoes) {
        const message = {
            interactiveMessage: proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: texto }),
                header: proto.Message.InteractiveMessage.Header.create({ title: titulo, hasMediaAttachment: false }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [{
                        name: "single_select",
                        buttonParamsJson: JSON.stringify({
                            title: textoBotao,
                            sections: secoes
                        })
                    }]
                })
            })
        }
        
        const msg = generateWAMessageFromContent(from, { viewOnceMessage: { message } }, {})
        await client.relayMessage(from, msg.message, { messageId: msg.key.id })
    }

    async function mostrarMenuPrincipal(from) {
        const secoes = [
            {
                title: "Atendimento & Serviços",
                rows: [
                    { title: "Solicitar Serviço / Agendar", description: "Abra um novo chamado de encanador", id: "op_1" },
                    { title: "Orçamento Automático", description: "Consulte estimativas de preços", id: "op_2" },
                    { title: "Tabela por Categoria", description: "Veja todos os serviços disponíveis", id: "op_3" }
                ]
            },
            {
                title: "Informações Gerais",
                rows: [
                    { title: "Regiões & Taxa de Visita", description: "Cidades atendidas e valores", id: "op_4" },
                    { title: "Formas de Pagamento", description: "Pix, cartões e dinheiro", id: "op_5" },
                    { title: "Horário de Funcionamento", description: "Confira nossa disponibilidade", id: "op_6" }
                ]
            },
            {
                title: "Suporte",
                rows: [
                    { title: "Falar com Atendente", description: "Conversar com equipe humana", id: "op_7" },
                    { title: "Status do Atendimento", description: "Consultar protocolo do chamado", id: "op_8" }
                ]
            }
        ]

        await enviarListaInterativa(
            from, 
            "👋 Atendimento Lukas Encanador", 
            "Selecione a opção desejada no menu abaixo para continuar:", 
            "Ver Opções", 
            secoes
        )
    }

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            await client.readMessages([{ remoteJid: from, id: info.key.id, participant: info.key.participant }])

            let text = ""
            const msg = info.message

            if (msg.conversation) text = msg.conversation
            else if (msg.extendedTextMessage?.text) text = msg.extendedTextMessage.text
            else if (msg.interactiveResponseMessage) {
                try {
                    const params = JSON.parse(msg.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)
                    text = params.id || params.text || ""
                } catch (e) { text = msg.interactiveResponseMessage.body?.text || "" }
            } else if (msg.templateButtonReplyMessage) text = msg.templateButtonReplyMessage.selectedId || ""
            else if (msg.buttonsResponseMessage) text = msg.buttonsResponseMessage.selectedButtonId || ""
            else if (msg.listResponseMessage) text = msg.listResponseMessage.singleSelectReply?.selectedRowId || ""

            const textNorm = normalizar(text)
            if (!text) return

            async function escrever(mensagem) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: mensagem }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estadoAtual = userState[from]

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuPrincipal(from)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || text === 'op_1' || textNorm.includes('agendar') || textNorm.includes('solicitar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPor favor, digite o seu *Nome completo*:')
                } else if (text === '2' || text === 'op_2' || textNorm.includes('orcamento')) {
                    await escrever('💰 *Orçamento Automático*\n\nDescreva o problema ou envie uma foto para obter uma estimativa de valor.')
                } else if (text === '3' || text === 'op_3' || textNorm.includes('tabela')) {
                    await escrever('🛠️ *Serviços Prestados:*\n- Desentupimento em geral\n- Reparo de vazamentos\n- Instalação de louças e metais\n- Manutenção em caixa d\'água')
                } else if (text === '4' || text === 'op_4' || textNorm.includes('regiao')) {
                    await escrever('📍 Atendemos em Itabuna, Ilhéus e região. Taxa de visita a partir de R$ 50,00.')
                } else if (text === '5' || text === 'op_5' || textNorm.includes('pagamento')) {
                    await escrever('💳 Aceitamos Pix, Cartões de Crédito/Débito e Dinheiro.')
                } else if (text === '6' || text === 'op_6' || textNorm.includes('horario')) {
                    await escrever('⏰ *Horário de Funcionamento:*\nSegunda a Sexta: 08:00 às 18:00\nSábado: 08:00 às 12:00')
                } else if (text === '7' || text === 'op_7' || textNorm.includes('atendente')) {
                    await escrever('👨‍🔧 Um atendente humano responderá à sua mensagem em instantes.')
                } else if (text === '8' || text === 'op_8' || textNorm.includes('status')) {
                    await escrever('🔍 Digite o *número do protocolo* para consultar o status:')
                } else {
                    await mostrarMenuPrincipal(from)
                }
            } else if (estadoAtual === 'chamado_nome') {
                userData[from].nome = text
                userState[from] = 'chamado_detalhes'
                await escrever(`Prazer, *${text}*! Digite o seu *Endereço completo* e os *Detalhes do problema*:`)
            } else if (estadoAtual === 'chamado_detalhes') {
                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, { nome: userData[from].nome, detalhes: text })
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!*\n\nEntraremos em contato em breve. Digite *0* para voltar ao menu.`)
                userState[from] = 'inicio'
            }
        } catch (erro) {
            console.log('Erro ao processar mensagem:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (!client.authState.creds.registered && !jaPareou) {
            jaPareou = true
            const Numero = BOT_NUMBER.replace(/[^0-9]/g, '')
            if (Numero) {
                console.log(`📱 Solicitando código de pareamento para o número: ${Numero}...`)
                await esperar(10000)
                try {
                    let codigo = await client.requestPairingCode(Numero)
                    console.log(`\n==============================================`)
                    console.log(`🔑 CODIGO DE PAREAMENTO: ${codigo}`)
                    console.log(`==============================================\n`)
                } catch (err) {
                    console.error('❌ Erro ao solicitar código de pareamento:', err.message)
                    jaPareou = false
                }
            } else {
                console.log('⚠️ A variável BOT_NUMBER não foi definida nas variáveis de ambiente do Render!')
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP!')
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão fechada (${statusCode}). Reiniciando em 10 segundos...`)
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 10000)
            }
        }
    })
}

ligarbot()
