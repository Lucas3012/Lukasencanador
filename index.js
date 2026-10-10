const { default: makeWASocket, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const useMongoDBAuthState = require('./mongoAuth')
const mongoose = require('mongoose')
const pino = require('pino')
const fs = require('fs')

const MONGO_URI = process.env.MONGO_URI || ''
const BOT_NUMBER = (process.env.BOT_NUMBER || process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

// Links exatos dos Grupos do WhatsApp
const LINK_GRUPO_CHAMADOS = 'https://chat.whatsapp.com/EwUIug1DbI3IWZGkpbrJ8n?s=cl&p=a&mlu=4&ilr=4'
const LINK_GRUPO_ORCAMENTOS = 'https://chat.whatsapp.com/HYFutIc2BYi6I0EyM6sBsQ?s=cl&p=a&mlu=4&ilr=4'
const LINK_GRUPO_SUPORTE = 'https://chat.whatsapp.com/F0UYp2zG5pTAgtSE0dwctX?s=cl&p=a&mlu=4&ilr=4'

let GRUPO_CHAMADOS_JID = null
let GRUPO_ORCAMENTOS_JID = null
let GRUPO_SUPORTE_JID = null

let clienteAtual = null
let keepOnlineInterval = null

const AtendimentoSchema = new mongoose.Schema({
    protocolo: { type: String, required: true, unique: true },
    nome: String,
    telefone: String,
    endereco: String,
    tipoServico: String,
    detalhes: String,
    origem: String,
    status: { type: String, default: 'Pendente' },
    createdAt: { type: Date, default: Date.now }
});

const AtendimentoModel = mongoose.models.Chamado || mongoose.model('Chamado', AtendimentoSchema);

async function salvarNoMongo(dados) {
    try {
        if (mongoose.connection.readyState === 1) {
            await AtendimentoModel.create(dados);
            console.log(`💾 Atendimento #${dados.protocolo} salvo com sucesso no MongoDB!`);
            return true;
        }
    } catch (err) {
        console.error('❌ Erro ao salvar no MongoDB:', err.message);
    }
    return false;
}

async function buscarAtendimentoNoMongo(protocolo) {
    try {
        if (mongoose.connection.readyState === 1) {
            return await AtendimentoModel.findOne({ protocolo }).lean();
        }
    } catch (e) {}
    return null;
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
            try { return await client.groupAcceptInvite(inviteCode) } 
            catch (err) {
                const groupInfo = await client.groupGetInviteInfo(inviteCode)
                return groupInfo.id
            }
        }
    } catch (e) {}
    return null
}

async function limparSessaoInvalida() {
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.collection('sessions').deleteMany({})
        }
    } catch (err) {}
    try {
        if (fs.existsSync('./sessao')) {
            fs.rmSync('./sessao', { recursive: true, force: true })
        }
    } catch (err) {}
}

const MENU_PRINCIPAL = `👋 *Atendimento Lukas Encanador*

Escolha uma das opções abaixo enviando o número ou escrevendo o que deseja:

1️⃣ *Agendar Serviço* (Vazamentos, Instalações, Desentupimentos)
2️⃣ *Solicitar Orçamento Gratuito*
3️⃣ *Emergência 24h* (Inundação, Vazamento Grave)
4️⃣ *Verificar Status do Pedido / Chamado*
5️⃣ *Tabela de Serviços e Preços Base*
6️⃣ *Horários de Atendimento e Região*
7️⃣ *Falar com Atendente Humano / Reclamações*`

