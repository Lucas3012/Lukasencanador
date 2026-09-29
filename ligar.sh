#!/bin/bash

echo "=========================================="
echo "🚀 Iniciando Servidor e Bot WhatsApp..."
echo "📱 WhatsApp Ativo: +5573981070937"
echo "=========================================="

echo "📦 Atualizando repositório no GitHub..."
git add .
git commit -m "Atualização automática"
git push origin main

echo "🤖 Iniciando o Bot Encanador..."
cd ~/site-encanador/Botencanador
node index.js
