document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return
        document.querySelector(".tab.active")?.classList.remove("active")
        tab.classList.add("active")
    })
})
