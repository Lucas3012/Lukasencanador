const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'minha_chave_secreta_local';

// Middlewares CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Servir arquivos estáticos
app.use(express.static(__dirname));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

const readJSON = (filePath) => {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return [];
  }
};

const writeJSON = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ mensagem: 'Token não fornecido' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ mensagem: 'Token inválido ou expirado' });
    req.user = user;
    next();
  });
};

// Lógica do Chatbot por Regras Fixas (Site)
function processarMensagemChat(mensagem) {
  if (!mensagem) return "Como posso ajudar você hoje?";

  const texto = mensagem.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (texto.includes('orcamento') || texto.includes('agendar') || texto.includes('preco') || texto.includes('valor') || texto === '1') {
    return "🛠️ Para solicitar um *orçamento* ou agendar uma visita técnica:\n\n1️⃣ Digite o seu *Nome Completo*\n2️⃣ Descreva o problema (vazamento, desentupimento, etc.)\n3️⃣ Informe o seu endereço com bairro.\n\nOu clique no botão do WhatsApp para falar direto com o técnico!";
  }

  if (texto.includes('vazamento') || texto.includes('infiltracao') || texto.includes('cano') || texto.includes('pingando')) {
    return "💧 *Serviços de Vazamentos:*\nRealizamos localização e reparo de vazamentos em canos, torneiras, vasos sanitários e infiltrações.\n\nPara agendar uma avaliação no local, informe o seu nome e endereço!";
  }

  if (texto.includes('desentup') || texto.includes('pia') || texto.includes('ralo') || texto.includes('esgoto') || texto.includes('vaso')) {
    return "🚽 *Serviços de Desentupimento:*\nAtendemos desentupimento de pias, ralos, vasos sanitários, caixas de gordura e esgoto em geral.\n\nInforme o seu nome e bairro para verificarmos a disponibilidade imediata.";
  }

  if (texto.includes('regiao') || texto.includes('onde') || texto.includes('cidade') || texto.includes('atende') || texto.includes('taxa') || texto.includes('visita')) {
    return "📍 *Regiões de Atendimento:*\nAtendemos em *Itabuna*, *Ilhéus* e *Itapé*.\n\n🚗 *Taxa de visita:* R$ 50,00 (valor abatido do total caso o serviço seja aprovado!).";
  }

  if (texto.includes('pagamento') || texto.includes('cartao') || texto.includes('pix') || texto.includes('dinheiro')) {
    return "💳 *Formas de Pagamento Aceitas:*\nAceitamos Pix, Cartão de Crédito/Débito e Dinheiro.";
  }

  if (texto.includes('horario') || texto.includes('funciona') || texto.includes('aberto') || texto.includes('tempo')) {
    return "⏰ *Horário de Atendimento:*\nAtendemos de Segunda a Sexta, das 08h às 18h.";
  }

  if (texto.includes('ola') || texto.includes('oi') || texto.includes('bom dia') || texto.includes('boa tarde') || texto.includes('boa noite')) {
    return "Olá! 👋 Seja bem-vindo ao atendimento do *Lukas Encanador*.\n\nComo posso ajudar você hoje?\n\n• Digite *1* para Pedir Orçamento\n• Digite *2* para Dúvidas sobre Serviços\n• Digite *3* para Regiões de Atendimento";
  }

  return "Obrigado pelo contato! 👋 Para podermos te atender melhor, informe o seu *Nome*, *Bairro* e o *Serviço necessário*, ou escolha uma das opções:\n\n1️⃣ Solicitar Orçamento\n2️⃣ Regiões de Atendimento\n3️⃣ Falar no WhatsApp";
}

// Rota do Chat do Site
app.post('/chat', (req, res) => {
  try {
    const { message, mensagem } = req.body;
    const textoEntrada = message || mensagem;
    const resposta = processarMensagemChat(textoEntrada);
    res.json({ reply: resposta, resposta });
  } catch (error) {
    console.error("Erro no chat:", error);
    res.status(500).json({ reply: "Desculpe, ocorreu um erro interno. Tente novamente." });
  }
});

// Autenticação Admin
app.post('/api/admin/login', (req, res) => {
  const usuarioInput = req.body.usuario || req.body.username;
  const senhaInput = req.body.senha || req.body.password;

  const admins = readJSON(path.join(__dirname, 'admins.json'));
  const admin = admins.find(a => a.username === usuarioInput);

  if (!admin) {
    return res.status(401).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
  }

  if (admin.password === senhaInput) {
    const token = jwt.sign({ username: admin.username }, SECRET_KEY, { expiresIn: '8h' });
    return res.json({ sucesso: true, token });
  }

  res.status(401).json({ sucesso: false, mensagem: 'Senha incorreta' });
});

