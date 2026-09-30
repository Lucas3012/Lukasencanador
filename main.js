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

    // Modal de Pedir Orçamento enviando para o Bot do WhatsApp
    const btnPedirOrcamento = document.getElementById('btnPedirOrcamento');
    if (btnPedirOrcamento) {
        btnPedirOrcamento.addEventListener('click', () => {
            Swal.fire({
                title: 'Solicitar Orçamento',
                html: `
                    <input id="swal-nome" class="swal2-input" placeholder="Seu Nome *">
                    <select id="swal-servico" class="swal2-select" style="display: flex; width: 80%; margin: 1em auto;">
                        <option value="" disabled selected>Selecione o Serviço *</option>
                        <option value="Desentupimento">Desentupimento</option>
                        <option value="Reparação de Vazamento">Reparação de Vazamento</option>
                        <option value="Instalações">Instalações</option>
                        <option value="Outro Serviço">Outro Serviço</option>
                    </select>
                `,
                showCancelButton: true,
                confirmButtonText: 'Enviar para o Bot',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#0d47a1',
                focusConfirm: false,
                preConfirm: () => {
                    const nome = document.getElementById('swal-nome').value.trim();
                    const servico = document.getElementById('swal-servico').value;

                    if (!nome || !servico) {
                        Swal.showValidationMessage('Por favor, preencha o seu nome e escolha o serviço.');
                        return false;
                    }
                    return { nome, servico };
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    const { nome, servico } = result.value;
                    const numeroWhatsapp = "5573981070937";
                    
                    // Monta a mensagem que aciona o bot com o nome e serviço
                    const textoMensagem = `2\nOlá, meu nome é ${nome} e gostaria de um orçamento para: ${servico}.`;
                    const url = `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoMensagem)}`;
                    
                    window.open(url, '_blank');
                }
            });
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
