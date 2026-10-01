const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

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

const SERVICOS = {
    desentupimento: [
        "1 - Desentupimento de pia/lavatório",
        "2 - Desentupimento de ralo/tanque",
        "3 - Desentupimento de vaso sanitário",
        "4 - Desentupimento coluna/rede principal",
        "5 - Limpeza/desentupimento caixa de gordura",
        "6 - Limpeza/desentupimento caixa de inspeção"
    ],
    reparos: [
        "1 - Troca de torneira simples/filtro",
        "2 - Instalação torneira monocomando/misturador",
        "3 - Troca de engate flexível / niple",
        "4 - Troca ou substituição de sifão",
        "5 - Troca de válvula de escoamento (ralo)",
        "6 - Reparo em válvula Hydra / Docol",
        "7 - Troca mecanismo interno caixa acoplada",
        "8 - Troca de bóia de caixa d'água",
        "9 - Limpeza de caixa d'água"
    ]
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

const question = (texto) => new Promise((resolve) => {
    if (!process.stdin.isTTY) {
        return resolve('');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(texto, (resposta) => {
        rl.close()
        resolve(resposta)
    })
})

function respostaPorRegras(texto) {
    const textNorm = normalizar(texto)

    if (textNorm.includes('vazamento') || textNorm.includes('infiltracao') || textNorm.includes('cano')) {
        return `💧 *Serviços de Vazamento:*\nAtendemos infiltrações, vazamentos em canos, torneiras e caixas d'água.\n\nDigite *1* para agendar uma visita técnica ou *0* para ver o menu.`
    }
    if (textNorm.includes('desentup') || textNorm.includes('pia') || textNorm.includes('ralo') || textNorm.includes('esgoto')) {
        return `🚽 *Serviços de Desentupimento:*\nDesentupimos pias, ralos, vasos sanitários, caixas de gordura e rede principal.\n\nDigite *1* para solicitar atendimento ou *0* para ver o menu.`
    }
    if (textNorm.includes('preco') || textNorm.includes('valor') || textNorm.includes('quanto')) {
        return `💰 *Valores & Visita:*\nTaxa de visita: R$ 50,00 (valor abatido no total caso o serviço seja aprovado!).\n\nDigite *1* para agendar ou *0* para ver o menu.`
    }

    return MENU_TEXTO
}

const MENU_TEXTO = `Olá! 👋 Bem-vindo ao atendimento do Encanador.\n\nEscolha uma opção digitando o número correspondente:\n\n1️⃣ *Solicitar Serviço / Agendar*\n2️⃣ *Orçamento Automático*\n3️⃣ *Tabela de Serviços por Categoria*\n4️⃣ *Regiões de Atendimento & Taxa de Visita*\n5️⃣ *Formas de Pagamento Aceitas*\n6️⃣ *Horário de Funcionamento*\n7️⃣ *Falar com Atendente*\n8️⃣ *Status do Atendimento / Reclamação*`

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

    client.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return
            if (info.key && info.key.remoteJid === 'status@broadcast') return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            await client.readMessages([{ remoteJid: from, id: info.key.id, participant: info.key.participant }])

            const altpdf = Object.keys(info.message)
            const type = altpdf[0] === 'senderKeyDistributionMessage' ? altpdf[1] === 'messageContextInfo' ? altpdf[2] : altpdf[1] : altpdf[0]

            const texto_exato = (type === 'conversation') ? info.message.conversation : (type === 'extendedTextMessage') ? info.message.extendedTextMessage.text : (type === 'imageMessage') ? info.message.imageMessage.caption : ''
            const text = texto_exato.trim()
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
            const rodapeNavegacao = `\n\n─────────────────\n↩️ *9* - Voltar à Pergunta Anterior\n🏠 *0* - Voltar ao Menu Principal`

            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'inicio') && estadoAtual !== 'inicio') {
                userState[from] = 'inicio'
                delete userData[from]
                await escrever(MENU_TEXTO)
                return
            }

            // --- MENU PRINCIPAL ---
            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('solicitar') || textNorm.includes('agendar')) {
                    userState[from] = 'pedir_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara começar, por favor digite o seu *Nome Completo*:' + rodapeNavegacao)
                } else if (text === '2' || textNorm.includes('orcamento')) {
                    userState[from] = 'orcamento_categoria'
                    const introOrcamento = `📊 *Orçamento Automático*\n\nSelecione a categoria do serviço desejado:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(introOrcamento)
                } else if (text === '3' || textNorm.includes('tabela')) {
                    userState[from] = 'orcamento_categoria'
                    const menuPrecos = `🛠️ *Lista de Serviços por Categoria*\n\nEscolha qual categoria de serviço você deseja consultar:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(menuPrecos)
                } else if (text === '4' || textNorm.includes('regiao')) {
                    await escrever(`📍 *Regiões de Atendimento & Visita:*\n\n🏠 Atendemos em:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita:* R$ 50,00 (abatido caso o serviço seja aprovado!).\n\nDigite *1* para solicitar chamado ou *0* para voltar.`)
                } else if (text === '5' || textNorm.includes('pagamento')) {
                    await escrever(`💳 *Formas de Pagamento:* Pix, Cartão de Crédito/Débito e Dinheiro.\n\nDigite *1* para solicitar chamado ou *0* para voltar.`)
                } else if (text === '6' || textNorm.includes('horario')) {
                    await escrever(`⏰ *Horário:* Segunda a Sexta, das 08h às 18h.\n\nDigite *1* para solicitar chamado ou *0* para voltar.`)
                } else if (text === '7' || textNorm.includes('atendente')) {
                    userState[from] = 'pedir_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPor favor, digite o seu *Nome Completo*:' + rodapeNavegacao)
                } else {
                    const resposta = respostaPorRegras(text)
                    await escrever(resposta)
                }
            }

            // --- FLUXO DE SELEÇÃO DE CATEGORIA DE ORÇAMENTO ---
            else if (estadoAtual === 'orcamento_categoria') {
                if (text === '1') {
                    userData[from].categoria = 'Vazamentos'
                    userState[from] = 'pedir_nome'
                    await escrever('🔎 *Categoria: Vazamentos*\n\nPara dar início, por favor informe o seu *Nome Completo*:' + rodapeNavegacao)
                } else if (text === '2') {
                    userData[from].categoria = 'Desentupimentos'
                    userState[from] = 'pedir_nome'
                    await escrever('🚽 *Categoria: Desentupimentos*\n\nPara dar início, por favor informe o seu *Nome Completo*:' + rodapeNavegacao)
                } else if (text === '3') {
                    userData[from].categoria = 'Reparo / Manutenção'
                    userState[from] = 'pedir_nome'
                    await escrever('🔧 *Categoria: Reparo / Manutenção*\n\nPara dar início, por favor informe o seu *Nome Completo*:' + rodapeNavegacao)
                } else {
                    await escrever('⚠️ Opção inválida. Escolha 1, 2 ou 3:' + rodapeNavegacao)
                }
            }

            // --- PASSO 1: NOME DO CLIENTE ---
            else if (estadoAtual === 'pedir_nome') {
                if (text === '9') { userState[from] = 'inicio'; await escrever(MENU_TEXTO); return; }
                userData[from].nome = text
                userState[from] = 'pedir_problema'

                let msgProblema = `Prazer, *${text}*! 👋\n\n`
                if (userData[from].categoria === 'Vazamentos') {
                    msgProblema += `Por favor, *descreva o tipo de vazamento* que está ocorrendo (ex: infiltração na parede, vazamento no cano, torneira pingando):`
                } else if (userData[from].categoria === 'Desentupimentos') {
                    msgProblema += `Por favor, escolha ou descreva o problema de desentupimento:\n\n${SERVICOS.desentupimento.join('\n')}\n\n*Ou descreva com suas palavras:*`
                } else if (userData[from].categoria === 'Reparo / Manutenção') {
                    msgProblema += `Por favor, escolha ou descreva o serviço necessário:\n\n${SERVICOS.reparos.join('\n')}\n\n*Ou descreva com suas palavras:*`
                } else {
                    msgProblema += `Por favor, *descreva em detalhes qual é o problema* ou serviço que você precisa:`
                }

                await escrever(msgProblema + rodapeNavegacao)
            }

            // --- PASSO 2: DESCRIÇÃO DO PROBLEMA ---
            else if (estadoAtual === 'pedir_problema') {
                if (text === '9') { 
                    userState[from] = 'pedir_nome'
                    await escrever('Por favor, informe o seu *Nome Completo*:' + rodapeNavegacao)
                    return
                }
                userData[from].detalhes = text
                userState[from] = 'pedir_telefone'
                await escrever('📱 Perfeito! Agora digite o seu *Telefone/WhatsApp para contato* (com DDD):' + rodapeNavegacao)
            }

            // --- PASSO 3: TELEFONE ---
            else if (estadoAtual === 'pedir_telefone') {
                if (text === '9') { 
                    userState[from] = 'pedir_problema'
                    await escrever('Por favor, descreva novamente o tipo de problema:' + rodapeNavegacao)
                    return
                }
                userData[from].telefone = text
                userState[from] = 'pedir_endereco'
                await escrever('📍 Excelente! Por fim, informe o seu *Endereço Completo* (Rua, Número, Bairro e Cidade):' + rodapeNavegacao)
            }

            // --- PASSO 4: ENDEREÇO & FINALIZAÇÃO ---
            else if (estadoAtual === 'pedir_endereco') {
                if (text === '9') {
                    userState[from] = 'pedir_telefone'
                    await escrever('Digite o seu *Telefone/WhatsApp para contato* (com DDD):' + rodapeNavegacao)
                    return
                }
                userData[from].endereco = text

                const protocolo = gerarProtocolo()
                salvarChamado(protocolo, {
                    categoria: userData[from].categoria || 'Geral',
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    detalhes: userData[from].detalhes
                })

                const resumoChamado = `📝 *CHAMADO REGISTRADO COM SUCESSO!*\n\n🔢 *Protocolo:* #${protocolo}\n👤 *Nome:* ${userData[from].nome}\n📂 *Categoria:* ${userData[from].categoria || 'Geral'}\n🛠️ *Descrição:* ${userData[from].detalhes}\n📞 *Telefone:* ${userData[from].telefone}\n📍 *Endereço:* ${userData[from].endereco}`
                
                await escrever(resumoChamado)
                await escrever(`✅ Obrigado, *${userData[from].nome}*! O seu chamado foi gerado. Um técnico entrará em contato em breve.`)

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
            const Pergunta = await question('Por favor, diga seu número (ex: 5573981070937):\n')
            const Numero = Pergunta.replace(/[^0-9]/g, '')
            let codigo = await client.requestPairingCode(Numero)
            codigo = codigo?.match(/.{1,4}/g)?.join("-") || codigo
            console.log(`🔑 Código de Pareamento: ${codigo}`)
        }
        
        if (connection === 'open') {
            console.log('✅ Bot conectado e atualizado!')
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
