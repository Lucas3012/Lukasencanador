const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

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

const LINK_GRUPO = 'EwUIug1DbI3IWZGkpbrJ8n' 
const LINK_GRUPO_ATENDENTE = 'F0UYp2zG5pTAgtSE0dwctX'

const userState = {} 
const userData = {}

const gerarProtocolo = () => Math.floor(1000 + Math.random() * 9000).toString()

// Função utilitária para normalizar texto (remove acentos e deixa minúsculo)
function normalizar(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ""
}

const SERVICOS = {
    desentupimento: [
        "Desentupimento de pia/lavatório",
        "Desentupimento de ralo/tanque",
        "Desentupimento de vaso sanitário",
        "Desentupimento coluna/rede principal",
        "Limpeza/desentupimento caixa de gordura",
        "Limpeza/desentupimento caixa de inspeção"
    ],
    reparos: [
        "Troca de torneira simples/filtro",
        "Instalação torneira monocomando/misturador",
        "Troca de engate flexível / niple",
        "Troca ou substituição de sifão",
        "Troca de válvula de escoamento (ralo)",
        "Reparo em válvula Hydra / Docol",
        "Troca mecanismo interno caixa acoplada",
        "Troca de bóia de caixa d'água",
        "Troca de registro geral/gaveta/pressão",
        "Limpeza de caixa d'água (até 1.000 L)",
        "Limpeza de caixa d'água (1.500L a 3.000L)",
        "Substituição tubulação do banheiro",
        "Substituição tubulação da cozinha",
        "Substituição tubulação por PVC/PPR"
    ]
}

const esperar = (tempo) => new Promise(resolve => setTimeout(resolve, tempo))

const question = (texto) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(texto, (resposta) => {
        rl.close()
        resolve(resposta)
    })
})

