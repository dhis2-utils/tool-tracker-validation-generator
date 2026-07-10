// Centralized application state with simple getters/setters

const state = {
    currentProgram: null,
    programMetadata: null,
    currentVariable: null,
    programConfig: null,
    dateVariables: null,
    batchTemplates: []
};

export function setState(partial) {
    Object.assign(state, partial);
}

export function getState() {
    return state;
}

export function resetOnProgramChange(programId) {
    state.currentProgram = programId;
    state.programMetadata = null;
    state.currentVariable = null;
    state.programConfig = null;
    state.dateVariables = null;
    state.batchTemplates = [];
}

export function setCurrentVariable(variable) {
    state.currentVariable = variable;
}
