const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = process.env.BOT_NUMBER || ''

// Links dos grupos do WhatsApp
const LINK_GRUPO_CHAMADOS = 'https://chat.whatsapp.com/EwUIug1DbI3IWZGkpbrJ8n'
const LINK_GRUPO_ORCAMENTOS = 'https://chat.whatsapp.com/HYFutIc2BYi6I0EyM6sBsQ'
const LINK_GRUPO_SUPORTE = 'https://chat.whatsapp.com/F0UYp2zG5pTAgtSE0dwctX'

let GRUPO_CHAMADOS_JID = null
let GRUPO_ORCAMENTOS_JID = null
let GRUPO_SUPORTE_JID = null

let jaPareou = false
let clienteAtual = null

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

async function obterJidGrupo(client, linkGrupo) {
    try {
        const codeMatch = linkGrupo.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)
        if (codeMatch && codeMatch[1]) {
            const inviteCode = codeMatch[1]
            try {
                const jid = await client.groupAcceptInvite(inviteCode)
                return jid
            } catch (err) {
                const groupInfo = await client.groupGetInviteInfo(inviteCode)
                return groupInfo.id
            }
        }
    } catch (e) {
        console.error('⚠️ Erro ao vincular grupo:', linkGrupo, e.message)
    }
    return null
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

            // Cancela/volta ao menu
            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'cancelar') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await escrever('❌ Solicitação cancelada.')
                await mostrarMenuPrincipal(from)
                return
            }

            // MENU PRINCIPAL
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
                    await escrever('🔍 Para verificar o status, digite o *número do protocolo* do seu chamado:')
                } else {
                    await mostrarMenuPrincipal(from)
                }

            // --- FLUXO OPÇÃO 3: TABELA POR CATEGORIA ---
            } else if (estadoAtual === 'tabela_opcoes') {
                if (text === '1') {
                    userState[from] = 'form_nome'
                    await escrever('📋 *Formulário de Agendamento (1/5)*\n\nPor favor, digite o seu *Nome completo*:\n\n_(Digite 0 a qualquer momento para cancelar)_')
                } else if (text === '2') {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await mostrarMenuPrincipal(from)
                } else {
                    await escrever('⚠️ Opção inválida. Digite *1* para Solicitar um agendamento ou *2* para Voltar ao Menu Principal.')
                }

            // --- FLUXO OPÇÃO 7: SUPORTE / ATENDENTE HUMANO ---
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

                salvarChamado(protocolo, {
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

                if (!GRUPO_SUPORTE_JID) {
                    GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
                }

                if (GRUPO_SUPORTE_JID) {
                    try {
                        const mensagemGrupo = 
`🆘 *SOLICITAÇÃO DE SUPORTE HUMANO (#${protocolo})*

👤 *Cliente:* ${userData[from].nome}
📞 *Contato:* ${userData[from].telefone}
📝 *Descrição:* ${userData[from].detalhes}`

                        await client.sendMessage(GRUPO_SUPORTE_JID, { text: mensagemGrupo })
                        console.log(`📢 Solicitação de suporte #${protocolo} enviada ao grupo!`)
                    } catch (eGrupo) {
                        console.error('❌ Erro ao enviar para o grupo de suporte:', eGrupo.message)
                    }
                }

                userState[from] = 'inicio'
                delete userData[from]

            // --- FLUXO OPÇÃO 1: FORMULÁRIO COMPLETO ---
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

                salvarChamado(protocolo, {
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
                        const mensagemGrupo = 
`🚨 *NOVO CHAMADO RECEBIDO!*

📌 *Protocolo:* #${protocolo}
👤 *Cliente:* ${userData[from].nome}
📞 *Contato:* ${userData[from].telefone}
🏠 *Endereço:* ${userData[from].endereco}
🛠️ *Serviço:* ${userData[from].tipoServico}
📝 *Detalhes:* ${userData[from].detalhes}`

                        await client.sendMessage(GRUPO_CHAMADOS_JID, { text: mensagemGrupo })
                        console.log(`📢 Chamado #${protocolo} enviado ao grupo de chamados!`)
                    } catch (eGrupo) {
                        console.error('❌ Erro ao enviar para o grupo de chamados:', eGrupo.message)
                    }
                }

                userState[from] = 'inicio'
                delete userData[from]

            // --- FLUXO OPÇÃO 2: ORÇAMENTO AUTOMÁTICO ---
            } else if (estadoAtual === 'orc_nome') {
                userData[from].nome = text
                userState[from] = 'orc_telefone'
                await escrever(`Prazer, *${text}*!\n\n📞 *(2/4)* Digite o seu *Telefone/WhatsApp* para contato:`)
            } else if (estadoAtual === 'orc_telefone') {
                userData[from].telefone = text
                userState[from] = 'orc_tipo'
                
                const categoriasTexto = 
`🔧 *(3/4)* Escolha uma das categorias abaixo digitando o *número* ou escrevendo:

1️⃣ *Vazamento*
2️⃣ *Desentupimento*
3️⃣ *Reparo Geral / Manutenção*`

                await escrever(categoriasTexto)
            } else if (estadoAtual === 'orc_tipo') {
                if (text === '1' || textNorm.includes('vazamento')) {
                    userData[from].tipoServico = 'Vazamento'
                } else if (text === '2' || textNorm.includes('desentupimento')) {
                    userData[from].tipoServico = 'Desentupimento'
                } else if (text === '3' || textNorm.includes('reparo') || textNorm.includes('manutencao')) {
                    userData[from].tipoServico = 'Reparo Geral / Manutenção'
                } else {
                    userData[from].tipoServico = text
                }

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

                if (!GRUPO_ORCAMENTOS_JID) {
                    GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS)
                }

                if (GRUPO_ORCAMENTOS_JID) {
                    try {
                        const mensagemGrupo = 
`💰 *SOLICITAÇÃO DE ORÇAMENTO RECEBIDA*

👤 *Cliente:* ${userData[from].nome}
📞 *Contato:* ${userData[from].telefone}
🛠️ *Categoria:* ${userData[from].tipoServico}
📝 *Descrição:* ${userData[from].detalhes}`

                        await client.sendMessage(GRUPO_ORCAMENTOS_JID, { text: mensagemGrupo })
                        console.log(`📢 Resumo de orçamento de ${userData[from].nome} enviado ao grupo!`)
                    } catch (eGrupo) {
                        console.error('❌ Erro ao enviar resumo para o grupo:', eGrupo.message)
                    }
                }

            } else if (estadoAtual === 'orc_confirmacao') {
                if (text === '1') {
                    const protocolo = gerarProtocolo()

                    salvarChamado(protocolo, {
                        nome: userData[from].nome,
                        telefone: userData[from].telefone,
                        tipoServico: userData[from].tipoServico,
                        detalhes: userData[from].detalhes,
                        origem: 'Orçamento Automático',
                        status: 'Pendente'
                    })

                    const msgSucesso = 
`✅ *CHAMADO REGISTRADO COM SUCESSO!*

📌 *Protocolo:* #${protocolo}
👤 *Nome:* ${userData[from].nome}
📞 *Telefone:* ${userData[from].telefone}
🛠️ *Categoria:* ${userData[from].tipoServico}
📝 *Descrição:* ${userData[from].detalhes}

Nossa equipe analisará o seu pedido e entrará em contato em breve!
_Digite *0* para voltar ao menu principal._`

                    await escrever(msgSucesso)

                    if (GRUPO_ORCAMENTOS_JID) {
                        try {
                            const mensagemGrupo = 
`✅ *CHAMADO CONFIRMADO PELO CLIENTE (#${protocolo})*

👤 *Cliente:* ${userData[from].nome}
📞 *Contato:* ${userData[from].telefone}
🛠️ *Categoria:* ${userData[from].tipoServico}
📝 *Descrição:* ${userData[from].detalhes}`

                            await client.sendMessage(GRUPO_ORCAMENTOS_JID, { text: mensagemGrupo })
                        } catch (eGrupo) {}
                    }

                    userState[from] = 'inicio'
                    delete userData[from]
                } else if (text === '2') {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await escrever('👍 Entendido! Voltando ao menu principal...')
                    await mostrarMenuPrincipal(from)
                } else {
                    await escrever('⚠️ Opção inválida. Digite *1* para Registrar chamado agora ou *2* para Voltar ao menu inicial.')
                }
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

            GRUPO_CHAMADOS_JID = await obterJidGrupo(client, LINK_GRUPO_CHAMADOS)
            if (GRUPO_CHAMADOS_JID) console.log(`👥 Grupo Chamados vinculado: ${GRUPO_CHAMADOS_JID}`)

            GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS)
            if (GRUPO_ORCAMENTOS_JID) console.log(`👥 Grupo Orçamentos vinculado: ${GRUPO_ORCAMENTOS_JID}`)

            GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE)
            if (GRUPO_SUPORTE_JID) console.log(`👥 Grupo Suporte vinculado: ${GRUPO_SUPORTE_JID}`)
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`🔄 Conexão fechada (${reason || 'desconhecido'}). Reiniciando em 5 segundos...`)
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 5000)
            } else {
                console.log('❌ Sessão deslogada.')
            }
        }
    })
}

ligarbot()
