require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('ERRO: defina um JWT_SECRET forte (16+ caracteres) no arquivo .env antes de iniciar.');
  process.exit(1);
}

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'usuario',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    url TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    icone TEXT NOT NULL DEFAULT '🌐',
    ativo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS permissoes (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, site_id)
  );
`);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás do nginx
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- util ----------
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const normEmail = e => String(e || '').trim().toLowerCase();
function urlOk(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}
const publicUser = u => ({ id: u.id, nome: u.nome, email: u.email, role: u.role, ativo: !!u.ativo });

// Limite simples de tentativas de login (por IP+e-mail): 8 erros / 15 min
const tentativas = new Map();
function bloqueado(chave) {
  const t = tentativas.get(chave);
  if (!t) return false;
  if (Date.now() - t.inicio > 15 * 60 * 1000) { tentativas.delete(chave); return false; }
  return t.n >= 8;
}
function falhou(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > 15 * 60 * 1000) tentativas.set(chave, { n: 1, inicio: Date.now() });
  else t.n++;
}

// ---------- auth ----------
function autenticar(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    // Consulta o banco a cada requisição: desativar/excluir alguém vale na hora.
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(p.id);
    if (!u || !u.ativo) return res.status(401).json({ erro: 'Acesso desativado. Fale com o administrador.' });
    req.usuario = u;
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada, faça login novamente' });
  }
}
function soAdmin(req, res, next) {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores.' });
  next();
}

app.post('/api/login', (req, res) => {
  const email = normEmail(req.body.email);
  const senha = String(req.body.senha || '');
  if (!email || !senha) return res.status(400).json({ erro: 'Preencha e-mail e senha' });
  const chave = req.ip + '|' + email;
  if (bloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) {
    falhou(chave);
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
  }
  if (!u.ativo) return res.status(403).json({ erro: 'Acesso desativado. Fale com o administrador.' });
  tentativas.delete(chave);
  const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, usuario: publicUser(u) });
});

app.get('/api/me', autenticar, (req, res) => res.json(publicUser(req.usuario)));

app.get('/api/meus-sites', autenticar, (req, res) => {
  const u = req.usuario;
  const rows = u.role === 'admin'
    ? db.prepare('SELECT id,nome,url,descricao,icone FROM sites WHERE ativo = 1 ORDER BY nome').all()
    : db.prepare(`SELECT s.id,s.nome,s.url,s.descricao,s.icone FROM sites s
                  JOIN permissoes p ON p.site_id = s.id
                  WHERE p.usuario_id = ? AND s.ativo = 1 ORDER BY s.nome`).all(u.id);
  res.json(rows);
});

app.put('/api/minha-senha', autenticar, (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  if (!bcrypt.compareSync(String(senhaAtual || ''), req.usuario.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  if (String(novaSenha || '').length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(novaSenha, 10), req.usuario.id);
  res.json({ ok: true });
});

// ---------- admin: usuários ----------
const adm = [autenticar, soAdmin];
function contarAdminsAtivos(excetoId) {
  return db.prepare("SELECT COUNT(*) n FROM usuarios WHERE role='admin' AND ativo=1 AND id != ?").get(excetoId || 0).n;
}
function listarUsuarios() {
  const us = db.prepare('SELECT * FROM usuarios ORDER BY nome').all();
  const perms = db.prepare('SELECT usuario_id, site_id FROM permissoes').all();
  return us.map(u => ({ ...publicUser(u), sites: perms.filter(p => p.usuario_id === u.id).map(p => p.site_id) }));
}
function gravarPermissoes(usuarioId, siteIds) {
  const ids = (Array.isArray(siteIds) ? siteIds : []).map(Number).filter(Number.isInteger);
  const existentes = new Set(db.prepare('SELECT id FROM sites').all().map(s => s.id));
  const del = db.prepare('DELETE FROM permissoes WHERE usuario_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO permissoes (usuario_id, site_id) VALUES (?, ?)');
  db.transaction(() => { del.run(usuarioId); ids.filter(i => existentes.has(i)).forEach(i => ins.run(usuarioId, i)); })();
}

app.get('/api/admin/usuarios', adm, (req, res) => res.json(listarUsuarios()));

app.post('/api/admin/usuarios', adm, (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = normEmail(req.body.email);
  const senha = String(req.body.senha || '');
  const role = req.body.role === 'admin' ? 'admin' : 'usuario';
  if (!nome) return res.status(400).json({ erro: 'Informe o nome.' });
  if (!emailOk(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail.' });
  const info = db.prepare('INSERT INTO usuarios (nome,email,senha_hash,role,ativo,criado_em) VALUES (?,?,?,?,1,?)')
    .run(nome, email, bcrypt.hashSync(senha, 10), role, new Date().toISOString());
  gravarPermissoes(info.lastInsertRowid, req.body.sites);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/admin/usuarios/:id', adm, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const nome = req.body.nome !== undefined ? String(req.body.nome).trim() : u.nome;
  const email = req.body.email !== undefined ? normEmail(req.body.email) : u.email;
  const role = req.body.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'usuario') : u.role;
  const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : u.ativo;
  if (!nome) return res.status(400).json({ erro: 'Informe o nome.' });
  if (!emailOk(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (email !== u.email && db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail.' });
  if (u.role === 'admin' && u.ativo && (role !== 'admin' || !ativo) && contarAdminsAtivos(id) === 0)
    return res.status(400).json({ erro: 'Precisa existir pelo menos um administrador ativo.' });
  let hash = u.senha_hash;
  if (req.body.senha) {
    if (String(req.body.senha).length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    hash = bcrypt.hashSync(String(req.body.senha), 10);
  }
  db.prepare('UPDATE usuarios SET nome=?, email=?, role=?, ativo=?, senha_hash=? WHERE id=?').run(nome, email, role, ativo, hash, id);
  if (req.body.sites !== undefined) gravarPermissoes(id, req.body.sites);
  res.json({ ok: true });
});

app.delete('/api/admin/usuarios/:id', adm, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode excluir o seu próprio usuário.' });
  if (u.role === 'admin' && u.ativo && contarAdminsAtivos(id) === 0) return res.status(400).json({ erro: 'Precisa existir pelo menos um administrador ativo.' });
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- admin: sites ----------
app.get('/api/admin/sites', adm, (req, res) => res.json(db.prepare('SELECT * FROM sites ORDER BY nome').all().map(s => ({ ...s, ativo: !!s.ativo }))));

function lerSite(body) {
  const nome = String(body.nome || '').trim();
  const url = String(body.url || '').trim();
  if (!nome) return { erro: 'Informe o nome do site.' };
  if (!urlOk(url)) return { erro: 'Endereço inválido. Use o link completo, começando com https://' };
  return { nome, url, descricao: String(body.descricao || '').trim().slice(0, 200), icone: (String(body.icone || '').trim() || '🌐').slice(0, 8), ativo: body.ativo === false ? 0 : 1 };
}
app.post('/api/admin/sites', adm, (req, res) => {
  const s = lerSite(req.body);
  if (s.erro) return res.status(400).json({ erro: s.erro });
  const info = db.prepare('INSERT INTO sites (nome,url,descricao,icone,ativo) VALUES (?,?,?,?,?)').run(s.nome, s.url, s.descricao, s.icone, s.ativo);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put('/api/admin/sites/:id', adm, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Site não encontrado.' });
  const s = lerSite(req.body);
  if (s.erro) return res.status(400).json({ erro: s.erro });
  db.prepare('UPDATE sites SET nome=?, url=?, descricao=?, icone=?, ativo=? WHERE id=?').run(s.nome, s.url, s.descricao, s.icone, s.ativo, id);
  res.json({ ok: true });
});
app.delete('/api/admin/sites/:id', adm, (req, res) => {
  db.prepare('DELETE FROM sites WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
app.listen(PORT, () => console.log('Portal TROK rodando na porta ' + PORT));
