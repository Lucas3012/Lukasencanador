const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@itsliaaa/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Sua chave no formato AQ...
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KHbHV85YPLeqj5QUDwOOOH4VVn2WqxSVM445kR_m9rEg'

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
    if (!processstdin.isTTY) {
        console.log('⚠️ Ambiente sem terminal interativo. Aguardando conexão por sessão salva.');
        return resolve('');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(texto, (resposta) => {
        rl.close()
        resolve(resposta)
    })
})

// Função adaptada para conversar sobre TUDO e oferecer serviços
async function responderComGemini(pergunta) {
    try {
        const systemInstruction = `Você é o "Lukas Encanador", um profissional encanador experiente, extremamente educado, simpático, humano e atencioso. Atende nas regiões de Itabuna, Ilhéus e Itapé.

SUAS DIRETRIZES DE CONVERSA:
1. ATENDIMENTO AMPLO E HUMANO: Você pode conversar sobre QUALQUER assunto que o cliente trouxer. Seja uma pergunta sobre a vida, conversa fiada, conselhos, dúvidas gerais ou desabafos, responda sempre com empatia, respeito, tom acolhedOR e profissionalismo.
2. DÚVIDAS TÉCNICAS E HIDRÁULICAS: Caso o cliente pergunte sobre vazamentos, infiltrações, desentupimentos, pressão de água, torneiras, caixas d'água ou obras, explique com clareza o que pode estar acontecendo e ofereça seus serviços para resolver o problema no local com garantia e rapidez.
3. CONEXÃO COM O SERVIÇO: De forma natural (sem parecer forçado), ao final das suas respostas, lembre ao cliente que você está à disposição para ajudar com serviços de encanamento e que ele pode digitar *Menu* a qualquer momento para ver as opções de atendimento ou agendar uma visita.
4. TOM DE VOZ: Amigável, humilde, prestativo e profissional (ex: "Opa, tudo bem com você?", "Com certeza!", "Entendo perfeitamente o seu lado", "Conte comigo!"). Use emojis leves e adequados (🤝, 🚰, 🔧, 😊, 👍).`

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
            console.error('⚠️ Erro de API Gemini:', data.error.message)
            return "Opa, tudo bem? 🔧 Sou o Lukas Encanador! Como posso te ajudar hoje? Se precisar ver nossas opções de serviço ou agendar uma visita, basta digitar *Menu*."
        }

        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            return data.candidates[0].content.parts[0].text
        }

        return "Opa, tudo joia? Sou o Lukas Encanador! 🔧 Estou aqui para te ajudar no que precisar. Digite *Menu* para ver nossos serviços!"
    } catch (err) {
        console.error('⚠️ Erro de conexão:', err.message)
        return "Opa! Sou o Lukas Encanador. Como posso te ajudar hoje? Se quiser agendar uma visita ou ver nosso menu, digite *Menu*!"
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

    async function mostrarMenuTexto(from) {
        const menuTexto = `🔧 *LUKAS ENCANADOR - SERVIÇOS HIDRÁULICOS* 🚰\n\nComo posso te ajudar hoje? Digite o *número* da opção desejada:\n\n1️⃣ *Solicitar Serviço / Agendar Visita*\n2️⃣ *Orçamento Automático*\n3️⃣ *Tabela de Serviços por Categoria*\n4️⃣ *Regiões Atendidas & Taxa de Visita*\n5️⃣ *Formas de Pagamento*\n6️⃣ *Horário de Funcionamento*\n7️⃣ *Falar com Atendente Humano*\n8️⃣ *Consultar Status do Chamado*\n\n💡 *Dica:* Você também pode conversar comigo sobre qualquer assunto ou dúvida que eu te respondo aqui mesmo!`
        await client.sendMessage(from, { text: menuTexto })
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

            // Identifica solicitações de menu expressas
            const pedeMenu = (
                textNorm === 'menu' || 
                textNorm === '0' || 
                textNorm === 'inicio' || 
                textNorm === 'ver menu'
            )

            if (pedeMenu && estadoAtual !== 'chamado_nome' && estadoAtual !== 'chamado_telefone' && estadoAtual !== 'chamado_endereco' && estadoAtual !== 'chamado_detalhes') {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuTexto(from)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1') {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado - Lukas Encanador*\n\nPara iniciarmos o seu agendamento, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2') {
                    await escrever('📊 *Orçamento Automático*\n\nDescreva em poucas palavras qual o problema (ex: vazamento no banheiro, pia entupida, troca de torneira):' + rodapeNavegacao)
                    userState[from] = 'descrever_detalhes'
                } else if (text === '3') {
                    const tabela = `🛠️ *Tabela de Serviços - Lukas Encanador*\n\n🔹 *Vazamentos:* Caça-vazamentos, reparo em canos, infiltrações na parede.\n🔹 *Desentupimentos:* Pias, ralos, vasos sanitários e caixas de esgoto.\n🔹 *Reparos:* Troca de reparo de torneira, caixa acoplada, válvula Hydra, chuveiro.`
                    await escrever(tabela)
                } else if (text === '4') {
                    await escrever(`📍 *Regiões Atendidas:*\n🔹 Itabuna\n🔹 Ilhéus\n🔹 Itapé\n\n🚗 *Taxa de Visita:* R$ 50,00 (Descontada do valor final caso o serviço seja realizado).`)
                } else if (text === '5') {
                    await escrever(`💳 *Formas de Pagamento:*\n✅ Pix\n✅ Cartão de Crédito/Débito\n✅ Dinheiro`)
                } else if (text === '6') {
                    await escrever(`⏰ *Atendimento:* Segunda a Sexta, das 08h às 18h.`)
                } else if (text === '7') {
                    await escrever(`📞 Um atendente humano responderá esta conversa em breve! Por favor, aguarde.`)
                } else if (text === '8') {
                    await escrever(`🔍 Para verificar seu chamado, por favor informe o número do protocolo:`)
                } else {
                    // Qualquer mensagem aberta (dúvidas, bate-papo, problemas pessoais) vai para a IA
                    const respostaAI = await responderComGemini(text)
                    await escrever(respostaAI)
                }
            } else if (estadoAtual === 'descrever_detalhes') {
                userData[from].detalhes = text
                await escrever(`✅ Registrado! Deseja agendar a visita para resolver isso?\n\nDigite *1* para Agendar ou *Menu* para voltar.`)
                userState[from] = 'inicio'
            } else if (estadoAtual === 'chamado_nome') {
                if (text === '0') { userState[from] = 'inicio'; await mostrarMenuTexto(from); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! Digite seu *Telefone/WhatsApp* para contato:` + rodapeNavegacao)
            } else if (estadoAtual === 'chamado_telefone') {
                if (text === '0') { userState[from] = 'inicio'; await mostrarMenuTexto(from); return; }
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Agora digite seu *Endereço completo* (Rua, Número e Bairro):' + rodapeNavegacao)
            } else if (estadoAtual === 'chamado_endereco') {
                if (text === '0') { userState[from] = 'inicio'; await mostrarMenuTexto(from); return; }
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Descreva brevemente o serviço que precisa:' + rodapeNavegacao)
            } else if (estadoAtual === 'chamado_detalhes') {
                if (text === '0') { userState[from] = 'inicio'; await mostrarMenuTexto(from); return; }
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, {
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    detalhes: userData[from].detalhes
                })
                await escrever(`✅ *Chamado #${protocolo} Agendado!*\n\n👤 *Nome:* ${userData[from].nome}\n📍 *Endereço:* ${userData[from].endereco}\n📝 *Serviço:* ${userData[from].detalhes}\n\nEntraremos em contato em breve!`)
                userState[from] = 'inicio'
            }

        } catch (erro) {
            console.log('Erro ao processar mensagem:', erro)
        }
    })

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr && !client.authState.creds.registered && !jaPareou) {
            jaPareou = true
            const Pergunta = await question('Por favor, informe o seu número com DDD (ex: 5573981070937):\n')
            const Numero = Pergunta.replace(/[^0-9]/g, '')
            let codigo = await client.requestPairingCode(Numero)
            codigo = codigo?.match(/.{1,4}/g)?.join("-") || codigo
            console.log(`🔑 Código de Pareamento: ${codigo}`)
        }
        
        if (connection === 'open') {
            console.log('✅ Bot Lukas Encanador pronto para conversar e agendar serviços!')
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
