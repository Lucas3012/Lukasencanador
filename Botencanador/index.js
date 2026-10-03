const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = process.env.BOT_NUMBER || ''

const LINK_CONVITE_GRUPO = 'EwUIug1DbI3IWZGkpbrJ8n' 
let jaPareou = false

const ARQUIVO_CHAMADOS = path.join(__dirname, 'chamados.json')

function carregarChamados() {
    try {
        if (fs.existsSync(ARQUIVO_CHAMADOS)) {
            return JSON.parse(fs.readFileSync(ARQUIVO_CHAMADOS, 'utf8'))
        }
    } catch (e) {}
    return {}
}

const userState = {} 
const userData = {}
const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim() : ""
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

async function ligarbot() {
    let state, saveCreds;

    if (MONGO_URI) {
        try {
            console.log('🍃 Conectando ao MongoDB Atlas para recuperar/salvar sessão...');
            await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
            const auth = await useMongoDBAuthState();
            state = auth.state;
            saveCreds = auth.saveCreds;
            console.log('✅ Conectado ao MongoDB com sucesso!');
        } catch (err) {
            console.error('❌ Falha ao conectar ao MongoDB:', err.message);
            const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
            const localAuth = await useMultiFileAuthState('./sessao');
            state = localAuth.state;
            saveCreds = localAuth.saveCreds;
        }
    } else {
        const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
        const localAuth = await useMultiFileAuthState('./sessao');
        state = localAuth.state;
        saveCreds = localAuth.saveCreds;
    }

    const { version } = await fetchLatestBaileysVersion()
    
    const client = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    })

    client.ev.on('creds.update', saveCreds)

    async function enviarLista(from, title, text, buttonText, sections) {
        const msg = generateWAMessageFromContent(from, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ text }),
                        header: proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                            buttons: [{ name: "single_select", buttonParamsJson: JSON.stringify({ title: buttonText, sections }) }]
                        })
                    })
                }
            }
        }, {})
        await client.relayMessage(from, msg.message, { messageId: msg.key.id })
    }

    async function mostrarMenuPrincipal(from) {
        const secoes = [
            {
                title: "Atendimento & Serviços",
                rows: [
                    { title: "Solicitar Serviço / Agendar", description: "Abra um novo chamado", id: "op_1" },
                    { title: "Orçamento Automático", description: "Estimativas de preços", id: "op_2" },
                    { title: "Tabela por Categoria", description: "Veja todos os serviços", id: "op_3" }
                ]
            },
            {
                title: "Informações Geral",
                rows: [
                    { title: "Regiões & Taxa de Visita", description: "Cidades e custos", id: "op_4" },
                    { title: "Formas de Pagamento", description: "Pix, cartões e dinheiro", id: "op_5" },
                    { title: "Horário de Funcionamento", description: "Nossa disponibilidade", id: "op_6" }
                ]
            },
            {
                title: "Suporte",
                rows: [
                    { title: "Falar com Atendente", description: "Conversar com equipe humana", id: "op_7" },
                    { title: "Status do Atendimento", description: "Consultar protocolo", id: "op_8" }
                ]
            }
        ]

        await enviarLista(from, "👋 Atendimento do Encanador", "Escolha uma opção no menu:", "Ver Opções", secoes)
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
                    await mostrarMenuPrincipal(from)
                } else if (text === '3' || text === 'op_3' || textNorm.includes('tabela')) {
                    await mostrarMenuPrincipal(from)
                } else if (text === '4' || text === 'op_4' || textNorm.includes('regiao')) {
                    await escrever('📍 Atendemos em Itabuna, Ilhéus e Itapé. Taxa de visita: R$ 50,00.')
                } else if (text === '5' || text === 'op_5' || textNorm.includes('pagamento')) {
                    await escrever('💳 Aceitamos Pix, Cartões (até 12x) e Dinheiro.')
                } else if (text === '6' || text === 'op_6' || textNorm.includes('horario')) {
                    await escrever('⏰ Atendemos de Segunda a Sexta, das 08h às 18h.')
                } else if (text === '7' || text === 'op_7' || textNorm.includes('atendente')) {
                    await escrever('👨‍🔧 Um atendente humano responderá em instantes.')
                } else {
                    await mostrarMenuPrincipal(from)
                }
            } else if (estadoAtual === 'chamado_nome') {
                userData[from].nome = text
                userState[from] = 'chamado_detalhes'
                await escrever(`Prazer, *${text}*! Digite o seu endereço e detalhes do problema:`)
            } else if (estadoAtual === 'chamado_detalhes') {
                const protocolo = gerarProtocolo()
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!*`)
                userState[from] = 'inicio'
            }
        } catch (erro) {
            console.log('Erro:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (!client.authState.creds.registered && !jaPareou) {
            jaPareou = true
            const Numero = BOT_NUMBER.replace(/[^0-9]/g, '')
            if (Numero) {
                let codigo = await client.requestPairingCode(Numero)
                console.log(`\n==============================================`)
                console.log(`🔑 CODIGO DE PAREAMENTO WHATSAPP: ${codigo}`)
                console.log(`==============================================\n`)
            } else {
                console.log('⚠️️ BOT_NUMBER nao foi definido nas variaveis de ambiente.')
            }
        }
        
        if (connection === 'open') {
            console.log('✅ Bot conectado no WhatsApp com sucesso!')
        }
        
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 2000)
            }
        }
    })
}

ligarbot()
