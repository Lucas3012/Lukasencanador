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
let gerandoCodigo = false

// --- SCHEMAS E MODELS DO MONGODB ---
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
    try { await Chamado.create({ protocolo, ...dados }) } catch (e) { console.error('❌ Erro ao salvar chamado:', e.message) }
}

async function salvarSuporte(protocolo, dados) {
    try { await Suporte.create({ protocolo, ...dados }) } catch (e) { console.error('❌ Erro ao salvar suporte:', e.message) }
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
            try {
                return await client.groupAcceptInvite(inviteCode)
            } catch (err) {
                const groupInfo = await client.groupGetInviteInfo(inviteCode)
                return groupInfo.id
            }
        }
    } catch (e) {}
    return null
}

async function limparSessaoInvalida() {
    try {
        console.log('🧹 Limpando sessão antiga/inválida no MongoDB...');
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({});
        }
    } catch (err) {
        console.error('Erro ao limpar coleção de sessões no Mongo:', err.message);
    }
    try {
        if (fs.existsSync('./sessao')) {
            fs.rmSync('./sessao', { recursive: true, force: true });
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
            console.error('❌ Falha na conexão MongoAuth:', err.message);
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

    clienteAtual = client
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

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'cancelar') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await escrever('❌ Solicitação cancelada.')
                await mostrarMenuPrincipal(from)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('agendar') || textNorm.includes('solicitar')) {
                    userState[from] = 'form_nome'
                    await escrever('📋 *Formulário de Agendamento (1/5)*\n\nPor favor, digite o seu *Nome completo*:\n\n_(Digite 0 a qualquer momento para cancelar)_')
                } else if (text === '2' || textNorm.includes('orcamento')) {
                    userState[from] = 'orc_nome'
                    await escrever('💰 *Solicitação de Orçamento (1/4)*\n\nPor favor, digite o seu *Nome completo*:\n\n_(Digite 0 a qualquer momento para cancelar)_')
                } else if (text === '3' || textNorm.includes('tabela')) {
                    userState[from] = 'tabela_opcoes'
                    const tabelaTexto = 
`📊 *TABELA DE SERVIÇOS POR CATEGORIA*

🛠️ *1. DESENTUPIMENTOS*
• Pias, Ralos e Vasos Sanitários
• Caixas de Gordura e Colunas

💧 *2. VAZAMENTOS & REPAROS*
• Caça Vazamentos (Detecção)
• Troca de Reparadores, Torneiras e Sifões
• Conserto de Canos Rompidos

📦 *3. CAIXA D'ÁGUA & BOMBAS*
• Limpeza e Higienização
• Instalação de Caixas d'água e Válvulas Alternadoras
• Manutenção de Bombas d'água

---
O que deseja fazer agora?

1️⃣ *Solicitar um agendamento*
2️⃣ *Voltar ao Menu Principal*`

                    await escrever(tabelaTexto)
                } else if (text === '4' || textNorm.includes('regiao')) {
                    await escrever('📍 Atendemos em Itabuna, Ilhéus e região. Taxa de visita a partir de R$ 50,00.')
                } else if (text === '5' || textNorm.includes('pagamento')) {
                    await escrever('💳 Aceitamos Pix, Cartões de Crédito/Débito e Dinheiro.')
                } else if (text === '6' || textNorm.includes('horario')) {
                    await escrever('⏰ *Horário de Funcionamento:*\nSegunda a Sexta: 08:00 às 18:00\nSábado: 08:00 às 12:00\nAtendimento emergencial 24h sob consulta.')
                } else if (text === '7' || textNorm.includes('atendente')) {
                    userState[from] = 'sup_nome'
                    await escrever('👨‍🔧 *Atendimento com Atendente (1/3)*\n\nPara direcionar o seu atendimento, digite o seu *Nome completo*:\n\n_(Digite 0 a qualquer momento para cancelar)_')
                } else if (text === '8' || textNorm.includes('status')) {
                    userState[from] = 'consultar_status'
                    await escrever('🔍 *Consulta de Status*\n\nPor favor, digite o *número do protocolo* de 4 dígitos do seu chamado:\n\n_(Digite 0 para cancelar)_')
                } else {
                    await mostrarMenuPrincipal(from)
                }

            } else if (estadoAtual === 'consultar_status') {
                const protocolo = text.replace(/[^0-9]/g, '')
                const itemEncontrado = await buscarAtendimento(protocolo)

                if (itemEncontrado) {
                    const statusAtual = itemEncontrado.status || 'Pendente'
                    let emojiStatus = '⏳'
                    if (statusAtual.toLowerCase().includes('recebido') || statusAtual.toLowerCase().includes('concluido')) emojiStatus = '✅'
                    if (statusAtual.toLowerCase().includes('cancelado')) emojiStatus = '❌'

                    const respostaStatus = 
`🔍 *STATUS DO ATENDIMENTO*

📌 *Protocolo:* #${protocolo}
👤 *Nome:* ${itemEncontrado.nome || 'N/A'}
📞 *Contato:* ${itemEncontrado.telefone || 'N/A'}
🛠️ *Tipo/Origem:* ${itemEncontrado.tipoServico || itemEncontrado.origem || 'Atendimento'}
📝 *Detalhes:* ${itemEncontrado.detalhes || 'N/A'}

${emojiStatus} *Status Atual:* ${statusAtual}

_Digite *0* para voltar ao menu principal._`

                    await escrever(respostaStatus)
                    userState[from] = 'inicio'
                    delete userData[from]
                } else {
                    await escrever(`❌ *Protocolo #${protocolo} não encontrado!*\n\nPor favor, verifique o número digitado e tente novamente, ou digite *0* para voltar ao menu principal.`)
                }

            } else if (estadoAtual === 'sup_nome') {
                userData[from].nome = text
                userState[from] = 'sup_telefone'
                await escrever(`Prazer, *${text}*!\n\n📞 *(2/3)* Digite o seu *Telefone/WhatsApp* com DDD:`)
            } else if (estadoAtual === 'sup_telefone') {
                userData[from].telefone = text
                userState[from] = 'sup_descricao'
                await escrever('📝 *(3/3)* Por favor, descreva em poucas palavras o motivo do seu contato ou a sua dúvida:')
            } else if (estadoAtual === 'sup_descricao') {
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()

                await salvarSuporte(protocolo, {
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    detalhes: userData[from].detalhes,
                    origem: 'Atendimento Suporte Humano',
                    status: 'Pendente'
                })

                const msgCliente = 
`👨‍🔧 *SOLICITAÇÃO DE ATENDIMENTO REGISTRADA!*

📌 *Protocolo:* #${protocolo}
👤 *Nome:* ${userData[from].nome}
📞 *Telefone:* ${userData[from].telefone}
📝 *Assunto:* ${userData[from].detalhes}

Um atendente humano já recebeu os seus dados e responderá em breve!
_Digite *0* a qualquer momento para voltar ao menu principal._`

                await escrever(msgCliente)

                if (!GRUPO_SUPORTE_JID) GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
                if (GRUPO_SUPORTE_JID) {
                    try {
                        await client.sendMessage(GRUPO_SUPORTE_JID, { text: `🆘 *SOLICITAÇÃO DE SUPORTE (#${protocolo})*\n\n👤 *Cliente:* ${userData[from].nome}\n📞 *Contato:* ${userData[from].telefone}\n📝 *Descrição:* ${userData[from].detalhes}` })
                    } catch (eGrupo) {}
                }

                userState[from] = 'inicio'
                delete userData[from]

            } else if (estadoAtual === 'form_nome') {
                userData[from].nome = text
                userState[from] = 'form_telefone'
                await escrever(`Prazer, *${text}*!\n\n📞 *(2/5)* Agora digite o seu *Telefone/WhatsApp* para contato (com DDD):`)
            } else if (estadoAtual === 'form_telefone') {
                userData[from].telefone = text
                userState[from] = 'form_endereco'
                await escrever('🏠 *(3/5)* Digite o seu *Endereço completo* (Rua, Número, Bairro e Ponto de Referência):')
            } else if (estadoAtual === 'form_endereco') {
                userData[from].endereco = text
                userState[from] = 'form_tipo_servico'
                await escrever('🔧 *(4/5)* Qual é o *Tipo de Serviço* que você precisa?\n\nExemplos:\n- Desentupimento\n- Reparo de Vazamento\n- Instalação de Torneira/Sifão\n- Manutenção de Caixa d\'água\n- Outro')
            } else if (estadoAtual === 'form_tipo_servico') {
                userData[from].tipoServico = text
                userState[from] = 'form_detalhes'
                await escrever('📝 *(5/5)* Por fim, descreva com mais *Detalhes o problema* ou o que precisa ser feito:')
            } else if (estadoAtual === 'form_detalhes') {
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()

                await salvarChamado(protocolo, {
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    tipoServico: userData[from].tipoServico,
                    detalhes: userData[from].detalhes,
                    status: 'Pendente'
                })

                const resumoCliente = 
`✅ *CHAMADO REGISTRADO COM SUCESSO!*

📌 *Protocolo:* #${protocolo}
👤 *Nome:* ${userData[from].nome}
📞 *Telefone:* ${userData[from].telefone}
🏠 *Endereço:* ${userData[from].endereco}
🛠️ *Tipo de Serviço:* ${userData[from].tipoServico}
📝 *Detalhes:* ${userData[from].detalhes}

Nossa equipe entrará em contato em breve para confirmar a visita!
_Digite *0* a qualquer momento para voltar ao menu principal._`

                await escrever(resumoCliente)

                if (GRUPO_CHAMADOS_JID) {
                    try {
                        await client.sendMessage(GRUPO_CHAMADOS_JID, { text: `🚨 *NOVO CHAMADO RECEBIDO!*\n\n📌 *Protocolo:* #${protocolo}\n👤 *Cliente:* ${userData[from].nome}\n📞 *Contato:* ${userData[from].telefone}\n🏠 *Endereço:* ${userData[from].endereco}\n🛠️ *Serviço:* ${userData[from].tipoServico}\n📝 *Detalhes:* ${userData[from].detalhes}` })
                    } catch (eGrupo) {}
                }

                userState[from] = 'inicio'
                delete userData[from]

            } else if (estadoAtual === 'orc_nome') {
                userData[from].nome = text
                userState[from] = 'orc_telefone'
                await escrever(`Prazer, *${text}*!\n\n📞 *(2/4)* Digite o seu *Telefone/WhatsApp* para contato:`)
            } else if (estadoAtual === 'orc_telefone') {
                userData[from].telefone = text
                userState[from] = 'orc_tipo'
                await escrever('🔧 *(3/4)* Escolha uma das categorias abaixo digitando o *número* ou escrevendo:\n\n1️⃣ *Vazamento*\n2️⃣ *Desentupimento*\n3️⃣ *Reparo Geral / Manutenção*')
            } else if (estadoAtual === 'orc_tipo') {
                if (text === '1' || textNorm.includes('vazamento')) userData[from].tipoServico = 'Vazamento'
                else if (text === '2' || textNorm.includes('desentupimento')) userData[from].tipoServico = 'Desentupimento'
                else if (text === '3' || textNorm.includes('reparo') || textNorm.includes('manutencao')) userData[from].tipoServico = 'Reparo Geral / Manutenção'
                else userData[from].tipoServico = text

                userState[from] = 'orc_descricao'
                await escrever('📝 *(4/4)* Descreva em detalhes o *Problema / Serviço* que precisa:')
            } else if (estadoAtual === 'orc_descricao') {
                userData[from].detalhes = text
                userState[from] = 'orc_confirmacao'

                const resumoOrc = 
`📋 *RESUMO DA SOLICITAÇÃO DE ORÇAMENTO*

👤 *Nome:* ${userData[from].nome}
📞 *Telefone:* ${userData[from].telefone}
🛠️ *Categoria:* ${userData[from].tipoServico}
📝 *Descrição:* ${userData[from].detalhes}

💡 *Obs:* O valor do serviço será informado no local. Registre agora seu chamado!

Escolha uma das opções abaixo:

1️⃣ *Registrar chamado agora*
2️⃣ *Voltar ao menu inicial*`

                await escrever(resumoOrc)

            } else if (estadoAtual === 'orc_confirmacao') {
                if (text === '1') {
                    const protocolo = gerarProtocolo()

                    await salvarChamado(protocolo, {
                        nome: userData[from].nome,
                        telefone: userData[from].telefone,
                        tipoServico: userData[from].tipoServico,
                        detalhes: userData[from].detalhes,
                        origem: 'Orçamento Automático',
                        status: 'Pendente'
                    })

                    await escrever(`✅ *CHAMADO REGISTRADO COM SUCESSO!*\n\n📌 *Protocolo:* #${protocolo}\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n🛠️ *Categoria:* ${userData[from].tipoServico}\n📝 *Descrição:* ${userData[from].detalhes}\n\nNossa equipe analisará o seu pedido e entrará em contato em breve!`)

                    userState[from] = 'inicio'
                    delete userData[from]
                } else if (text === '2') {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await escrever('👍 Entendido! Voltando ao menu principal...')
                    await mostrarMenuPrincipal(from)
                }
            }
        } catch (erro) {
            console.log('Erro ao processar mensagem:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (!client.authState.creds.registered && !gerandoCodigo) {
            gerandoCodigo = true
            const Numero = BOT_NUMBER.replace(/[^0-9]/g, '')
            if (Numero) {
                console.log(`📱 Solicitando Código de Emparelhamento para o número ${Numero}...`)
                await esperar(5000)
                try {
                    let codigo = await client.requestPairingCode(Numero)
                    console.log(`\n==============================================`)
                    console.log(`🔑 CÓDIGO DE EMPARELHAMENTO: ${codigo}`)
                    console.log(`==============================================\n`)
                } catch (err) {
                    console.error('❌ Erro ao solicitar código de pareamento:', err.message)
                    gerandoCodigo = false
                }
            } else {
                console.log('⚠️ AVISO: Variável BOT_NUMBER não definida nas variáveis de ambiente!')
            }
        }
        
        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP!')
            gerandoCodigo = false
            GRUPO_CHAMADOS_JID = await obterJidGrupo(client, LINK_GRUPO_CHAMADOS)
            GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS)
            GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão fechada (código ${reason || 'desconhecido'}).`)

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log('❌ Sessão deslogada/inválida. A limpar registos para novo pareamento...')
                await limparSessaoInvalida()
                gerandoCodigo = false
                setTimeout(() => ligarbot(), 3000)
            } else {
                setTimeout(() => ligarbot(), 5000)
            }
        }
    })
}

ligarbot()
