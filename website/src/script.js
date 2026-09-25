let isActivityLoaded = false;
const activitySection = document.querySelector(".main-content > section.activity");

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
        if (tab.classList.contains("active")) return;
        document.querySelector(".tab.active")?.classList.remove("active");
        tab.classList.add("active");

        if (tab.classList.contains("activity")) await goToActivity();
    })
})

const goToActivity = async () => {
    if (isActivityLoaded) return;
    isActivityLoaded = true;
    activitySection.innerHTML = "<p style='color: var(--text-muted);'>Loading activity...</p>";
    try {
        const res = await fetch("/activity.html");
        activitySection.innerHTML = await res.text();
    } catch (error) {
        console.error(error);
        activitySection.innerHTML = "<p style='color: var(--text-muted);'>Failed to load activity.</p>";
    }
}

document.querySelector(".btn-go-to-activity")
    .addEventListener("click", async () => {
        document.querySelector(".tab.active")?.classList.remove("active");
        document.querySelector(".tab.activity").classList.add("active");
        window.scrollTo(0, 0);

        await goToActivity();
    });
