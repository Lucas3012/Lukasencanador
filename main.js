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

    // Botão Pedir Orçamento com texto "orçamento automático"
    const btnPedirOrcamento = document.getElementById('btnPedirOrcamento');
    if (btnPedirOrcamento) {
        btnPedirOrcamento.addEventListener('click', () => {
            const numeroWhatsapp = "5573981070937";
            const textoMensagem = "orçamento automático";
            const url = `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoMensagem)}`;
            
            window.open(url, '_blank');
        });
    }

    // Formulário de Contacto integrado ao WhatsApp
    const formContacto = document.getElementById('formContacto');
    if (formContacto) {
        formContacto.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const nome = document.getElementById('nome').value.trim();
            const telefone = document.getElementById('telefone').value.trim();
            const servico = document.getElementById('servico').value;
            const mensagem = document.getElementById('mensagem').value.trim();
            
            const numeroWhatsapp = "5573981070937";
            
            let textoMensagem = `Olá! Gostaria de solicitar um orçamento.\n\n`;
            textoMensagem += `*Nome:* ${nome}\n`;
            if (telefone) textoMensagem += `*Telefone:* ${telefone}\n`;
            if (servico) textoMensagem += `*Serviço:* ${servico}\n`;
            if (mensagem) textoMensagem += `*Mensagem:* ${mensagem}`;

            const url = `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoMensagem)}`;
            
            window.open(url, '_blank');
            formContacto.reset();
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
