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
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data : [];
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
      const chamadosMongo = await ChamadoModel.find().lean();
      if (Array.isArray(chamadosMongo) && chamadosMongo.length > 0) {
        return res.json(chamadosMongo);
      }
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

  const chamados = readJSON(chamadosPath);
  chamados.push(novoChamado);
  writeJSON(chamadosPath, chamados);

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

  let chamados = readJSON(chamadosPath);
  if (Array.isArray(chamados)) {
    const index = chamados.findIndex(p => String(p.id) === String(id));
    if (index !== -1) {
      chamados[index].status = status;
      writeJSON(chamadosPath, chamados);
    }
  }

  if (mongoose.connection.readyState === 1) {
    try {
      await ChamadoModel.updateOne({ id: Number(id) }, { status });
    } catch (err) {
      console.error("Erro ao atualizar status no MongoDB:", err);
    }
  }

  res.json({ sucesso: true });
});

app.delete('/api/admin/pedidos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  let chamados = readJSON(chamadosPath);
  if (Array.isArray(chamados)) {
    chamados = chamados.filter(p => String(p.id) !== String(id));
    writeJSON(chamadosPath, chamados);
  }

  if (mongoose.connection.readyState === 1) {
    try {
      await ChamadoModel.deleteOne({ id: Number(id) });
    } catch (err) {
      console.error("Erro ao eliminar chamado no MongoDB:", err);
    }
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
      const suporteMongo = await SuporteModel.find(query).lean();
      if (Array.isArray(suporteMongo) && suporteMongo.length > 0) {
        return res.json(suporteMongo);
      }
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

    const suporteList = readJSON(suportePath);
    suporteList.push(novoSuporte);
    writeJSON(suportePath, suporteList);

    if (mongoose.connection.readyState === 1) {
      await SuporteModel.create(novoSuporte);
    }

    return res.json({ sucesso: true, suporte: novoSuporte });
  } catch (error) {
    console.error("Erro ao salvar suporte:", error);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao guardar suporte.' });
  }
});

app.patch('/api/admin/suporte/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  let suporteList = readJSON(suportePath);
  if (Array.isArray(suporteList)) {
    const index = suporteList.findIndex(s => String(s.id) === String(id));
    if (index !== -1) {
      suporteList[index].status = status;
      writeJSON(suportePath, suporteList);
    }
  }

  if (mongoose.connection.readyState === 1) {
    try {
      await SuporteModel.updateOne({ id: Number(id) }, { status });
    } catch (err) {
      console.error("Erro ao atualizar suporte no MongoDB:", err);
    }
  }

  res.json({ sucesso: true });
});

app.delete('/api/admin/suporte/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  let suporteList = readJSON(suportePath);
  if (Array.isArray(suporteList)) {
    suporteList = suporteList.filter(s => String(s.id) !== String(id));
    writeJSON(suportePath, suporteList);
  }

  if (mongoose.connection.readyState === 1) {
    try {
      await SuporteModel.deleteOne({ id: Number(id) });
    } catch (err) {
      console.error("Erro ao eliminar suporte no MongoDB:", err);
    }
  }

  res.json({ sucesso: true, mensagem: 'Registo de suporte eliminado' });
});

// Autenticação Admin
app.post('/api/admin/login', (req, res) => {
  const usuarioInput = req.body.usuario || req.body.username;
  const senhaInput = req.body.senha || req.body.password;

  const admins = readJSON(path.join(__dirname, 'admins.json'));
  const admin = Array.isArray(admins) ? admins.find(a => a.username === usuarioInput) : null;

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
