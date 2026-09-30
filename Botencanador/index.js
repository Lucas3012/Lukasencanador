const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@itsliaaa/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

const CODIGO_CONVITE_GRUPO = 'EwUIug1DbI3IWZGkpbrJ8n'

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

    async function mostrarMenuOpcoes(from) {
        const menuTexto = `🔧 *LUKAS ENCANADOR - MENU DE ATENDIMENTO* 🚰\n\nPor favor, digite o *nome do serviço* ou selecione uma das opções abaixo:\n\n📌 *AGENDA* - Agendar Visita Técnica / Serviço\n📌 *ORCAMENTO* - Solicitar Orçamento Automático\n📌 *TABELA* - Ver Tabela de Serviços\n📌 *REGIAO* - Regiões e Taxa de Visita\n📌 *PAGAMENTO* - Formas de Pagamento\n📌 *HORARIO* - Horário de Atendimento\n📌 *ATENDENTE* - Falar com Atendente Humano`
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
            const rodapeNavegacao = `\n\n─────────────────\n↩ Digite *MENU* ou *0* para voltar às opções.`

            // Comando de cancelamento ou volta ao menu
            if ((textNorm === 'menu' || textNorm === '0' || textNorm === 'voltar' || textNorm === 'inicio') && !estadoAtual.startsWith('chamado_')) {
                userState[from] = 'inicio'
                delete userData[from]
                await mostrarMenuOpcoes(from)
                return
            }

            if (estadoAtual === 'inicio') {
                // DETECÇÃO POR PALAVRAS-CHAVE E SELEÇÃO DE OPÇÕES

                // 1. Agendamento / Visita Técnica
                if (textNorm.includes('agendar') || textNorm.includes('visita') || textNorm.includes('agenda') || textNorm.includes('servico') || textNorm === '1') {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Agendamento de Visita Técnica - Lukas Encanador*\n\nPara iniciarmos o registro da sua visita, por favor informe o seu *Nome completo*:' + rodapeNavegacao)
                
                // 2. Orçamento
                } else if (textNorm.includes('orcamento') || textNorm.includes('quanto custa') || textNorm.includes('valor') || textNorm === '2') {
                    await escrever('📊 *Solicitação de Orçamento*\n\nPor favor, descreva em poucas palavras qual problema precisa resolver (ex: vazamento no banheiro, pia entupida, troca de torneira):' + rodapeNavegacao)
                    userState[from] = 'orcamento_detalhes'

                // 3. Tipos de Serviços / Tabela / Dúvidas Específicas
                } else if (textNorm.includes('vazamento') || textNorm.includes('infiltracao') || textNorm.includes('cano') || textNorm.includes('entupido') || textNorm.includes('desentupir') || textNorm.includes('torneira') || textNorm.includes('tabela') || textNorm === '3') {
                    await escrever(`🛠️ *Serviços Hidráulicos Prestados:*\n\n🔹 *Caça-Vazamentos e Infiltrações:* Identificação e reparo de vazamentos em canos e paredes.\n🔹 *Desentupimentos:* Pias, ralos, vasos sanitários e caixas de esgoto.\n🔹 *Reparos Gerais:* Troca de torneiras, reparos em caixas acopladas, válvulas Hydra e chuveiros.\n\nDeseja agendar uma visita técnica? Digite *AGENDA* para solicitar.` + rodapeNavegacao)

                // 4. Região de Atendimento
                } else if (textNorm.includes('regiao') || textNorm.includes('cidade') || textNorm.includes('bairro') || textNorm.includes('itabuna') || textNorm.includes('ilheus') || textNorm.includes('itape') || textNorm === '4') {
                    await escrever(`📍 *Regiões Atendidas:*\n Atendemos em Itabuna, Ilhéus e Itapé.\n\n🚗 *Taxa de Visita Técnica:* R$ 50,00 (Valor abatido no total do serviço caso aprovado).` + rodapeNavegacao)

                // 5. Pagamento
                } else if (textNorm.includes('pagamento') || textNorm.includes('pix') || textNorm.includes('cartao') || textNorm.includes('dinheiro') || textNorm === '5') {
                    await escrever(`💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito / Débito\n✅ Dinheiro` + rodapeNavegacao)

                // 6. Horário
                } else if (textNorm.includes('horario') || textNorm.includes('hora') || textNorm.includes('aberto') || textNorm === '6') {
                    await escrever(`⏰ *Horário de Funcionamento:*\n\nSegunda a Sexta-feira, das 08h às 18h.` + rodapeNavegacao)

                // 7. Atendente Humano
                } else if (textNorm.includes('atendente') || textNorm.includes('humano') || textNorm.includes('falar') || textNorm === '7') {
                    await escrever(`📞 Um atendente humano foi notificado e responderá esta conversa em breve. Por favor, aguarde!`)

                // Resposta padrão direta caso não identifique a palavra-chave
                } else {
                    await escrever(`Olá! Entendi sua mensagem, mas para que eu possa te ajudar da melhor forma, por favor escolha uma das opções ou digite a palavra correspondente:\n\n👉 Digite *AGENDA* para agendar uma visita técnica\n👉 Digite *ORCAMENTO* para pedir um orçamento\n👉 Digite *TABELA* para ver os serviços prestados\n👉 Digite *ATENDENTE* para falar com um humano`)
                }

            } else if (estadoAtual === 'orcamento_detalhes') {
                userData[from].detalhes = text
                await escrever(`✅ Registramos o detalhe do seu problema!\n\nDeseja confirmar a solicitação de agendamento presencial?\n\nDigite *AGENDA* para continuar ou *MENU* para voltar.`)
                userState[from] = 'inicio'

            } else if (estadoAtual === 'chamado_nome') {
                if (textNorm === '0' || textNorm === 'menu') { userState[from] = 'inicio'; await mostrarMenuOpcoes(from); return; }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! Agora digite seu *Telefone / WhatsApp* de contato:` + rodapeNavegacao)

            } else if (estadoAtual === 'chamado_telefone') {
                if (textNorm === '0' || textNorm === 'menu') { userState[from] = 'inicio'; await mostrarMenuOpcoes(from); return; }
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Por favor, informe o seu *Endereço completo* (Rua, Número, Bairro e Cidade):' + rodapeNavegacao)

            } else if (estadoAtual === 'chamado_endereco') {
                if (textNorm === '0' || textNorm === 'menu') { userState[from] = 'inicio'; await mostrarMenuOpcoes(from); return; }
                userData[from].endereco = text
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Descreva brevemente o serviço ou problema técnico que precisa ser resolvido:' + rodapeNavegacao)

            } else if (estadoAtual === 'chamado_detalhes') {
                if (textNorm === '0' || textNorm === 'menu') { userState[from] = 'inicio'; await mostrarMenuOpcoes(from); return; }
                userData[from].detalhes = text
                const protocolo = gerarProtocolo()

                salvarChamado(protocolo, {
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    detalhes: userData[from].detalhes
                })

                // NOTIFICAÇÃO DE REGISTRO CONCLUÍDO ENVIADA PARA O GRUPO
                const pedidoConcluido = `🚨 *NOVO AGENDAMENTO CONCLUÍDO (#${protocolo})*\n\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${userData[from].telefone}\n📍 *Endereço:* ${userData[from].endereco}\n📝 *Serviço:* ${userData[from].detalhes}`
                await notificarGrupo(pedidoConcluido)

                await escrever(`✅ *Agendamento #${protocolo} Concluído com Sucesso!*\n\nSeu pedido foi registrado e encaminhado para nossa equipe. Entraremos em contato em breve para confirmar a visita!`)
                
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
            console.log('✅ Bot Lukas Encanador pronto e operando!')
            try {
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
