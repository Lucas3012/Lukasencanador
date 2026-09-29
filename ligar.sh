#!/bin/bash

echo "=========================================="
echo "🚀 Iniciando Servidor, Bot e Serveo..."
echo "📱 WhatsApp Ativo: +5573981070937"
echo "=========================================="

# Ajuste do Git para a branch main
git add .
git commit -m "Atualizacao automatica"
git push origin main

echo "🤖 Iniciando o Bot Encanador..."
cd ~/site-encanador/Botencanador
node index.js &

sleep 3

echo "🌐 Conectando ao Serveo..."
echo "=========================================="

while true; do
  ssh -R lukas-encanador-itabuna:80:localhost:3000 serveo.net
  echo "⚠️ Conexão perdida com o Serveo! Tentando reconectar em 5 segundos..."
  sleep 5
done
