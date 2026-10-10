const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'minha_chave_secreta_local';
const MONGO_URI = process.env.MONGO_URI;

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Rota para visualizar o QR Code na Web
app.get('/qr', (req, res) => {
  const qr = botModule && botModule.getQRCode ? botModule.getQRCode() : null;
  if (!qr) {
    return res.send(`
      <div style="text-align:center; padding: 50px; font-family: Arial;">
        <h2>Aguardando geração do QR Code ou Bot já conectado...</h2>
        <p>Atualize a página em alguns segundos.</p>
        <script>setTimeout(() => location.reload(), 5000);</script>
      </div>
    `);
  }
  res.send(`
    <div style="text-align:center; padding: 30px; font-family: Arial;">
      <h2>Escaneie o QR Code com o seu WhatsApp</h2>
      <img src="${qr}" style="width: 300px; height: 300px;" />
      <p>Abra o WhatsApp > Aparelhos Conectados > Conectar um aparelho</p>
      <script>setTimeout(() => location.reload(), 10000);</script>
    </div>
  `);
});

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 Conectado ao MongoDB com sucesso!'))
    .catch(err => console.error('❌ Erro na conexão com MongoDB:', err.message));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor a rodar na porta ${PORT}`);
  try {
    const botPath = fs.existsSync(path.join(__dirname, 'Botencanador', 'index.js'))
      ? './Botencanador/index.js'
      : './index.js';
    botModule = require(botPath);
  } catch (err) {
    console.error('❌ Erro ao inicializar o Bot:', err.message);
  }
});
