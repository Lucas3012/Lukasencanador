const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')
const qrcodeTerminal = require('qrcode-terminal')
const QRCode = require('qrcode')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = (process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

let clienteAtual = null
let qrCodeBase64 = null

async function limparSessaoInvalida() {
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
            console.log('🧹 Sessão antiga limpa no MongoDB.')
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
        browser: Browsers.ubuntu('Desktop'),
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('\n==============================================')
            console.log('📸 ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP:')
            console.log('==============================================\n')
            qrcodeTerminal.generate(qr, { small: true })
            
            try {
                qrCodeBase64 = await QRCode.toDataURL(qr)
            } catch (e) {}
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO COM SUCESSO AO WHATSAPP!')
            qrCodeBase64 = null
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão encerrada (código ${reason}).`)

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                await limparSessaoInvalida()
                setTimeout(() => ligarbot(), 5000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

// Exporta o QRCode gerado para poder ser servido no Express
module.exports = {
    ligarbot,
    getQRCode: () => qrCodeBase64
}

ligarbot()
