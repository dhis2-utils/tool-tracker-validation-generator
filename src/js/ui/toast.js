let container = null;

function getContainer() {
    if (!container) {
        container = document.getElementById("toast-container");
    }
    return container;
}

export function showToast(message, type = "info", duration = 4000) {
    const c = getContainer();
    if (!c) return;

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;

    const dot = document.createElement("span");
    dot.className = "toast-dot";

    const text = document.createTextNode(message);

    el.appendChild(dot);
    el.appendChild(text);
    c.appendChild(el);

    // Trigger animation on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add("toast-visible"));
    });

    setTimeout(() => {
        el.classList.remove("toast-visible");
        el.addEventListener("transitionend", () => el.remove(), { once: true });
    }, duration);
}

// Alias for backward compatibility
export const showMessage = showToast;
