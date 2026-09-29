const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'minha_chave_secreta_serveo';

// Permitir requisições do Serveo / CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Rota de Login Unificada
app.post('/api/admin/login', (req, res) => {
  const usuarioInput = req.body.usuario || req.body.username;
  const senhaInput = req.body.senha || req.body.password;

  const admins = readJSON(path.join(__dirname, 'admins.json'));
  const admin = admins.find(a => a.username === usuarioInput);

  if (!admin) {
    return res.status(401).json({ sucesso: false, success: false, mensagem: 'Usuário não encontrado' });
  }

  // Compara texto direto ou hash
  const senhaValida = (admin.password === senhaInput);

  if (senhaValida) {
    const token = jwt.sign({ username: admin.username }, SECRET_KEY, { expiresIn: '8h' });
    return res.json({ sucesso: true, success: true, token });
  }

  res.status(401).json({ sucesso: false, success: false, mensagem: 'Senha incorreta' });
});

// Pedidos
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

app.listen(PORT, '0.0.0.0', () => console.log(`Servidor a rodar na porta ${PORT}`));
