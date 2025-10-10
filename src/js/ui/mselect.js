import M from "materialize-css";

export function reinitSelect(select) {
    const inst = M.FormSelect.getInstance(select);
    if (inst) inst.destroy();
    M.FormSelect.init(select);
}

export function reinitAllSelects(root = document) {
    const selects = root.querySelectorAll("select");
    selects.forEach(s => {
        const inst = M.FormSelect.getInstance(s);
        if (inst) inst.destroy();
    });
    M.FormSelect.init(selects);
}
