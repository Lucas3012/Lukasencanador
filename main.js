const btnPedirOrcamento = document.getElementById('btnPedirOrcamento');
if (btnPedirOrcamento) {
    btnPedirOrcamento.addEventListener('click', () => {
        const numeroWhatsapp = "5573981070937";
        const mensagemOpcao2 = encodeURIComponent("2");
        window.open(`https://wa.me/${numeroWhatsapp}?text=${mensagemOpcao2}`, '_blank');
    });
}
