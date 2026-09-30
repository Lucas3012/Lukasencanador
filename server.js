const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'minha_chave_secreta_local';

// Inicialização da API do Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const systemInstruction = `
Você é a assistente virtual inteligente e profissional do Lukas Encanador.
Sua missão é:
1. Cumprimentar o cliente com cordialidade e profissionalismo.
2. Tirar dúvidas sobre serviços de desentupimento, reparação de vazamentos, instalações hidráulicas e manutenções em geral.
3. Se o cliente solicitar um orçamento ou atendimento urgente, oriente-o a informar o nome, telefone e o serviço desejado ou direcionar para o WhatsApp.
4. Manter sempre um tom prestativo, objetivo e acolhedor.
`;

// Mapa para armazenar o histórico do chat de cada cliente em memória
const chatSessions = new Map();

// Middlewares CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Servir arquivos estáticos do site
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

// Rota do Web Chat (Gemini)
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ sucesso: false, mensagem: 'sessionId e message são obrigatórios' });
    }

    if (!chatSessions.has(sessionId)) {
      const newChat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        },
      });
      chatSessions.set(sessionId, newChat);
    }

    const chat = chatSessions.get(sessionId);
    const response = await chat.sendMessage({ message });

    return res.json({
      sucesso: true,
      resposta: response.text
    });
  } catch (error) {
    console.error('Erro no atendimento do Chat:', error);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao processar a resposta do assistente.' });
  }
});

// Rotas da API Admin e Contacto
app.post('/api/admin/login', (req, res) => {
  const usuarioInput = req.body.usuario || req.body.username;
  const senhaInput = req.body.senha || req.body.password;

  const admins = readJSON(path.join(__dirname, 'admins.json'));
  const admin = admins.find(a => a.username === usuarioInput);

  if (!admin) {
    return res.status(401).json({ sucesso: false, success: false, mensagem: 'Usuário não encontrado' });
  }

  const senhaValida = (admin.password === senhaInput);

  if (senhaValida) {
    const token = jwt.sign({ username: admin.username }, SECRET_KEY, { expiresIn: '8h' });
    return res.json({ sucesso: true, success: true, token });
  }

  res.status(401).json({ sucesso: false, success: false, mensagem: 'Senha incorreta' });
});

app.get('/api/admin/pedidos', authenticateToken, (req, res) => {
  const pedidos = readJSON(path.join(__dirname, 'pedidos.json'));
  res.json(pedidos);
});

app.post('/api/contacto', (req, res) => {
  const { nome, telefone, servico, mensagem } = req.body;
  if (!nome || !telefone || !servico) {
    return res.status(400).json({ sucesso: false, mensagem: 'Preencha os campos obrigatórios' });
  }

  const pedidos = readJSON(path.join(__dirname, 'pedidos.json'));
  const novoPedido = {
    id: Date.now(),
    nome,
    telefone,
    servico,
    mensagem: mensagem || '',
    status: 'Pendente',
    data: new Date().toISOString()
  };

  pedidos.push(novoPedido);
  writeJSON(path.join(__dirname, 'pedidos.json'), pedidos);
  res.json({ sucesso: true, pedido: novoPedido });
});

app.patch('/api/admin/pedidos/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const pedidos = readJSON(path.join(__dirname, 'pedidos.json'));
  const index = pedidos.findIndex(p => p.id == id);

  if (index !== -1) {
    pedidos[index].status = status;
    writeJSON(path.join(__dirname, 'pedidos.json'), pedidos);
    return res.json({ sucesso: true, pedido: pedidos[index] });
  }
  res.status(404).json({ sucesso: false, mensagem: 'Pedido não encontrado' });
});

// Inicialização do servidor + Execução do Bot
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor API e Web a rodar na porta ${PORT}`);
  
  try {
    const botPath = fs.existsSync(path.join(__dirname, 'Botencanador', 'index.js'))
      ? './Botencanador/index.js'
      : './index.js';
    
    if (fs.existsSync(botPath) && botPath !== './index.js') {
      require(botPath);
      console.log('🤖 Bot do WhatsApp inicializado junto com o servidor!');
    }
  } catch (err) {
    console.error('❌ Erro ao inicializar o Bot do WhatsApp:', err.message);
  }
});
