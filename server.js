const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'minha_chave_secreta_local';
const MONGO_URI = process.env.MONGO_URI;

// Middlewares
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(__dirname));

if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// --- CONEXÃO MONGODB ---
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 Conectado ao MongoDB com sucesso!'))
    .catch(err => console.error('❌ Erro na conexão com MongoDB:', err.message));
} else {
  console.log('⚠️ MONGO_URI não definida. Operando apenas com ficheiros JSON locais.');
}

// Schemas do Mongoose
const ChamadoSchema = new mongoose.Schema({
  id: Number,
  protocolo: String,
  nome: String,
  telefone: String,
  servico: String,
  detalhes: String,
  status: { type: String, default: 'Pendente' },
  data: { type: String, default: () => new Date().toISOString() }
});

const SuporteSchema = new mongoose.Schema({
  id: Number,
  protocolo: String,
  nome: String,
  telefone: String,
  detalhes: String,
  status: { type: String, default: 'Pendente' },
  createdAt: { type: String, default: () => new Date().toISOString() }
});

const ChamadoModel = mongoose.models.Chamado || mongoose.model('Chamado', ChamadoSchema);
const SuporteModel = mongoose.models.Suporte || mongoose.model('Suporte', SuporteSchema);

// --- FUNÇÕES UTILITÁRIAS JSON ---
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

const chamadosPath = path.join(__dirname, 'Botencanador', 'chamados.json');
const suportePath = path.join(__dirname, 'suporte.json');

// --- ROTAS DE CHAMADOS (OPÇÃO 1) ---

app.get('/api/admin/pedidos', authenticateToken, async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const chamadosMongo = await ChamadoModel.find();
      if (chamadosMongo.length > 0) return res.json(chamadosMongo);
    }
  } catch (err) {
    console.error("Erro ao ler chamados do Mongo:", err);
  }
  
  const chamados = readJSON(chamadosPath);
  res.json(chamados);
});

app.post('/api/contacto', async (req, res) => {
  const { nome, telefone, servico, mensagem, endereco } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ sucesso: false, mensagem: 'Preencha os campos obrigatórios' });
  }

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

  // 1. Guardar no JSON local
  const chamados = readJSON(chamadosPath);
  chamados.push(novoChamado);
  writeJSON(chamadosPath, chamados);

  // 2. Guardar no MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      await ChamadoModel.create(novoChamado);
    } catch (err) {
      console.error("Erro ao salvar chamado no MongoDB:", err);
    }
  }

  res.json({ sucesso: true, pedido: novoChamado });
});

app.patch('/api/admin/pedidos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const chamados = readJSON(chamadosPath);
  const index = chamados.findIndex(p => p.id == id);
  if (index !== -1) {
    chamados[index].status = status;
    writeJSON(chamadosPath, chamados);
  }

  if (mongoose.connection.readyState === 1) {
    await ChamadoModel.updateOne({ id: Number(id) }, { status });
  }

  res.json({ sucesso: true });
});

app.delete('/api/admin/pedidos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  let chamados = readJSON(chamadosPath);
  chamados = chamados.filter(p => p.id != id);
  writeJSON(chamadosPath, chamados);

  if (mongoose.connection.readyState === 1) {
    await ChamadoModel.deleteOne({ id: Number(id) });
  }

  res.json({ sucesso: true, mensagem: 'Chamado eliminado com sucesso' });
});

// --- ROTAS DE SUPORTE (OPÇÃO 7) ---

app.get('/api/suporte', async (req, res) => {
  const { protocolo } = req.query;

  if (mongoose.connection.readyState === 1) {
    try {
      let query = {};
      if (protocolo) {
        query = { $or: [{ id: protocolo }, { protocolo: protocolo }] };
      }
      const suporteMongo = await SuporteModel.find(query);
      if (suporteMongo.length > 0) return res.json(suporteMongo);
    } catch (err) {
      console.error("Erro ao ler suporte do Mongo:", err);
    }
  }

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

app.post('/api/suporte', async (req, res) => {
  try {
    const { nome, telefone, mensagem, detalhes, protocolo } = req.body;

    const novoSuporte = {
      id: Date.now(),
      protocolo: protocolo || String(Math.floor(1000 + Math.random() * 9000)),
      nome: nome || 'Cliente WhatsApp',
      telefone: telefone || 'Não informado',
      detalhes: detalhes || mensagem || 'Sem descrição',
      status: 'Pendente',
      createdAt: new Date().toISOString()
    };

    // 1. Guardar no JSON local
    const suporteList = readJSON(suportePath);
    suporteList.push(novoSuporte);
    writeJSON(suportePath, suporteList);

    // 2. Guardar no MongoDB
    if (mongoose.connection.readyState === 1) {
      await SuporteModel.create(novoSuporte);
    }

    return res.json({ sucesso: true, suporte: novoSuporte });
  } catch (error) {
    console.error("Erro ao salvar suporte:", error);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao guardar suporte.' });
  }
});

app.delete('/api/admin/suporte/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  let suporteList = readJSON(suportePath);
  suporteList = suporteList.filter(s => s.id != id);
  writeJSON(suportePath, suporteList);

  if (mongoose.connection.readyState === 1) {
    await SuporteModel.deleteOne({ id: Number(id) });
  }

  res.json({ sucesso: true, mensagem: 'Registo de suporte eliminado' });
});

// Autenticação Admin
app.post('/api/admin/login', (req, res) => {
  const usuarioInput = req.body.usuario || req.body.username;
  const senhaInput = req.body.senha || req.body.password;

  const admins = readJSON(path.join(__dirname, 'admins.json'));
  const admin = admins.find(a => a.username === usuarioInput);

  if (admin && admin.password === senhaInput) {
    const token = jwt.sign({ username: admin.username }, SECRET_KEY, { expiresIn: '8h' });
    return res.json({ sucesso: true, token });
  }

  res.status(401).json({ sucesso: false, mensagem: 'Credenciais inválidas' });
});

// Inicialização
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor a rodar na porta ${PORT}`);
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
