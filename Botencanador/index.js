const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@itsliaaa/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Código do convite extraído do link: https://chat.whatsapp.com/EwUIug1DbI3IWZGkpbrJ8n
const CODIGO_CONVITE_GRUPO = 'EwUIug1DbI3IWZGkpbrJ8n'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KHbHV85YPLeqj5QUDwOOOH4VVn2WqxSVM445kR_m9rEg'

let idGrupoNotificacao = null
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
        const systemInstruction = `Você é o "Lukas Encanador", um mestre encanador altamente capacitado, simpático e atencioso que presta serviços em Itabuna, Ilhéus e Itapé.

Suas diretrizes:
1. RESPONDA A TUDO: Converse livremente sobre qualquer assunto de forma profissional e amigável.
2. DÚVIDAS TÉCNICAS: Explique o problema e ofereça seus serviços no local.
3. LEMBRETE: Diga que para ver os serviços ou agendar, basta digitar *Menu*.`

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ parts: [{ text: pergunta }] }]
            })
        })

        const data = await response.json()

        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            return data.candidates[0].content.parts[0].text
        }

        return "Opa, tudo joia? Sou o Lukas Encanador! 🔧 Como posso te ajudar hoje? Digite *Menu* para ver nossos serviços!"
    } catch (err) {
        console.error('⚠️ Erro de conexão:', err.message)
        return "Opa! Sou o Lukas Encanador. Digite *Menu* para ver nossas opções de serviços!"
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

    async function notificarGrupo(mensagem) {
        if (idGrupoNotificacao) {
            try {
                await client.sendMessage(idGrupoNotificacao, { text: mensagem })
                console.log('📢 Pedido concluído enviado para o grupo com sucesso!')
            } catch (err) {
                console.error('⚠️ Erro ao enviar mensagem para o grupo:', err.message)
            }
        } else {
            console.error('⚠️ O grupo de notificações ainda não foi identificado.')
        }
    }

    async function mostrarMenuTexto(from) {
        const menuTexto = `🔧 *LUKAS ENCANADOR - SERVIÇOS HIDRÁULICOS* 🚰\n\nComo posso te ajudar hoje? Digite o *número* da opção desejada:\n\n1️⃣ *Solicitar Serviço / Agendar Visita*\n2️⃣ *Orçamento Automático*\n3️⃣ *Tabela de Serviços por Categoria*\n4️⃣ *Regiões Atendidas & Taxa de Visita*\n5️⃣ *Formas de Pagamento*\n6️⃣ *Horário de Funcionamento*\n7️⃣ *Falar com Atendente Humano*\n8️⃣ *Consultar Status do Chamado*\n\n💡 *Dica:* Pode me enviar qualquer mensagem em texto que eu te respondo na hora!`
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
            let text = info.message.conversation || info.message.extendedTextMessage?.text || ""
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

            const pedeMenu = (textNorm === 'menu' || textNorm === '0' || textNorm === 'inicio')

            if (pedeMenu && !estadoAtual.startsWith('chamado_')) {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuTexto(from)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('agendar') || textNorm.includes('solicitar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado - Lukas Encanador*\n\nPara iniciarmos o seu agendamento, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2') {
                    await escrever('📊 *Orçamento Automático*\n\nDescreva em poucas palavras qual o problema (ex: vazamento no banheiro, pia entupida, troca de torneira):' + rodapeNavegacao)
                    userState[from] = 'orcamento_detalhes'
                } else if (text === '3') {
                    await escrever(`🛠️ *Tabela de Serviços - Lukas Encanador*\n\n🔹 *Vazamentos:* Caça-vazamentos, reparo em canos, infiltrações.\n🔹 *Desentupimentos:* Pias, ralos, vasos e esgoto.\n🔹 *Reparos:* Torneiras, caixa acoplada, válvula Hydra.`)
                } else if (text === '4') {
                    await escrever(`📍 *Regiões Atendidas:*\n🔹 Itabuna\n🔹 Ilhéus\n🔹 Itapé\n\n🚗 *Taxa de Visita:* R$ 50,00`)
                } else if (text === '5') {
                    await escrever(`💳 *Pagamento:* Pix, Cartões ou Dinheiro.`)
                } else if (text === '6') {
                    await escrever(`⏰ *Atendimento:* Segunda a Sexta, 08h às 18h.`)
                } else if (text === '7') {
                    await escrever(`📞 Um atendente humano responderá em breve! Por favor, aguarde.`)
                } else {
                    const respostaAI = await responderComGemini(text)
                    await escrever(respostaAI)
                }
            } else if (estadoAtual === 'orcamento_detalhes') {
                userData[from].detalhes = text
                await escrever(`✅ Registramos os detalhes do seu orçamento!\n\nDeseja realizar o agendamento completo do serviço agora?\n\nDigite *1* para Agendar ou *0* para voltar ao Menu.`)
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

                // ENVIA APENAS O PEDIDO CONCLUÍDO PARA O GRUPO
                const pedidoConcluido = `🚨 *NOVO PEDIDO CONCLUÍDO (#${protocolo})*\n\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n📍 *Endereço:* ${userData[from].endereco}\n📝 *Serviço Solicitado:* ${userData[from].detalhes}`
                await notificarGrupo(pedidoConcluido)

                await escrever(`✅ *Chamado #${protocolo} Agendado com Sucesso!*\n\nSeu pedido foi finalizado e encaminhado para nossa equipe de atendimento. Entraremos em contato em breve!`)
                
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
            const Pergunta = await question('Por favor, informe o seu número com DDD (ex: 5573981070937):\n')
            const Numero = Pergunta.replace(/[^0-9]/g, '')
            let codigo = await client.requestPairingCode(Numero)
            codigo = codigo?.match(/.{1,4}/g)?.join("-") || codigo
            console.log(`🔑 Código de Pareamento: ${codigo}`)
        }
        
        if (connection === 'open') {
            console.log('✅ Bot Lukas Encanador pronto!')
            try {
                // Resolve o link de convite para obter o ID real do grupo
                const groupInfo = await client.groupGetInviteInfo(CODIGO_CONVITE_GRUPO)
                idGrupoNotificacao = groupInfo.id
                console.log(`📌 Grupo de notificações localizado: ${idGrupoNotificacao}`)
            } catch (err) {
                console.error('⚠️ Não foi possível obter as informações do grupo via link:', err.message)
            }
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
