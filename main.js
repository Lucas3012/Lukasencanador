document.addEventListener('DOMContentLoaded', () => {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('#navMenu a');

    if (hamburgerBtn && navMenu) {
        hamburgerBtn.addEventListener('click', () => {
            navMenu.classList.toggle('show');
            const icon = hamburgerBtn.querySelector('i');
            if (navMenu.classList.contains('show')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-xmark');
            } else {
                icon.classList.remove('fa-xmark');
                icon.classList.add('fa-bars');
            }
        });

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (link.id !== 'btnAdminLogin') {
                    navMenu.classList.remove('show');
                    const icon = hamburgerBtn.querySelector('i');
                    if (icon) {
                        icon.classList.remove('fa-xmark');
                        icon.classList.add('fa-bars');
                    }
                }
            });
        });
    }

    const btnPedirOrcamento = document.getElementById('btnPedirOrcamento');
    if (btnPedirOrcamento) {
        btnPedirOrcamento.addEventListener('click', () => {
            const numeroWhatsapp = "5573981070937";
            const textoMensagem = "orçamento automático";
            const url = `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoMensagem)}`;
            
            window.open(url, '_blank');
        });
    }

    const formContacto = document.getElementById('formContacto');
    if (formContacto) {
        formContacto.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dados = {
                nome: document.getElementById('nome').value,
                telefone: document.getElementById('telefone').value,
                servico: document.getElementById('servico').value,
                mensagem: document.getElementById('mensagem').value
            };
            await enviarOrcamentoAPI(dados, formContacto);
        });
    }

    const btnAdminLogin = document.getElementById('btnAdminLogin');
    if (btnAdminLogin) {
        btnAdminLogin.addEventListener('click', (e) => {
            e.preventDefault();
            if (navMenu) navMenu.classList.remove('show');
            
            Swal.fire({
                title: '<i class="fa-solid fa-user-shield"></i> Painel do Administrador',
                html: `
                    <input id="swal-user" class="swal2-input" placeholder="Usuário">
                    <input id="swal-pass" type="password" class="swal2-input" placeholder="Senha">
                `,
                showCancelButton: true,
                confirmButtonText: 'Entrar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#0d47a1',
                preConfirm: () => {
                    const usuario = document.getElementById('swal-user').value.trim();
                    const senha = document.getElementById('swal-pass').value.trim();
                    if (!usuario || !senha) {
                        Swal.showValidationMessage('Preencha usuário e senha');
                        return false;
                    }
                    return { usuario, senha };
                }
            }).then(async (res) => {
                if (res.isConfirmed) {
                    Swal.showLoading();
                    try {
                        const response = await fetch('/api/admin/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(res.value)
                        });
                        const data = await response.json();

                        if (data.sucesso || data.success) {
                            localStorage.setItem('token', data.token);
                            Swal.fire({
                                icon: 'success',
                                title: 'Acesso Concedido!',
                                text: `Redirecionando para o painel...`,
                                timer: 1500,
                                showConfirmButton: false
                            }).then(() => {
                                window.location.href = '/admin-dashboard.html';
                            });
                        } else {
                            Swal.fire('Acesso Negado', data.mensagem || 'Credenciais inválidas.', 'error');
                        }
                    } catch (err) {
                        Swal.fire('Erro', 'Não foi possível conectar ao servidor.', 'error');
                    }
                }
            });
        });
    }

    // ==========================================
    // LÓGICA DO WEB CHAT COM IA
    // ==========================================
    const chatFloatBtn = document.getElementById('chatFloatBtn');
    const chatBox = document.getElementById('chatBox');
    chatCloseBtn = document.getElementById('chatCloseBtn');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const chatBadge = document.getElementById('chatBadge');

    let sessionId = localStorage.getItem('chat_session_id');
    if (!sessionId) {
        sessionId = 'sessao_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('chat_session_id', sessionId);
    }

    const mensagemBoasVindas = "Olá! Seja bem-vindo ao Lukas Encanador. 🛠️\nComo posso ajudar você hoje?";

    if (chatMessages && chatMessages.children.length === 0) {
        adicionarMensagem('bot', mensagemBoasVindas);
    }

    if (chatFloatBtn && chatBox) {
        chatFloatBtn.addEventListener('click', () => {
            chatBox.classList.toggle('open');
            if (chatBadge) chatBadge.style.display = 'none';
        });
    }

    if (chatCloseBtn && chatBox) {
        chatCloseBtn.addEventListener('click', () => {
            chatBox.classList.remove('open');
        });
    }

    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mensagemTexto = chatInput.value.trim();
            if (!mensagemTexto) return;

            adicionarMensagem('user', mensagemTexto);
            chatInput.value = '';

            const loaderId = adicionarMensagem('bot', 'A escrever...');

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: sessionId,
                        message: mensagemTexto
                    })
                });

                const data = await response.json();
                
                const loaderElem = document.getElementById(loaderId);
                if (loaderElem) loaderElem.remove();

                if (data.sucesso || data.resposta) {
                    adicionarMensagem('bot', data.resposta);
                } else {
                    adicionarMensagem('bot', 'Desculpe, ocorreu um erro ao processar sua resposta.');
                }
            } catch (err) {
                const loaderElem = document.getElementById(loaderId);
                if (loaderElem) loaderElem.remove();
                adicionarMensagem('bot', 'Falha na conexão com o servidor. Tente novamente mais tarde.');
            }
        });
    }

    function adicionarMensagem(remetente, texto) {
        const msgDiv = document.createElement('div');
        const idUnico = 'msg_' + Date.now();
        msgDiv.id = idUnico;
        msgDiv.classList.add('message', remetente);
        msgDiv.innerText = texto;
        
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        return idUnico;
    }
});

async function enviarOrcamentoAPI(dados, formElement = null) {
    Swal.fire({
        title: 'Enviando...',
        text: 'Aguarde um momento.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch('/api/contacto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
        const res = await response.json();

        if (res.sucesso || res.success) {
            Swal.fire({
                icon: 'success',
                title: 'Pedido Recebido!',
                text: 'Obrigado! Entraremos em contacto o mais rápido possível.',
                confirmButtonColor: '#0d47a1'
            });
            if (formElement) formElement.reset();
        } else {
            Swal.fire('Atenção', res.mensagem || 'Erro ao processar.', 'warning');
        }
    } catch (err) {
        Swal.fire('Erro', 'Falha ao conectar com o servidor.', 'error');
    }
}

function exibirInfoServico(titulo, descricao) {
    Swal.fire({
        title: titulo,
        text: descricao,
        icon: 'info',
        confirmButtonText: 'Pedir esse Serviço',
        confirmButtonColor: '#0d47a1',
        showCancelButton: true,
        cancelButtonText: 'Fechar'
    }).then((res) => {
        if (res.isConfirmed) {
            const btn = document.getElementById('btnPedirOrcamento');
            if (btn) btn.click();
        }
    });
}
