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

// Servir arquivos estáticos
app.use(express.static(__dirname));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// Rotas HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

app.get('/admin-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// --- CONEXÃO MONGODB ---
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 Conectado ao MongoDB com sucesso!'))
    .catch(err => console.error('❌ Erro na conexão com MongoDB:', err.message));
} else {
  console.log('⚠️ MONGO_URI não definida. Operando apenas com arquivos JSON locais.');
}

// Schemas do Mongoose
const ChamadoSchema = new mongoose.Schema({
  id: mongoose.Schema.Types.Mixed,
  protocolo: String,
  nome: String,
  telefone: String,
  servico: String,
  detalhes: String,
  status: { type: String, default: 'Pendente' },
  data: { type: String, default: () => new Date().toISOString() }
});

const ChamadoModel = mongoose.models.Chamado || mongoose.model('Chamado', ChamadoSchema);

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

const normalizeData = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const idVal = item.id || item._id;
    return {
      ...item,
      id: idVal ? String(idVal) : String(Date.now()),
      _id: item._id ? String(item._id) : undefined
    };
  });
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

// Rotas API
app.get('/api/admin/pedidos', authenticateToken, async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const chamadosMongo = await ChamadoModel.find().lean();
      if (Array.isArray(chamadosMongo) && chamadosMongo.length > 0) {
        return res.json(normalizeData(chamadosMongo));
      }
    }
  } catch (err) {
    console.error("Erro ao ler chamados do Mongo:", err);
  }
  
  const chamados = readJSON(chamadosPath);
  res.json(normalizeData(chamados));
});

app.patch('/api/admin/pedidos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  let chamados = readJSON(chamadosPath);
  if (Array.isArray(chamados)) {
    const index = chamados.findIndex(p => String(p.id) === String(id) || String(p._id) === String(id));
    if (index !== -1) {
      chamados[index].status = status;
      writeJSON(chamadosPath, chamados);
    }
  }

  if (mongoose.connection.readyState === 1) {
    try {
      const parsedId = isNaN(id) ? id : Number(id);
      const conditions = [{ id: parsedId }, { id: String(id) }];
      if (mongoose.Types.ObjectId.isValid(id)) {
        conditions.push({ _id: id });
      }
      await ChamadoModel.updateOne({ $or: conditions }, { status });
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
    chamados = chamados.filter(p => String(p.id) !== String(id) && String(p._id) !== String(id));
    writeJSON(chamadosPath, chamados);
  }

  if (mongoose.connection.readyState === 1) {
    try {
      const parsedId = isNaN(id) ? id : Number(id);
      const conditions = [{ id: parsedId }, { id: String(id) }];
      if (mongoose.Types.ObjectId.isValid(id)) {
        conditions.push({ _id: id });
      }
      await ChamadoModel.deleteOne({ $or: conditions });
    } catch (err) {
      console.error("Erro ao eliminar chamado no MongoDB:", err);
    }
  }

  res.json({ sucesso: true });
});

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