const MENU_TEXTO = `Olá! 👋 Bem-vindo ao atendimento do Encanador.\n\nEscolha uma opção digitando o número correspondente ou o nome da opção:\n\n1️⃣ *Solicitar Serviço / Agendar*\n2️⃣ *Orçamento Automático*\n3️⃣ *Tabela de Serviços por Categoria*\n4️⃣ *Regiões de Atendimento & Taxa de Visita*\n5️⃣ *Formas de Pagamento Aceitas*\n6️⃣ *Horário de Funcionamento*\n7️⃣ *Falar com Atendente*\n8️⃣ *Status do Atendimento / Reclamação*`

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

            console.log(`📩 Mensagem recebida de [${from}]: "${text}"`)

            async function escrever(mensagem) {
                await client.sendPresenceUpdate('composing', from) 
                await esperar(1000)   
                await client.sendMessage(from, { text: mensagem }, { quoted: info })
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estadoAtual = userState[from]
            const rodapeNavegacao = `\n\n─────────────────\n↩️ *9* - Voltar à Pergunta Anterior\n🏠 *0* - Voltar ao Menu Principal`

            // Comando global para voltar ao menu principal
            if ((text === '0' || textNorm === 'voltar' || textNorm === 'menu' || textNorm === 'inicio') && estadoAtual !== 'inicio' && estadoAtual !== 'orcamento_pos_opcao' && estadoAtual !== 'tabela_pos_opcao' && estadoAtual !== 'regioes_pos_opcao' && estadoAtual !== 'pagamento_pos_opcao' && estadoAtual !== 'horario_pos_opcao') {
                userState[from] = 'inicio'
                delete userData[from]
                await escrever(MENU_TEXTO)
                return
            }

            if (estadoAtual === 'inicio') {
                if (text === '1' || textNorm.includes('solicitar') || textNorm.includes('agendar') || textNorm.includes('chamado') || textNorm.includes('servico')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '2' || textNorm.includes('orcamento') || textNorm.includes('valor') || textNorm.includes('preco')) {
                    userState[from] = 'orcamento_categoria'
                    const introOrcamento = `📊 *Orçamento Automático*\n\nSelecione a categoria do serviço para ver as opções disponíveis:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(introOrcamento)
                } else if (text === '3' || textNorm.includes('tabela') || textNorm.includes('lista') || textNorm.includes('categoria')) {
                    userState[from] = 'tabela_categoria'
                    const menuPrecos = `🛠️ *Lista de Serviços por Categoria*\n\nEscolha qual categoria de serviço você deseja consultar:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(menuPrecos)
                } else if (text === '4' || textNorm.includes('regiao') || textNorm.includes('regioes') || textNorm.includes('visita') || textNorm.includes('cidade') || textNorm.includes('taxa')) {
                    const regioes = `📍 *Regiões de Atendimento & Visita:*\n\n🏠 Atendemos exclusivamente nas seguintes cidades:\n🔹 *Itabuna*\n🔹 *Ilhéus*\n🔹 *Itapé*\n\n🚗 *Taxa de Visita/Avaliação:* R$ 50,00 (Esse valor é abatido no total caso o serviço seja aprovado!).\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(regioes)
                    userState[from] = 'regioes_pos_opcao'
                } else if (text === '5' || textNorm.includes('pagamento') || textNorm.includes('pix') || textNorm.includes('cartao') || textNorm.includes('dinheiro')) {
                    const pagamentos = `💳 *Formas de Pagamento Aceitas:*\n\n✅ Pix\n✅ Cartão de Crédito (até 12x)\n✅ Cartão de Débito\n✅ Dinheiro em espécie\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(pagamentos)
                    userState[from] = 'pagamento_pos_opcao'
                } else if (text === '6' || textNorm.includes('horario') || textNorm.includes('hora') || textNorm.includes('funcionamento') || textNorm.includes('aberto')) {
                    const horarios = `⏰ *Horário de Atendimento:*\n\nAtendemos de Segunda a Sexta-feira, das 08h às 18h.\n\nO que deseja fazer agora?\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*`
                    await escrever(horarios)
                    userState[from] = 'horario_pos_opcao'
                } else if (text === '7' || textNorm.includes('atendente') || textNorm.includes('humano') || textNorm.includes('falar') || textNorm.includes('pessoa')) {
                    await escrever('⏳ Aguarde um momento...')
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPara encaminharmos você a um de nossos especialistas, por favor digite seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '8' || textNorm.includes('status') || textNorm.includes('reclamacao') || textNorm.includes('protocolo') || textNorm.includes('consultar')) {
                    userState[from] = 'reclamacao_nome'
                    await escrever('🔍 *Consulta de Status / Reclamação*\n\nPor favor, informe o seu *Nome completo*:' + rodapeNavegacao)
                } else {
                    await escrever(MENU_TEXTO)
                }
            }

            else if (estadoAtual === 'tabela_categoria') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'inicio'
                    await escrever(MENU_TEXTO)
                    return
                }

                if (text === '1' || textNorm.includes('vazamento')) {
                    const msgVazamentoTabela = 
`Para serviços de vazamentos realizamos uma avaliação no local.

O que deseja fazer agora?
1️⃣ *Registrar Chamado Agora*
0️⃣ *Voltar ao Menu Principal*`

                    await escrever(msgVazamentoTabela)
                    userState[from] = 'tabela_pos_opcao'
                    return
                }

                let listaOpcoes = []
                let nomeCategoria = ''

                if (text === '2' || textNorm.includes('desentupimento') || textNorm.includes('desentupir')) {
                    userData[from].categoria_chave = 'desentupimento'
                    nomeCategoria = 'Desentupimento'
                    listaOpcoes = SERVICOS.desentupimento
                } else if (text === '3' || textNorm.includes('reparo') || textNorm.includes('manutencao') || textNorm.includes('troca')) {
                    userData[from].categoria_chave = 'reparos'
                    nomeCategoria = 'Reparo / Manutenção'
                    listaOpcoes = SERVICOS.reparos
                } else {
                    await escrever('⚠️ Opção inválida! Digite 1 (Vazamentos), 2 (Desentupimentos) ou 3 (Reparo/Manutenção).' + rodapeNavegacao)
                    return
                }

                userData[from].categoria_nome = nomeCategoria
                userState[from] = 'tabela_item_servico'

                let msgItens = `🛠️ *Serviços de ${nomeCategoria}:*\n\nDigite o número correspondente ao serviço desejado:\n\n`
                listaOpcoes.forEach((servico, index) => {
                    msgItens += `${index + 1}️⃣ ${servico}\n`
                })
                msgItens += rodapeNavegacao

                await escrever(msgItens)
            }
            else if (estadoAtual === 'tabela_item_servico') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'tabela_categoria'
                    const menuPrecos = `🛠️ *Lista de Serviços por Categoria*\n\nEscolha qual categoria de serviço você deseja consultar:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(menuPrecos)
                    return
                }

                const catChave = userData[from].categoria_chave
                const listaOpcoes = SERVICOS[catChave]
                let indiceEscolhido = parseInt(text) - 1

                // Busca pelo nome do serviço se o usuário escreveu o texto
                if (isNaN(indiceEscolhido)) {
                    indiceEscolhido = listaOpcoes.findIndex(item => normalizar(item).includes(textNorm))
                }

                if (indiceEscolhido < 0 || indiceEscolhido >= listaOpcoes.length) {
                    await escrever(`⚠️ Opção inválida! Digite um número de 1 a ${listaOpcoes.length} ou o nome do serviço:` + rodapeNavegacao)
                    return
                }

                const servicoSelecionado = listaOpcoes[indiceEscolhido]

                const mensagemResultado = 
`📋 *Serviço Selecionado:*

