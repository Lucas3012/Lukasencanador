#!/bin/bash

echo "=========================================="
echo "🚀 Atualizando GitHub e Iniciando Servidor..."
echo "📱 WhatsApp Ativo: +5573981070937"
echo "=========================================="

echo "📦 Enviando alterações para o GitHub..."
git add .
git commit -m "Atualizando número do WhatsApp e arquivos do site"
git push origin main || git push origin master

echo "🤖 Iniciando o Servidor/Bot..."
node server.js &

sleep 3

echo "🌐 Conectando ao Serveo..."
echo "=========================================="

while true; do
  ssh -R lukas-encanador-itabuna:80:localhost:3000 serveo.net
  echo "⚠️ Conexão perdida com o Serveo! Tentando reconectar em 5 segundos..."
  sleep 5
done
