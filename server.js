const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'minha_chave_secreta_local';
const MONGO_URI = process.env.MONGO_URI;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(__dirname));

let botModule = null;

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

function autenticarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ mensagem: 'Acesso negado. Token não fornecido.' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ mensagem: 'Token inválido ou expirado.' });
    req.user = user;
    next();
  });
}

// Servir o painel admin
app.get('/admin', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'admin.html'))) {
    res.sendFile(path.join(__dirname, 'admin.html'));
  } else {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
  }
});

// Endpoint de Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '7d' });
    return res.json({ token, mensagem: 'Login realizado com sucesso!' });
  }
  return res.status(401).json({ mensagem: 'Usuário ou senha incorretos.' });
});

// GET: Listar todos os atendimentos
app.get('/api/atendimentos', autenticarToken, async (req, res) => {
  try {
    const lista = await AtendimentoModel.find().sort({ createdAt: -1 }).lean();
    res.json(lista);
  } catch (err) {
    res.status(500).json({ mensagem: 'Erro ao buscar atendimentos no MongoDB.' });
  }
});

// PATCH: Editar dados ou status
app.patch('/api/atendimentos/:protocolo', autenticarToken, async (req, res) => {
  try {
    const { protocolo } = req.params;
    const updateData = req.body;
    await AtendimentoModel.updateOne({ protocolo }, { $set: updateData });
    res.json({ mensagem: 'Atendimento atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ mensagem: 'Erro ao atualizar atendimento.' });
  }
});

// DELETE: Excluir registro
app.delete('/api/atendimentos/:protocolo', autenticarToken, async (req, res) => {
  try {
    const { protocolo } = req.params;
    await AtendimentoModel.deleteOne({ protocolo });
    res.json({ mensagem: 'Atendimento excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ mensagem: 'Erro ao excluir atendimento.' });
  }
});

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 Conectado ao MongoDB com sucesso!'))
    .catch(err => console.error('❌ Erro na conexão com MongoDB:', err.message));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  try {
    const botPath = fs.existsSync(path.join(__dirname, 'Botencanador', 'index.js'))
      ? './Botencanador/index.js'
      : './index.js';
    botModule = require(botPath);
  } catch (err) {
    console.error('❌ Erro ao inicializar o Bot:', err.message);
  }
});