async function ligarbot() {
    if (keepOnlineInterval) {
        clearInterval(keepOnlineInterval);
        keepOnlineInterval = null;
    }

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
            if (mongoose.connection.readyState === 0) {
                await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
            }
            const auth = await useMongoDBAuthState();
            state = auth.state;
            saveCreds = auth.saveCreds;
        } catch (err) {
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
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    })

    clienteAtual = client
    client.ev.on('creds.update', saveCreds)

    client.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return
            const info = messages[0]
            if (!info || !info.message || info.key.fromMe) return

            const from = info.key.remoteJid
            if (from.endsWith('@g.us') || from.endsWith('@newsletter')) return

            try { await client.presenceSubscribe(from) } catch (e) {}
            await client.sendPresenceUpdate('available', from)

            const textRaw = info.message.conversation || info.message.extendedTextMessage?.text || ""
            const text = textRaw.trim()
            const txtNorm = normalizar(text)
            if (!text) return

            async function escrever(msg) {
                await client.sendPresenceUpdate('composing', from)
                await esperar(1200)
                await client.sendMessage(from, { text: msg }, { quoted: info })
                await client.sendPresenceUpdate('available', from)
            }

            if (!userState[from]) userState[from] = 'inicio'
            if (!userData[from]) userData[from] = {}

            const estado = userState[from]

            if (txtNorm === 'menu' || txtNorm === 'inicio' || txtNorm === 'voltar') {
                userState[from] = 'inicio'
                userData[from] = {}
                return await escrever(MENU_PRINCIPAL)
            }

            if (estado === 'inicio') {
                // Reconhecimento por Número OU por Escrita
                const isOpcao1 = text === '1' || txtNorm.includes('agendar') || txtNorm.includes('agendamento') || txtNorm.includes('visita') || txtNorm.includes('desentupir') || txtNorm.includes('vazamento');
                const isOpcao2 = text === '2' || txtNorm.includes('orcamento') || txtNorm.includes('cotacao') || txtNorm.includes('valor') || txtNorm.includes('quanto custa');
                const isOpcao3 = text === '3' || txtNorm.includes('emergencia') || txtNorm.includes('urgente') || txtNorm.includes('inundacao') || txtNorm.includes('socorro');
                const isOpcao4 = text === '4' || txtNorm.includes('status') || txtNorm.includes('acompanhar') || txtNorm.includes('protocolo') || txtNorm.includes('pedido');
                const isOpcao5 = text === '5' || txtNorm.includes('tabela') || txtNorm.includes('preco') || txtNorm.includes('precos') || txtNorm.includes('servicos');
                const isOpcao6 = text === '6' || txtNorm.includes('horario') || txtNorm.includes('regiao') || txtNorm.includes('cidade') || txtNorm.includes('atende');
                const isOpcao7 = text === '7' || txtNorm.includes('atendente') || txtNorm.includes('humano') || txtNorm.includes('reclamacao') || txtNorm.includes('suporte') || txtNorm.includes('falar');

                if (isOpcao1 || isOpcao2) {
                    userData[from].tipoOperacao = isOpcao1 ? 'Agendamento' : 'Orçamento'
                    userState[from] = 'aguardando_nome'
                    await escrever(`📋 *${userData[from].tipoOperacao}*: Por favor, digite o seu *Nome Completo*:`)

                } else if (isOpcao3) {
                    const prot = gerarProtocolo()
                    const fone = from.replace(/[^0-9]/g, '')
                    
                    await salvarNoMongo({
                        protocolo: prot,
                        nome: 'Cliente Emergência 24h',
                        telefone: fone,
                        origem: 'Emergência',
                        detalhes: '🚨 Chamado de EMERGÊNCIA 24H disparado via WhatsApp.'
                    });

                    if (GRUPO_SUPORTE_JID) {
                        await client.sendMessage(GRUPO_SUPORTE_JID, {
                            text: `🚨 *ALERTA DE EMERGÊNCIA 24H*\n\n📌 *Protocolo:* #${prot}\n📱 *Telefone:* https://wa.me/${fone}\n⚠️ Cliente solicita atendimento imediato!`
                        });
                    }

                    await escrever(`🚨 *ALERTA DE EMERGÊNCIA REGISTRADO!*\n\n📌 *Protocolo:* #${prot}\n\nO nosso técnico foi notificado e entrará em contacto imediatamente!`);

                } else if (isOpcao4) {
                    userState[from] = 'aguardando_protocolo'
                    await escrever('🔍 Por favor, digite o seu código de *Protocolo* (ex: 4582):');

                } else if (isOpcao5) {
                    const tabela = `🛠️ *Tabela de Serviços - Lukas Encanador*\n\n` +
                        `• *Caça Vazamento com Geofone:* A partir de R$ 150\n` +
                        `• *Desentupimento de Ralo/Pia:* A partir de R$ 100\n` +
                        `• *Instalação de Torneira/Sifão:* A partir de R$ 80\n` +
                        `• *Manutenção de Caixa D'água:* A partir de R$ 120\n` +
                        `• *Troca de Reparo de Válvula Hydra:* A partir de R$ 90\n\n` +
                        `Escreva *AGENDAR* ou digite *1* para solicitar uma visita!`;
                    await escrever(tabela);

                } else if (isOpcao6) {
                    const infoServico = `📍 *Região de Atendimento & Horários*\n\n` +
                        `⏰ *Horário:* Segunda a Sábado das 07h às 19h\n` +
                        `🚨 *Plantão 24h:* Disponível para Emergências\n\n` +
                        `🏙️ *Cidades Atendidas:* Centro e região metropolitana.\n\n` +
                        `Digite *MENU* para voltar.`;
                    await escrever(infoServico);

                } else if (isOpcao7) {
                    userData[from].tipoOperacao = 'Suporte / Reclamação';
                    userState[from] = 'aguardando_nome_suporte';
                    await escrever(`👨‍🔧 *Atendimento Humano / Reclamação*\n\nPor favor, digite o seu *Nome Completo*:`);

                } else {
                    await escrever(MENU_PRINCIPAL);
                }

            } else if (estado === 'aguardando_nome') {
                userData[from].nome = text;
                userState[from] = 'aguardando_telefone';
                await escrever(`📞 Obrigado, *${text}*. Agora digite o seu *Número de Telefone* (com DDD):`);

            } else if (estado === 'aguardando_telefone') {
                userData[from].telefone = text;
                userState[from] = 'aguardando_endereco';
                await escrever(`📍 Perfeito. Agora informe o seu *Endereço Completo* (Com Ponto de Referência):`);

            } else if (estado === 'aguardando_endereco') {
                userData[from].endereco = text;
                userState[from] = 'aguardando_detalhes';
                await escrever(`🛠️ Descreva brevemente o problema ou serviço necessário:`);

            } else if (estado === 'aguardando_detalhes') {
                userData[from].detalhes = text;
                const prot = gerarProtocolo();
                const foneContato = userData[from].telefone || from.replace(/[^0-9]/g, '');
                const tipo = userData[from].tipoOperacao || 'Agendamento/Orçamento';

                await salvarNoMongo({
                    protocolo: prot,
                    nome: userData[from].nome,
                    telefone: foneContato,
                    endereco: userData[from].endereco,
                    tipoServico: tipo,
                    detalhes: userData[from].detalhes,
                    origem: tipo
                });

                const msgGrupo = `📋 *NOVO ${tipo.toUpperCase()} REGISTRADO (#${prot})*\n\n` +
                    `👤 *Cliente:* ${userData[from].nome}\n` +
                    `📱 *Contato:* https://wa.me/${foneContato.replace(/[^0-9]/g, '')}\n` +
                    `📍 *Endereço:* ${userData[from].endereco}\n` +
                    `📝 *Detalhes:* ${userData[from].detalhes}`;

                const targetGroup = (tipo === 'Agendamento' ? GRUPO_CHAMADOS_JID : GRUPO_ORCAMENTOS_JID);
                if (targetGroup) {
                    await client.sendMessage(targetGroup, { text: msgGrupo });
                }

                await escrever(`🎉 *${tipo} Registrado com Sucesso!*\n\n📌 *Protocolo:* #${prot}\n👤 *Nome:* ${userData[from].nome}\n📞 *Telefone:* ${foneContato}\n📍 *Endereço:* ${userData[from].endereco}\n\nO registo foi guardado no MongoDB e enviado para a nossa equipa!`);

                userState[from] = 'inicio';
                userData[from] = {};

            } else if (estado === 'aguardando_nome_suporte') {
                userData[from].nome = text;
                userState[from] = 'aguardando_detalhes_suporte';
                await escrever(`📝 Por favor, descreva detalhadamente a sua *Dúvida, Reclamação ou Solicitação de Atendente*:`);

            } else if (estado === 'aguardando_detalhes_suporte') {
                userData[from].detalhes = text;
                const prot = gerarProtocolo();
                const fone = from.replace(/[^0-9]/g, '');

                await salvarNoMongo({
                    protocolo: prot,
                    nome: userData[from].nome,
                    telefone: fone,
                    origem: 'Suporte / Reclamação',
                    detalhes: userData[from].detalhes
                });

                if (GRUPO_SUPORTE_JID) {
                    await client.sendMessage(GRUPO_SUPORTE_JID, {
                        text: `👨‍🔧 *SUPORTE / RECLAMAÇÃO REGISTRADA (#${prot})*\n\n👤 *Cliente:* ${userData[from].nome}\n📱 *Contato:* https://wa.me/${fone}\n📝 *Mensagem:* ${userData[from].detalhes}`
                    });
                }

                await escrever(`👨‍🔧 *Solicitação Registrada com Sucesso!*\n\n📌 *Protocolo:* #${prot}\n\nO seu pedido de suporte/reclamação foi enviado para a equipa responsável. Aguarde retorno!`);

                userState[from] = 'inicio';
                userData[from] = {};

            } else if (estado === 'aguardando_protocolo') {
                const busca = await buscarAtendimentoNoMongo(text.replace(/[^0-9]/g, ''));
                if (busca) {
                    await escrever(`🔎 *Status do Protocolo #${busca.protocolo}*\n\n👤 *Cliente:* ${busca.nome || 'N/I'}\n📞 *Telefone:* ${busca.telefone || 'N/I'}\n🛠️ *Tipo:* ${busca.origem || busca.tipoServico}\n📌 *Status Atual:* *${busca.status || 'Pendente'}*\n📅 *Data:* ${new Date(busca.createdAt).toLocaleDateString('pt-BR')}`);
                } else {
                    await escrever(`❌ Não encontramos nenhum registo com o protocolo *#${text}* no MongoDB. Verifique o número ou digite *MENU*.`);
                }
                userState[from] = 'inicio';
            }

        } catch (err) {
            console.error('❌ Erro ao processar mensagem:', err.message);
        }
    });

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('🎉 BOT CONECTADO E PRONTO NO WHATSAPP (MODO 24/7 ONLINE ATIVADO)!');
            await client.sendPresenceUpdate('available');

            keepOnlineInterval = setInterval(async () => {
                try {
                    if (clienteAtual) {
                        await clienteAtual.sendPresenceUpdate('available');
                    }
                } catch (e) {}
            }, 15000);

            GRUPO_CHAMADOS_JID = await obterJidGrupo(client, LINK_GRUPO_CHAMADOS);
            GRUPO_ORCAMENTOS_JID = await obterJidGrupo(client, LINK_GRUPO_ORCAMENTOS);
            GRUPO_SUPORTE_JID = await obterJidGrupo(client, LINK_GRUPO_SUPORTE);
        }
        
        if (connection === 'close') {
            if (keepOnlineInterval) {
                clearInterval(keepOnlineInterval);
                keepOnlineInterval = null;
            }

            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔄 Conexão encerrada (código ${reason || 'desconhecido'}).`);

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                await limparSessaoInvalida();
                setTimeout(() => ligarbot(), 5000);
            } else {
                setTimeout(() => ligarbot(), 5000);
            }
        }
    });
}

ligarbot();
