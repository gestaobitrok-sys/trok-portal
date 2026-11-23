# Portal TROK Service

Portal único: o diretor/admin entra com login e senha, escolhe o sistema e clica. Cada funcionário
vê somente os sistemas que o administrador liberou. **Não altera nenhum dos sistemas existentes** —
é um app separado (porta 3002, banco próprio `portal.db`).

## Instalação no Lightsail (uma vez)

1. DNS: crie um registro **A** `portal.trokservice.com.br` apontando para o IP do Lightsail.
2. No servidor:
```bash
cd ~
git clone https://github.com/gestaobitrok-sys/trok-portal.git
cd trok-portal
npm install
cp .env.example .env
nano .env        # troque JWT_SECRET (gere com: openssl rand -hex 32)
node criar-admin.js "Seu Nome" seuemail@trokservice.com.br SuaSenhaForte123
pm2 start server.js --name trok-portal
pm2 save
```
3. nginx — crie `/etc/nginx/sites-available/portal` (e ligue em `sites-enabled`):
```nginx
server {
    listen 80;
    server_name portal.trokservice.com.br;
    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d portal.trokservice.com.br     # liga o HTTPS
```

## Atualizar depois
```bash
cd ~/trok-portal && git pull && pm2 restart trok-portal
```

## Uso
- Aba **Cadastro de sites**: cadastre cada sistema (nome, link, ícone).
- Aba **Usuários**: cadastre funcionário (nome, e-mail/login, senha), marque quais sites ele pode ver.
- Desativar um usuário bloqueia o acesso ao portal imediatamente.

## Limite importante
O portal controla o que **aparece** para cada pessoa. Os sistemas continuam com o login próprio de
cada um e abertos na internet — quem souber o endereço direto ainda chega na tela de login deles.
