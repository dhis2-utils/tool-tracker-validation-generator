"use strict";

//JS
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
loadLegacyHeaderBarIfNeeded();

//CSS
import "./css/style.css";


/**
 * Saves a configuration of prefix etc for a program
 * @param {string} programId - The ID of the program
 * @param {Object} config - The configuration to be saved
 */
function progSetConfig(programId, config) {
    // Implementation goes here
    /**
Using the Web API (for web apps)
Get a value:
Make a GET request to /api/dataStore/{namespace}/{key} to retrieve a value.
Set a value:
Make a PUT request to /api/dataStore/{namespace}/{key} with your value as the JSON payload.
     */
}

/**
 * Loads a configuration of prefix etc for a program
 * @param {string} programId - The ID of the program
 * @param {Object} config - The configuration to be loaded
 */
function progGetConfig(programId, config) {
    // Implementation goes here
    /**
Using the Web API (for web apps)
Get a value:
Make a GET request to /api/dataStore/{namespace}/{key} to retrieve a value.
Set a value:
Make a PUT request to /api/dataStore/{namespace}/{key} with your value as the JSON payload.
     */
}

/**
 * Gets the PRV for a data element or tracked entity attribute with the given ID from the API; creates a programRuleVariable object if it doesn’t exist (but doesn’t POST it to the API)
 * @param {string} type - The type of the element (data element or tracked entity attribute)
 * @param {string} id - The ID of the element
 */
function prvGetSet(type, id) {
    // Implementation goes here
    // /api/programRuleVariables
}

/**
 * Performs a dry run import of the program rule to see if there are validation issues
 * @param {Object} programRule - The program rule to validate
 */
function prValidate(programRule) {
    // Implementation goes here
}

/**
 * Creates a new programRule and associated programRuleVariables and programRuleActions using POST operation
 * @param {Object} programRule - The program rule to create
 * @param {Array} programRuleActions - The program rule actions to create
 * @param {Array} programRuleVariables - The program rule variables to create
 */
function prCreate(programRule, programRuleActions, programRuleVariables) {
    // Implementation goes here
    // /api/programRuleVariables
    // /api/programRuleActions
    // /api/programRules
}

/**
 * Updates an existing program rule with associated programRuleActions and programRuleVariables.
 * Note that programRuleVariables cannot be renamed, as this breaks the system.
 * Also note that if programRuleActions are removed from a programRule being updated, they should be removed via the API.
 * This function first fetches all the existing metadata from the server, compares it with the updated metadata, then makes the appropriate API calls (PATCH, DELETE, POST)
 * @param {Object} programRule - The program rule to update
 * @param {Array} programRuleActions - The program rule actions to update
 * @param {Array} programRuleVariables - The program rule variables to update
 */
function prUpdate(programRule, programRuleActions, programRuleVariables) {
    // Implementation goes here
    
    // /api/programRuleVariables
    // /api/programRuleActions
    // /api/programRules
}

/**
 * Gets all programmes from the instance; name and id only
 * @returns {Array} An array of programs with name and id
 */
function programsAllGet() {
    // Implementation goes here

    // /api/programs
}

/**
 * Gets all required metadata for one particular programme: relevant program metadata, existing program rules, existing program rule actions, existing program rule variables.
 * @param {string} programId - The ID of the program
 * @returns {Object} The program metadata
 */
function programGet(programId) {
    // Implementation goes here

    // /api/programs/{id}?fields=name,id,programStages[name,id,executionDateLabel,hideDueDate,programStageDataElements[dataElement[id,name,valueType]],programStageSections[id,name,dataElements[id]]],trackedEntityType[trackedEntityTypeAttributes[id,name,valueType]],programTrackedEntityAttributes[trackedEntityAttribute[id,name,valueType]],enrollmentDateLabel,incidentDateLabel,displayIncidentDate,ignoreOverdueEvents
    // /api/programRules?filter=program.id:eq:{id}
    // /api/programRuleVariables?filter=program.id:eq:{id}
    // /api/programRuleActions?filter=programRule.program.id:eq:{id}
}

/**
 * Identifies all the validations currently existing for a particular variable - including both the system-generated dates, tracked entity attributes, and data elements.
 * @param {string} type - The type of the variable
 * @param {string} id - The ID of the variable
 * @returns {Array} An array of validations
 */
function prGetExisting(type, id) {
    // Implementation goes here
}

/**
 * Fetches a new UID from the /system/id API endpoint and returns it.
 * @returns {string} The new UID
 */
function getId() {
    // Implementation goes here

    // /api/system/id returns:
    /**
     {
"codes": [
"{ZuyVpR2w8jw}"
]
}
     */
}
