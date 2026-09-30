const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@itsliaaa/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Sua chave no formato AQ....
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6JZpdIHUjHmwU5XbZedY64Eh7s2CFQ8AzdkU1LtOM9kyA'

let jaPareou = false

const ARQUIVO_CHAMADOS = path.join(__dirname, 'chamados.json')

function carregarChamados() {
    try {
        if (fs.existsSync(ARQUIVO_CHAMADOS)) {
            const data = fs.readFileSync(ARQUIVO_CHAMADOS, 'utf8')
            return JSON.parse(data)
        }
    } catch (e) {
        console.error('Erro ao ler arquivo de chamados:', e.message)
    }
    return {}
}

function salvarChamado(protocolo, dados) {
    try {
        const chamados = carregarChamados()
        chamados[protocolo] = {
            ...dados,
            dataCriacao: new Date().toISOString()
        }
        fs.writeFileSync(ARQUIVO_CHAMADOS, JSON.stringify(chamados, null, 2), 'utf8')
        console.log(`💾 Chamado #${protocolo} salvo em arquivo!`)
    } catch (e) {
        console.error('Erro ao salvar chamado em arquivo:', e.message)
    }
}

const userState = {} 
const userData = {}

const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ""
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

const question = (texto) => new Promise((resolve) => {
    if (!process.stdin.isTTY) {
        console.log('⚠️ Ambiente sem terminal interativo. Aguardando conexão por sessão salva.');
        return resolve('');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(texto, (resposta) => {
        rl.close()
        resolve(resposta)
    })
})

// Função adaptada para suportar a API Key formato AQ... via Fetch direto da API Gemini
async function responderComGemini(pergunta) {
    try {
        const systemInstruction = `Você é o "Lukas Encanador", um mestre encanador altamente capacitado, simpático e atencioso que presta serviços nas regiões de Itabuna, Ilhéus e Itapé.

Suas diretrizes de atendimento:
1. RESPONDA A TUDO: Tire qualquer dúvida do cliente de forma clara (hidráulica, vazamentos, infiltrações, desentupimentos, pressão da água, troca de reparos, marcas de materiais, etc.).
2. OFEREÇA OS SERVIÇOS: Sempre que responder a uma dúvida técnica ou problema, explique brevemente o motivo e ofereça seus serviços para resolver o problema no local.
3. PERSONALIDADE HUMANA: Responda de forma natural, amigável, educada e bem-humorada (ex: "Opa, tudo joia?", "Com certeza!", "Entendo perfeitamente!").
4. EMOJIS: Use emojis do tema com moderação (🔧, 🚰, 💧, 🛠️, 👍).
5. LEMBRETE: Diga ao cliente que se quiser ver os preços ou agendar um serviço, ele pode digitar *Menu* a qualquer momento.`

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: systemInstruction }]
                },
                contents: [
                    {
                        parts: [{ text: pergunta }]
                    }
                ]
            })
        })

        const data = await response.json()

        if (data.error) {
            console.error('⚠️ Erro na API Gemini:', data.error.message)
            return "Opa, tudo bem? 🔧 Sou o Lukas Encanador! Como posso te ajudar com a sua parte hidráulica hoje? (Caso queira ver nossos serviços, basta digitar *Menu*)."
        }

        return data.candidates[0].content.parts[0].text
    } catch (err) {
        console.error('⚠️ Erro de conexão com a IA:', err.message)
        return "Opa! Sou o Lukas Encanador. Posso te tirar dúvidas sobre vazamentos, infiltrações e reparos. Se quiser agendar uma visita, digite *Menu*!"
    }
}

