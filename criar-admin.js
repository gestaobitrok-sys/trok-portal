// Uso: node criar-admin.js "Nome" email@trokservice.com.br senha-com-8-ou-mais
// Cria (ou redefine a senha de) um administrador direto no banco. Use só na 1ª vez.
require('dotenv').config();
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const [, , nome, emailArg, senha] = process.argv;
if (!nome || !emailArg || !senha || senha.length < 8) {
  console.log('Uso: node criar-admin.js "Nome" email senha(8+ caracteres)');
  process.exit(1);
}
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'portal.db'));
db.exec(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'usuario', ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL);`);
const email = emailArg.trim().toLowerCase();
const hash = bcrypt.hashSync(senha, 10);
if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
  db.prepare("UPDATE usuarios SET senha_hash=?, role='admin', ativo=1, nome=? WHERE email=?").run(hash, nome, email);
  console.log('Administrador atualizado:', email);
} else {
  db.prepare("INSERT INTO usuarios (nome,email,senha_hash,role,ativo,criado_em) VALUES (?,?,?,'admin',1,?)").run(nome, email, hash, new Date().toISOString());
  console.log('Administrador criado:', email);
}
