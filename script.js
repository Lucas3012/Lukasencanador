document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('menuToggle');
    const navMenu = document.getElementById('navMenu');

    if (toggleBtn && navMenu) {
        toggleBtn.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    }
});
