const fs = require('fs');
const bcrypt = require('bcryptjs');

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';

const hashedPassword = bcrypt.hashSync(password, 10);
const filePath = './admins.json';

let admins = [];
if (fs.existsSync(filePath)) {
  admins = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

admins.push({ username, password: hashedPassword });
fs.writeFileSync(filePath, JSON.stringify(admins, null, 2));

console.log(`Usuário ${username} criado com sucesso!`);
