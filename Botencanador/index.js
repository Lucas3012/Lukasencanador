const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = (process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

let clienteAtual = null
let gerandoCodigo = false

async function limparSessaoInvalida() {
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
            console.log('🧹 Coleção de sessões zerada com sucesso no MongoDB!')
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
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'connecting') {
            console.log('⏳ Estabelecendo conexão segura com o WhatsApp...')
        }

        if (!client.authState.creds.registered && !gerandoCodigo && BOT_NUMBER) {
            gerandoCodigo = true
            console.log(`📱 Aguardando 8 segundos para solicitar código para ${BOT_NUMBER}...`)
            
            await new Promise(r => setTimeout(r, 8000))

            if (client.ws?.readyState === 1) { // Verifica se o socket está aberto antes de solicitar
                try {
                    let codigo = await client.requestPairingCode(BOT_NUMBER)
                    console.log(`\n==============================================`)
                    console.log(`🔑 CÓDIGO DE EMPARELHAMENTO: ${codigo}`)
                    console.log(`==============================================\n`)
                } catch (err) {
                    console.error('❌ Falha ao gerar código:', err.message)
                    gerandoCodigo = false
                }
            } else {
                console.log('⚠️ Conexão socket instável, aguardando próxima tentativa...')
                gerandoCodigo = false
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO COM SUCESSO AO WHATSAPP!')
            gerandoCodigo = false
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão encerrada (código ${reason || 'desconhecido'}).`)
            gerandoCodigo = false

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log('🧹 Limpando dados para novo pareamento...')
                await limparSessaoInvalida()
                setTimeout(() => ligarbot(), 10000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
