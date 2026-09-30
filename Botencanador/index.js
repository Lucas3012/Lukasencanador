const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@itsliaaa/baileys')
const { GoogleGenAI } = require('@google/genai')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Insira a chave gerada no Google AI Studio (deve começar com AIzaSy...):
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'SUA_CHAVE_AQUI'
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

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

async function responderComGemini(pergunta) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: pergunta,
            config: {
                systemInstruction: `Você é o "Lukas Encanador", um encanador experiente, extremamente educado, bem-humorado e confiável que atende em Itabuna, Ilhéus e Itapé.

Tom de voz e Personalidade:
1. Responda como um profissional humano de verdade: caloroso, prestativo e direto ao ponto. Use expressões amigáveis (ex: "Opa, tudo joia?", "Tranquilo!", "Com certeza, posso te ajudar com isso!").
2. Demonstre conhecimento prático sobre hidráulica, vazamentos, pias, vasos sanitários, caixas d'água e tubulações.
3. Use emojis do universo da construção e reparo de forma natural (🔧, 🚰, 💧, 👍, 🛠️).
4. Se o cliente apenas saudar ou fazer uma pergunta rápida, converse de forma natural. Se ele demonstrar que quer agendar ou contratar, lembre-o com simpatia: "Se quiser ver nossa tabela de serviços ou abrir um chamado direto, é só digitar *Menu*!".
5. Mantenha as respostas relativamente curtas e fáceis de ler no WhatsApp.`
            }
        });
        return response.text;
    } catch (err) {
        console.error('⚠️ Erro na chamada do Gemini:', err.message);
        return "Opa, tudo bem? 🔧 Sou o Lukas Encanador! Tive um pequeno probleminha aqui no sinal, mas me diz: como posso te ajudar com a parte hidráulica hoje? (Se quiser ver nossos serviços, basta digitar *Menu*).";
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
                    { title: "Solicitar Serviço / Agendar", description: "Abra um novo chamado com a gente", id: "op_1" },
                    { title: "Orçamento Automático", description: "Consulte estimativas rapidamente", id: "op_2" },
                    { title: "Tabela por Categoria", description: "Veja nossos serviços disponíveis", id: "op_3" }
                ]
            },
            {
                title: "Informações Gerais",
                rows: [
                    { title: "Regiões & Taxa de Visita", description: "Cidades atendidas e valores", id: "op_4" },
                    { title: "Formas de Pagamento", description: "Pix, cartões e dinheiro", id: "op_5" },
                    { title: "Horário de Funcionamento", description: "Veja quando estamos disponíveis", id: "op_6" }
                ]
            },
            {
                title: "Suporte",
                rows: [
                    { title: "Falar com Atendente Humano", description: "Conversar com a nossa equipe", id: "op_7" },
                    { title: "Status do Atendimento", description: "Consultar protocolo ou suporte", id: "op_8" }
                ]
            }
        ]

        await enviarLista(
            from,
            "🔧 Lukas Encanador",
            "Opa! Aqui está o nosso menu completo de serviços e opções. Como posso te ajudar hoje?",
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
                    await escrever('📋 *Abertura de Chamado - Lukas Encanador*\n\nExcelente! Para organizar o seu agendamento, pode me dizer o seu *Nome completo*?' + rodapeNavegacao)
                } else if (text === '2' || text === 'op_2') {
                    userState[from] = 'orcamento_categoria'
                    await enviarLista(
                        from,
                        "📊 Orçamento Automático",
                        "Perfeito! De qual dessas categorias é o serviço que você precisa?",
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
                        "Escolha a categoria abaixo para dar uma olhada na nossa lista de serviços:",
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
                    const regioes = `📍 *Regiões de Atendimento & Visita (Lukas Encanador):*\n\n🏠 Atendemos com agilidade em:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita:* R$ 50,00 (E o melhor: esse valor é abatido no total se você fechar o serviço com a gente!).`
                    await escrever(regioes)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '5' || text === 'op_5') {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\nFacilitamos para você! Aceitamos:\n✅ Pix\n✅ Cartão de Crédito (em até 12x)\n✅ Cartão de Débito\n✅ Dinheiro em espécie`
                    await escrever(pagamentos)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '6' || text === 'op_6') {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nNossa equipe está de prontidão de Segunda a Sexta-feira, das 08h às 18h.`
                    await escrever(horarios)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else if (text === '7' || text === 'op_7') {
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nCom certeza! Para eu te encaminhar para a equipe agora mesmo, informe seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '8' || text === 'op_8') {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Suporte*\n\nSem problemas! Por favor, digite seu *Nome completo* para localizarmos seu histórico:' + rodapeNavegacao)
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
                    await escrever('💧 *Detalhamento de Vazamento*\n\nCerto! Me conta brevemente onde está o vazamento (ex: cano na parede, torneira pingando, caixa d\'água, infiltração...):' + rodapeNavegacao)
                } else if (text === 'cat_desentupimento' || text === 'tab_desentupimento' || textNorm.includes('desentupimento')) {
                    userState[from] = 'descrever_detalhes'
                    userData[from].categoria = "Desentupimento"
                    await escrever('🚽 *Detalhamento de Desentupimento*\n\nPerfeito! Pode me explicar o que está entupido? (ex: pia da cozinha, vaso sanitário, ralo do banheiro, caixa de esgoto...):' + rodapeNavegacao)
                } else if (text === 'cat_reparos' || text === 'tab_reparos' || textNorm.includes('reparo')) {
                    userState[from] = 'descrever_detalhes'
                    userData[from].categoria = "Reparo / Manutenção"
                    await escrever('🛠️ *Detalhamento do Reparo*\n\nShow! Qual reparo ou troca você precisa realizar? (ex: trocar reparo de válvula Hydra, instalar torneira, trocar caixa acoplada...):' + rodapeNavegacao)
                } else {
                    await escrever('Opção não reconhecida.')
                }
            }

            else if (estadoAtual === 'descrever_detalhes') {
                userData[from].detalhes = text
                await escrever(`✅ Entendido! Anotei aqui os detalhes do seu serviço de *${userData[from].categoria}*:\n\n💬 "${text}"\n\nDeseja abrir o chamado de atendimento agora com esses dados?`)
                await enviarBotoes(from, "Como deseja prosseguir?", [
                    { displayText: "📋 Registrar Chamado", id: "op_1" },
                    { displayText: "🏠 Menu Principal", id: "menu" }
                ])
                userState[from] = 'inicio'
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '0' || textNorm === 'voltar') { userState[from] = 'inicio'; await mostrarMenuPrincipal(from); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer em te conhecer, *${text}*! 👋\n\nQual é o seu *Telefone/WhatsApp* para contato (com DDD)?` + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_telefone') {
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Perfeito! Agora me informe o *Endereço completo* onde será o serviço (Rua, Número e Bairro):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_endereco') {
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Para finalizar: descreva brevemente o problema ou o serviço que precisa ser feito:' + rodapeNavegacao)
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
                const resumoChamado = `🚨 *NOVO CHAMADO REGISTRADO - LUKAS ENCANADOR*\n\n🔢 *Protocolo:* #${protocolo}\n👤 *Cliente:* ${userData[from].nome}\n📞 *Contato:* ${userData[from].telefone}\n🏠 *Endereço:* ${userData[from].endereco}\n📝 *Serviço:* ${userData[from].detalhes}`
                await escrever(resumoChamado)
                await escrever(`✅ *Chamado #${protocolo} gerado com sucesso!* Já registrei tudo aqui e nossa equipe vai entrar em contato com você o mais rápido possível! 🛠️👍`)
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
            console.log('✅ Bot Lukas Encanador com Personalidade Conectado!')
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
