#!/bin/bash

# Acessa a pasta do projeto
cd ~/site-encanador

echo "🔄 Adicionando arquivos modificados..."
git add .

# Pega a mensagem de commit enviada pelo usuário ou usa uma mensagem padrão
MSG=${1:-"Atualização automática dos arquivos do projeto"}

echo "📝 Salvando alterações: \"$MSG\""
git commit -m "$MSG"

echo "🚀 Enviando para o Render via GitHub..."
git push -u origin main --force

echo "✅ Atualização enviada com sucesso! Aguarde o deploy no Render."
