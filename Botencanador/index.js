const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason, generateWAMessageFromContent, proto } = require('@itsliaaa/baileys')
const { GoogleGenAI } = require('@google/genai')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Configuração da API do Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

let jaPareou = false

// Arquivo local para persistência de dados
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
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim() : ""
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
    if (!GEMINI_API_KEY) return null
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: pergunta,
            config: {
                systemInstruction: `Você é o assistente virtual inteligente de uma empresa de encanadores profissionais que atende Itabuna, Ilhéus e Itapé. 
Sua função é tirar dúvidas simples sobre hidráulica, vazamentos e desentupimentos com cordialidade, objetividade e clareza.
Sempre lembre o cliente de que soluções definitivas devem ser feitas por um especialista.`
            }
        });
        return response.text;
    } catch (err) {
        console.error('Erro na chamada do Gemini:', err);
        return null;
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

    // Função para enviar Lista Interativa (List Message)
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

    // Função para enviar Botões Interativos (Quick Reply Buttons)
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
                title: "Informações Geral",
                rows: [
                    { title: "Regiões & Taxa de Visita", description: "Cidades atendidas e custos", id: "op_4" },
                    { title: "Formas de Pagamento", description: "Pix, cartões e dinheiro", id: "op_5" },
                    { title: "Horário de Funcionamento", description: "Nossa disponibilidade", id: "op_6" }
                ]
            },
            {
                title: "Suporte",
                rows: [
                    { title: "Falar com Atendente", description: "Conversar com equipe humana", id: "op_7" },
                    { title: "Status do Atendimento", description: "Consultar protocolo ou reclamação", id: "op_8" }
                ]
            }
        ]

        await enviarLista(
            from,
            "👋 Atendimento do Encanador",
            "Seja bem-vindo! Clique no botão abaixo para abrir a lista de opções disponíveis:",
            "Ver Opções",
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

            // Captura avançada do texto e botões no WhatsApp
            let text = ""
            const msg = info.message

            if (msg.conversation) {
                text = msg.conversation
            } else if (msg.extendedTextMessage?.text) {
                text = msg.extendedTextMessage.text
            } else if (msg.interactiveResponseMessage) {
                try {
                    const params = JSON.parse(msg.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)
                    text = params.id || params.text || ""
                } catch (e) {
                    text = msg.interactiveResponseMessage.body?.text || ""
                }
            } else if (msg.templateButtonReplyMessage) {
                text = msg.templateButtonReplyMessage.selectedId || msg.templateButtonReplyMessage.selectedDisplayText || ""
            } else if (msg.buttonsResponseMessage) {
                text = msg.buttonsResponseMessage.selectedButtonId || msg.buttonsResponseMessage.selectedButtonDisplayText || ""
            } else if (msg.listResponseMessage) {
                text = msg.listResponseMessage.singleSelectReply?.selectedRowId || ""
            }

            const textNorm = normalizar(text)
            if (!text) return

            console.log(`📩 Mensagem recebida de [${from}]: "${text}" (Norm: "${textNorm}")`)

            async function escrever(mensagem) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: mensagem }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estadoAtual = userState[from]
            const rodapeNavegacao = `\n\n─────────────────\n↩️ Digite *0* a qualquer momento para voltar ao Menu.`

            // Ação de Voltar ao Menu
            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm.includes('menu principal')) && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuPrincipal(from)
                return
            }

            if (estadoAtual === 'inicio') {
                // Registrar Chamado / Agendar
                if (text === '1' || text === 'op_1' || textNorm.includes('registrar chamado') || textNorm.includes('solicitar') || textNorm.includes('agendar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                
                // Orçamento
                } else if (text === '2' || text === 'op_2' || textNorm.includes('orcamento')) {
                    userState[from] = 'tabela_categoria'
                    await enviarLista(
                        from,
                        "📊 Orçamento Automático",
                        "Selecione qual categoria de serviço você deseja consultar:",
                        "Selecionar Categoria",
                        [{
                            title: "Categorias",
                            rows: [
                                { title: "Vazamentos", description: "Caça vazamentos e infiltrações", id: "tab_vazamentos" },
                                { title: "Desentupimentos", description: "Pias, ralos e esgoto", id: "tab_desentupimento" },
                                { title: "Reparo / Manutenção", description: "Torneiras, caixas e válvulas", id: "tab_reparos" }
                            ]
                        }]
                    )

                // Tabela de Serviços por Categoria
                } else if (text === '3' || text === 'op_3' || textNorm.includes('tabela')) {
                    userState[from] = 'tabela_categoria'
                    await enviarLista(
                        from,
                        "🛠️ Tabela de Serviços",
                        "Escolha a categoria para visualizar a lista completa:",
                        "Ver Categorias",
                        [{
                            title: "Categorias",
                            rows: [
                                { title: "Vazamentos", description: "Caça vazamentos e infiltrações", id: "tab_vazamentos" },
                                { title: "Desentupimentos", description: "Pias, ralos, vasos e esgoto", id: "tab_desentupimento" },
                                { title: "Reparo / Manutenção", description: "Torneiras, caixas d'água e válvulas", id: "tab_reparos" }
                            ]
                        }]
                    )

                // Regiões
                } else if (text === '4' || text === 'op_4' || textNorm.includes('regiao')) {
                    const regioes = `📍 *Regiões de Atendimento & Visita:*\n\n🏠 Atendemos exclusivamente em:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita:* R$ 50,00 (Valor abatido no total caso o serviço seja aprovado!).`
                    await escrever(regioes)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])

                // Pagamento
                } else if (text === '5' || text === 'op_5' || textNorm.includes('pagamento')) {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito (até 12x)\n✅ Cartão de Débito\n✅ Dinheiro em espécie`
                    await escrever(pagamentos)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])

                // Horário
                } else if (text === '6' || text === 'op_6' || textNorm.includes('horario')) {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nAtendemos de Segunda a Sexta-feira, das 08h às 18h.`
                    await escrever(horarios)
                    await enviarBotoes(from, "Como deseja prosseguir?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])

                // Atendente
                } else if (text === '7' || text === 'op_7' || textNorm.includes('atendente')) {
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPara encaminharmos você a um especialista, por favor digite seu *Nome completo*:' + rodapeNavegacao)

                // Status / Reclamação
                } else if (text === '8' || text === 'op_8' || textNorm.includes('status') || textNorm.includes('reclamacao')) {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Reclamação*\n\nPor favor, informe o seu *Nome completo*:' + rodapeNavegacao)

                // Menu Principal por texto
                } else if (textNorm === 'menu' || textNorm.includes('menu principal')) {
                    await mostrarMenuPrincipal(from)

                // Resposta IA ou Menu padrão
                } else {
                    const respostaAI = await responderComGemini(text)
                    if (respostaAI) {
                        await escrever(respostaAI)
                    }
                    await mostrarMenuPrincipal(from)
                }
            }

            // Tratamento das categorias com 20 serviços em cada
            else if (estadoAtual === 'tabela_categoria') {
                if (text === 'tab_vazamentos' || textNorm.includes('vazamento')) {
                    const listaVazamentos = `🔍 *Lista de Serviços - Vazamentos (20 Opções):*\n\n` +
                        `1. Caça-vazamento não visível com Geofone\n` +
                        `2. Detecção de vazamento por Termografia (Câmera Térmica)\n` +
                        `3. Localização de vazamento em tubulações presas na parede\n` +
                        `4. Reparo de vazamento em cano de água fria (PVC/PPR)\n` +
                        `5. Reparo de vazamento em tubulação de água quente (Cobre/PEX)\n` +
                        `6. Diagnóstico de infiltração em lajes e teto\n` +
                        `7. Reparo de vazamento de esgoto subterrâneo\n` +
                        `8. Identificação de vazamento em caixa d'água\n` +
                        `9. Conserto de vazamento no vaso sanitário/acoplado\n` +
                        `10. Reparo de vazamento em válvula de descarga Hydra/Docol\n` +
                        `11. Eliminador de vazamento em sifão de pia/tanque\n` +
                        `12. Reparo de vazamento no registro geral\n` +
                        `13. Correção de infiltração ao redor do ralo do box\n` +
                        `14. Eliminação de vazamento em chuveiro/ducha\n` +
                        `15. Reparo em vazamento de coluna do prédio/condomínio\n` +
                        `16. Detecção de vazamento em piscina\n` +
                        `17. Teste de estanqueidade e pressão da rede de água\n` +
                        `18. Reparo de vazamento em flexíveis e engates\n` +
                        `19. Vedação contra vazamentos de torneiras de parede\n` +
                        `20. Teste de pressurização e teste de vazão de água`

                    await escrever(listaVazamentos)
                    userState[from] = 'inicio'
                    await enviarBotoes(from, "Deseja agendar um atendimento para este serviço?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])

                } else if (text === 'tab_desentupimento' || textNorm.includes('desentupimento')) {
                    const listaDesentupimento = `🌀 *Lista de Serviços - Desentupimentos (20 Opções):*\n\n` +
                        `1. Desentupimento de pia de cozinha\n` +
                        `2. Desentupimento de vaso sanitário\n` +
                        `3. Desentupimento de ralo de banheiro / box\n` +
                        `4. Desentupimento de ralo de lavanderia / quintal\n` +
                        `5. Desentupimento de caixa de gordura\n` +
                        `6. Desentupimento de caixa de inspeção de esgoto\n` +
                        `7. Desentupimento de rede geral de esgoto\n` +
                        `8. Desentupimento de coluna predial de esgoto\n` +
                        `9. Desentupimento de tanques\n` +
                        `10. Desentupimento de calhas e condutores\n` +
                        `11. Desentupimento de mictórios\n` +
                        `12. Desentupimento mecanizado com Roto-Rooter (K-50/K-500)\n` +
                        `13. Desentupimento por Hidrojateamento de alta pressão\n` +
                        `14. Desobstrução de tubulação pluvial (água da chuva)\n` +
                        `15. Remoção de gordura e resíduos solidificados em tubos\n` +
                        `16. Desentupimento de encanamento de lavadora de roupas\n` +
                        `17. Limpeza e raspagem interna de tubulações obstruídas\n` +
                        `18. Retirada de objetos estranhos do vaso ou canos\n` +
                        `19. Desentupimento preventiva em condomínios e estabelecimentos\n` +
                        `20. Inspeção por vídeo de rede de esgoto obstruída`

                    await escrever(listaDesentupimento)
                    userState[from] = 'inicio'
                    await enviarBotoes(from, "Deseja agendar um atendimento para este serviço?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])

                } else if (text === 'tab_reparos' || textNorm.includes('reparo') || textNorm.includes('manutencao')) {
                    const listaReparos = `🛠️ *Lista de Serviços - Reparo / Manutenção (20 Opções):*\n\n` +
                        `1. Troca de reparo de válvula de descarga (Hydra, Docol, Deca)\n` +
                        `2. Troca de reparo / vedante de torneira e misturador\n` +
                        `3. Substituição e instalação de novas torneiras\n` +
                        `4. Instalação e manutenção de caixa d'água\n` +
                        `5. Troca de boia Mecânica ou Elétrica de caixa d'água\n` +
                        `6. Instalação / Troca de Filtros e Purificadores de Água\n` +
                        `7. Substituição de Sifões em pias, tanques e pias duplas\n` +
                        `8. Instalação e reparo de pressurizador de água\n` +
                        `9. Instalação de vaso sanitário (com caixa acoplada ou convencional)\n` +
                        `10. Troca de mecanismo interno de caixa acoplada\n` +
                        `11. Instalação de duchas higiênicas e engates flexíveis\n` +
                        `12. Troca de registros de pressão (chuveiro) e gaveta (geral)\n` +
                        `13. Instalação e substituição de chuveiros e duchaselétricas\n` +
                        `14. Troca de anel de vedação de vaso sanitário (combate ao mau cheiro)\n` +
                        `15. Instalação e manutenção de triturador de pia de cozinha\n` +
                        `16. Instalação e adequação de pontos de água para máquina de lavar\n` +
                        `17. Substituição de tubulações antigas de ferro/galvanizado por PVC/PPR\n` +
                        `18. Regulagem e manutenção de aquecedores a gás / elétricos\n` +
                        `19. Troca e manutenção de ralos "click" e grelhas inox\n` +
                        `20. Instalação de válvula de retenção de esgoto (anti-retorno/anti-pragas)`

                    await escrever(listaReparos)
                    userState[from] = 'inicio'
                    await enviarBotoes(from, "Deseja agendar um atendimento para este serviço?", [
                        { displayText: "📋 Registrar Chamado", id: "op_1" },
                        { displayText: "🏠 Menu Principal", id: "menu" }
                    ])
                } else {
                    userState[from] = 'inicio'
                    await mostrarMenuPrincipal(from)
                }
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '0' || textNorm === 'voltar') { userState[from] = 'inicio'; await mostrarMenuPrincipal(from); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! 👋\n\nAgora, digite o seu *Telefone para Contato/WhatsApp* (com DDD):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_telefone') {
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Perfeito! Agora, digite o seu *Endereço completo* (Rua, Número, Bairro):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_endereco') {
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Descreva brevemente o problema ou o serviço que você precisa:' + rodapeNavegacao)
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
                const resumoChamado = `🚨 *NOVO CHAMADO REGISTRADO*\n\n🔢 *Protocolo:* #${protocolo}\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n🏠 *Endereço:* ${userData[from].endereco}\n📝 *Detalhes:* ${userData[from].detalhes}`
                await escrever(resumoChamado)
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!* Um de nossos técnicos entrará em contato em instantes.`)
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
            console.log('✅ Bot conectado com sucesso com suporte a Listas e Botoes Interativos!')
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
