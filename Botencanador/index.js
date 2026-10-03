const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = process.env.BOT_NUMBER || ''

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

async function ligarbot() {
    let state, saveCreds;

    if (MONGO_URI) {
        try {
            console.log('🍃 Conectando ao MongoDB Atlas...');
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
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    client.ev.on('creds.update', saveCreds)

    async function mostrarMenuPrincipal(from) {
        const menuTexto = 
`👋 *Atendimento Lukas Encanador*

Por favor, escolha uma opção digitando o *número* correspondente:

1️⃣ *Solicitar Serviço / Agendar*
2️⃣ *Orçamento Automático*
3️⃣ *Tabela por Categoria*
4️⃣ *Regiões & Taxa de Visita*
5️⃣ *Formas de Pagamento*
6️⃣ *Horário de Funcionamento*
7️⃣ *Falar com Atendente*
8️⃣ *Status do Atendimento*

_Digite a opção desejada (1 a 8):_`

        await client.sendMessage(from, { text: menuTexto })
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
                if (text === '1' || textNorm.includes('agendar') || textNorm.includes('solicitar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPor favor, digite o seu *Nome completo*:')
                } else if (text === '2' || textNorm.includes('orcamento')) {
                    await escrever('💰 *Orçamento Automático*\n\nNossos serviços de encanamento em geral variam de acordo com a complexidade. Para uma estimativa precisa, descreva o problema abaixo ou envie uma foto/vídeo.')
                } else if (text === '3' || textNorm.includes('tabela')) {
                    await escrever('🛠️ *Serviços Prestados:*\n- Desentupimento em geral\n- Reparo de vazamentos\n- Instalação de louças e metais\n- Manutenção em caixa d\'água\n\nDigite *0* a qualquer momento para voltar ao menu.')
                } else if (text === '4' || textNorm.includes('regiao')) {
                    await escrever('📍 Atendemos em Itabuna, Ilhéus e região. Taxa de visita a partir de R$ 50,00.')
                } else if (text === '5' || textNorm.includes('pagamento')) {
                    await escrever('💳 Aceitamos Pix, Cartões de Crédito/Débito e Dinheiro.')
                } else if (text === '6' || textNorm.includes('horario')) {
                    await escrever('⏰ *Horário de Funcionamento:*\nSegunda a Sexta: 08:00 às 18:00\nSábado: 08:00 às 12:00\nAtendimento emergencial 24h sob consulta.')
                } else if (text === '7' || textNorm.includes('atendente')) {
                    await escrever('👨‍‍🔧 Um atendente humano responderá à sua mensagem em instantes. Por favor, aguarde!')
                } else if (text === '8' || textNorm.includes('status')) {
                    await escrever('🔍 Para verificar o status, digite o *número do protocolo* do seu chamado:')
                } else {
                    await mostrarMenuPrincipal(from)
                }
            } else if (estadoAtual === 'chamado_nome') {
                userData[from].nome = text
                userState[from] = 'chamado_detalhes'
                await escrever(`Prazer, *${text}*! Agora digite o seu *Endereço completo* e os *Detalhes do problema*:`)
            } else if (estadoAtual === 'chamado_detalhes') {
                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, { nome: userData[from].nome, detalhes: text })
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!*\n\nNossa equipe entrará em contato em breve para confirmar o horário. Digite *0* para voltar ao menu principal.`)
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
                await esperar(5000)
                try {
                    let codigo = await client.requestPairingCode(Numero)
                    console.log(`\n==============================================`)
                    console.log(`🔑 CODIGO DE PAREAMENTO: ${codigo}`)
                    console.log(`==============================================\n`)
                } catch (err) {
                    console.error('❌ Erro ao solicitar código de pareamento:', err.message)
                    jaPareou = false
                }
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP!')
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão fechada. Reiniciando em 5 segundos...`)
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
