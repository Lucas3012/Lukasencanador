const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@itsliaaa/baileys')
const { GoogleGenAI } = require('@google/genai')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Configuração da API do Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'SUA_CHAVE_API_GEMINI_AQUI'
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

    // Função para enviar Menu como Enquete (Botão de Escolha)
    async function enviarMenuBotoes(from, info) {
        await client.sendMessage(from, {
            poll: {
                name: "👋 Olá! Bem-vindo ao atendimento do Encanador.\nComo posso te ajudar hoje? Escolha uma opção abaixo:",
                values: [
                    "1️⃣ Solicitar Serviço / Agendar",
                    "2️⃣ Orçamento Automático",
                    "3️⃣ Tabela de Serviços por Categoria",
                    "4️⃣ Regiões de Atendimento & Taxa",
                    "5️⃣ Formas de Pagamento",
                    "6️⃣ Horário de Funcionamento",
                    "7️⃣ Falar com Atendente",
                    "8️⃣ Status do Atendimento / Reclamação"
                ],
                selectableCount: 1
            }
        }, { quoted: info })
    }

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            if (info.key && info.key.remoteJid === 'status@broadcast') return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            await client.readMessages([{ remoteJid: from, id: info.key.id, participant: info.key.participant }])

            // Trata mensagens de texto comuns ou votos em enquetes/botões
            let text = ""
            if (info.message.conversation) {
                text = info.message.conversation
            } else if (info.message.extendedTextMessage) {
                text = info.message.extendedTextMessage.text
            } else if (info.message.pollCreationMessage) {
                return
            } else if (info.message.pollUpdateMessage) {
                // Captura clique no botão da enquete (se houver)
                const vote = info.message.pollUpdateMessage
                if (vote) text = "menu"
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
            const rodapeNavegacao = `\n\n─────────────────\n↩️ Envie *0* para voltar ao Menu Principal.`

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'inicio') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await enviarMenuBotoes(from, info)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('1') || textNorm.includes('solicitar') || textNorm.includes('agendar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2' || textNorm.includes('2') || textNorm.includes('orcamento')) {
                    userState[from] = 'orcamento_categoria'
                    await client.sendMessage(from, {
                        poll: {
                            name: "📊 *Orçamento Automático*\nSelecione a categoria do serviço:",
                            values: ["1️⃣ Vazamentos", "2️⃣ Desentupimentos", "3️⃣ Reparo / Manutenção"],
                            selectableCount: 1
                        }
                    }, { quoted: info })
                } else if (text === '3' || textNorm.includes('3') || textNorm.includes('tabela')) {
                    userState[from] = 'tabela_categoria'
                    await client.sendMessage(from, {
                        poll: {
                            name: "🛠️ *Lista de Serviços por Categoria*\nEscolha qual categoria deseja consultar:",
                            values: ["1️⃣ Vazamentos", "2️⃣ Desentupimentos", "3️⃣ Reparo / Manutenção"],
                            selectableCount: 1
                        }
                    }, { quoted: info })
                } else if (text === '4' || textNorm.includes('4') || textNorm.includes('regiao') || textNorm.includes('visita')) {
                    const regioes = `📍 *Regiões de Atendimento & Visita:*\n\n🏠 Atendemos em:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita:* R$ 50,00 (Abatido no total caso o serviço seja aprovado!).`
                    await escrever(regioes)
                    await enviarMenuBotoes(from, info)
                } else if (text === '5' || textNorm.includes('5') || textNorm.includes('pagamento')) {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito (até 12x)\n✅ Cartão de Débito\n✅ Dinheiro`
                    await escrever(pagamentos)
                    await enviarMenuBotoes(from, info)
                } else if (text === '6' || textNorm.includes('6') || textNorm.includes('horario')) {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nSegunda a Sexta-feira, das 08h às 18h.`
                    await escrever(horarios)
                    await enviarMenuBotoes(from, info)
                } else if (text === '7' || textNorm.includes('7') || textNorm.includes('atendente')) {
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPara encaminharmos você a um especialista, digite seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '8' || textNorm.includes('8') || textNorm.includes('status') || textNorm.includes('reclamacao')) {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Reclamação*\n\nPor favor, informe o seu *Nome completo*:' + rodapeNavegacao)
                } else {
                    const respostaAI = await responderComGemini(text)
                    if (respostaAI) {
                        await escrever(respostaAI)
                    }
                    await enviarMenuBotoes(from, info)
                }
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '0' || textNorm === 'voltar') { userState[from] = 'inicio'; await enviarMenuBotoes(from, info); return; }
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
            console.log('✅ Bot conectado com sucesso com suporte a Botoes/Enquetes!')
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
