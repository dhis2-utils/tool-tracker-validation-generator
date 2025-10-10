import M from "materialize-css";

export function showMessage(message, type = "success") {
    const cls = type === "error" ? "red" : "green";
    const icon = type === "error" ? "error" : "check_circle";
    M.toast({ html: `<i class="material-icons left">${icon}</i>${message}`, classes: cls, displayLength: 4000 });
}