👉 *${servicoSelecionado}*

O que deseja fazer agora?
1️⃣ *Registrar Chamado Agora*
0️⃣ *Voltar ao Menu Principal*`

                await escrever(mensagemResultado)
                userState[from] = 'tabela_pos_opcao'
            }
            else if (estadoAtual === 'tabela_pos_opcao') {
                if (text === '1' || textNorm.includes('registrar') || textNorm.includes('chamado') || textNorm.includes('agendar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '0' || textNorm.includes('menu') || textNorm.includes('voltar')) {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await escrever(MENU_TEXTO)
                } else {
                    await escrever('⚠️ Opção inválida!\n\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*')
                }
            }

            else if (estadoAtual === 'reclamacao_nome') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'inicio'
                    await escrever(MENU_TEXTO)
                    return
                }
                userData[from].nome = text
                userState[from] = 'status_protocolo'
                await escrever(`Obrigado, *${text}*!\n\nPor favor, informe o *Número do Protocolo* (4 dígitos):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'status_protocolo') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'reclamacao_nome'
                    await escrever('Por favor, informe o seu *Nome completo*:' + rodapeNavegacao)
                    return
                }

                if (!/^\d{4}$/.test(text)) {
                    await escrever('⚠️ *Número de protocolo inválido!* O número deve conter exatamente 4 dígitos.\nPor favor, digite novamente ou digite *0* para voltar ao Menu Principal.')
                    return
                }

                const codigoInformed = text
                const nomeCliente = userData[from].nome || 'Não informado'

                const todosChamados = carregarChamados()
                const chamadoExiste = !!todosChamados[codigoInformed]

                if (!chamadoExiste) {
                    userState[from] = 'atendente_duvida'
                    userData[from].telefone = from.replace(/[^0-9]/g, '')

                    await escrever(`❌ *Protocolo #${codigoInformed} não encontrado!*\n\nVocê está sendo redirecionado para o nosso *Atendimento Humano*.\n\nPor favor, descreva em poucas palavras a sua *dúvida ou necessidade*:` + rodapeNavegacao)
                    return
                }

                await escrever('Sua reclamação já está sendo analisada por um de nossos atendentes, em breve nossa equipe entrará em contato.')

                const msgGrupo = 
