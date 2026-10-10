const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = (process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

// Links dos Grupos do WhatsApp
const LINK_GRUPO_CHAMADOS = 'https://chat.whatsapp.com/EwUIug1DbI3IWZGkpbrJ8n'
const LINK_GRUPO_ORCAMENTOS = 'https://chat.whatsapp.com/HYFutIc2BYi6I0EyM6sBsQ'
const LINK_GRUPO_SUPORTE = 'https://chat.whatsapp.com/F0UYp2zG5pTAgtSE0dwctX'

let GRUPO_CHAMADOS_JID = null
let GRUPO_ORCAMENTOS_JID = null
let GRUPO_SUPORTE_JID = null

let clienteAtual = null

// Schemas do Mongoose para Chamados e Suporte
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
    try { await Chamado.create({ protocolo, ...dados }) } catch (e) { console.error('Erro Mongo Chamado:', e.message) }
}

async function salvarSuporte(protocolo, dados) {
    try { await Suporte.create({ protocolo, ...dados }) } catch (e) { console.error('Erro Mongo Suporte:', e.message) }
}

async function buscarAtendimento(protocolo) {
    try {
        let res = await Chamado.findOne({ protocolo }).lean()
        if (!res) res = await Suporte.findOne({ protocolo }).lean()
        return res
    } catch (e) { return null }
}

// Controle de Estados e Dados de Usuário na memória
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

