#!/bin/bash

echo "=========================================="
echo "🚀 Enviando atualizações para o GitHub..."
echo "=========================================="

cd ~/site-encanador

# Adiciona todas as alterações
git add .

# Pede mensagem de commit opcional
read -p "Digite a mensagem do commit (ou aperte ENTER para padrão): " MSG
if [ -z "$MSG" ]; then
  MSG="Atualização para o Render"
fi

git commit -m "$MSG"
git push origin main

echo ""
echo "=========================================="
echo "✅ Enviado! O Render iniciará o deploy automaticamente."
echo "=========================================="