`🚨 *ALERTA: ATENDIMENTO URGENTE* 🚨

⚠️ *O cliente solicita ATENDIMENTO URGENTE referente ao chamado!*

🔢 *Protocolo:* #${codigoInformed}
👤 *Nome:* ${nomeCliente}`

                try {
                    const groupAtendente = await client.groupGetInviteInfo(LINK_GRUPO_ATENDENTE)
                    await client.sendMessage(groupAtendente.id, { text: msgGrupo })
                    console.log(`📢 Alerta urgente do protocolo #${codigoInformed} enviado para o grupo!`)
                } catch (err) {
                    console.error('❌ Erro ao enviar alerta para o grupo:', err.message)
                }

                delete userState[from]
                delete userData[from]
            }

            else if (estadoAtual === 'atendente_nome') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'inicio'
                    await escrever(MENU_TEXTO)
                    return
                }
                userData[from].nome = text
                userState[from] = 'atendente_telefone'
                await escrever(`Prazer, *${text}*!\n\nAgora informe o seu *Telefone para Contato/WhatsApp* (com DDD):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'atendente_telefone') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'atendente_nome'
                    await escrever('📞 *Atendimento Humano*\n\nPor favor digite seu *Nome completo*:' + rodapeNavegacao)
                    return
                }
                userData[from].telefone = text
                userState[from] = 'atendente_horario'
                
                const msgHorario = `⏰ *Qual o melhor horário para entrarmos em contato?*\n\n1️⃣ *Manhã* (08:00 às 12:00)\n2️⃣ *Tarde* (14:00 às 18:00)` + rodapeNavegacao
                await escrever(msgHorario)
            }
            else if (estadoAtual === 'atendente_horario') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'atendente_telefone'
                    await escrever('Informe o seu *Telefone para Contato/WhatsApp* (com DDD):' + rodapeNavegacao)
                    return
                }

                if (text === '1' || textNorm.includes('manha')) {
                    userData[from].horario = 'Manhã (08:00 às 12:00)'
                } else if (text === '2' || textNorm.includes('tarde')) {
                    userData[from].horario = 'Tarde (14:00 às 18:00)'
                } else {
                    await escrever('⚠️ Opção inválida! Digite *1* (Manhã) ou *2* (Tarde).' + rodapeNavegacao)
                    return
                }

                userState[from] = 'atendente_duvida'
                await escrever('📝 Por favor, descreva em poucas palavras a sua *dúvida ou necessidade*:' + rodapeNavegacao)
            }
            else if (estadoAtual === 'atendente_duvida') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'atendente_horario'
                    const msgHorario = `⏰ *Qual o melhor horário para entrarmos em contato?*\n\n1️⃣ *Manhã* (08:00 às 12:00)\n2️⃣ *Tarde* (14:00 às 18:00)` + rodapeNavegacao
                    await escrever(msgHorario)
                    return
                }

                userData[from].duvida = text
                const protocolo = gerarProtocolo()

                salvarChamado(protocolo, {
                    tipo: 'atendimento_humano',
                    nome: userData[from].nome,
                    telefone: userData[from].telefone || from.replace(/[^0-9]/g, ''),
                    horario_preferencial: userData[from].horario || 'Não especificado',
                    duvida: userData[from].duvida
                })

                const resumoAtendimento = 
`💬 *NOVA SOLICITAÇÃO DE ATENDIMENTO (OPÇÃO 7)*

🔢 *Protocolo:* #${protocolo}
👤 *Nome:* ${userData[from].nome || 'Não informado'}
📞 *Telefone:* ${userData[from].telefone || from.replace(/[^0-9]/g, '')}
⏰ *Melhor Horário:* ${userData[from].horario || 'Não especificado'}
❓ *Dúvida/Assunto:* ${userData[from].duvida}`

                await escrever(`✅ *Chamado #${protocolo} registrado!* Suas informações foram encaminhadas para a nossa equipe e um atendente falará com você no horário solicitado.`)

                try {
                    const groupInfo = await client.groupGetInviteInfo(LINK_GRUPO_ATENDENTE)
                    await client.sendMessage(groupInfo.id, { text: resumoAtendimento })
                    console.log(`📢 Solicitação de atendimento #${protocolo} enviada com sucesso para o grupo ${groupInfo.subject}!`)
                } catch (err) {
                    console.error('❌ Erro ao enviar para o grupo de atendentes:', err.message)
                }

                delete userState[from]
                delete userData[from]
            }

            else if (estadoAtual === 'regioes_pos_opcao' || estadoAtual === 'pagamento_pos_opcao' || estadoAtual === 'horario_pos_opcao') {
                if (text === '1' || textNorm.includes('registrar') || textNorm.includes('chamado') || textNorm.includes('agendar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '0' || textNorm.includes('menu') || textNorm.includes('voltar')) {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await escrever(MENU_TEXTO)
                } else {
                    await escrever('⚠️ Opção inválida!\n\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*')
                }
            }

            else if (estadoAtual === 'chamado_nome') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'inicio'
                    await escrever(MENU_TEXTO)
                    return
                }
                userData[from].nome = text
                userState[from] = 'chamado_telefone'
                await escrever(`Prazer, *${text}*! 👋\n\nAgora, digite o seu *Telefone para Contato/WhatsApp* (com DDD):` + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_telefone') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPor favor, digite o seu *Nome completo*:' + rodapeNavegacao)
                    return
                }
                userData[from].telefone = text
                userState[from] = 'chamado_endereco'
                await escrever('📍 Perfeito! Agora, digite o seu *Endereço completo* (Rua, Número, Bairro):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_endereco') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'chamado_telefone'
                    await escrever('Digite o seu *Telefone para Contato/WhatsApp* (com DDD):' + rodapeNavegacao)
                    return
                }
                userData[from].endereco = text
                userState[from] = 'chamado_categoria'
                
                const msgCategoria = `🛠️ *Selecione a Categoria do Serviço:*\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                await escrever(msgCategoria)
            }
            else if (estadoAtual === 'chamado_categoria') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'chamado_endereco'
                    await escrever('Digite o seu *Endereço completo* (Rua, Número, Bairro):' + rodapeNavegacao)
                    return
                }

                if (text === '1' || textNorm.includes('vazamento')) {
                    userData[from].categoria_nome = 'Vazamentos'
                    userData[from].servico = 'Vazamento (Geral)'
                    userState[from] = 'chamado_detalhes'
                    await escrever('Para serviços de vazamentos realizamos uma avaliação no local.' + rodapeNavegacao)
                    return
                }

                let listaOpcoes = []
                let nomeCategoria = ''

                if (text === '2' || textNorm.includes('desentupimento') || textNorm.includes('desentupir')) {
                    userData[from].categoria_chave = 'desentupimento'
                    nomeCategoria = 'Desentupimento'
                    listaOpcoes = SERVICOS.desentupimento
                } else if (text === '3' || textNorm.includes('reparo') || textNorm.includes('manutencao') || textNorm.includes('troca')) {
                    userData[from].categoria_chave = 'reparos'
                    nomeCategoria = 'Reparo / Manutenção'
                    listaOpcoes = SERVICOS.reparos
                } else {
                    await escrever('⚠️ Opção inválida! Digite 1 (Vazamentos), 2 (Desentupimentos) ou 3 (Reparo/Manutenção).' + rodapeNavegacao)
                    return
                }

                userData[from].categoria_nome = nomeCategoria
                userState[from] = 'chamado_item_servico'

                let msgItens = `🛠️ *Serviços de ${nomeCategoria}:*\nEscolha o item desejado digitando o número:\n\n`
                listaOpcoes.forEach((servico, index) => {
                    msgItens += `${index + 1}️⃣ ${servico}\n`
                })
                msgItens += rodapeNavegacao

                await escrever(msgItens)
            }
            else if (estadoAtual === 'chamado_item_servico') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'chamado_categoria'
                    const msgCategoria = `🛠️ *Selecione a Categoria do Serviço:*\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(msgCategoria)
                    return
                }

                const catChave = userData[from].categoria_chave
                const listaOpcoes = SERVICOS[catChave]
                let indiceEscolhido = parseInt(text) - 1

                if (isNaN(indiceEscolhido)) {
                    indiceEscolhido = listaOpcoes.findIndex(item => normalizar(item).includes(textNorm))
                }

                if (indiceEscolhido < 0 || indiceEscolhido >= listaOpcoes.length) {
                    await escrever(`⚠️ Opção inválida! Digite um número de 1 a ${listaOpcoes.length} ou o nome do serviço:` + rodapeNavegacao)
                    return
                }

                userData[from].servico = listaOpcoes[indiceEscolhido]
                userState[from] = 'chamado_detalhes'
                await escrever('📝 Para finalizar, *descreva brevemente os detalhes adicionais do problema* (ex: Ponto exato, urgência, etc.):' + rodapeNavegacao)
            }
            else if (estadoAtual === 'chamado_detalhes') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'chamado_categoria'
                    const msgCategoria = `🛠️ *Selecione a Categoria do Serviço:*\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(msgCategoria)
                    return
                }

                userData[from].detalhes = text
                const protocolo = gerarProtocolo()

                salvarChamado(protocolo, {
                    tipo: 'servico',
                    nome: userData[from].nome,
                    telefone: userData[from].telefone,
                    endereco: userData[from].endereco,
                    servico: userData[from].servico,
                    detalhes: userData[from].detalhes
                })

                const resumoChamado = 
`🚨 *NOVO CHAMADO DE SERVIÇO*

