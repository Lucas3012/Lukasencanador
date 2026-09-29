#!/bin/bash

echo "=========================================="
echo "🚀 Atualizando GitHub e Iniciando Servidor..."
echo "📱 WhatsApp Ativo: +5573981070937"
echo "=========================================="

echo "📦 Enviando alterações para o GitHub..."
git add .
git commit -m "Atualizando repositório e arquivos"
git push origin main --force || git push origin master --force

echo "🤖 Iniciando o Bot (Botencanador/index.js)..."
node Botencanador/index.js < /dev/null &

sleep 3

echo "🌐 Conectando ao Serveo..."
echo "=========================================="

while true; do
  ssh -R lukas-encanador-itabuna:80:localhost:3000 serveo.net
  echo "⚠️ Conexão perdida com o Serveo! Tentando reconectar em 5 segundos..."
  sleep 5
done