async function ligarbot() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessao')
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
                        body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                        header: proto.Message.InteractiveMessage.Header.create({ title: title, hasMediaAttachment: false }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: buttonText,
                                        sections: sections
                                    })
                                }
                            ]
                        })
                    })
                }
            }
        }, {})
        await client.relayMessage(from, msg.message, { messageId: msg.key.id })
    }

    async function enviarBotoes(from, text, buttons) {
        const formatButtons = buttons.map(b => ({
            name: "quick_reply",
            buttonParamsJson: JSON.stringify({
                display_text: b.displayText,
                id: b.id
            })
        }))

        const msg = generateWAMessageFromContent(from, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                            buttons: formatButtons
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
                    { title: "Solicitar Serviço / Agendar", description: "Abra um novo chamado de atendimento", id: "op_1" },
                    { title: "Orçamento Automático", description: "Consulte estimativas de preços", id: "op_2" },
                    { title: "Tabela por Categoria", description: "Veja todos os nossos serviços", id: "op_3" }
                ]
            },
            {
                title: "Informações Gerais",
                rows: [
                    { title: "Regiões & Taxa de Visita", description: "Cidades atendidas e custos", id: "op_4" },
                    { title: "Formas de Pagamento", description: "Pix, cartões e dinheiro", id: "op_5" },
                    { title: "Horário de Funcionamento", description: "Nossa disponibilidade", id: "op_6" }
                ]
            },
            {
                title: "Suporte",
                rows: [
                    { title: "Falar com Atendente Humano", description: "Conversar com a equipe", id: "op_7" },
                    { title: "Status do Atendimento", description: "Consultar protocolo ou reclamação", id: "op_8" }
                ]
            }
        ]

        await enviarLista(
            from,
            "🔧 Lukas Encanador",
            "Aqui está o menu com nossos serviços e opções de atendimento. Como posso te ajudar?",
            "Ver Serviços",
            secoes
        )
    }

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            if (info.key && info.key.remoteJid === 'status@broadcast') return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            await client.readMessages([{ remoteJid: from, id: info.key.id, participant: info.key.participant }])

            let text = ""
            if (info.message.conversation) {
                text = info.message.conversation
            } else if (info.message.extendedTextMessage) {
                text = info.message.extendedTextMessage.text
            } else if (info.message.interactiveResponseMessage) {
                const params = JSON.parse(info.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)
                text = params.id || params.text
            } else if (info.message.buttonsResponseMessage) {
                text = info.message.buttonsResponseMessage.selectedButtonId
            } else if (info.message.listResponseMessage) {
                text = info.message.listResponseMessage.singleSelectReply.selectedRowId
            }

            const textNorm = normalizar(text)
            if (!text) return

            console.log(`📩 Mensagem recebida de [${from}]: "${text}"`)

            async function escrever(mensagem) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: mensagem }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estadoAtual = userState[from]
            const rodapeNavegacao = `\n\n─────────────────\n↩ Digite *0* a qualquer momento para voltar ao Menu.`

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'inicio') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuPrincipal(from)
                return
            }

            const pedeAtendimentoOuMenu = (
                textNorm === 'menu' || 
                textNorm === '0' || 
                textNorm === 'atendimento' || 
                textNorm.includes('ver servicos') || 
                textNorm.includes('lista de servicos')
            )

            if (estadoAtual === 'inicio') {
                if (text === '1' || text === 'op_1' || textNorm.includes('solicitar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado - Lukas Encanador*\n\nPara iniciarmos o seu agendamento, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2' || text === 'op_2') {
                    userState[from] = 'orcamento_categoria'
                    await enviarLista(
                        from,
                        "📊 Orçamento Automático",
                        "Qual categoria de serviço você precisa para o seu orçamento?",
                        "Selecionar Categoria",
                        [{
                            title: "Categorias",
                            rows: [
                                { title: "Vazamentos", description: "Caça vazamentos e infiltrações", id: "cat_vazamentos" },
                                { title: "Desentupimentos", description: "Pias, ralos e esgoto", id: "cat_desentupimento" },
                                { title: "Reparo / Manutenção", description: "Torneiras, caixas e válvulas", id: "cat_reparos" }
                            ]
                        }]
                    )
                } else if (text === '3' || text === 'op_3') {
                    userState[from] = 'tabela_categoria'
                    await enviarLista(
                        from,
                        "🛠️ Tabela de Serviços",
                        "Escolha a categoria que deseja para visualizar nossos serviços:",
                        "Ver Categorias",
                        [{
                            title: "Categorias",
                            rows: [
                                { title: "Vazamentos", description: "Infiltrações e vazamentos", id: "tab_vazamentos" },
                                { title: "Desentupimentos", description: "Pias, ralos, vasos e esgoto", id: "tab_desentupimento" },
                                { title: "Reparos e Trocas", description: "Torneiras, válvulas e tubulação", id: "tab_reparos" }
                            ]
                        }]
                    )
                } else if (text === '4' || text === 'op_4') {
                    const regioes = `📍 *Regiões de Atendimento & Visita (Lukas Encanador):*\n\n🏠 Atendemos em:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita:* R$ 50,00 (Valor abatido no total caso o serviço seja aprovado!).`
                    await escrever(regioes)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '5' || text === 'op_5') {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito (até 12x)\n✅ Cartão de Débito\n✅ Dinheiro em espécie`
                    await escrever(pagamentos)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '6' || text === 'op_6') {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nAtendemos de Segunda a Sexta-feira, das 08h às 18h.`
                    await escrever(horarios)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '7' || text === 'op_7') {
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPara transferir para nossa equipe, por favor informe seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '8' || text === 'op_8') {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Reclamação*\n\nPor favor, informe o seu *Nome completo*:' + rodapeNavegacao)
                } else if (pedeAtendimentoOuMenu) {
                    await mostrarMenuPrincipal(from)
                } else {
                    const respostaAI = await responderComGemini(text)
                    await escrever(respostaAI)
                }
            }

            else if (estadoAtual === 'orcamento_categoria' || estadoAtual === 'tabela_categoria') {
                if (text === 'cat_vazamentos' || text === 'tab_vazamentos' || textNorm.includes('vazamento')) {
                    userState[from] = 'descrever_detalhes'
                    userData[from].categoria = "Vazamento"
                    await escrever('💧 *Lukas Encanador - Detalhamento do Vazamento*\n\nPor favor, **descreva o tipo de vazamento** (ex: onde está localizado, se é em cano, parede, torneira ou caixa d\'água):' + rodapeNavegacao)
                } else if (text === 'cat_desentupimento' || text === 'tab_desentupimento' || textNorm.includes('desentupimento')) {
                    userState[from] = 'descrever_detalhes'
                    userData[from].categoria = "Desentupimento"
                    await escrever('🚽 *Lukas Encanador - Detalhamento do Desentupimento*\n\nPor favor, **descreva o tipo de entupimento** (ex: se é na pia, vaso sanitário, ralo ou caixa de esgoto):' + rodapeNavegacao)
                } else if (text === 'cat_reparos' || text === 'tab_reparos' || textNorm.includes('reparo')) {
                    userState[from] = 'descrever_detalhes'
                    userData[from].categoria = "Reparo / Manutenção"
                    await escrever('🛠️ *Lukas Encanador - Detalhamento do Reparo*\n\nPor favor, **descreva qual serviço de reparo ou manutenção você precisa** (ex: troca de torneira, caixa acoplada, válvula hydra):' + rodapeNavegacao)
                } else {
                    await escrever('Opção não reconhecida.')
                }
            }

            else if (estadoAtual === 'descrever_detalhes') {
                userData[from].detalhes = text
                await escrever(`✅ Perfeito! Sou o **Lukas Encanador** e registrei os detalhes do seu serviço de *${userData[from].categoria}*:\n\n💬 "${text}"\n\nDeseja registrar o chamado com esses dados agora?`)
                await enviarBotoes(from, "Escolha uma opção:", [
                    { displayText: "📋 Registrar Chamado", id: "op_1" },
                    { displayText: "🏠 Menu Principal", id: "menu" }
                ])
                userState[from] = 'inicio'
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '0' || textNorm === 'voltar') { userState[from] = 'inicio'; await mostrarMenuPrincipal(from); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! Sou o **Lukas Encanador**. 👋\n\nAgora, digite o seu *Telefone para Contato/WhatsApp* (com DDD):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_telefone') {
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Perfeito! Agora, digite o seu *Endereço completo* (Rua, Número, Bairro):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_endereco') {
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Qual é o serviço que você deseja agendar? Descreva brevemente o problema:' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_detalhes') {
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, {
                    tipo: 'servico',
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    detalhes: userData[from].detalhes
                })
                const resumoChamado = `🚨 *NOVO CHAMADO - LUKAS ENCANADOR*\n\n🔢 *Protocolo:* #${protocolo}\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n🏠 *Endereço:* ${userData[from].endereco}\n📝 *Serviço Solicitado:* ${userData[from].detalhes}`
                await escrever(resumoChamado)
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!* Sou o **Lukas Encanador** e nossa equipe entrará em contato em instantes.`)
                delete userState[from]
                delete userData[from]
            }

        } catch (erro) {
            console.log('Erro ao processar mensagem:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr && !client.authState.creds.registered && !jaPareou) {
            jaPareou = true
            const Pergunta = await question('Por Favor Me diga Seu número (ex: 5573981070937):\n')
            const Numero = Pergunta.replace(/[^0-9]/g, '')
            let codigo = await client.requestPairingCode(Numero)
            codigo = codigo?.match(/.{1,4}/g)?.join("-") || codigo
            console.log(`🔑 Codigo de Pareamento: ${codigo}`)
        }
        
        if (connection === 'open') {
            console.log('✅ Bot Lukas Encanador conectado e operando com a sua chave!')
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => ligarbot(), 1000)
            }
        }
    })
}

ligarbot()
