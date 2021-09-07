const toggle = document.querySelector (".nav__toggle")
const navMenu = document.querySelector (".nav__menu")

toggle.addEventListener("click", ()=>{
    navMenu.classList.toggle("nav__menu_visible")
}
)