// --- ROTAS DE CHAMADOS (OPÇÃO 1 DO BOT - chamados.json) ---

const chamadosPath = path.join(__dirname, 'Botencanador', 'chamados.json');

app.get('/api/admin/pedidos', authenticateToken, (req, res) => {
  const chamados = readJSON(chamadosPath);
  res.json(chamados);
});

app.post('/api/contacto', (req, res) => {
  const { nome, telefone, servico, mensagem, endereco } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ sucesso: false, mensagem: 'Preencha os campos obrigatórios' });
  }

  const chamados = readJSON(chamadosPath);
  const novoChamado = {
    id: Date.now(),
    protocolo: String(Math.floor(1000 + Math.random() * 9000)),
    nome,
    telefone,
    servico: servico || 'Orçamento/Agendamento',
    detalhes: mensagem || endereco || '',
    status: 'Pendente',
    data: new Date().toISOString()
  };

  chamados.push(novoChamado);
  writeJSON(chamadosPath, chamados);
  res.json({ sucesso: true, pedido: novoChamado });
});

app.patch('/api/admin/pedidos/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const chamados = readJSON(chamadosPath);
  const index = chamados.findIndex(p => p.id == id);

  if (index !== -1) {
    chamados[index].status = status;
    writeJSON(chamadosPath, chamados);
    return res.json({ sucesso: true, pedido: chamados[index] });
  }
  res.status(404).json({ sucesso: false, mensagem: 'Chamado não encontrado' });
});

app.delete('/api/admin/pedidos/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  let chamados = readJSON(chamadosPath);
  const inicial = chamados.length;
  chamados = chamados.filter(p => p.id != id);

  if (chamados.length < inicial) {
    writeJSON(chamadosPath, chamados);
    return res.json({ sucesso: true, mensagem: 'Chamado eliminado com sucesso' });
  }
  res.status(404).json({ sucesso: false, mensagem: 'Chamado não encontrado' });
});

// --- ROTAS DE SUPORTE (OPÇÃO 7 DO BOT - suporte.json) ---

const suportePath = path.join(__dirname, 'suporte.json');

app.get('/api/suporte', (req, res) => {
  const { protocolo } = req.query;
  const suporteList = readJSON(suportePath);

  if (protocolo) {
    const filtrado = suporteList.filter(s => 
      String(s.id).includes(protocolo) || 
      (s.protocolo && String(s.protocolo).includes(protocolo))
    );
    return res.json(filtrado);
  }

  res.json(suporteList);
});

app.post('/api/suporte', (req, res) => {
  try {
    const { nome, telefone, mensagem, detalhes, protocolo } = req.body;
    const suporteList = readJSON(suportePath);

    const novoSuporte = {
      id: Date.now(),
      protocolo: protocolo || String(Math.floor(1000 + Math.random() * 9000)),
      nome: nome || 'Cliente WhatsApp',
      telefone: telefone || 'Não informado',
      detalhes: detalhes || mensagem || 'Sem descrição',
      status: 'Pendente',
      createdAt: new Date().toISOString()
    };

    suporteList.push(novoSuporte);
    writeJSON(suportePath, suporteList);

    return res.json({ sucesso: true, suporte: novoSuporte });
  } catch (error) {
    console.error("Erro ao salvar suporte:", error);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao guardar suporte.' });
  }
});

app.delete('/api/admin/suporte/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  let suporteList = readJSON(suportePath);
  const inicial = suporteList.length;
  suporteList = suporteList.filter(s => s.id != id);

  if (suporteList.length < inicial) {
    writeJSON(suportePath, suporteList);
    return res.json({ sucesso: true, mensagem: 'Registo de suporte eliminado com sucesso' });
  }

  res.status(404).json({ sucesso: false, mensagem: 'Registo de suporte não encontrado' });
});

// Inicialização do servidor + Execução do Bot
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor API e Web a rodar na porta ${PORT}`);
  
  try {
    const botPath = fs.existsSync(path.join(__dirname, 'Botencanador', 'index.js'))
      ? './Botencanador/index.js'
      : './index.js';
    
    require(botPath);
    console.log('🤖 Bot do WhatsApp inicializado!');
  } catch (err) {
    console.error('❌ Erro ao inicializar o Bot:', err.message);
  }
});
