/**
 * Logique pour le menu burger
 * Ce script doit être chargé sur toutes les pages.
 */
document.addEventListener('DOMContentLoaded', () => {
    
    // Sélectionne les éléments du DOM
    const burgerBtn = document.getElementById('burger-btn');
    const burgerMenu = document.getElementById('burger-menu');
    const menuOverlay = document.getElementById('menu-overlay'); // NOUVEAU

    // Vérifie si les éléments existent
    if (burgerBtn && burgerMenu && menuOverlay) {
        
        // Fonction pour OUVRIR le menu
        function openMenu() {
            burgerBtn.classList.add('active');
            burgerMenu.classList.add('active');
            menuOverlay.classList.add('active'); // Affiche le voile
        }
        
        // Fonction pour FERMER le menu
        function closeMenu() {
            burgerBtn.classList.remove('active');
            burgerMenu.classList.remove('active');
            menuOverlay.classList.remove('active'); // Masque le voile
        }

        // Le bouton burger "bascule" (toggle) l'état
        burgerBtn.addEventListener('click', () => {
            if (burgerMenu.classList.contains('active')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        // NOUVEAU: Le voile, en cliquant dessus, ferme le menu
        menuOverlay.addEventListener('click', closeMenu);
    }
});