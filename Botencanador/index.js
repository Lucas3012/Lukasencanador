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
    console.log('🧹 Executando limpeza profunda de sessões...')
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
            console.log('✅ Coleção "sessions" zerada com sucesso no MongoDB!')
        }
    } catch (err) {
        console.error('Erro ao limpar Mongo:', err.message)
    }
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
    
    // Configuração com identificação oficial de navegação
    const client = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Chrome (Linux)', 'Chrome', '120.0.0.0'],
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 90000,
        defaultQueryTimeoutMs: 90000,
        keepAliveIntervalMs: 15000,
        retryRequestOptions: {
            maxRetries: 5
        }
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (!client.authState.creds.registered && !gerandoCodigo && BOT_NUMBER) {
            gerandoCodigo = true
            console.log(`📱 Solicitando código de emparelhamento para: ${BOT_NUMBER}...`)
            
            // Aguarda 10 segundos antes de pedir o código para o servidor estabilizar
            await new Promise(r => setTimeout(r, 10000))
            
            try {
                let codigo = await client.requestPairingCode(BOT_NUMBER)
                console.log(`\n==============================================`)
                console.log(`🔑 CÓDIGO DE EMPARELHAMENTO NOVO: ${codigo}`)
                console.log(`==============================================\n`)
            } catch (err) {
                console.error('❌ Erro ao solicitar código:', err.message)
                gerandoCodigo = false
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO COM SUCESSO AO WHATSAPP!')
            gerandoCodigo = false
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão encerrada (código ${reason}).`)
            gerandoCodigo = false

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log('⚠️ Sessão rejeitada/expirada. Efetuando limpeza completa...')
                await limparSessaoInvalida()
                // Aguarda 15 segundos para reiniciar e evitar bloqueio por requisições seguidas
                setTimeout(() => ligarbot(), 15000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