const MENU_PRINCIPAL = `👋 *Atendimento Lukas Encanador*

Escolha uma das opções abaixo enviando o número desejado:

1️⃣ *Agendar Serviço* (Vazamentos, Instalações, Desentupimentos)
2️⃣ *Solicitar Orçamento Gratuito*
3️⃣ *Emergência 24h* (Inundação, Vazamento Grave)
4️⃣ *Verificar Status do Pedido / Chamado*
5️⃣ *Tabela de Serviços e Preços Base*
6️⃣ *Horários de Atendimento e Região*
7️⃣ *Falar com Atendente Humano*`

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
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    // --- MANIPULADOR DE MENSAGENS (MENU DE 1 A 7 E FLUXO) ---
    client.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            const textRaw = info.message.conversation || info.message.extendedTextMessage?.text || ""
            const text = textRaw.trim()
            if (!text) return

            async function escrever(msg) {
                await client.sendPresenceUpdate('composing', from)
                await esperar(1200)
                await client.sendMessage(from, { text: msg }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estado = userState[from]

            // Voltar ao menu principal se digitar "menu" ou "inicio"
            if (normalizar(text) === 'menu' || normalizar(text) === 'inicio') {
                userState[from] = 'inicio'
                userData[from] = {}
                return await escrever(MENU_PRINCIPAL)
            }

            // --- FLUXO PRINCIPAL ---
            if (estado === 'inicio') {
                if (text === '1' || text === '2') {
                    userData[from].tipoOperacao = text === '1' ? 'Agendamento' : 'Orçamento'
                    userState[from] = 'aguardando_nome'
                    await escrever(`📋 *${userData[from].tipoOperacao}*: Por favor, digite o seu *Nome Completo*:`)

                } else if (text === '3') {
                    // Opção 3: Emergência
                    const prot = gerarProtocolo()
                    const fone = from.replace(/[^0-9]/g, '')
                    
                    await salvarSuporte(prot, {
                        nome: 'Cliente Urgente',
                        telefone: fone,
                        detalhes: '🚨 Chamado de EMERGÊNCIA 24H disparado via WhatsApp.'
                    })

                    if (GRUPO_SUPORTE_JID) {
                        await client.sendMessage(GRUPO_SUPORTE_JID, {
                            text: `🚨 *ALERTA DE EMERGÊNCIA 24H*\n\n📌 *Protocolo:* #${prot}\n📱 *Telefone:* https://wa.me/${fone}\n⚠️ Cliente solicita atendimento imediato!`
                        })
                    }

                    await escrever(`🚨 *ALERTA DE EMERGÊNCIA REGISTRADO!*\n\n📌 *Protocolo:* #${prot}\n\nO nosso técnico foi notificado com prioridade máxima e entrará em contacto com você imediatamente!`)

                } else if (text === '4') {
                    // Opção 4: Status do Pedido
                    userState[from] = 'aguardando_protocolo'
                    await escrever('🔍 Por favor, digite o seu código de *Protocolo* (ex: 4582):')

                } else if (text === '5') {
                    // Opção 5: Tabela de Serviços e Preços Base
                    const tabela = `🛠️ *Tabela de Serviços - Lukas Encanador*\n\n` +
                        `• *Caça Vazamento com Geofone:* A partir de R$ 150\n` +
                        `• *Desentupimento de Ralo/Pia:* A partir de R$ 100\n` +
                        `• *Instalação de Torneira/Sifão:* A partir de R$ 80\n` +
                        `• *Manutenção de Caixa D'água:* A partir de R$ 120\n` +
                        `• *Troca de Reparo de Válvula Hydra:* A partir de R$ 90\n\n` +
                        `*Nota:* Os valores podem variar de acordo com a complexidade. Digite *1* para agendar uma visita técnica!`
                    await escrever(tabela)

                } else if (text === '6') {
                    // Opção 6: Horários e Regiões
                    const infoServico = `📍 *Região de Atendimento & Horários*\n\n` +
                        `⏰ *Horário:* Segunda a Sábado das 07h às 19h\n` +
                        `🚨 *Plantão 24h:* Disponível para Emergências\n\n` +
                        `🏙️ *Cidades Atendidas:* Centro e bairros da região metropolitana.\n\n` +
                        `Digite *MENU* para voltar às opções.`
                    await escrever(infoServico)

                } else if (text === '7') {
                    // Opção 7: Atendente Humano
                    const prot = gerarProtocolo()
                    const fone = from.replace(/[^0-9]/g, '')

                    await salvarSuporte(prot, {
                        nome: 'Atendimento Direto',
                        telefone: fone,
                        detalhes: 'Cliente solicitou falar com atendente humano.'
                    })

                    if (GRUPO_SUPORTE_JID) {
                        await client.sendMessage(GRUPO_SUPORTE_JID, {
                            text: `👨‍🔧 *SOLICITAÇÃO DE ATENDENTE HUMANO*\n\n📌 *Protocolo:* #${prot}\n📱 *Cliente:* https://wa.me/${fone}`
                        })
                    }

                    await escrever(`👨‍🔧 *Atendimento Humano Solicita do*\n\n📌 *Protocolo:* #${prot}\n\nUm dos nossos atendentes irá responder a esta conversa em breve. Aguarde um momento!`)

                } else {
                    await escrever(MENU_PRINCIPAL)
                }

            } else if (estado === 'aguardando_nome') {
                userData[from].nome = text
                userState[from] = 'aguardando_endereco'
                await escrever(`📍 Obrigado, *${text}*. Agora digite o seu *Endereço Completo* (Com Ponto de Referência):`)

            } else if (estado === 'aguardando_endereco') {
                userData[from].endereco = text
                userState[from] = 'aguardando_detalhes'
                await escrever(`🛠️ Descreva brevemente o problema ou serviço necessário (ex: vazamento na cozinha, ralo entupido):`)

            } else if (estado === 'aguardando_detalhes') {
                userData[from].detalhes = text
                const prot = gerarProtocolo()
                const fone = from.replace(/[^0-9]/g, '')
                const tipo = userData[from].tipoOperacao || 'Agendamento/Orçamento'

                await salvarChamado(prot, {
                    nome: userData[from].nome,
                    telefone: fone,
                    endereco: userData[from].endereco,
                    tipoServico: tipo,
                    detalhes: userData[from].detalhes,
                    origem: tipo
                })

                const msgGrupo = `📋 *NOVO CHAMADO REGISTRADO (#${prot})*\n\n` +
                    `👤 *Cliente:* ${userData[from].nome}\n` +
                    `📱 *Contato:* https://wa.me/${fone}\n` +
                    `📍 *Endereço:* ${userData[from].endereco}\n` +
                    `🛠️ *Serviço:* ${tipo}\n` +
                    `📝 *Detalhes:* ${userData[from].detalhes}`

                const targetGroup = (tipo === 'Agendamento' ? GRUPO_CHAMADOS_JID : GRUPO_ORCAMENTOS_JID) || GRUPO_CHAMADOS_JID

                if (targetGroup) {
                    await client.sendMessage(targetGroup, { text: msgGrupo })
                }

                await escrever(`🎉 *${tipo} Registrado com Sucesso!*\n\n📌 *Protocolo:* #${prot}\n👤 *Nome:* ${userData[from].nome}\n📍 *Endereço:* ${userData[from].endereco}\n\nA nossa equipe entrará em contacto em breve para confirmar o horário!`)

                userState[from] = 'inicio'
                userData[from] = {}

            } else if (estado === 'aguardando_protocolo') {
                const busca = await buscarAtendimento(text.replace(/[^0-9]/g, ''))
                if (busca) {
                    await escrever(`🔎 *Status do Protocolo #${busca.protocolo}*\n\n👤 *Cliente:* ${busca.nome || 'N/I'}\n🛠️ *Serviço:* ${busca.tipoServico || busca.origem}\n📌 *Status Atual:* *${busca.status || 'Pendente'}*\n📅 *Data:* ${new Date(busca.createdAt).toLocaleDateString('pt-BR')}`)
                } else {
                    await escrever(`❌ Não encontramos nenhum chamado ou pedido com o protocolo *#${text}*. Verifique o número e tente novamente ou digite *MENU*.`)
                }
                userState[from] = 'inicio'
            }

        } catch (err) {
            console.error('❌ Erro ao processar mensagem:', err.message)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP!')
            await client.sendPresenceUpdate('available')

            GRUPO_CHAMADOS_JID = await obterJidGrupo(client, LINK_GRUPO_CHAMADOS)
            GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS)
            GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão encerrada (código ${reason || 'desconhecido'}).`)

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log('🧹 Limpando registos inválidos...')
                await limparSessaoInvalida()
                setTimeout(() => ligarbot(), 5000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
