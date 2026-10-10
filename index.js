const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = (process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

let clienteAtual = null

async function limparSessaoInvalida() {
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
            console.log('🧹 Coleção de sessões limpa no MongoDB.')
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
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        markOnlineOnConnect: true, // Força o bot a ficar Online no WhatsApp
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    // --- ESCUTA E RESPOSTA AUTOMÁTICA A MENSAGENS ---
    client.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return

            const from = info.key.remoteJid
            // Ignora mensagens de grupos e canais/novidades
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            const texto = info.message.conversation || info.message.extendedTextMessage?.text || ""
            console.log(`📩 Mensagem recebida de ${from}: ${texto}`)

            // Simula presença "A escrever..."
            await client.sendPresenceUpdate('composing', from)
            await new Promise(r => setTimeout(r, 1500))

            const menu = `👋 *Olá! Bem-vindo ao atendimento do Lukas Encanador.*\n\nComo posso ajudar hoje?\n\n1️⃣ *Agendar Serviço*\n2️⃣ *Solicitar Orçamento*\n7️⃣ *Falar com Atendente*`

            if (texto.trim() === '1') {
                await client.sendMessage(from, { text: '📋 *Agendamento*: Por favor, envie o seu *Nome completo* e *Endereço com Ponto de Referência*.' }, { quoted: info })
            } else if (texto.trim() === '2') {
                await client.sendMessage(from, { text: '💰 *Orçamento*: Descreva brevemente o problema ou serviço que necessita (ex: vazamento na pia, instalação de torneira).' }, { quoted: info })
            } else if (texto.trim() === '7') {
                await client.sendMessage(from, { text: '👨‍🔧 Um atendente humano responderá a esta conversa em breve. Aguarde um momento!' }, { quoted: info })
            } else {
                await client.sendMessage(from, { text: menu }, { quoted: info })
            }
        } catch (err) {
            console.error('❌ Erro ao responder mensagem:', err.message)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
            console.log('🎉 ==============================================')
            console.log('🎉 BOT OFICIALMENTE CONECTADO E ONLINE NO WHATSAPP!')
            console.log('🎉 ==============================================')
            await client.sendPresenceUpdate('available')
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão encerrada (código ${reason || 'desconhecido'}).`)

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log('🧹 Sessão expirada/desconectada no telemóvel. A limpar registos...')
                await limparSessaoInvalida()
                setTimeout(() => ligarbot(), 5000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
