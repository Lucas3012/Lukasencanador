const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || ''

// Links dos grupos do WhatsApp
const LINK_GRUPO_CHAMADOS = 'https://chat.whatsapp.com/EwUIug1DbI3IWZGkpbrJ8n'
const LINK_GRUPO_ORCAMENTOS = 'https://chat.whatsapp.com/HYFutIc2BYi6I0EyM6sBsQ'
const LINK_GRUPO_SUPORTE = 'https://chat.whatsapp.com/F0UYp2zG5pTAgtSE0dwctX'

let GRUPO_CHAMADOS_JID = null
let GRUPO_ORCAMENTOS_JID = null
let GRUPO_SUPORTE_JID = null

let clienteAtual = null
let aguardandoEmparelhamento = false

const chamadoSchema = new mongoose.Schema({
    protocolo: { type: String, required: true, unique: true },
    nome: String,
    telefone: String,
    endereco: String,
    tipoServico: String,
    detalhes: String,
    origem: { type: String, default: 'Agendamento / Orçamento' },
    status: { type: String, default: 'Pendente' },
    createdAt: { type: Date, default: Date.now }
})

const suporteSchema = new mongoose.Schema({
    protocolo: { type: String, required: true, unique: true },
    nome: String,
    telefone: String,
    detalhes: String,
    origem: { type: String, default: 'Atendimento Suporte Humano' },
    status: { type: String, default: 'Pendente' },
    createdAt: { type: Date, default: Date.now }
})

const Chamado = mongoose.models.Chamado || mongoose.model('Chamado', chamadoSchema)
const Suporte = mongoose.models.Suporte || mongoose.model('Suporte', suporteSchema)

async function salvarChamado(protocolo, dados) {
    try { await Chamado.create({ protocolo, ...dados }) } catch (e) {}
}

async function salvarSuporte(protocolo, dados) {
    try { await Suporte.create({ protocolo, ...dados }) } catch (e) {}
}

async function buscarAtendimento(protocolo) {
    try {
        let res = await Chamado.findOne({ protocolo }).lean()
        if (!res) res = await Suporte.findOne({ protocolo }).lean()
        return res
    } catch (e) { return null }
}

const userState = {} 
const userData = {}
const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim() : ""
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

async function obterJidGrupo(client, linkGrupo) {
    try {
        const codeMatch = linkGrupo.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)
        if (codeMatch && codeMatch[1]) {
            const inviteCode = codeMatch[1]
            try { return await client.groupAcceptInvite(inviteCode) } 
            catch (err) {
                const groupInfo = await client.groupGetInviteInfo(inviteCode)
                return groupInfo.id
            }
        }
    } catch (e) {}
    return null
}

async function limparSessaoMongo() {
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
            console.log('🧹 Coleção de sessões limpa no MongoDB Atlas.')
        }
    } catch (err) {}
    try {
        if (fs.existsSync('./sessao')) {
            fs.rmSync('./sessao', { recursive: true, force: true })
        }
    } catch (err) {}
}

async function ligarbot() {
    if (clienteAtual) {
        try {
            clienteAtual.ev.removeAllListeners()
            clienteAtual.ws?.close()
        } catch (e) {}
        clienteAtual = null
    }

    let state, saveCreds;

    if (MONGO_URI) {
        try {
            if (mongoose.connection.readyState === 0) {
                await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
            }
            const auth = await useMongoDBAuthState();
            state = auth.state;
            saveCreds = auth.saveCreds;
        } catch (err) {
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
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            let text = info.message.conversation || info.message.extendedTextMessage?.text || ""
            if (!text) return

            async function escrever(msg) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: msg }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            if (text === '1') {
                await escrever('📋 *Agendamento*: Envie o seu Nome e Endereço.')
            } else {
                await escrever('👋 *Atendimento Lukas Encanador*\n\n1️⃣ Agendar Serviço\n2️⃣ Orçamento\n7️⃣ Atendente')
            }
        } catch (e) {}
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (!client.authState.creds.registered && !aguardandoEmparelhamento) {
            aguardandoEmparelhamento = true
            const Numero = BOT_NUMBER.replace(/[^0-9]/g, '')
            if (Numero) {
                console.log(`📱 A solicitar Código para ${Numero}...`)
                await esperar(6000)
                try {
                    let codigo = await client.requestPairingCode(Numero)
                    console.log(`\n==============================================`)
                    console.log(`🔑 CÓDIGO DE EMPARELHAMENTO VÁLIDO: ${codigo}`)
                    console.log(`==============================================\n`)
                } catch (err) {
                    console.error('❌ Erro ao solicitar código:', err.message)
                    aguardandoEmparelhamento = false
                }
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP!')
            aguardandoEmparelhamento = false
            GRUPO_CHAMADOS_JID = await obterJidGrupo(client, LINK_GRUPO_CHAMADOS)
            GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS)
            GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão fechada (código ${reason || 'desconhecido'}).`)

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                if (aguardandoEmparelhamento) {
                    console.log('⏳ A aguardar introdução do código no telemóvel... Reagendando tentativa em 45s.')
                    setTimeout(() => {
                        aguardandoEmparelhamento = false
                        ligarbot()
                    }, 45000)
                } else {
                    await limparSessaoMongo()
                    setTimeout(() => ligarbot(), 5000)
                }
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