🔢 *Protocolo:* #${protocolo}
👤 *Nome:* ${userData[from].nome}
📞 *Telefone:* ${userData[from].telefone}
🏠 *Endereço:* ${userData[from].endereco}
🧰 *Serviço Selecionado:* ${userData[from].servico}
📝 *Detalhes:* ${userData[from].detalhes}`

                await escrever(resumoChamado)
                await escrever(`✅ *Chamado #${protocolo} registrado com sucesso!* Um de nossos técnicos entrará em contato em instantes.`)

                try {
                    const groupInfo = await client.groupGetInviteInfo(LINK_GRUPO)
                    await client.sendMessage(groupInfo.id, { text: resumoChamado })
                    console.log(`📢 Chamado #${protocolo} enviado com sucesso para o grupo ${groupInfo.subject}!`)
                } catch (err) {
                    console.error('❌ Erro ao enviar para o grupo:', err.message)
                }

                delete userState[from]
                delete userData[from]
            }

            else if (estadoAtual === 'orcamento_categoria') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'inicio'
                    await escrever(MENU_TEXTO)
                    return
                }

                if (text === '1' || textNorm.includes('vazamento')) {
                    const msgVazamentoOrcamento = 
`Para serviços de vazamentos realizamos uma avaliação no local.

O que deseja fazer agora?
1️⃣ *Registrar Chamado Agora*
0️⃣ *Voltar ao Menu Principal*`

                    await escrever(msgVazamentoOrcamento)
                    userState[from] = 'orcamento_pos_opcao'
                    return
                }

                let listaOpcoes = []
                let nomeCategoria = ''

                if (text === '2' || textNorm.includes('desentupimento') || textNorm.includes('desentupir')) {
                    userData[from].categoria_chave = 'desentupimento'
                    nomeCategoria = 'Desentupimento'
                    listaOpcoes = SERVICOS.desentupimento
                } else if (text === '3' || textNorm.includes('reparo') || textNorm.includes('manutencao') || textNorm.includes('troca')) {
                    userData[from].categoria_chave = 'reparos'
                    nomeCategoria = 'Reparo / Manutenção'
                    listaOpcoes = SERVICOS.reparos
                } else {
                    await escrever('⚠️ Opção inválida! Digite 1 (Vazamentos), 2 (Desentupimentos) ou 3 (Reparo/Manutenção).' + rodapeNavegacao)
                    return
                }

                userData[from].categoria_nome = nomeCategoria
                userState[from] = 'orcamento_item_servico'

                let msgItens = `📊 *Orçamento - ${nomeCategoria}:*\nEscolha o serviço desejado digitando o número correspondente:\n\n`
                listaOpcoes.forEach((servico, index) => {
                    msgItens += `${index + 1}️⃣ ${servico}\n`
                })
                msgItens += rodapeNavegacao

                await escrever(msgItens)
            }
            else if (estadoAtual === 'orcamento_item_servico') {
                if (text === '9' || textNorm === 'voltar') {
                    userState[from] = 'orcamento_categoria'
                    const introOrcamento = `📊 *Orçamento Automático*\n\nSelecione a categoria do serviço para ver as opções disponíveis:\n\n1️⃣ *Vazamentos*\n2️⃣ *Desentupimentos*\n3️⃣ *Reparo / Manutenção*` + rodapeNavegacao
                    await escrever(introOrcamento)
                    return
                }

                const catChave = userData[from].categoria_chave
                const listaOpcoes = SERVICOS[catChave]
                let indiceEscolhido = parseInt(text) - 1

                if (isNaN(indiceEscolhido)) {
                    indiceEscolhido = listaOpcoes.findIndex(item => normalizar(item).includes(textNorm))
                }

                if (indiceEscolhido < 0 || indiceEscolhido >= listaOpcoes.length) {
                    await escrever(`⚠️ Opção inválida! Digite um número de 1 a ${listaOpcoes.length} ou o nome do serviço:` + rodapeNavegacao)
                    return
                }

                const servicoSelecionado = listaOpcoes[indiceEscolhido]

                const mensagemResultado = 
`📋 *Serviço Selecionado:*

👉 *${servicoSelecionado}*

O que deseja fazer agora?
1️⃣ *Registrar Chamado Agora*
0️⃣ *Voltar ao Menu Principal*`

                await escrever(mensagemResultado)
                userState[from] = 'orcamento_pos_opcao'
            }

            else if (estadoAtual === 'orcamento_pos_opcao') {
                if (text === '1' || textNorm.includes('registrar') || textNorm.includes('chamado') || textNorm.includes('agendar')) {
                    userState[from] = 'chamado_nome'
                    await escrever('📋 *Abertura de Chamado*\n\nPara iniciarmos, por favor digite o seu *Nome completo*:' + rodapeNavegacao)
                } else if (text === '0' || textNorm.includes('menu') || textNorm.includes('voltar')) {
                    userState[from] = 'inicio'
                    delete userData[from]
                    await escrever(MENU_TEXTO)
                } else {
                    await escrever('⚠️ Opção inválida!\n\n1️⃣ *Registrar Chamado Agora*\n0️⃣ *Voltar ao Menu Principal*')
                }
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
            console.log('✅ Bot conectado com sucesso!')
            try {
                await client.groupAcceptInvite(LINK_GRUPO)
                await client.groupAcceptInvite(LINK_GRUPO_ATENDENTE)
            } catch (e) {}
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            console.log('❌ Conexão fechada. Código:', statusCode)

            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconectando...')
                setTimeout(() => ligarbot(), 3000)
            } else {
                console.log('🚪 Deslogado. Apague a pasta sessao e pareie novamente.')
            }
        }
    })
}

ligarbot()
